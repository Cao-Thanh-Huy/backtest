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

        tmp_in_fd, tmp_in_path = tempfile.mkstemp(suffix=".parquet")
        os.close(tmp_in_fd)
        try:
            # Download directly and save to disk
            raw_bytes = download_bytes(bucket, key)
            with open(tmp_in_path, "wb") as f:
                f.write(raw_bytes)
            del raw_bytes
            gc.collect()

            self.update_state(state="PROGRESS", meta={
                "progress": 30,
                "message": "Generating targets separately via old Pandas flow...",
                "step": "Target Generation",
            })

            # Read only 'close' column to compute returns (takes virtually 0 RAM!)
            df_close = pl.read_parquet(tmp_in_path, columns=["close"])
            
            # Convert to Pandas just like the old flow, but only for the close column
            df_pd_close = df_close.to_pandas()
            
            # Use the EXACT old target generation function!
            df_pd_close, target_cols = generate_targets(df_pd_close, targets_config)
            
            # Drop NaN rows just like the old flow
            df_pd_close = df_pd_close.dropna(subset=target_cols).reset_index(drop=True)

            self.update_state(state="PROGRESS", meta={
                "progress": 70,
                "message": f"Generated: {', '.join(target_cols)}",
                "step": "Target Generation",
            })

            # Convert target columns back to Polars
            df_targets_pl = pl.from_pandas(df_pd_close[target_cols])

            # Load the full Polars dataframe (extremely memory optimized compared to Pandas)
            df_pl = pl.read_parquet(tmp_in_path)

            # Slice the main dataframe to align with dropped NaNs from target calculation
            df_pl = df_pl.head(len(df_targets_pl))

            # Concat/horizontal append target columns to the main dataframe
            df_pl = df_pl.with_columns(df_targets_pl)

            feature_cols = [c for c in df_pl.columns if c not in target_cols and c != "timestamp"]

            # Save the new parquet file back to S3
            self.update_state(state="PROGRESS", meta={"progress": 80, "message": "Uploading labeled dataset..."})
            labeled_key = f"labeled/{labeled_dataset_id}/labeled.parquet"
            
            tmp_out_fd, tmp_out_path = tempfile.mkstemp(suffix=".parquet")
            os.close(tmp_out_fd)
            try:
                df_pl.write_parquet(tmp_out_path)
                with open(tmp_out_path, "rb") as fh:
                    s3_labeled_path = upload_file(
                        settings.minio_bucket_processed,
                        labeled_key,
                        fh,
                        "application/octet-stream",
                    )
            finally:
                if os.path.exists(tmp_out_path):
                    os.unlink(tmp_out_path)

            del df_pl, df_targets_pl, df_pd_close
            gc.collect()

        finally:
            if os.path.exists(tmp_in_path):
                os.unlink(tmp_in_path)

        # --- Update DB ---
        self.update_state(state="PROGRESS", meta={"progress": 95, "message": "Updating database..."})
        _update_labeled_dataset_state(
            labeled_dataset_id,
            status="completed",
            s3_labeled_path=s3_labeled_path,
            feature_columns=feature_cols,
            target_columns=target_cols,
        )

        # Synchronize target columns and paths back to parent FeaturePipeline so they appear on Trang 2's UI
        try:
            with engine.begin() as conn:
                pipeline_row = conn.execute(
                    _text("""
                        SELECT dp.pipeline_id 
                        FROM labeled_datasets ld
                        JOIN data_preparations dp ON dp.id = ld.data_prep_id
                        WHERE ld.id = :lid
                    """),
                    {"lid": labeled_dataset_id},
                ).fetchone()
                
                if pipeline_row:
                    pipeline_id = pipeline_row[0]
                    fp_row = conn.execute(
                        _text("SELECT feature_columns FROM feature_pipelines WHERE id = :pid"),
                        {"pid": pipeline_id}
                    ).fetchone()
                    
                    if fp_row:
                        import json
                        val = fp_row[0]
                        if isinstance(val, str):
                            current_cols = json.loads(val or "[]")
                        elif isinstance(val, list):
                            current_cols = val
                        else:
                            current_cols = []
                        new_cols = list(current_cols)
                        for tc in target_cols:
                            if tc not in new_cols:
                                new_cols.append(tc)
                        
                        # Use a new connection transaction to ensure clean commit and transition pipeline to completed!
                        conn.execute(
                            _text("""
                                UPDATE feature_pipelines
                                SET feature_columns = :cols, s3_processed_path = :path, status = 'completed', progress = 100, updated_at = now()
                                WHERE id = :pid
                            """),
                            {"cols": json.dumps(new_cols), "path": s3_labeled_path, "pid": pipeline_id}
                        )
        except Exception as sync_exc:
            print(f"[SyncPipeline] Failed to sync target back to FeaturePipeline: {sync_exc}")

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
        # Transition parent FeaturePipeline status to failed as well
        try:
            with engine.begin() as conn:
                pipeline_row = conn.execute(
                    _text("""
                        SELECT dp.pipeline_id 
                        FROM labeled_datasets ld
                        JOIN data_preparations dp ON dp.id = ld.data_prep_id
                        WHERE ld.id = :lid
                    """),
                    {"lid": labeled_dataset_id},
                ).fetchone()
                
                if pipeline_row:
                    pipeline_id = pipeline_row[0]
                    conn.execute(
                        _text("""
                            UPDATE feature_pipelines
                            SET status = 'failed', error_message = :err, updated_at = now()
                            WHERE id = :pid
                        """),
                        {"err": f"Target Labeling Failed: {exc}", "pid": pipeline_id}
                    )
        except Exception as sync_err:
            print(f"[SyncPipeline] Failed to mark pipeline as failed: {sync_err}")
            
        if isinstance(exc, (ValueError, TypeError)):
            raise
        raise self.retry(exc=exc)
