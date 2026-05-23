"""Celery pipeline task: Feature Factory — Engine A only (indicators + lags).

NOTE: Target generation is now handled by labeled_dataset_tasks.py (Labeling System page).
This task ONLY generates features. No targets are appended here.
"""
import gc
import io
import os
import tempfile

import polars as pl
import pandas as pd
from celery import Task

from workers.celery_app import celery_app
from workers.engines.features import generate_features
from app.core.storage import download_to_file, upload_file, parse_s3_uri
from app.core.config import settings


def _update_pipeline_state(pipeline_id: str, **kwargs):
    """Synchronous DB update from within Celery (uses sync SQLAlchemy)."""
    from sqlalchemy import create_engine as _ce, text
    import json

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["pipeline_id"] = pipeline_id
        conn.execute(
            text(f"UPDATE feature_pipelines SET {set_clauses}, updated_at = now() WHERE id = :pipeline_id"),
            params,
        )
    engine.dispose()


def _get_current_ram_mb() -> float:
    try:
        with open("/proc/self/status", "r") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return round(float(parts[1]) / 1024.0, 2)
    except Exception:
        pass
    return 0.0


@celery_app.task(
    bind=True,
    name="workers.tasks.pipeline_tasks.generate_pipeline_task",
    max_retries=2,
    default_retry_delay=30,
)
def generate_pipeline_task(self: Task, pipeline_id: str):
    """
    Feature Factory pipeline task:
    1. Load raw data from MinIO (Dataset.s3_raw_path)
    2. Engine A: Generate indicators + lags
    3. Save processed Parquet to MinIO (pipelines/{id}/processed.parquet)
    4. Update DB record

    NOTE: No targets are generated here. Targets are handled by the Labeling System.
    """
    def safe_update_state(progress: int, message: str, step: str = None, sub: dict = None):
        ram = _get_current_ram_mb()
        meta = {
            "progress": progress,
            "message": message,
            "celery_ram_mb": ram,
        }
        if step:
            meta["step"] = step
        if sub:
            meta["sub"] = sub
        self.update_state(state="PROGRESS", meta=meta)

    try:
        # --- 1. Load pipeline config from DB ---
        safe_update_state(5, "Loading pipeline config...")
        from sqlalchemy import create_engine as _ce, text
        import json as _json

        sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
        engine = _ce(sync_url)
        with engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT fp.indicators_config, fp.lags, d.s3_raw_path
                    FROM feature_pipelines fp
                    JOIN datasets d ON d.id = fp.dataset_id
                    WHERE fp.id = :pid
                """),
                {"pid": pipeline_id},
            ).fetchone()
        engine.dispose()

        if row is None:
            raise ValueError(f"Pipeline {pipeline_id} not found in DB")

        indicators = row[0] if isinstance(row[0], list) else _json.loads(row[0])
        lags = row[1] if isinstance(row[1], list) else _json.loads(row[1])
        s3_raw_path: str = row[2]

        _update_pipeline_state(pipeline_id, status="running")

        # --- 2. Download raw Parquet from MinIO directly to disk (Zero-RAM) ---
        safe_update_state(15, "Downloading raw data directly to disk...")
        bucket, key = parse_s3_uri(s3_raw_path)
        
        tmp_raw_fd, tmp_raw_path = tempfile.mkstemp(suffix=".parquet")
        os.close(tmp_raw_fd)
        
        try:
            download_to_file(bucket, key, tmp_raw_path)
            # Nạp trực tiếp vào Pandas dùng PyArrow
            df_pd_raw = pd.read_parquet(tmp_raw_path, engine="pyarrow")
        finally:
            if os.path.exists(tmp_raw_path):
                os.unlink(tmp_raw_path)

        # --- 3. Engine A: Feature generation (indicators + lags) ---
        safe_update_state(
            30,
            "Generating indicators & lag features...",
            "STEP 2/3 Generating Features",
            {"indicator": "", "done": 0, "total": len(indicators)},
        )

        def _feature_progress(pct: int, msg: str, sub: dict):
            safe_update_state(
                30 + int(pct * 0.50),
                msg,
                "STEP 2/3 Generating Features",
                sub,
            )

        # --- 4. Save processed Parquet to MinIO ---
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".parquet")
        os.close(tmp_fd)
        try:
            # Truyền tmp_path vào generate_features để ghi lũy tiến trực tiếp (RAM cực nhẹ)
            _, feature_cols = generate_features(
                df_pd_raw,
                indicators,
                lags,
                progress_cb=_feature_progress,
                output_parquet_path=tmp_path
            )
            
            # Giải phóng toàn bộ RAM ngay lập tức
            del df_pd_raw
            gc.collect()

            safe_update_state(82, "Saving processed dataset to MinIO...", "STEP 3/3 Saving to Storage")

            processed_key = f"pipelines/{pipeline_id}/processed.parquet"
            with open(tmp_path, "rb") as fh:
                s3_processed_path = upload_file(
                    settings.minio_bucket_processed,
                    processed_key,
                    fh,
                    "application/octet-stream",
                )
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        # --- 5. Update DB ---
        target_config = None
        for ind in indicators:
            if isinstance(ind, dict) and ind.get("name") == "target_config":
                target_config = ind
                break

        safe_update_state(95, "Updating database...")
        _update_pipeline_state(
            pipeline_id,
            status="completed",
            s3_processed_path=s3_processed_path,
            feature_columns=feature_cols,
        )

        if target_config:
            safe_update_state(96, "Auto-chaining Data Preparation and Target Labeling (Single-Pass)...")
            import uuid
            from sqlalchemy import create_engine as _ce, text

            horizon = int(target_config.get("horizon", 15))
            task_type = target_config.get("task_type", "classification")

            prep_id = uuid.uuid4()
            labeled_id = uuid.uuid4()

            sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
            engine_db = _ce(sync_url)
            with engine_db.begin() as conn:
                # 1. Fetch dataset_id and name of pipeline
                fp_row = conn.execute(
                    text("SELECT dataset_id, name FROM feature_pipelines WHERE id = :pid"),
                    {"pid": pipeline_id}
                ).fetchone()

                if fp_row:
                    dataset_id, pipeline_name = fp_row

                    # 2. Insert DataPreparation (completed status since we reuse the same parquet file!)
                    conn.execute(
                        text("""
                            INSERT INTO data_preparations (id, dataset_id, pipeline_id, name, alignment_config, cleaning_config, missing_value_config, normalization_config, s3_prepared_path, status, created_at, updated_at)
                            VALUES (:id, :dataset_id, :pipeline_id, :name, :align, :clean, :missing, :norm, :path, 'completed', now(), now())
                        """),
                        {
                            "id": prep_id,
                            "dataset_id": dataset_id,
                            "pipeline_id": pipeline_id,
                            "name": f"{pipeline_name}_prep",
                            "align": "{}",
                            "clean": "{}",
                            "missing": "{}",
                            "norm": "{}",
                            "path": s3_processed_path
                        }
                    )

                    # 3. Construct targets config
                    target_name = f"y_{task_type}_{horizon}"
                    if task_type == "classification":
                        t_config = [{
                            "name": target_name,
                            "method": "n_bar",
                            "params": {
                                "shift": horizon,
                                "type": "classification",
                                "bins": [-1e100, 0.0, 1e100]
                            }
                        }]
                    else:
                        t_config = [{
                            "name": target_name,
                            "method": "n_bar",
                            "params": {
                                "shift": horizon,
                                "type": "regression"
                            }
                        }]

                    # 4. Insert LabeledDataset (completed status directly!)
                    target_cols_list = [target_name]
                    feature_cols_list = [c for c in feature_cols if c != target_name]
                    conn.execute(
                        text("""
                            INSERT INTO labeled_datasets (id, data_prep_id, name, targets_config, target_columns, feature_columns, s3_labeled_path, status, created_at, updated_at)
                            VALUES (:id, :prep_id, :name, :targets_config, :target_columns, :feature_columns, :s3_labeled_path, 'completed', now(), now())
                        """),
                        {
                            "id": labeled_id,
                            "prep_id": prep_id,
                            "name": f"{pipeline_name} (Target: {horizon} nến {'Up/Down' if task_type == 'classification' else 'Return'})",
                            "targets_config": _json.dumps(t_config),
                            "target_columns": _json.dumps(target_cols_list),
                            "feature_columns": _json.dumps(feature_cols_list),
                            "s3_labeled_path": s3_processed_path
                        }
                    )
            engine_db.dispose()
            safe_update_state(98, "Successfully completed single-pass target labeling pipeline!")

        return {
            "pipeline_id": pipeline_id,
            "features": len(feature_cols),
            "s3_path": s3_processed_path,
        }

    except Exception as exc:
        _update_pipeline_state(pipeline_id, status="failed", error_message=str(exc))
        if isinstance(exc, (ValueError, TypeError)):
            raise
        raise self.retry(exc=exc)
