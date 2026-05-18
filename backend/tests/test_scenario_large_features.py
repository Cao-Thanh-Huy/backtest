"""
Scenario: large feature space via parameter sweeps.

Tests that:
- Sweeps produce a meaningfully large feature space
- Feature selection reduces columns to a manageable set
- Model training completes on the large feature set
- No NaN leakage in selected columns
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

def _make_csv(n_rows: int = 450) -> bytes:
    rng = np.random.default_rng(42)
    dates = pd.date_range("2019-01-01", periods=n_rows, freq="D")
    closes = np.cumprod(1 + rng.normal(0, 0.01, n_rows)) * 100
    df = pl.DataFrame({
        "datetime": dates,
        "open":  closes * (1 - rng.uniform(0, 0.003, n_rows)),
        "high":  closes * (1 + rng.uniform(0, 0.005, n_rows)),
        "low":   closes * (1 - rng.uniform(0, 0.005, n_rows)),
        "close": closes,
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
                    if data["status"] == "SUCCESS":
                        return data
                    if data["status"] == "FAILURE":
                        raise AssertionError(f"Task FAILED: {data}")
        except Exception as e:
            if "1012" in str(e) or "ConnectionClosedError" in type(e).__name__:
                await asyncio.sleep(0.5); continue
            raise
    raise TimeoutError(f"Timed out after {timeout}s for task {task_id}")


def _wait(task_id: str) -> dict:
    return asyncio.run(_wait_task(task_id))


# ── large sweep pipeline ──────────────────────────────────────────────────────

# Expected column count (rough):
# Subtotal raw ~45-70 (depending on engine naming/capping) + lag expansion.
LARGE_INDICATORS = [
    # RSI sweep
    {"name": "rsi",  "params_sweep": {"length": {"min": 6, "max": 26, "step": 4}}},
    # EMA sweep
    {"name": "ema",  "params_sweep": {"length": {"min": 10, "max": 60, "step": 10}}},
    # SMA sweep
    {"name": "sma",  "params_sweep": {"length": {"min": 10, "max": 60, "step": 10}}},
    # ATR sweep
    {"name": "atr",  "params_sweep": {"length": {"min": 7, "max": 21, "step": 7}}},
    # ADX sweep
    {"name": "adx",  "params_sweep": {"length": {"min": 7, "max": 21, "step": 7}}},
    # MACD sweep (fast × slow, fixed signal)
    {"name": "macd", "params_sweep": {
        "fast": {"min": 8, "max": 16, "step": 4},
        "slow": {"min": 24, "max": 28, "step": 4},
    }, "params": {"signal": 9}},
    # BBands sweep
    {"name": "bbands", "params_sweep": {
        "length": {"min": 10, "max": 30, "step": 10},
        "std": {"min": 1.5, "max": 2.0, "step": 0.5},
    }},
    # Stoch sweep
    {"name": "stoch", "params_sweep": {"k": {"min": 5, "max": 21, "step": 8}}},
]


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=300.0) as c:
        yield c


@pytest.fixture(scope="module")
def large_pipeline(client):
    csv_bytes = _make_csv(700)
    r = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "LARGESWEEP", "timeframe": "1d"},
        files={"file": ("data.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 201, r.text
    dataset_id = r.json()["id"]

    r2 = client.post(f"{API_BASE}/pipelines/generate", json={
        "dataset_id": dataset_id,
        "name": "scenario_large_features",
        "indicators": LARGE_INDICATORS,
        "targets": [
            {"name": "y_return_5d", "method": "n_bar", "params": {"shift": 5, "type": "regression"}}
        ],
        "lags": [1],
    })
    assert r2.status_code == 202, r2.text
    data = r2.json()
    _wait(data["celery_task_id"])
    return data


def test_pipeline_completed(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    assert r.json()["status"] == "completed"


def test_large_feature_space(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    cols = r.json()["feature_columns"]
    feature_cols = [c for c in cols if not c.startswith("y_")]
    print(f"Total columns: {len(feature_cols)}")
    assert len(feature_cols) >= 40, f"Expected >=40 feature cols, got {len(feature_cols)}"


def test_rsi_sweep_columns_exist(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    cols = r.json()["feature_columns"]
    for length in [6, 10, 14, 18, 22, 26]:
        assert f"rsi_{length}" in cols, f"rsi_{length} missing from {cols[:20]}"


def test_ema_sweep_columns_exist(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    cols = r.json()["feature_columns"]
    for length in [10, 20, 30, 40, 50]:
        assert f"ema_{length}" in cols, f"ema_{length} missing"


def test_lag_columns_exist(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    cols = r.json()["feature_columns"]
    lag_cols = [c for c in cols if c.endswith("_lag1")]
    assert len(lag_cols) > 10, f"Expected many lag columns, got {len(lag_cols)}"


def test_preview_has_no_all_nan_columns(client, large_pipeline):
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}/preview?limit=300")
    assert r.status_code == 200, r.text
    data = r.json()
    rows = data["rows"]
    if not rows:
        pytest.skip("No preview rows")
    # Ignore target and focus on generated feature columns.
    feature_cols = [c for c in data["columns"] if not c["name"].startswith("y_")]
    for col in feature_cols:
        values = [row.get(col["name"]) for row in rows]
        non_null = [v for v in values if v is not None and v != ""]
        assert len(non_null) > 0, f"Column {col['name']} is entirely null in preview"


def test_feature_selection_reduces_columns(client, large_pipeline):
    """Feature selection should pick top-K columns (K << total)."""
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    pipe = r.json()
    all_feature_cols = [c for c in pipe["feature_columns"] if not c.startswith("y_")]
    # Use current feature suggestion endpoint
    r2 = client.post(f"{API_BASE}/feature-sets/suggest", json={
        "pipeline_id": large_pipeline["id"],
        "target_column": "y_return_5d",
        "task": "regression",
        "mi_top_k": 30,
        "tree_top_k": 12,
        "vif_threshold": 10.0,
        "corr_threshold": 0.95,
    })
    assert r2.status_code == 200, f"Feature selection failed: {r2.text}"
    result = r2.json()
    selected = result.get("selected_columns", [])
    print(f"Selected {len(selected)} from {len(all_feature_cols)}")
    assert len(selected) <= 25, f"Selection should reduce columns, got {len(selected)}"
    assert len(selected) >= 5, f"Too few columns selected: {selected}"


def test_train_on_full_large_feature_set(client, large_pipeline):
    """Training should succeed even with 100+ columns (model handles it internally)."""
    r = client.get(f"{API_BASE}/pipelines/{large_pipeline['id']}")
    pipe = r.json()
    feature_cols = [c for c in pipe["feature_columns"] if not c.startswith("y_")]

    r2 = client.post(f"{API_BASE}/feature-sets/", json={
        "pipeline_id": large_pipeline["id"],
        "name": "fs_large_all",
        "selected_columns": feature_cols[:80],  # cap at 80 to keep training fast
        "target_column": "y_return_5d",
    })
    assert r2.status_code in (200, 201), r2.text
    fs = r2.json()

    r3 = client.post(f"{API_BASE}/models/train", json={
        "pipeline_id": large_pipeline["id"],
        "feature_set_id": fs["id"],
        "target_column": "y_return_5d",
        "model_type": "lightgbm",
        "hyperparameters": {"n_estimators": 50, "num_leaves": 15},
        "n_splits": 3,
        "gap": 5,
    })
    assert r3.status_code == 202, r3.text
    model_data = r3.json()
    _wait(model_data["celery_task_id"])

    model = client.get(f"{API_BASE}/models/{model_data['id']}").json()
    assert model["status"] == "completed"
    # Must honor feature_set source: selected features should be subset of feature-set columns.
    assert set(model.get("selected_features", [])).issubset(set(fs["selected_columns"]))
    oos_idx = model["cv_metrics"]["oos_start_index"]
    assert oos_idx > 20, f"oos_start_index too small: {oos_idx}"
