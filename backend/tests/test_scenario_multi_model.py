"""
Scenario: multiple models on same feature set with different types and params.

Tests that:
- lightgbm, xgboost, random_forest all complete successfully on the same data
- Each has different CV metrics (models differ)
- All have oos_start_index > 0 (OOS enforced)
- Metrics stay in valid ranges
- Backtest can run on each model
"""
import asyncio
import io
import json
import time

import httpx
import numpy as np
import pandas as pd
import polars as pl
import pytest

API_BASE = "http://localhost:8000/api/v1"
WS_BASE  = "ws://localhost:8000/api/v1/ws"
TIMEOUT  = 300


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_csv(n_rows: int = 600) -> bytes:
    rng = np.random.default_rng(7)
    dates = pd.date_range("2021-01-01", periods=n_rows, freq="D")
    closes = np.cumprod(1 + rng.normal(0, 0.01, n_rows)) * 200
    df = pl.DataFrame({
        "datetime": dates,
        "open":   closes * (1 - rng.uniform(0, 0.002, n_rows)),
        "high":   closes * (1 + rng.uniform(0, 0.006, n_rows)),
        "low":    closes * (1 - rng.uniform(0, 0.006, n_rows)),
        "close":  closes,
        "volume": rng.integers(2000, 15000, n_rows).tolist(),
    })
    buf = io.BytesIO(); df.write_csv(buf); return buf.getvalue()


async def _wait_task(task_id: str, timeout: int = TIMEOUT) -> dict:
    from websockets import connect
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            async with connect(f"{WS_BASE}/task/{task_id}") as ws:
                while time.time() < deadline:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    data = json.loads(msg)
                    if data["status"] == "SUCCESS": return data
                    if data["status"] == "FAILURE":
                        raise AssertionError(f"Task FAILED: {data}")
        except Exception as e:
            if "1012" in str(e) or "ConnectionClosedError" in type(e).__name__:
                await asyncio.sleep(0.5); continue
            raise
    raise TimeoutError(f"Timed out after {timeout}s")


def _wait(task_id: str) -> dict:
    return asyncio.run(_wait_task(task_id))


MODEL_CONFIGS = [
    {
        "label": "lgbm_default",
        "model_type": "lightgbm",
        "hyperparameters": {"n_estimators": 100, "num_leaves": 31, "learning_rate": 0.1},
        "n_splits": 4,
        "gap": 10,
    },
    {
        "label": "lgbm_shallow",
        "model_type": "lightgbm",
        "hyperparameters": {"n_estimators": 50, "num_leaves": 15, "learning_rate": 0.05},
        "n_splits": 3,
        "gap": 5,
    },
    {
        "label": "rf_default",
        "model_type": "random_forest",
        "hyperparameters": {"n_estimators": 100, "max_depth": None, "min_samples_split": 5},
        "n_splits": 3,
        "gap": 5,
    },
]


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=300.0) as c:
        yield c


@pytest.fixture(scope="module")
def pipeline_and_fs(client):
    csv_bytes = _make_csv(600)
    r = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "MULTI_MODEL", "timeframe": "1d"},
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 201, r.text
    dataset_id = r.json()["id"]

    r2 = client.post(f"{API_BASE}/pipelines/generate", json={
        "dataset_id": dataset_id,
        "name": "scenario_multi_model",
        "indicators": [
            {"name": "rsi",  "params": {"length": 14}},
            {"name": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}},
            {"name": "ema",  "params": {"length": 21}},
            {"name": "bbands", "params": {"length": 20, "std": 2.0}},
            {"name": "atr",  "params": {"length": 14}},
        ],
        "targets": [
            {"name": "y_dir_5d", "method": "n_bar", "params": {"shift": 5, "type": "classification"}}
        ],
        "lags": [1, 2, 3],
    })
    assert r2.status_code == 202, r2.text
    pd_data = r2.json()
    _wait(pd_data["celery_task_id"])

    pipe = client.get(f"{API_BASE}/pipelines/{pd_data['id']}").json()
    feature_cols = [c for c in pipe["feature_columns"] if not c.startswith("y_")]

    r3 = client.post(f"{API_BASE}/feature-sets/", json={
        "pipeline_id": pd_data["id"],
        "name": "fs_multi_model",
        "selected_columns": feature_cols,
        "target_column": "y_dir_5d",
    })
    assert r3.status_code in (200, 201), r3.text
    fs = r3.json()

    return {"pipeline_id": pd_data["id"], "feature_set_id": fs["id"]}


@pytest.fixture(scope="module")
def trained_models(client, pipeline_and_fs):
    """Train all model configs and return their results."""
    results = {}
    for cfg in MODEL_CONFIGS:
        r = client.post(f"{API_BASE}/models/train", json={
            "pipeline_id": pipeline_and_fs["pipeline_id"],
            "feature_set_id": pipeline_and_fs["feature_set_id"],
            "target_column": "y_dir_5d",
            **{k: v for k, v in cfg.items() if k != "label"},
        })
        assert r.status_code == 202, f"{cfg['label']} train request failed: {r.text}"
        data = r.json()
        _wait(data["celery_task_id"])
        model = client.get(f"{API_BASE}/models/{data['id']}").json()
        results[cfg["label"]] = model
    return results


def test_all_models_completed(trained_models):
    for label, model in trained_models.items():
        assert model["status"] == "completed", f"{label}: status={model['status']}"


def test_all_have_oos_index(trained_models):
    for label, model in trained_models.items():
        oos_idx = model["cv_metrics"]["oos_start_index"]
        assert oos_idx > 0, f"{label}: oos_start_index = {oos_idx}"


def test_accuracy_is_valid_probability(trained_models):
    for label, model in trained_models.items():
        agg = model["cv_metrics"]["aggregate"]
        for k, v in agg.items():
            if "accuracy" in k:
                assert 0.0 <= v <= 1.0, f"{label}: {k}={v} outside [0,1]"
            if "f1" in k:
                assert 0.0 <= v <= 1.0, f"{label}: {k}={v} outside [0,1]"


def test_sharpe_in_sane_range(trained_models):
    for label, model in trained_models.items():
        agg = model["cv_metrics"]["aggregate"]
        if "sharpe_mean" in agg:
            s = agg["sharpe_mean"]
            assert -30 < s < 30, f"{label}: sharpe_mean={s} seems unrealistic"


def test_models_are_not_identical(trained_models):
    """Different model types should produce different metrics."""
    labels_to_check = ["lgbm_default", "rf_default"]
    available = {l: trained_models[l] for l in labels_to_check if l in trained_models}
    if len(available) < 2:
        pytest.skip("Not enough model types to compare")
    sharpes = []
    for label, model in available.items():
        agg = model["cv_metrics"]["aggregate"]
        s = agg.get("sharpe_mean", agg.get("sharpe", None))
        if s is not None:
            sharpes.append(round(s, 4))
    # At least 2 different sharpe values
    assert len(set(sharpes)) >= 2, f"All models have same sharpe? {sharpes}"


def test_backtest_runs_on_each_model(client, pipeline_and_fs, trained_models):
    """Verify backtest can run for each completed model."""
    for label, model in trained_models.items():
        r = client.post(f"{API_BASE}/backtests/run", json={
            "pipeline_id": pipeline_and_fs["pipeline_id"],
            "model_id": model["id"],
            "feature_set_id": pipeline_and_fs["feature_set_id"],
            "initial_capital": 10000,
            "commission": 0.001,
        })
        assert r.status_code in (200, 201, 202), f"{label} backtest failed: {r.text}"
        bt_data = r.json()
        _wait(bt_data["celery_task_id"])

        bt = client.get(f"{API_BASE}/backtests/{bt_data['id']}").json()
        assert bt["status"] == "completed", f"{label} backtest not completed: {bt['status']}"
        m = bt["metrics"]
        assert "total_return" in m, f"{label}: total_return missing from {list(m.keys())}"
        assert -100 <= m["total_return"] <= 10000, f"{label}: total_return={m['total_return']}"
        assert -100 <= m.get("max_drawdown", 0) <= 0, f"{label}: max_drawdown={m.get('max_drawdown')}"
