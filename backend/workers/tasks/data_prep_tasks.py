"""Data Preparation Celery Task - Alignment, Cleaning, Missing Value Handling, Normalization."""
import io
import json
from celery import Task

import polars as pl
from workers.celery_app import celery_app
from app.core.storage import download_bytes, upload_file, parse_s3_uri
from app.core.config import settings


def _update_prep_state(prep_id: str, **kwargs):
    """Synchronous DB update from within Celery."""
    from sqlalchemy import create_engine as _ce, text

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["prep_id"] = prep_id
        conn.execute(
            text(f"UPDATE data_preparations SET {set_clauses}, updated_at = now() WHERE id = :prep_id"),
            params,
        )
    engine.dispose()


def _compute_quality_metrics(df: pl.DataFrame, timeframe: str = None) -> dict:
    """Compute data quality metrics."""
    try:
        # Expected interval in seconds
        interval_map = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800}
        expected_interval_sec = interval_map.get(timeframe, 3600)

        # Timestamp analysis (if timestamp column exists)
        if "timestamp" in df.columns:
            df = df.sort("timestamp")
        
        # Basic stats
        row_count = len(df)
        null_cells = df.select([(pl.col("*").is_null().sum().sum())]).to_series()[0]

        quality = {
            "row_count": row_count,
            "column_count": len(df.columns),
            "null_cells": int(null_cells),
            "expected_interval_sec": expected_interval_sec,
        }

        if "timestamp" in df.columns:
            # Duplicate timestamps
            duplicates = row_count - df.select("timestamp").n_unique()
            quality["duplicate_candles"] = duplicates

            # Gaps
            ts = df.select("timestamp").to_series().sort()
            gaps = ((ts.diff().dt.total_milliseconds() / 1000) > (expected_interval_sec * 1.5)).sum()
            quality["gap_segments"] = int(gaps)

        # OHLCV validation if columns exist
        if all(c in df.columns for c in ["open", "high", "low", "close", "volume"]):
            corrupted = 0
            df_check = df.select(["open", "high", "low", "close", "volume"])

            # High < Low check
            corrupted += (df_check.select((pl.col("high") < pl.col("low")).sum())).item()

            # Negative prices/volume
            for col in ["open", "high", "low", "close"]:
                corrupted += (df_check.select((pl.col(col) < 0).sum())).item()
            corrupted += (df_check.select((pl.col("volume") < 0).sum())).item()

            quality["corrupted_rows"] = int(corrupted)

            # Spikes detection (extreme returns)
            if "close" in df.columns:
                returns = df.select("close").to_series().pct_change()
                threshold = max(0.15, returns.mean() + 4 * returns.std())
                spikes = (returns.abs() > threshold).sum()
                quality["spikes"] = int(spikes)

        return quality

    except Exception as e:
        return {"error": str(e)}


@celery_app.task(
    bind=True,
    name="workers.tasks.data_prep_tasks.prepare_data_task",
    max_retries=2,
    default_retry_delay=30,
)
def prepare_data_task(self: Task, prep_id: str):
    """
    Full data preparation pipeline:
    1. Load raw dataset from S3
    2. Step 3: Timestamp Alignment
    3. Step 4: Data Cleaning
    4. Step 5: Missing Value Handling
    5. Step 6: Normalization
    6. Upload prepared data to S3
    """
    try:
        # --- Load prep config from DB ---
        self.update_state(state="PROGRESS", meta={"progress": 5, "message": "Loading data preparation config..."})
        from sqlalchemy import create_engine as _ce

        sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
        engine = _ce(sync_url)
        with engine.connect() as conn:
            from sqlalchemy import text

            row = conn.execute(
                text("""
                    SELECT dp.alignment_config, dp.cleaning_config, dp.missing_value_config, dp.normalization_config,
                           d.s3_raw_path, d.timeframe
                    FROM data_preparations dp
                    JOIN datasets d ON d.id = dp.dataset_id
                    WHERE dp.id = :prep_id
                """),
                {"prep_id": prep_id},
            ).fetchone()
        engine.dispose()

        if row is None:
            raise ValueError(f"Data preparation job {prep_id} not found")

        alignment_cfg = row[0] if isinstance(row[0], dict) else (json.loads(row[0]) if row[0] else {})
        cleaning_cfg = row[1] if isinstance(row[1], dict) else (json.loads(row[1]) if row[1] else {})
        missing_cfg = row[2] if isinstance(row[2], dict) else (json.loads(row[2]) if row[2] else {})
        norm_cfg = row[3] if isinstance(row[3], dict) else (json.loads(row[3]) if row[3] else {})
        s3_raw_path: str = row[4]
        timeframe: str = row[5]
        s3_input_path: str = alignment_cfg.get("source_s3_path") or s3_raw_path

        _update_prep_state(prep_id, status="running")

        # --- Download raw data ---
        self.update_state(state="PROGRESS", meta={"progress": 10, "message": "Downloading raw dataset..."})
        bucket, key = parse_s3_uri(s3_input_path)
        raw_bytes = download_bytes(bucket, key)
        df = pl.read_parquet(io.BytesIO(raw_bytes))

        # Compute quality before
        quality_before = _compute_quality_metrics(df, timeframe)
        _update_prep_state(prep_id, quality_before=json.dumps(quality_before))

        # --- STEP 3: Timestamp Alignment ---
        self.update_state(state="PROGRESS", meta={
            "progress": 25,
            "message": "Aligning timestamps...",
            "step": "Timestamp Alignment",
            "sub": {"status": "Processing"},
        })

        # Ensure timestamp column exists and is sorted
        if "timestamp" in df.columns:
            df = df.sort("timestamp")
            # Remove exact duplicates on timestamp
            df = df.unique(subset=["timestamp"], keep="first")

        # --- STEP 4: Data Cleaning ---
        self.update_state(state="PROGRESS", meta={
            "progress": 40,
            "message": "Cleaning corrupted data...",
            "step": "Data Cleaning",
            "sub": {"status": "Removing duplicates and corrupted rows"},
        })

        # Remove complete duplicates
        df = df.unique()

        # OHLCV validation
        if all(c in df.columns for c in ["open", "high", "low", "close", "volume"]):
            # Remove rows where high < low
            df = df.filter(pl.col("high") >= pl.col("low"))

            # Remove negative prices
            df = df.filter(pl.col("open") >= 0)
            df = df.filter(pl.col("high") >= 0)
            df = df.filter(pl.col("low") >= 0)
            df = df.filter(pl.col("close") >= 0)
            df = df.filter(pl.col("volume") >= 0)

            # Remove spikes (extreme returns)
            if "close" in df.columns:
                returns = df.select("close").to_series().pct_change()
                if returns.len() > 1:
                    threshold = max(0.15, returns.mean() + 4 * returns.std())
                    df = df.filter(
                        (pl.col("close").pct_change().abs() <= threshold) |
                        (pl.col("close").pct_change().is_null())
                    )

        # --- STEP 5: Missing Value Handling ---
        self.update_state(state="PROGRESS", meta={
            "progress": 55,
            "message": "Handling missing values...",
            "step": "Missing Value Handling",
            "sub": {"status": "Processing NaN and gaps"},
        })

        # Remove rows with NaN in critical columns
        critical_cols = [c for c in ["timestamp", "open", "high", "low", "close", "volume"] if c in df.columns]
        df = df.drop_nulls(subset=critical_cols)

        # Forward fill for funding and other optional columns
        optional_cols = [c for c in df.columns if c not in critical_cols]
        for col in optional_cols:
            if df[col].dtype != pl.Null:
                df = df.with_columns(pl.col(col).fill_null(strategy="forward"))



        # --- Upload prepared data ---
        # --- Filter target columns (y_*) for clean output ---
        self.update_state(state="PROGRESS", meta={"progress": 80, "message": "Filtering target columns..."})
        # Drop columns named 'y' or starting with 'y_'
        target_cols = [c for c in df.columns if c == 'y' or c.startswith('y_')]
        if target_cols:
            df = df.drop(target_cols)

        # --- Upload prepared data ---
        self.update_state(state="PROGRESS", meta={"progress": 85, "message": "Uploading prepared data..."})

        parquet_buffer = io.BytesIO()
        df.write_parquet(parquet_buffer)
        parquet_buffer.seek(0)

        s3_prep_path = f"s3://{settings.minio_bucket_processed}/prepared/{prep_id}.parquet"
        bucket_prep, key_prep = parse_s3_uri(s3_prep_path)
        upload_file(bucket_prep, key_prep, parquet_buffer.getvalue())

        # Compute quality after
        quality_after = _compute_quality_metrics(df, timeframe)

        # --- Update DB ---
        self.update_state(state="PROGRESS", meta={"progress": 95, "message": "Finalizing..."})
        _update_prep_state(
            prep_id,
            status="completed",
            s3_prepared_path=s3_prep_path,
            quality_after=json.dumps(quality_after),
        )

        self.update_state(state="SUCCESS", meta={"progress": 100, "message": "Data preparation completed!"})

    except Exception as exc:
        _update_prep_state(prep_id, status="failed", error_message=str(exc))
        raise
