"""BTCUSDT 1h end-to-end integration test.

This scenario starts from a clean database and empty MinIO buckets,
fetches as much BTCUSDT 1h data as possible, builds a broad indicator
feature space, trains a classifier, and runs a backtest.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone

import boto3
import httpx
import pytest
from botocore.exceptions import ClientError
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from websockets import connect
from websockets.exceptions import ConnectionClosedError

from app.core.config import settings


API_BASE = "http://localhost:8000/api/v1"
WS_BASE = "ws://localhost:8000/api/v1/ws"
TASK_TIMEOUT = 2400

BTC_SYMBOL = "BTCUSDT"
BTC_TIMEFRAME = "1h"
BTC_DATE_FROM = "2018-01-01"
BTC_DATE_TO = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()

BTC_INDICATORS = [
    {"name": "rsi", "params_sweep": {"length": {"min": 7, "max": 28, "step": 7}}},
    {"name": "ema", "params_sweep": {"length": {"min": 12, "max": 48, "step": 12}}},
    {"name": "sma", "params_sweep": {"length": {"min": 10, "max": 40, "step": 10}}},
    {"name": "atr", "params_sweep": {"length": {"min": 7, "max": 21, "step": 7}}},
    {"name": "adx", "params_sweep": {"length": {"min": 7, "max": 21, "step": 7}}},
    {
        "name": "macd",
        "params": {"signal": 9},
        "params_sweep": {
            "fast": {"min": 8, "max": 12, "step": 4},
            "slow": {"min": 24, "max": 28, "step": 4},
        },
    },
    {
        "name": "bbands",
        "params_sweep": {
            "length": {"min": 10, "max": 30, "step": 10},
            "std": {"min": 1.5, "max": 2.0, "step": 0.5},
        },
    },
    {"name": "stoch", "params": {"d": 3}, "params_sweep": {"k": {"min": 5, "max": 21, "step": 8}}},
]

BTC_TARGET = {
    "name": "y_dir_12h",
    "method": "n_bar",
    "params": {"shift": 12, "type": "classification"},
}


def _db_engine():
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2").replace("@postgres:", "@localhost:")
    return create_engine(sync_url)


def _s3_client(endpoint_url: str | None = None):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url or f"http://{settings.minio_endpoint.replace('minio', 'localhost')}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
    )


def _existing_tables() -> list[str]:
    candidate_tables = [
        "datasets",
        "feature_pipelines",
        "feature_sets",
        "ai_models",
        "backtests",
        "sweeps",
        "sweep_jobs",
    ]
    engine = _db_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    """
                )
            ).fetchall()
            present = {row[0] for row in rows}
    finally:
        engine.dispose()

    return [name for name in candidate_tables if name in present]


def _truncate_database() -> None:
    tables = _existing_tables()
    if not tables:
        return

    attempts = 5
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        engine = _db_engine()
        try:
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '8s'"))
                conn.execute(text("SET LOCAL statement_timeout = '120s'"))
                conn.execute(text(f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE"))
            return
        except OperationalError as exc:
            last_exc = exc
            if attempt == attempts:
                raise
            time.sleep(min(6, attempt * 1.5))
        finally:
            engine.dispose()

    if last_exc is not None:
        raise last_exc


def _empty_bucket(bucket_name: str) -> None:
    candidate_endpoints = [
        f"http://{settings.minio_endpoint}",
        f"http://{settings.minio_endpoint.replace('minio', 'localhost')}",
    ]

    last_error = None
    for endpoint_url in candidate_endpoints:
        client = _s3_client(endpoint_url)
        try:
            paginator = client.get_paginator("list_objects_v2")
            keys: list[dict[str, str]] = []
            for page in paginator.paginate(Bucket=bucket_name):
                for obj in page.get("Contents", []):
                    keys.append({"Key": obj["Key"]})
                    if len(keys) == 1000:
                        client.delete_objects(Bucket=bucket_name, Delete={"Objects": keys, "Quiet": True})
                        keys = []
            if keys:
                client.delete_objects(Bucket=bucket_name, Delete={"Objects": keys, "Quiet": True})
            return
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"NoSuchBucket", "NoSuchKey"}:
                return
            last_error = exc
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error


def _reset_environment() -> None:
    _truncate_database()
    for bucket_name in (
        settings.minio_bucket_raw,
        settings.minio_bucket_processed,
        settings.minio_bucket_models,
    ):
        _empty_bucket(bucket_name)


def _count_rows() -> dict[str, int]:
    tables = _existing_tables()
    if not tables:
        return {}

    engine = _db_engine()
    try:
        with engine.connect() as conn:
            counts: dict[str, int] = {}
            for table_name in tables:
                counts[table_name] = int(conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one())
            return counts
    finally:
        engine.dispose()


async def _wait_task(task_id: str, timeout: int = TASK_TIMEOUT) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            async with connect(f"{WS_BASE}/task/{task_id}") as websocket:
                while time.time() < deadline:
                    message = await asyncio.wait_for(websocket.recv(), timeout=15)
                    payload = json.loads(message)
                    if payload.get("status") == "SUCCESS":
                        return payload
                    if payload.get("status") == "FAILURE":
                        raise AssertionError(f"Task {task_id} failed: {payload}")
        except ConnectionClosedError as exc:
            if exc.code != 1012:
                raise
            await asyncio.sleep(0.5)
        except Exception as exc:
            if "1012" in str(exc) or "ConnectionClosedError" in type(exc).__name__:
                await asyncio.sleep(0.5)
                continue
            raise
    raise TimeoutError(f"Timed out after {timeout}s waiting for task {task_id}")


def _wait_task_sync(task_id: str, timeout: int = TASK_TIMEOUT) -> dict:
    return asyncio.run(_wait_task(task_id, timeout))


def _wait_resource_status(client: httpx.Client, resource_url: str, timeout: int = TASK_TIMEOUT) -> dict:
    deadline = time.time() + timeout
    last_payload: dict = {}
    while time.time() < deadline:
        response = client.get(resource_url)
        if response.status_code == 200:
            payload = response.json()
            last_payload = payload
            status = str(payload.get("status", "")).lower()
            if status == "completed":
                return payload
            if status == "failed":
                raise AssertionError(f"Resource failed at {resource_url}: {payload}")
        time.sleep(5)

    raise TimeoutError(f"Timed out after {timeout}s waiting for {resource_url}. Last payload: {last_payload}")


def _post_with_retry(client: httpx.Client, url: str, json_payload: dict, retries: int = 4) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return client.post(url, json=json_payload)
        except (httpx.ReadTimeout, httpx.RemoteProtocolError, httpx.ConnectError) as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(min(8.0, attempt * 1.5))
    if last_exc is not None:
        raise last_exc
    return client.post(url, json=json_payload)


def _select_feature_subset(feature_columns: list[str]) -> list[str]:
    preferred_prefixes = (
        "rsi_",
        "ema_",
        "sma_",
        "adx_",
        "atr_",
        "macd_",
        "bb_",
        "stoch_",
    )
    filtered = [c for c in feature_columns if c.startswith(preferred_prefixes)]
    # Keep base indicators first, then a limited number of lagged variants.
    base = [c for c in filtered if "_lag" not in c]
    lagged = [c for c in filtered if "_lag" in c]
    selected = base[:24] + lagged[:12]
    # Fallback to top-N raw feature columns if prefix filtering is too strict.
    return selected if len(selected) >= 20 else feature_columns[:30]


def _fetch_btc_dataset(client: httpx.Client) -> dict:
    response = client.post(
        f"{API_BASE}/fetch/market-data",
        json={
            "source": "binance",
            "symbol": BTC_SYMBOL,
            "timeframe": BTC_TIMEFRAME,
            "date_from": BTC_DATE_FROM,
            "date_to": BTC_DATE_TO,
        },
    )
    assert response.status_code == 202, response.text
    task_id = response.json()["task_id"]

    final = _wait_task_sync(task_id)
    assert final["status"] == "SUCCESS", final
    result = final.get("result") or {}
    dataset_id = result.get("dataset_id")
    preview = result.get("preview") or {}
    assert dataset_id, f"dataset_id missing from fetch result: {result}"
    assert preview.get("row_count", 0) > 30_000, f"BTC fetch returned too little data: {preview}"
    return {"dataset_id": dataset_id, "preview": preview, "task_id": task_id}


def _build_pipeline(client: httpx.Client, dataset_id: str) -> dict:
    payload = {
        "dataset_id": dataset_id,
        "name": "btc_h1_fullstack",
        "indicators": BTC_INDICATORS,
        "targets": [BTC_TARGET],
        "lags": [1, 2, 3, 6, 12],
    }
    response = _post_with_retry(client, f"{API_BASE}/pipelines/generate", payload)
    assert response.status_code == 202, response.text
    return response.json()


@pytest.fixture(scope="module", autouse=True)
def clean_slate():
    _reset_environment()
    assert all(value == 0 for value in _count_rows().values()), _count_rows()
    yield


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=600.0) as c:
        yield c


@pytest.fixture(scope="module")
def btc_dataset(client):
    return _fetch_btc_dataset(client)


@pytest.fixture(scope="module")
def btc_pipeline(client, btc_dataset):
    pipeline = _build_pipeline(client, btc_dataset["dataset_id"])
    _wait_task_sync(pipeline["celery_task_id"])
    return {"pipeline": pipeline, "dataset": btc_dataset}


@pytest.fixture(scope="module")
def btc_feature_set(client, btc_pipeline):
    pipeline = client.get(f"{API_BASE}/pipelines/{btc_pipeline['pipeline']['id']}").json()
    feature_columns = [c for c in pipeline.get("feature_columns", []) if not c.startswith("y_")]
    assert len(feature_columns) >= 40, f"Unexpectedly small BTC feature space: {len(feature_columns)}"
    selected_columns = _select_feature_subset(feature_columns)
    assert len(selected_columns) >= 20, selected_columns

    fs_response = client.post(
        f"{API_BASE}/feature-sets/",
        json={
            "pipeline_id": btc_pipeline["pipeline"]["id"],
            "name": "btc_h1_selected",
            "selected_columns": selected_columns,
            "target_column": BTC_TARGET["name"],
        },
    )
    assert fs_response.status_code in (200, 201), fs_response.text
    return {
        "feature_set": fs_response.json(),
        "selected_columns": selected_columns,
        "feature_columns": feature_columns,
    }


@pytest.fixture(scope="module")
def btc_model(client, btc_pipeline, btc_feature_set):
    response = client.post(
        f"{API_BASE}/models/train",
        json={
            "pipeline_id": btc_pipeline["pipeline"]["id"],
            "feature_set_id": btc_feature_set["feature_set"]["id"],
            "target_column": BTC_TARGET["name"],
            "model_type": "lightgbm",
            "auto_tune": True,
            "tune_trials": 15,
            "optimize_metric": "roc_auc",
            "tune_search_space": {
                "n_estimators": [60, 80, 100],
                "learning_rate": [0.01, 0.03, 0.05],
                "num_leaves": [15, 25, 31],
                "subsample": [0.8, 0.9, 1.0],
                "colsample_bytree": [0.8, 0.9, 1.0],
                "min_child_samples": [30, 50, 80],
            },
            "n_splits": 3,
            "gap": 24,
        },
    )
    assert response.status_code == 202, response.text
    model = response.json()
    _wait_resource_status(client, f"{API_BASE}/models/{model['id']}")
    return model


@pytest.fixture(scope="module")
def btc_backtest(client, btc_model):
    response = client.post(
        f"{API_BASE}/backtests/run",
        json={
            "model_id": btc_model["id"],
            "initial_capital": 10_000.0,
            "fee_pct": 0.0005,
            "slippage_pct": 0.0002,
            "long_threshold": 0.662,
            "short_threshold": 0.338,
        },
    )
    assert response.status_code == 202, response.text
    backtest = response.json()
    _wait_resource_status(client, f"{API_BASE}/backtests/{backtest['id']}")
    return backtest


def test_clean_slate_before_run():
    counts = _count_rows()
    assert all(value == 0 for value in counts.values()), counts


def test_btc_h1_pipeline_completed(client, btc_pipeline):
    pipeline = client.get(f"{API_BASE}/pipelines/{btc_pipeline['pipeline']['id']}").json()
    assert pipeline["status"] == "completed", pipeline
    feature_columns = [c for c in pipeline.get("feature_columns", []) if not c.startswith("y_")]
    assert len(feature_columns) >= 40, f"Feature space too small: {len(feature_columns)}"
    assert "rsi_7" in feature_columns, feature_columns[:20]
    assert "ema_12" in feature_columns, feature_columns[:20]
    assert "macd_8_24" in feature_columns, feature_columns[:20]


def test_btc_h1_training_and_backtest_quality(client, btc_dataset, btc_feature_set, btc_model, btc_backtest):
    dataset_rows = btc_dataset["preview"]["row_count"]
    assert dataset_rows > 30_000, dataset_rows

    model = client.get(f"{API_BASE}/models/{btc_model['id']}").json()
    assert model["status"] == "completed", model

    selected_features = model.get("selected_features", [])
    assert len(selected_features) >= 5, selected_features
    assert set(selected_features).issubset(set(btc_feature_set["feature_set"]["selected_columns"])), selected_features

    cv_metrics = model.get("cv_metrics", {})
    aggregate = cv_metrics.get("aggregate", {})
    oos_start_index = cv_metrics.get("oos_start_index", 0)
    assert oos_start_index > 100, oos_start_index
    assert 0.0 <= aggregate.get("accuracy_mean", 0.0) <= 1.0, aggregate
    # 3-class unbalanced target: realistic accuracy threshold for BTC direction
    assert aggregate.get("accuracy_mean", 0.0) >= 0.30, aggregate

    backtest = client.get(f"{API_BASE}/backtests/{btc_backtest['id']}").json()
    assert backtest["status"] == "completed", backtest
    metrics = backtest.get("metrics", {})
    assert metrics.get("n_trades", 0) > 0, metrics
    assert metrics.get("win_rate", 0.0) >= 25.0, metrics
    assert metrics.get("max_drawdown", -100.0) > -15.0, metrics
    assert metrics.get("total_return", -100.0) > 0.0, metrics

    equity_curve_response = client.get(f"{API_BASE}/backtests/{btc_backtest['id']}/equity-curve")
    assert equity_curve_response.status_code == 200, equity_curve_response.text
    equity_curve = equity_curve_response.json()
    assert len(equity_curve) > 0, equity_curve
    assert equity_curve[0]["value"] > 0, equity_curve[0]
    assert all(point["value"] > 0 for point in equity_curve), equity_curve[:5]
