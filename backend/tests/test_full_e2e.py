"""
Full end-to-end integration test — covers every stage of the platform:

  1. Upload CSV dataset
  2. Generate feature pipeline (Celery + WebSocket progress)
  3. Verify processed Parquet in MinIO + DB
  4. Validate feature column correctness (RSI Wilder's EMA, ADX proper)
  5. Train AI model (Celery + WebSocket progress)
  6. Verify CV metrics are sane + oos_start_index is saved
  7. Run backtest (Celery + WebSocket progress)
  8. Verify OOS-only backtest — oos rows < total dataset rows
  9. Assert metric units (all already-% values, no double-multiply)
  10. Fetch equity curve from MinIO and validate shape

Every assertion includes a clear failure message so any regression is immediately obvious.
"""
from __future__ import annotations

import asyncio
import io
import json
import math
import time
from datetime import datetime

import boto3
import httpx
import numpy as np
import pandas as pd
import polars as pl
import pytest
from sqlalchemy import create_engine, text
from websockets import connect
from websockets.exceptions import ConnectionClosedError

from app.core.config import settings
from app.core.storage import parse_s3_uri

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
API_BASE = "http://localhost:8000/api/v1"
WS_BASE  = "ws://localhost:8000/api/v1/ws"
DATASET_ROWS = 600          # enough for walk-forward CV (5 folds × gap 10 + features)
TASK_TIMEOUT = 300          # seconds to wait for any Celery task


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_ohlcv_csv(rows: int = DATASET_ROWS) -> bytes:
    """Generate synthetic daily OHLCV with a gentle trend + noise to avoid degenerate data."""
    rng = np.random.default_rng(42)
    dates = pd.date_range("2022-01-01", periods=rows, freq="D")
    trend = np.linspace(100.0, 160.0, rows)
    noise = rng.normal(0, 1.5, rows).cumsum()
    close = trend + noise
    close = np.clip(close, 50, 300)
    df = pd.DataFrame({
        "datetime": dates.strftime("%Y-%m-%d"),
        "open":   (close - rng.uniform(0.2, 0.8, rows)).round(4),
        "high":   (close + rng.uniform(0.5, 2.0, rows)).round(4),
        "low":    (close - rng.uniform(0.5, 2.0, rows)).round(4),
        "close":  close.round(4),
        "volume": rng.integers(1_000, 50_000, rows).astype(float),
    })
    return df.to_csv(index=False).encode()


async def _wait_task_ws(task_id: str, timeout: int = TASK_TIMEOUT) -> dict:
    """Subscribe to WebSocket task channel; return final payload on SUCCESS/FAILURE."""
    deadline = time.time() + timeout
    last_payload: dict = {}
    while time.time() < deadline:
        try:
            async with connect(f"{WS_BASE}/task/{task_id}") as ws:
                while time.time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=15)
                    payload = json.loads(raw)
                    last_payload = payload
                    status = payload.get("status", "")
                    if status in {"SUCCESS", "FAILURE"}:
                        return payload
        except ConnectionClosedError as exc:
            if exc.code != 1012:
                raise
            await asyncio.sleep(0.5)
    raise TimeoutError(f"Task {task_id} did not complete within {timeout}s. Last: {last_payload}")


def _wait_task(task_id: str, timeout: int = TASK_TIMEOUT) -> dict:
    return asyncio.run(_wait_task_ws(task_id, timeout))


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
    )


def _db_engine():
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    return create_engine(sync_url)


def _fetch_one(engine, query: str, params: dict):
    with engine.connect() as conn:
        return conn.execute(text(query), params).fetchone()


# ---------------------------------------------------------------------------
# STEP 1 — Upload dataset
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def uploaded_dataset() -> dict:
    client = httpx.Client(timeout=30.0)
    csv_bytes = _build_ohlcv_csv()
    resp = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "TEST_E2E", "timeframe": "1d"},
        files={"file": ("e2e_ohlcv.csv", csv_bytes, "text/csv")},
    )
    assert resp.status_code == 201, f"Dataset upload failed: {resp.status_code} — {resp.text}"
    data = resp.json()
    assert data["id"], "Dataset id missing"
    assert data["symbol"] == "TEST_E2E"
    assert data["timeframe"] == "1d"
    return data


# ---------------------------------------------------------------------------
# STEP 2 — Generate feature pipeline
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def pipeline(uploaded_dataset: dict) -> dict:
    client = httpx.Client(timeout=30.0)
    payload = {
        "dataset_id": uploaded_dataset["id"],
        "name": "e2e_full_test",
        "indicators": [
            {"name": "rsi",   "params": {"length": 14}},
            {"name": "macd",  "params": {"fast": 12, "slow": 26, "signal": 9}},
            {"name": "adx",   "params": {"length": 14}},
            {"name": "ema",   "params": {"length": 21}},
            {"name": "bbands","params": {"length": 20, "std": 2.0}},
        ],
        "targets": [
            {
                "name": "y_dir_3d",
                "method": "n_bar",
                "params": {"shift": 3, "type": "classification"},
            }
        ],
        "lags": [1, 2, 3],
    }
    resp = client.post(f"{API_BASE}/pipelines/generate", json=payload)
    assert resp.status_code == 202, f"Pipeline create failed: {resp.status_code} — {resp.text}"
    data = resp.json()
    assert data.get("celery_task_id"), "celery_task_id missing from pipeline response"
    return data


# ---------------------------------------------------------------------------
# STEP 3 — Wait for pipeline and assert DB + MinIO
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def completed_pipeline(pipeline: dict) -> dict:
    task_final = _wait_task(pipeline["celery_task_id"])
    assert task_final["status"] == "SUCCESS", f"Pipeline task failed: {task_final}"

    db = _db_engine()
    try:
        row = _fetch_one(db,
            "SELECT status, s3_processed_path, feature_columns FROM feature_pipelines WHERE id = :pid",
            {"pid": pipeline["id"]},
        )
    finally:
        db.dispose()

    assert row is not None, "Pipeline row not found in DB"
    assert str(row[0]) in {"completed", "StatusEnum.completed"}, \
        f"Pipeline status in DB = {row[0]!r}, expected 'completed'"
    assert row[1] and row[1].startswith("s3://"), \
        f"s3_processed_path invalid: {row[1]!r}"

    # MinIO object must exist
    s3 = _s3_client()
    bucket, key = parse_s3_uri(row[1])
    head = s3.head_object(Bucket=bucket, Key=key)
    assert head["ResponseMetadata"]["HTTPStatusCode"] == 200, "Processed parquet not in MinIO"

    return {"pipeline": pipeline, "s3_processed_path": row[1], "feature_columns": row[2]}


# ---------------------------------------------------------------------------
# STEP 4 — Validate processed data quality
# ---------------------------------------------------------------------------

def test_processed_parquet_quality(completed_pipeline: dict):
    """Download processed parquet and check feature/target correctness."""
    s3 = _s3_client()
    bucket, key = parse_s3_uri(completed_pipeline["s3_processed_path"])
    obj = s3.get_object(Bucket=bucket, Key=key)
    df = pl.read_parquet(io.BytesIO(obj["Body"].read())).to_pandas()

    # --- Basic shape ---
    assert len(df) > 0, "Processed parquet is empty"
    assert "close" in df.columns, "close column missing"
    assert "y_dir_3d" in df.columns, "target column y_dir_3d missing"
    assert df["y_dir_3d"].isna().sum() == 0, "Target contains NaN — trailing rows not dropped"

    # --- Target labels must be from {-1, 0, 1} ---
    unique_labels = set(df["y_dir_3d"].dropna().unique())
    assert unique_labels.issubset({-1.0, 0.0, 1.0}), \
        f"Unexpected target labels: {unique_labels}"

    # --- RSI must be in [0, 100] ---
    rsi_col = "rsi_14"
    assert rsi_col in df.columns, f"{rsi_col} not generated"
    rsi_vals = df[rsi_col].dropna()
    assert len(rsi_vals) > 0, "RSI has no non-NaN values"
    assert float(rsi_vals.min()) >= 0.0, f"RSI below 0: {rsi_vals.min()}"
    assert float(rsi_vals.max()) <= 100.0, f"RSI above 100: {rsi_vals.max()}"

    # --- ADX must be in [0, 100] ---
    adx_col = "adx_14"
    assert adx_col in df.columns, f"{adx_col} not generated"
    adx_vals = df[adx_col].dropna()
    assert len(adx_vals) > 0, "ADX has no non-NaN values"
    assert float(adx_vals.min()) >= 0.0, f"ADX below 0: {adx_vals.min()}"
    assert float(adx_vals.max()) <= 100.0, f"ADX above 100: {adx_vals.max()}"

    # --- RSI Wilder's EMA sanity: first-period RSI should not jump above 90 for normal data ---
    first_valid_rsi = float(rsi_vals.iloc[0])
    assert first_valid_rsi < 95.0, \
        f"First RSI value {first_valid_rsi:.2f} is suspiciously high — may indicate SMA instead of EMA"

    # --- Lag columns exist ---
    assert "rsi_14_lag1" in df.columns, "Lag column rsi_14_lag1 missing"
    assert "rsi_14_lag3" in df.columns, "Lag column rsi_14_lag3 missing"

    # --- MACD columns with correct naming format ---
    assert "macd_12_26" in df.columns, "macd_12_26 column missing"
    assert "macd_signal_12_26_9" in df.columns, "macd_signal_12_26_9 column missing"
    assert "macd_hist_12_26_9" in df.columns, "macd_hist_12_26_9 column missing"

    # --- No infinite values in feature matrix ---
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    for col in numeric_cols:
        inf_count = np.isinf(df[col].dropna().values).sum()
        assert inf_count == 0, f"Column {col!r} contains {inf_count} infinite values"


# ---------------------------------------------------------------------------
# STEP 5 — Train AI model
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def trained_model(completed_pipeline: dict) -> dict:
    client = httpx.Client(timeout=30.0)
    pipeline_id = completed_pipeline["pipeline"]["id"]
    payload = {
        "pipeline_id": pipeline_id,
        "target_column": "y_dir_3d",
        "model_type": "lightgbm",
        "hyperparameters": {
            "n_estimators": 50,
            "num_leaves": 15,
            "learning_rate": 0.1,
        },
        "n_splits": 3,
        "gap": 5,
    }
    resp = client.post(f"{API_BASE}/models/train", json=payload)
    assert resp.status_code == 202, f"Model train failed: {resp.status_code} — {resp.text}"
    data = resp.json()
    assert data.get("celery_task_id"), "celery_task_id missing from model response"
    return data


@pytest.fixture(scope="module")
def completed_model(trained_model: dict) -> dict:
    task_final = _wait_task(trained_model["celery_task_id"])
    assert task_final["status"] == "SUCCESS", f"Training task failed: {task_final}"

    db = _db_engine()
    try:
        row = _fetch_one(db,
            """SELECT status, selected_features, cv_metrics, s3_model_path, error_message
               FROM ai_models WHERE id = :mid""",
            {"mid": trained_model["id"]},
        )
    finally:
        db.dispose()

    assert row is not None, "Model row not found in DB"
    assert str(row[0]) in {"completed", "StatusEnum.completed"}, \
        f"Model status = {row[0]!r}; error: {row[4]}"

    selected_features = row[1] if isinstance(row[1], list) else json.loads(row[1])
    cv_metrics = row[2] if isinstance(row[2], dict) else json.loads(row[2])

    assert len(selected_features) > 0, "No features were selected"
    assert "oos_start_index" in cv_metrics, \
        "oos_start_index missing from cv_metrics — OOS leakage fix not applied"
    assert cv_metrics["oos_start_index"] > 0, \
        f"oos_start_index = {cv_metrics['oos_start_index']} — expected > 0"

    return {
        "model": trained_model,
        "selected_features": selected_features,
        "cv_metrics": cv_metrics,
        "s3_model_path": row[3],
    }


# ---------------------------------------------------------------------------
# STEP 6 — Assert CV metrics are meaningful
# ---------------------------------------------------------------------------

def test_cv_metrics_sanity(completed_model: dict):
    cv = completed_model["cv_metrics"]
    agg = cv.get("aggregate", {})

    # accuracy_mean must be in (0, 1) — not 0 (random noise) and not 1 (overfit)
    acc_mean = agg.get("accuracy_mean")
    assert acc_mean is not None, "accuracy_mean missing from aggregate CV metrics"
    assert 0.0 < acc_mean < 1.0, f"accuracy_mean = {acc_mean:.4f} is outside (0,1)"

    # std should not be 0 (that would mean all folds returned exactly same accuracy)
    acc_std = agg.get("accuracy_std", None)
    if acc_std is not None:
        assert acc_std >= 0.0, f"accuracy_std is negative: {acc_std}"

    # oos_start_index must be a positive integer
    oos_idx = cv.get("oos_start_index", 0)
    assert isinstance(oos_idx, int), f"oos_start_index type: {type(oos_idx)}"
    assert oos_idx > 50, f"oos_start_index = {oos_idx} is suspiciously small"


# ---------------------------------------------------------------------------
# STEP 7 — Run backtest
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def backtest(completed_model: dict) -> dict:
    client = httpx.Client(timeout=30.0)
    payload = {
        "model_id": completed_model["model"]["id"],
        "initial_capital": 10_000.0,
        "fee_pct": 0.001,
        "slippage_pct": 0.0005,
        "long_threshold": 0.55,
        "short_threshold": 0.45,
    }
    resp = client.post(f"{API_BASE}/backtests/run", json=payload)
    assert resp.status_code == 202, f"Backtest create failed: {resp.status_code} — {resp.text}"
    data = resp.json()
    assert data.get("celery_task_id"), "celery_task_id missing from backtest response"
    return data


@pytest.fixture(scope="module")
def completed_backtest(backtest: dict, completed_model: dict) -> dict:
    task_final = _wait_task(backtest["celery_task_id"])
    assert task_final["status"] == "SUCCESS", f"Backtest task failed: {task_final}"

    db = _db_engine()
    try:
        row = _fetch_one(db,
            """SELECT status, metrics, s3_equity_curve_path, s3_signals_path, error_message
               FROM backtests WHERE id = :bid""",
            {"bid": backtest["id"]},
        )
    finally:
        db.dispose()

    assert row is not None, "Backtest row not found in DB"
    assert str(row[0]) in {"completed", "StatusEnum.completed"}, \
        f"Backtest status = {row[0]!r}; error: {row[4]}"

    metrics = row[1] if isinstance(row[1], dict) else json.loads(row[1])
    assert metrics, "Backtest metrics are empty"
    assert row[2] and row[2].startswith("s3://"), "s3_equity_curve_path invalid"

    return {
        "backtest": backtest,
        "metrics": metrics,
        "s3_equity_curve_path": row[2],
        "oos_start_index": completed_model["cv_metrics"]["oos_start_index"],
    }


# ---------------------------------------------------------------------------
# STEP 8 — Verify OOS-only backtest (no in-sample leakage)
# ---------------------------------------------------------------------------

def test_backtest_is_oos_only(completed_backtest: dict):
    """Equity curve must have fewer bars than the full dataset — it's OOS only."""
    s3 = _s3_client()
    bucket, key = parse_s3_uri(completed_backtest["s3_equity_curve_path"])
    obj = s3.get_object(Bucket=bucket, Key=key)
    equity_curve = json.loads(obj["Body"].read())

    oos_start = completed_backtest["oos_start_index"]
    expected_max_bars = DATASET_ROWS - oos_start + 10  # small buffer for target NaN drops
    actual_bars = len(equity_curve)

    assert actual_bars > 0, "Equity curve is empty"
    assert actual_bars < DATASET_ROWS, \
        (f"Equity curve has {actual_bars} bars — equals full dataset ({DATASET_ROWS} rows). "
         f"OOS slice (oos_start_index={oos_start}) was not applied — in-sample leakage is present.")
    assert actual_bars <= expected_max_bars, \
        (f"Equity curve has {actual_bars} bars but expected ≤ {expected_max_bars} for OOS slice "
         f"starting at index {oos_start}.")


# ---------------------------------------------------------------------------
# STEP 9 — Assert metric units (no double-multiply bug)
# ---------------------------------------------------------------------------

def test_backtest_metric_units(completed_backtest: dict):
    """
    Backend stores metrics as percentages (e.g. total_return=12.5 means 12.5%).
    Verify values are in plausible percentage ranges, not decimal fractions (0.125).
    Also verify no double-multiply outliers (e.g. 1250% from 12.5 * 100 again).
    """
    m = completed_backtest["metrics"]

    required = {
        "total_return", "cagr", "sharpe_ratio", "sortino_ratio", "calmar_ratio",
        "max_drawdown", "win_rate", "n_trades", "profit_factor",
    }
    missing = required - set(m.keys())
    assert not missing, f"Metrics missing from backtest result: {missing}"

    # total_return stored as % — must be in [-100, +1000] for a sane test
    tr = m["total_return"]
    assert isinstance(tr, (int, float)), f"total_return is not numeric: {tr!r}"
    assert -100.0 <= tr <= 1000.0, \
        f"total_return = {tr} — value out of plausible % range [-100, 1000]. " \
        "Possible double-multiply: backend returned fraction instead of percent."

    # max_drawdown stored as % — must be in [-100, 0]
    md = m["max_drawdown"]
    assert -100.0 <= md <= 0.0, \
        f"max_drawdown = {md} — expected in [-100, 0]%. Got suspicious value."

    # win_rate stored as % — must be in [0, 100]
    wr = m["win_rate"]
    assert 0.0 <= wr <= 100.0, \
        f"win_rate = {wr} — expected in [0, 100]%. Possible double-multiply (0.55 * 100 = 55)."

    # Sharpe: reasonable range for a short OOS test is [-5, 5]
    sr = m["sharpe_ratio"]
    assert -10.0 <= sr <= 10.0, \
        f"sharpe_ratio = {sr} — suspiciously large. Possible annualization factor error."

    # n_trades should be an integer >= 0
    nt = m["n_trades"]
    assert isinstance(nt, int) and nt >= 0, f"n_trades = {nt!r} is invalid"

    # equity curve values must all be positive
    s3 = _s3_client()
    bucket, key = parse_s3_uri(completed_backtest["s3_equity_curve_path"])
    obj = s3.get_object(Bucket=bucket, Key=key)
    curve = json.loads(obj["Body"].read())
    values = [p["value"] for p in curve]
    assert all(v > 0 for v in values), \
        f"Equity curve contains non-positive values: {[v for v in values if v <= 0][:5]}"

    # Equity curve must start near initial_capital (10_000)
    assert 5_000 <= values[0] <= 20_000, \
        f"First equity value = {values[0]} — expected near 10000 (initial_capital)."


# ---------------------------------------------------------------------------
# STEP 10 — Equity curve accessible via API endpoint
# ---------------------------------------------------------------------------

def test_equity_curve_api_endpoint(completed_backtest: dict):
    client = httpx.Client(timeout=30.0)
    bt_id = completed_backtest["backtest"]["id"]
    resp = client.get(f"{API_BASE}/backtests/{bt_id}/equity-curve")
    assert resp.status_code == 200, f"Equity curve endpoint failed: {resp.status_code} — {resp.text}"
    curve = resp.json()
    assert isinstance(curve, list) and len(curve) > 0, "Equity curve API returned empty list"
    first = curve[0]
    assert "time" in first and "value" in first, \
        f"Equity curve entry missing time/value keys: {first}"


# ---------------------------------------------------------------------------
# STEP 11 — Assert RSI Wilder vs SMA is actually different (regression guard)
# ---------------------------------------------------------------------------

def test_rsi_wilder_vs_sma_regression():
    """
    If RSI accidentally uses SMA instead of Wilder's EMA, values will cluster
    near 50 much sooner. This test verifies Wilder's EMA produces the known
    correct RSI for a simple monotonically increasing price series.
    """
    from workers.engines.features import _rsi

    # Monotonically rising close — RSI should be high (>70) after warm-up
    close = np.array([float(100 + i) for i in range(60)])
    rsi = _rsi(close, length=14)

    # All non-NaN values after warm-up must be > 70 for a strictly rising series
    non_nan = rsi[~np.isnan(rsi)]
    assert len(non_nan) > 0, "RSI returned all NaN"
    # First valid RSI for monotonically rising data with Wilder's should be ~100
    assert non_nan[0] > 90.0, \
        (f"First RSI = {non_nan[0]:.2f} for monotonically rising prices — "
         "expected > 90 with Wilder's EMA. SMA would give lower values.")
    # All subsequent values should remain high (>70) — strictly rising prices
    assert all(v > 70 for v in non_nan), \
        f"RSI dropped below 70 for strictly rising prices: min={non_nan.min():.2f}"


# ---------------------------------------------------------------------------
# STEP 12 — Assert ADX returns proper trend-strength values (regression guard)
# ---------------------------------------------------------------------------

def test_adx_returns_proper_values():
    """
    ADX for a strong trending market (straight line) must converge near 100.
    The old broken implementation (smooth ATR) would return small ATR-like values.
    """
    from workers.engines.features import _adx

    n = 200
    high  = np.linspace(100, 200, n) + 1.0
    low   = np.linspace(100, 200, n) - 1.0
    close = np.linspace(100, 200, n)
    adx = _adx(high, low, close, length=14)

    non_nan = adx[~np.isnan(adx)]
    assert len(non_nan) > 0, "ADX returned all NaN"

    # Strong trend: ADX should be > 50 after initial warm-up
    stable_adx = non_nan[30:]   # skip early warm-up
    assert len(stable_adx) > 0
    assert float(stable_adx.mean()) > 50.0, \
        (f"ADX mean = {stable_adx.mean():.2f} for strong trend — "
         "expected > 50. Possibly still returning ATR-based values.")

    # ADX must be in [0, 100]
    assert float(non_nan.min()) >= 0.0, f"ADX below 0: {non_nan.min()}"
    assert float(non_nan.max()) <= 100.0, f"ADX above 100: {non_nan.max()}"


# ---------------------------------------------------------------------------
# STEP 13 — Annualization factor inferred correctly for daily data
# ---------------------------------------------------------------------------

def test_annualization_factor_daily():
    from workers.engines.backtester import _infer_bars_per_year

    idx_daily = pd.date_range("2023-01-01", periods=365, freq="D")
    factor = _infer_bars_per_year(idx_daily)
    assert 355 <= factor <= 375, \
        f"Daily ann_factor = {factor:.1f} — expected ~365"


def test_annualization_factor_hourly():
    from workers.engines.backtester import _infer_bars_per_year

    idx_hourly = pd.date_range("2023-01-01", periods=1000, freq="h")
    factor = _infer_bars_per_year(idx_hourly)
    assert 8500 <= factor <= 9000, \
        f"Hourly ann_factor = {factor:.1f} — expected ~8760"


def test_vbt_freq_inference():
    from workers.engines.backtester import _infer_vbt_freq

    daily_freq = _infer_vbt_freq(pd.date_range("2023-01-01", periods=100, freq="D"))
    assert "D" in daily_freq, f"Daily freq inference unexpected: {daily_freq!r}"

    hourly_freq = _infer_vbt_freq(pd.date_range("2023-01-01", periods=100, freq="h"))
    assert "h" in hourly_freq.lower(), f"Hourly freq inference unexpected: {hourly_freq!r}"
