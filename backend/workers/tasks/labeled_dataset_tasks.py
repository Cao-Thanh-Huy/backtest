"""Celery task: generate targets from a completed DataPreparation.

Flow:
1. Đọc config từ labeled_datasets JOIN data_preparations trong DB
2. Download s3_prepared_path (file đã làm sạch của Data Prep)
3. Gọi generate_targets() → tạo các cột y_*
4. Upload file mới lên s3://bucket/labeled/{id}/labeled.parquet
5. Update DB: status=completed, target_columns, feature_columns, s3_labeled_path
"""
import gc
import io
import json
import os
import tempfile

import polars as pl
from celery import Task

from workers.celery_app import celery_app
from workers.engines.features import generate_targets
from app.core.storage import download_bytes, upload_file, parse_s3_uri
from app.core.config import settings


def _update_labeled_dataset_state(labeled_dataset_id: str, **kwargs):
    """Synchronous DB update from within Celery worker."""
    from sqlalchemy import create_engine as _ce, text

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["labeled_dataset_id"] = labeled_dataset_id
        conn.execute(
            text(
                f"UPDATE labeled_datasets SET {set_clauses}, updated_at = now() "
                f"WHERE id = :labeled_dataset_id"
            ),
            params,
        )
    engine.dispose()


@celery_app.task(
    bind=True,
    name="workers.tasks.labeled_dataset_tasks.generate_labeled_dataset_task",
    max_retries=2,
    default_retry_delay=30,
)
def generate_labeled_dataset_task(self: Task, labeled_dataset_id: str):
    """
    Generate targets from a DataPreparation file and save as a new LabeledDataset file.

    Each LabeledDataset gets its own independent S3 file. Deleting this record
    does NOT affect the parent DataPreparation.
    """
    try:
        self.update_state(state="PROGRESS", meta={"progress": 5, "message": "Loading config from DB..."})

        from sqlalchemy import create_engine as _ce, text as _text

        sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
        engine = _ce(sync_url)
        with engine.connect() as conn:
            row = conn.execute(
                _text("""
                    SELECT ld.targets_config, dp.s3_prepared_path
                    FROM labeled_datasets ld
                    JOIN data_preparations dp ON dp.id = ld.data_prep_id
                    WHERE ld.id = :lid
                """),
                {"lid": labeled_dataset_id},
            ).fetchone()
        engine.dispose()

        if row is None:
            raise ValueError(f"LabeledDataset {labeled_dataset_id} not found or data_prep missing")

        targets_config = row[0] if isinstance(row[0], list) else json.loads(row[0] or "[]")
        s3_prepared_path: str = row[1]

        if not s3_prepared_path:
            raise ValueError("DataPreparation has no s3_prepared_path — run Data Prep first")

        _update_labeled_dataset_state(labeled_dataset_id, status="running")

        # --- Download prepared Parquet from Data Prep ---
        self.update_state(state="PROGRESS", meta={"progress": 15, "message": "Downloading prepared dataset..."})
        bucket, key = parse_s3_uri(s3_prepared_path)
        raw_bytes = download_bytes(bucket, key)
        df_pl = pl.read_parquet(io.BytesIO(raw_bytes))
        df_pd = df_pl.to_pandas()
        feature_cols = list(df_pl.columns)  # all columns from prep = features

        # --- Generate targets ---
        self.update_state(state="PROGRESS", meta={
            "progress": 30,
            "message": f"Generating {len(targets_config)} target(s)...",
            "step": "Target Generation",
            "sub": {"done": 0, "total": len(targets_config)},
        })

        df_pd, target_cols = generate_targets(df_pd, targets_config)

        self.update_state(state="PROGRESS", meta={
            "progress": 70,
            "message": f"Generated: {', '.join(target_cols)}",
            "step": "Target Generation",
        })

        # --- Save to its own S3 path ---
        self.update_state(state="PROGRESS", meta={"progress": 80, "message": "Uploading labeled dataset..."})

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".parquet")
        os.close(tmp_fd)
        try:
            df_out = pl.from_pandas(df_pd)
            df_out.write_parquet(tmp_path)
            del df_out, df_pd
            gc.collect()

            labeled_key = f"labeled/{labeled_dataset_id}/labeled.parquet"
            with open(tmp_path, "rb") as fh:
                s3_labeled_path = upload_file(
                    settings.minio_bucket_processed,
                    labeled_key,
                    fh,
                    "application/octet-stream",
                )
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        # --- Update DB ---
        self.update_state(state="PROGRESS", meta={"progress": 95, "message": "Updating database..."})
        _update_labeled_dataset_state(
            labeled_dataset_id,
            status="completed",
            s3_labeled_path=s3_labeled_path,
            feature_columns=feature_cols,
            target_columns=target_cols,
        )

        return {
            "labeled_dataset_id": labeled_dataset_id,
            "feature_columns": len(feature_cols),
            "target_columns": target_cols,
            "s3_path": s3_labeled_path,
        }

    except Exception as exc:
        _update_labeled_dataset_state(
            labeled_dataset_id,
            status="failed",
            error_message=str(exc),
        )
        if isinstance(exc, (ValueError, TypeError)):
            raise
        raise self.retry(exc=exc)
