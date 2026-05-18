"""Celery task: fetch market data from external source and store as Dataset."""
import io
from uuid import uuid4

from celery import Task

from workers.celery_app import celery_app
from workers.engines.fetcher import fetch_market_data, get_data_preview
from app.core.storage import upload_file
from app.core.config import settings


def _create_dataset_record(
    symbol: str,
    timeframe: str,
    source: str,
    s3_path: str,
    row_count: int,
    date_from: str | None,
    date_to: str | None,
) -> str:
    """Insert a Dataset row and return its UUID string."""
    from sqlalchemy import create_engine as _ce, text
    import json as _json

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)

    dataset_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO datasets
                    (id, symbol, timeframe, s3_raw_path, row_count, date_from, date_to, source, created_at)
                VALUES
                    (:id, :symbol, :timeframe, :s3_path, :row_count, :date_from, :date_to, :source, now())
            """),
            {
                "id": dataset_id,
                "symbol": symbol.upper(),
                "timeframe": timeframe,
                "s3_path": s3_path,
                "row_count": str(row_count),
                "date_from": date_from,
                "date_to": date_to,
                "source": source,
            },
        )
    engine.dispose()
    return dataset_id


@celery_app.task(
    bind=True,
    name="workers.tasks.fetch_tasks.fetch_market_data_task",
    max_retries=1,
    default_retry_delay=30,
)
def fetch_market_data_task(
    self: Task,
    source: str,
    symbol: str,
    timeframe: str,
    date_from: str,
    date_to: str,
    enrich_columns: list[str] | None = None,
) -> dict:
    """
    Fetch OHLCV data from external source, upload to MinIO, create Dataset record.

    Returns
    -------
    {"dataset_id": str, "preview": dict}
    """
    try:
        def _progress(pct: int, msg: str):
            self.update_state(
                state="PROGRESS",
                meta={"progress": pct, "message": msg, "step": "Fetching Market Data"},
            )

        _progress(5, f"Connecting to {source.title()}...")

        df = fetch_market_data(
            source=source,
            symbol=symbol,
            timeframe=timeframe,
            date_from=date_from,
            date_to=date_to,
            enrich_columns=enrich_columns,
            progress_cb=_progress,
        )

        _progress(95, "Saving to storage...")

        # Convert to Parquet and upload
        import polars as pl
        buf = io.BytesIO()
        df.write_parquet(buf)
        buf.seek(0)

        s3_key = f"raw/{symbol.lower()}_{timeframe}_{date_from}_{date_to}.parquet"
        s3_path = upload_file(
            bucket="raw-data",
            key=s3_key,
            data=buf.read(),
            content_type="application/octet-stream",
        )

        # Build preview info
        preview = get_data_preview(df)

        # Create DB record
        dataset_id = _create_dataset_record(
            symbol=symbol,
            timeframe=timeframe,
            source=source,
            s3_path=s3_path,
            row_count=preview["row_count"],
            date_from=preview["date_from"],
            date_to=preview["date_to"],
        )

        _progress(100, "Done")

        return {
            "dataset_id": dataset_id,
            "preview": preview,
        }

    except Exception as exc:
        # Keep custom progress channel readable without overriding Celery's
        # native FAILURE payload format.
        self.update_state(
            state="PROGRESS",
            meta={"progress": 0, "message": f"Error: {exc}", "step": "Error"},
        )
        raise
