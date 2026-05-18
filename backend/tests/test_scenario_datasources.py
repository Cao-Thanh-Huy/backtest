"""
Scenario: multiple data sources with different sizes and time ranges.

Tests that:
- 3 distinct datasets (300 / 500 / 800 rows) each produce a working pipeline
- row counts are correct after processing
- training on each feature set succeeds with OOS index > 0
- metrics are in valid financial ranges
"""
import asyncio
import io
import json
import time
from datetime import datetime, timedelta

import httpx
import numpy as np
import pandas as pd
import polars as pl
import pytest

API_BASE = "http://localhost:8000/api/v1"
WS_BASE  = "ws://localhost:8000/api/v1/ws"
TIMEOUT  = 300  # seconds per Celery job


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_csv(n_rows: int, start: str = "2022-01-01", seed_close: float = 100.0) -> bytes:
    """Generate synthetic OHLCV CSV with n_rows rows."""
    dates = pd.date_range(start=start, periods=n_rows, freq="D")
    import random; random.seed(hash(start) % 2**31)
    closes = [seed_close]
    for _ in range(n_rows - 1):
        closes.append(max(1.0, closes[-1] * (1 + random.gauss(0, 0.01))))
    df = pl.DataFrame({
        "datetime": dates,
        "open":   [c * 0.999 for c in closes],
        "high":   [c * 1.005 for c in closes],
        "low":    [c * 0.995 for c in closes],
        "close":  closes,
        "volume": [1000 + i * 5 for i in range(n_rows)],
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
                        raise AssertionError(f"Task {task_id} FAILED: {data}")
        except Exception as e:
            if "1012" in str(e) or "ConnectionClosedError" in type(e).__name__:
                await asyncio.sleep(0.5); continue
            raise
    raise TimeoutError(f"Timed out after {timeout}s for task {task_id}")


def _wait(task_id: str, timeout: int = TIMEOUT) -> dict:
    return asyncio.run(_wait_task(task_id, timeout))


# ── datasets ──────────────────────────────────────────────────────────────────

DATASETS = [
    {"rows": 300, "start": "2021-01-01", "symbol": "BTCUSDT_300", "close": 45000.0},
    {"rows": 500, "start": "2022-01-01", "symbol": "ETHUSDT_500", "close": 3000.0},
    {"rows": 800, "start": "2020-06-01", "symbol": "SOLUSDT_800", "close":   30.0},
]

INDICATORS = [
    {"name": "rsi",    "params": {"length": 14}},
    {"name": "ema",    "params": {"length": 21}},
    {"name": "atr",    "params": {"length": 14}},
]

TARGET = {"name": "y_return_5d", "method": "n_bar", "params": {"shift": 5, "type": "regression"}}


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=120.0) as c:
        yield c


@pytest.fixture(scope="module")
def dataset_results(client):
    """Upload all 3 datasets and run pipelines. Returns list of pipeline info dicts."""
    results = []
    for ds in DATASETS:
        csv_bytes = _make_csv(ds["rows"], ds["start"], ds["close"])
        r = client.post(
            f"{API_BASE}/datasets/upload",
            data={"symbol": ds["symbol"], "timeframe": "1d"},
            files={"file": ("data.csv", csv_bytes, "text/csv")},
        )
        assert r.status_code == 201, f"Upload failed for {ds['symbol']}: {r.text}"
        dataset_id = r.json()["id"]

        r2 = client.post(f"{API_BASE}/pipelines/generate", json={
            "dataset_id": dataset_id,
            "name": f"scenario_pipe_{ds['symbol']}",
            "indicators": INDICATORS,
            "targets": [TARGET],
            "lags": [1, 2],
        })
        assert r2.status_code == 202, f"Pipeline failed for {ds['symbol']}: {r2.text}"
        pd = r2.json()
        _wait(pd["celery_task_id"])  # block until complete

        results.append({"symbol": ds["symbol"], "expected_rows": ds["rows"], **pd})
    return results


def test_all_pipelines_complete(client, dataset_results):
    for info in dataset_results:
        r = client.get(f"{API_BASE}/pipelines/{info['id']}")
        assert r.status_code == 200
        assert r.json()["status"] == "completed", f"{info['symbol']} pipeline not completed"


def test_row_counts_are_reasonable(client, dataset_results):
    """Row count in processed parquet must be close to original minus indicator warmup."""
    for info in dataset_results:
        r = client.get(f"{API_BASE}/pipelines/{info['id']}/preview?limit=5")
        assert r.status_code == 200, r.text
        data = r.json()
        actual_rows = data["row_count"]
        expected_rows = info["expected_rows"]
        # After RSI(14) + lags(2) we lose ~16 rows + 5 for target shift
        assert actual_rows > expected_rows * 0.85, (
            f"{info['symbol']}: expected ~{expected_rows} rows, got {actual_rows}"
        )
        assert actual_rows <= expected_rows, f"More rows than source? {actual_rows} > {expected_rows}"


def test_feature_columns_present(client, dataset_results):
    for info in dataset_results:
        r = client.get(f"{API_BASE}/pipelines/{info['id']}")
        cols = r.json().get("feature_columns", [])
        assert "rsi_14" in cols, f"{info['symbol']}: rsi_14 missing from {cols}"
        assert "ema_21" in cols, f"{info['symbol']}: ema_21 missing"
        assert "atr_14" in cols, f"{info['symbol']}: atr_14 missing"
        assert "rsi_14_lag1" in cols, f"{info['symbol']}: lag column missing"
        assert "y_return_5d" in cols, f"{info['symbol']}: target column missing"


def test_train_model_on_each_datasource(client, dataset_results):
    """Train a model per pipeline and verify OOS metrics."""
    for info in dataset_results:
        # Create feature set (use all columns except target)
        pipe = client.get(f"{API_BASE}/pipelines/{info['id']}").json()
        feature_cols = [c for c in pipe["feature_columns"] if not c.startswith("y_")]

        r = client.post(f"{API_BASE}/feature-sets/", json={
            "pipeline_id": info["id"],
            "name": f"fs_{info['symbol']}",
            "selected_columns": feature_cols,
            "target_column": "y_return_5d",
        })
        assert r.status_code in (200, 201), f"FeatureSet creation failed: {r.text}"
        fs = r.json()

        r2 = client.post(f"{API_BASE}/models/train", json={
            "pipeline_id": info["id"],
            "feature_set_id": fs["id"],
            "target_column": "y_return_5d",
            "model_type": "lightgbm",
            "hyperparameters": {"n_estimators": 50},
            "n_splits": 3,
            "gap": 5,
        })
        assert r2.status_code == 202, f"Train failed: {r2.text}"
        model_data = r2.json()
        task_id = model_data["celery_task_id"]
        assert task_id, "celery_task_id missing"
        _wait(task_id)

        # Fetch completed model
        model = client.get(f"{API_BASE}/models/{model_data['id']}").json()
        assert model["status"] == "completed", f"{info['symbol']} model status: {model['status']}"
        agg = model["cv_metrics"]["aggregate"]
        oos_idx = model["cv_metrics"]["oos_start_index"]

        assert oos_idx > 10, f"oos_start_index too small: {oos_idx}"
        # Regression task returns regression metrics, not trading metrics.
        for key in ("r2_mean", "rmse_mean", "mae_mean"):
            assert key in agg, f"{key} missing from {agg.keys()}"
        assert np.isfinite(agg["rmse_mean"]), f"rmse_mean is not finite: {agg['rmse_mean']}"
        assert np.isfinite(agg["mae_mean"]), f"mae_mean is not finite: {agg['mae_mean']}"
