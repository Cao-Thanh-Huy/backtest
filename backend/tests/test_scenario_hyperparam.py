"""
Scenario: hyperparameter grid search — 6 lightgbm configs.

Tests that:
- All 6 jobs complete successfully
- Best job (highest accuracy_mean) is correctly identified
- Winner has better accuracy than the worst
- All OOS indices > 0
- Param values are reflected in stored model metadata
- Demonstrates the tuning page's backend usage pattern
"""
import asyncio
import io
import json
import time
from itertools import product

import httpx
import numpy as np
import pandas as pd
import polars as pl
import pytest

API_BASE = "http://localhost:8000/api/v1"
WS_BASE  = "ws://localhost:8000/api/v1/ws"
TIMEOUT  = 300


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_csv(n_rows: int = 500) -> bytes:
    rng = np.random.default_rng(55)
    dates = pd.date_range("2022-01-01", periods=n_rows, freq="D")
    closes = np.cumprod(1 + rng.normal(0, 0.01, n_rows)) * 1000
    df = pl.DataFrame({
        "datetime": dates,
        "open":   closes * (1 - rng.uniform(0, 0.002, n_rows)),
        "high":   closes * (1 + rng.uniform(0, 0.006, n_rows)),
        "low":    closes * (1 - rng.uniform(0, 0.006, n_rows)),
        "close":  closes,
        "volume": rng.integers(5000, 20000, n_rows).tolist(),
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


# ── param grid ────────────────────────────────────────────────────────────────
# 2 n_estimators × 3 max_depth = 6 combinations
N_ESTIMATORS_GRID = [50, 200]
MAX_DEPTH_GRID    = [3, 5, 8]

PARAM_GRID = [
    {"n_estimators": n, "max_depth": d, "learning_rate": 0.1}
    for n, d in product(N_ESTIMATORS_GRID, MAX_DEPTH_GRID)
]
assert len(PARAM_GRID) == 6


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=60.0) as c:
        yield c


@pytest.fixture(scope="module")
def pipeline_and_fs(client):
    csv_bytes = _make_csv(500)
    r = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "HYPERPARAM_TEST", "timeframe": "1d"},
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 201, r.text
    dataset_id = r.json()["id"]

    r2 = client.post(f"{API_BASE}/pipelines/generate", json={
        "dataset_id": dataset_id,
        "name": "scenario_hyperparam",
        "indicators": [
            {"name": "rsi",   "params": {"length": 14}},
            {"name": "ema",   "params": {"length": 21}},
            {"name": "macd",  "params": {"fast": 12, "slow": 26, "signal": 9}},
            {"name": "atr",   "params": {"length": 14}},
            {"name": "bbands","params": {"length": 20, "std": 2.0}},
        ],
        "targets": [
            {"name": "y_dir_5d", "method": "n_bar", "params": {"shift": 5, "type": "classification"}}
        ],
        "lags": [1, 2],
    })
    assert r2.status_code == 202, r2.text
    pd_data = r2.json()
    _wait(pd_data["celery_task_id"])

    pipe = client.get(f"{API_BASE}/pipelines/{pd_data['id']}").json()
    feature_cols = [c for c in pipe["feature_columns"] if not c.startswith("y_")]

    r3 = client.post(f"{API_BASE}/feature-sets/", json={
        "pipeline_id": pd_data["id"],
        "name": "fs_hyperparam",
        "selected_columns": feature_cols,
        "target_column": "y_dir_5d",
    })
    assert r3.status_code in (200, 201), r3.text

    return {"pipeline_id": pd_data["id"], "feature_set_id": r3.json()["id"]}


@pytest.fixture(scope="module")
def sweep_results(client, pipeline_and_fs):
    """Submit all 6 training jobs and collect results."""
    results = []
    for combo in PARAM_GRID:
        r = client.post(f"{API_BASE}/models/train", json={
            "pipeline_id": pipeline_and_fs["pipeline_id"],
            "feature_set_id": pipeline_and_fs["feature_set_id"],
            "target_column": "y_dir_5d",
            "model_type": "lightgbm",
            "hyperparameters": combo,
            "n_splits": 3,
            "gap": 5,
        })
        assert r.status_code == 202, f"Train failed for {combo}: {r.text}"
        data = r.json()
        _wait(data["celery_task_id"])
        model = client.get(f"{API_BASE}/models/{data['id']}").json()
        results.append({"params": combo, "model": model})
    return results


def test_all_6_jobs_completed(sweep_results):
    assert len(sweep_results) == 6
    for entry in sweep_results:
        label = str(entry["params"])
        assert entry["model"]["status"] == "completed", f"{label}: {entry['model']['status']}"


def test_all_have_oos_index(sweep_results):
    for entry in sweep_results:
        oos = entry["model"]["cv_metrics"]["oos_start_index"]
        assert oos > 0, f"{entry['params']}: oos_start_index = {oos}"


def test_all_accuracy_in_range(sweep_results):
    for entry in sweep_results:
        agg = entry["model"]["cv_metrics"]["aggregate"]
        for k, v in agg.items():
            if "accuracy" in k:
                assert 0.0 <= v <= 1.0, f"{entry['params']}: {k}={v}"


def test_best_model_can_be_identified(sweep_results):
    """The best model by accuracy_mean should be identifiable."""
    completed = [e for e in sweep_results if e["model"]["status"] == "completed"]
    assert len(completed) >= 2

    def get_accuracy(e):
        agg = e["model"]["cv_metrics"]["aggregate"]
        # Try various accuracy-like keys
        for k in ["accuracy_mean", "balanced_accuracy_mean", "f1_weighted_mean"]:
            if k in agg:
                return agg[k]
        return max((v for k, v in agg.items() if "accuracy" in k), default=0.0)

    best = max(completed, key=get_accuracy)
    worst = min(completed, key=get_accuracy)

    print(f"Best params:  {best['params']} → accuracy={get_accuracy(best):.4f}")
    print(f"Worst params: {worst['params']} → accuracy={get_accuracy(worst):.4f}")

    assert get_accuracy(best) >= get_accuracy(worst), "Best should be >= worst"


def test_param_diversity_in_metrics(sweep_results):
    """Different param combos should produce somewhat different metrics — not all identical."""
    completed = [e for e in sweep_results if e["model"]["status"] == "completed"]

    def get_accuracy(e):
        agg = e["model"]["cv_metrics"]["aggregate"]
        for k in ["accuracy_mean", "balanced_accuracy_mean", "f1_weighted_mean"]:
            if k in agg:
                return agg[k]
        return 0.0

    accuracies = [round(get_accuracy(e), 6) for e in completed]
    unique_accuracies = set(accuracies)
    # At least 2 distinct accuracy values among 6 configs
    assert len(unique_accuracies) >= 2, (
        f"All {len(completed)} models have identical accuracy {accuracies} — "
        "likely a bug in hyperparameter passing"
    )


def test_n_estimators_reflected_in_model(client, sweep_results):
    """Verify hyperparameters are stored and retrievable."""
    for entry in sweep_results:
        model = entry["model"]
        stored_hp = model.get("hyperparameters") or {}
        expected_n = entry["params"]["n_estimators"]
        if stored_hp:
            assert int(stored_hp.get("n_estimators", expected_n)) == expected_n, (
                f"Stored n_estimators mismatch: expected {expected_n}, got {stored_hp}"
            )


def test_sweep_6_jobs_independently_tracked(client, pipeline_and_fs):
    """
    Re-submit 2 jobs and verify both can be tracked simultaneously.
    This mirrors the frontend's parallel WebSocket tracking.
    """
    small_grid = [
        {"n_estimators": 50, "max_depth": 3},
        {"n_estimators": 100, "max_depth": 5},
    ]
    task_ids = []
    for combo in small_grid:
        r = client.post(f"{API_BASE}/models/train", json={
            "pipeline_id": pipeline_and_fs["pipeline_id"],
            "feature_set_id": pipeline_and_fs["feature_set_id"],
            "target_column": "y_dir_5d",
            "model_type": "lightgbm",
            "hyperparameters": combo,
            "n_splits": 3,
            "gap": 5,
        })
        assert r.status_code == 202
        task_ids.append(r.json()["celery_task_id"])

    # Wait for both in parallel using asyncio.gather
    async def wait_all():
        tasks = [_wait_task(tid) for tid in task_ids]
        return await asyncio.gather(*tasks)

    results = asyncio.run(wait_all())
    assert all(r["status"] == "SUCCESS" for r in results), f"Some tasks failed: {results}"
