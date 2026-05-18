import asyncio
import time

import asyncpg
import boto3
import httpx
import redis
from botocore.exceptions import ClientError
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine


def _retry(callable_obj, *, attempts: int = 10, delay: float = 2.0):
    last_error = None
    for attempt in range(attempts):
        try:
            return callable_obj()
        except Exception as exc:  # pragma: no cover - retry path is environment dependent
            last_error = exc
            if attempt == attempts - 1:
                raise
            time.sleep(delay)
    raise last_error


def test_db_connection():
    async def _check():
        conn = await asyncpg.connect(settings.database_url.replace("+asyncpg", ""))
        try:
            value = await conn.fetchval("SELECT 1")
            assert value == 1
        finally:
            await conn.close()

    _retry(lambda: asyncio.run(_check()))


def test_sqlalchemy_tables_created():
    expected_tables = {"datasets", "feature_pipelines", "ai_models", "backtests"}

    async def _check():
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    """
                )
            )
            table_names = {row[0] for row in result.fetchall()}
            assert expected_tables.issubset(table_names)

    _retry(lambda: asyncio.run(_check()))


def test_valkey_ping():
    client = redis.Redis.from_url(settings.valkey_url, decode_responses=True)
    assert _retry(client.ping) is True


def test_minio_reachable_and_bucket_exists():
    client = boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
    )
    bucket_name = "quant-data"

    def _check():
        try:
            client.head_bucket(Bucket=bucket_name)
        except ClientError:
            client.create_bucket(Bucket=bucket_name)
            client.head_bucket(Bucket=bucket_name)
        return True

    assert _retry(_check) is True


def test_mlflow_health_endpoint():
    def _check():
        response = httpx.get(f"{settings.mlflow_tracking_uri}/health", timeout=10.0)
        assert response.status_code == 200
        return True

    assert _retry(_check, attempts=15, delay=2.0) is True