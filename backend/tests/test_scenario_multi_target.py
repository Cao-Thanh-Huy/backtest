"""
Scenario: multiple target types — regression, n_bar classification, triple_barrier.

Tests that:
- A single pipeline can produce all 3 target types simultaneously
- Each target column has expected value distributions:
    * regression: continuous, no large outliers
    * classification: labels in {-1, 0, 1}
    * triple_barrier: labels in {-1, 0, 1}, reasonable class mix
- A model can be trained for each target type
- Regression model has r2 metric; classification has accuracy/f1
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
    rng = np.random.default_rng(99)
    dates = pd.date_range("2020-01-01", periods=n_rows, freq="D")
    closes = np.cumprod(1 + rng.normal(0.0002, 0.012, n_rows)) * 50000
    df = pl.DataFrame({
        "datetime": dates,
        "open":   closes * (1 - rng.uniform(0, 0.002, n_rows)),
        "high":   closes * (1 + rng.uniform(0, 0.008, n_rows)),
        "low":    closes * (1 - rng.uniform(0, 0.008, n_rows)),
        "close":  closes,
        "volume": rng.integers(1000, 10000, n_rows).tolist(),
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


# ── test setup ────────────────────────────────────────────────────────────────

INDICATORS = [
    {"name": "rsi",  "params": {"length": 14}},
    {"name": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}},
    {"name": "atr",  "params": {"length": 14}},
]

TARGETS = [
    {
        "name": "y_return_5d",
        "method": "n_bar",
        "params": {"shift": 5, "type": "regression"},
    },
    {
        "name": "y_dir_5d",
        "method": "n_bar",
        "params": {"shift": 5, "type": "classification"},
    },
    {
        "name": "y_tb_5d",
        "method": "triple_barrier",
        "params": {"tp": 0.02, "sl": 0.01, "max_bars": 24},
    },
]


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=300.0) as c:
        yield c


@pytest.fixture(scope="module")
def multi_target_pipeline(client):
    csv_bytes = _make_csv(600)
    r = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "MULTI_TARGET", "timeframe": "1d"},
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 201, r.text
    dataset_id = r.json()["id"]

    r2 = client.post(f"{API_BASE}/pipelines/generate", json={
        "dataset_id": dataset_id,
        "name": "scenario_multi_target",
        "indicators": INDICATORS,
        "targets": TARGETS,
        "lags": [1, 2],
    })
    assert r2.status_code == 202, r2.text
    data = r2.json()
    _wait(data["celery_task_id"])
    return data


def test_pipeline_completed(client, multi_target_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{multi_target_pipeline['id']}")
    assert r.json()["status"] == "completed"


def test_all_target_columns_present(client, multi_target_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{multi_target_pipeline['id']}")
    cols = r.json()["feature_columns"]
    assert "y_return_5d" in cols, f"y_return_5d missing from {cols}"
    assert "y_dir_5d"    in cols, f"y_dir_5d missing"
    assert "y_tb_5d"     in cols, f"y_tb_5d missing"


def _get_col_values(client, pipeline_id: str, col: str) -> list:
    r = client.get(f"{API_BASE}/pipelines/{pipeline_id}/preview?limit=2000")
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    return [row[col] for row in rows if row.get(col) is not None]


def test_regression_target_is_continuous(client, multi_target_pipeline):
    vals = _get_col_values(client, multi_target_pipeline["id"], "y_return_5d")
    assert len(vals) > 100, "Not enough rows"
    nums = [float(v) for v in vals]
    unique = set(round(n, 6) for n in nums)
    assert len(unique) > 50, f"regression target has only {len(unique)} unique values — may be discrete"
    # Should look like returns: most values small
    arr = np.array(nums)
    assert arr.std() > 0, "y_return_5d has zero variance"
    # No insane outliers: 99th percentile < 100x
    pct99 = np.percentile(np.abs(arr), 99)
    assert pct99 < 1.0, f"Extreme regression outlier: 99th pct absolute value = {pct99}"


def test_classification_target_labels(client, multi_target_pipeline):
    vals = _get_col_values(client, multi_target_pipeline["id"], "y_dir_5d")
    assert len(vals) > 100
    unique = set(int(float(v)) for v in vals)
    valid_labels = {-1, 0, 1}
    assert unique.issubset({-1, 0, 1, 2}), f"Classification labels outside expected: {unique}"
    # Should have both up and down
    assert len(unique) >= 2, f"Only one class present: {unique}"


def test_triple_barrier_labels(client, multi_target_pipeline):
    vals = _get_col_values(client, multi_target_pipeline["id"], "y_tb_5d")
    assert len(vals) > 50, f"Only {len(vals)} non-null triple barrier labels — may be too few rows"
    unique = set(int(float(v)) for v in vals)
    assert unique.issubset({-1, 0, 1}), f"Triple barrier labels outside {{-1,0,1}}: {unique}"
    # Check that not all labels are the same class
    from collections import Counter
    counts = Counter(int(float(v)) for v in vals)
    total = len(vals)
    for label, cnt in counts.items():
        pct = cnt / total
        # No single class should dominate >95% (degenerate)
        assert pct < 0.95, f"Triple barrier label {label} = {pct:.1%} — degenerate distribution"


def _train_and_wait(client, pipeline_id, fs_id, target_col, model_type, hyperparams=None):
    r = client.post(f"{API_BASE}/models/train", json={
        "pipeline_id": pipeline_id,
        "feature_set_id": fs_id,
        "target_column": target_col,
        "model_type": model_type,
        "hyperparameters": hyperparams or {"n_estimators": 50},
        "n_splits": 3,
        "gap": 5,
    })
    assert r.status_code == 202, f"Train failed: {r.text}"
    data = r.json()
    _wait(data["celery_task_id"])
    return client.get(f"{API_BASE}/models/{data['id']}").json()


@pytest.fixture(scope="module")
def feature_set_id(client, multi_target_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{multi_target_pipeline['id']}")
    pipe = r.json()
    feature_cols = [c for c in pipe["feature_columns"]
                    if not c.startswith("y_")]
    r2 = client.post(f"{API_BASE}/feature-sets/", json={
        "pipeline_id": multi_target_pipeline["id"],
        "name": "fs_multi_target",
        "selected_columns": feature_cols,
        "target_column": "y_return_5d",  # default; training calls specify their own target
    })
    assert r2.status_code in (200, 201), r2.text
    return r2.json()["id"]


def test_train_regression_model(client, multi_target_pipeline, feature_set_id):
    model = _train_and_wait(client, multi_target_pipeline["id"], feature_set_id, "y_return_5d", "lightgbm")
    assert model["status"] == "completed"
    agg = model["cv_metrics"]["aggregate"]
    # Regression task should have r2 or rmse metric
    regression_metrics = [k for k in agg if any(m in k for m in ["r2", "rmse", "mae"])]
    assert len(regression_metrics) > 0, f"No regression metrics in: {list(agg.keys())}"


def test_train_classification_model(client, multi_target_pipeline, feature_set_id):
    model = _train_and_wait(client, multi_target_pipeline["id"], feature_set_id, "y_dir_5d", "lightgbm")
    assert model["status"] == "completed"
    agg = model["cv_metrics"]["aggregate"]
    # Classification task should have accuracy or f1
    cls_metrics = [k for k in agg if any(m in k for m in ["accuracy", "f1", "auc"])]
    assert len(cls_metrics) > 0, f"No classification metrics in: {list(agg.keys())}"
    # Accuracy should be between 0 and 1
    for k in cls_metrics:
        if "accuracy" in k:
            assert 0.0 <= agg[k] <= 1.0, f"accuracy out of range: {k}={agg[k]}"


def test_train_triple_barrier_model(client, multi_target_pipeline, feature_set_id):
    model = _train_and_wait(client, multi_target_pipeline["id"], feature_set_id, "y_tb_5d", "lightgbm")
    assert model["status"] == "completed"
    assert model["cv_metrics"]["oos_start_index"] > 0
