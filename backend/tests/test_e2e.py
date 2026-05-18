import asyncio
import io
import json
import time
from datetime import datetime

import boto3
import httpx
import pandas as pd
import polars as pl
from sqlalchemy import create_engine, text
from websockets import connect
from websockets.exceptions import ConnectionClosedError

from app.core.config import settings
from app.core.storage import parse_s3_uri


API_BASE = "http://localhost:8000/api/v1"
WS_BASE = "ws://localhost:8000/api/v1/ws"


def _build_mock_csv() -> bytes:
    rows = 5000
    date_index = pd.date_range(start=datetime(2024, 1, 1), periods=rows, freq="D")
    df = pl.DataFrame(
        {
            "datetime": date_index,
            "open": [100 + i * 0.1 for i in range(rows)],
            "high": [100.5 + i * 0.1 for i in range(rows)],
            "low": [99.5 + i * 0.1 for i in range(rows)],
            "close": [100.2 + i * 0.1 for i in range(rows)],
            "volume": [1000 + i * 10 for i in range(rows)],
        }
    )
    buffer = io.BytesIO()
    df.write_csv(buffer)
    return buffer.getvalue()


async def _collect_task_states(task_id: str, timeout_seconds: int = 180) -> list[str]:
    statuses: list[str] = []
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        try:
            async with connect(f"{WS_BASE}/task/{task_id}") as websocket:
                while time.time() < deadline:
                    message = await asyncio.wait_for(websocket.recv(), timeout=10)
                    payload = json.loads(message)
                    status = payload.get("status")
                    statuses.append(status)

                    if status in {"SUCCESS", "FAILURE"}:
                        if status == "FAILURE":
                            raise AssertionError(f"Celery task failed via websocket: {payload}")
                        return statuses
        except ConnectionClosedError as exc:
            # Uvicorn reload in dev mode can close connections with 1012.
            if exc.code != 1012:
                raise
            await asyncio.sleep(0.5)

    raise TimeoutError(f"Timed out waiting for websocket completion for task {task_id}")


def test_pipeline_e2e_api_celery_websocket_db_minio():
    client = httpx.Client(timeout=30.0)

    # 1) Upload dataset
    csv_bytes = _build_mock_csv()
    upload_response = client.post(
        f"{API_BASE}/datasets/upload",
        data={"symbol": "BTCUSDT", "timeframe": "1d"},
        files={"file": ("mock_ohlcv.csv", csv_bytes, "text/csv")},
    )
    assert upload_response.status_code == 201, upload_response.text
    dataset_id = upload_response.json()["id"]

    # 2) Trigger pipeline generation (must be 202)
    pipeline_payload = {
        "dataset_id": dataset_id,
        "name": "e2e_pipeline",
        "indicators": [
            {"name": "rsi", "params": {"length": 14}},
            {"name": "ema", "params": {"length": 21}},
        ],
        "targets": [
            {"name": "y_return_3d", "method": "n_bar", "params": {"shift": 3, "type": "regression"}}
        ],
        "lags": [1, 2],
    }
    pipeline_response = client.post(f"{API_BASE}/pipelines/generate", json=pipeline_payload)
    assert pipeline_response.status_code == 202, pipeline_response.text
    pipeline_data = pipeline_response.json()
    pipeline_id = pipeline_data["id"]
    task_id = pipeline_data["celery_task_id"]
    assert task_id

    # 3) WebSocket progress stream: expect lifecycle to reach SUCCESS
    statuses = asyncio.run(_collect_task_states(task_id))
    assert "PENDING" in statuses
    assert "PROGRESS" in statuses
    assert statuses[-1] == "SUCCESS"

    # 4) Verify DB row populated with processed S3 path
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = create_engine(sync_url)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT status, s3_processed_path
                    FROM feature_pipelines
                    WHERE id = :pid
                    """
                ),
                {"pid": pipeline_id},
            ).fetchone()
    finally:
        engine.dispose()

    assert row is not None
    assert str(row[0]) in {"completed", "StatusEnum.completed"}
    s3_processed_path = row[1]
    assert s3_processed_path and s3_processed_path.startswith("s3://")

    # 5) Verify object exists in MinIO
    bucket, key = parse_s3_uri(s3_processed_path)
    s3_client = boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
    )
    head = s3_client.head_object(Bucket=bucket, Key=key)
    assert head["ResponseMetadata"]["HTTPStatusCode"] == 200