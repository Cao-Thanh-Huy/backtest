"""Celery task: generate feature sets by analyzing labeled datasets."""
import json
import logging
import pandas as pd
from celery import Task
from sqlalchemy import create_engine as _ce, text

from workers.celery_app import celery_app
from workers.engines.selector import analyze_features
from app.core.storage import download_bytes, parse_s3_uri
from app.core.config import settings

logger = logging.getLogger(__name__)


def _update_feature_set_state(feature_set_id: str, **kwargs):
    """Synchronous DB update from within Celery worker."""
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["feature_set_id"] = feature_set_id
        conn.execute(
            text(
                f"UPDATE feature_sets SET {set_clauses} "
                f"WHERE id = :feature_set_id"
            ),
            params,
        )
    engine.dispose()


def _get_fs_and_ld(feature_set_id: str):
    """Fetch FeatureSet config and LabeledDataset S3 path."""
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "SELECT f.analysis_config, f.target_column, l.s3_labeled_path "
                "FROM feature_sets f "
                "JOIN labeled_datasets l ON f.labeled_dataset_id = l.id "
                "WHERE f.id = :id"
            ),
            {"id": feature_set_id},
        ).fetchone()
    engine.dispose()
    if not result:
        raise ValueError(f"FeatureSet {feature_set_id} not found or no parent LD.")
    return result[0], result[1], result[2]


@celery_app.task(
    bind=True,
    name="workers.tasks.feature_tasks.generate_feature_set_task",
    max_retries=1,
)
def generate_feature_set_task(self: Task, feature_set_id: str):
    """
    Run feature selection analysis and save results to FeatureSet DB record.
    """
    self.update_state(state="PROGRESS", meta={"progress": 5, "message": "Initializing analysis..."})
    try:
        config, target_col, s3_path = _get_fs_and_ld(feature_set_id)
        if not s3_path:
            raise ValueError("Parent LabeledDataset has no S3 path (not completed?)")

        self.update_state(state="PROGRESS", meta={"progress": 15, "message": "Downloading dataset..."})
        bucket, key = parse_s3_uri(s3_path)
        parquet_bytes = download_bytes(bucket, key)
        import io
        df = pd.read_parquet(io.BytesIO(parquet_bytes))

        feature_cols = [c for c in df.columns if c != target_col and not c.startswith("y_") and c != "timestamp"]

        if not feature_cols:
            raise ValueError("No candidate feature columns found in dataset")

        self.update_state(state="PROGRESS", meta={"progress": 30, "message": f"Analyzing {len(feature_cols)} features..."})
        
        analysis_result = analyze_features(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            task=config.get("task", "regression"),
            vif_threshold=config.get("vif_threshold", 10.0),
            corr_threshold=config.get("corr_threshold", 0.95),
            mi_top_k=config.get("mi_top_k", 50),
            tree_top_k=config.get("tree_top_k", 20),
            celery_task=self,
        )

        self.update_state(state="PROGRESS", meta={"progress": 90, "message": "Saving results to DB..."})

        _update_feature_set_state(
            feature_set_id,
            status="completed",
            analysis_snapshot=analysis_result,
            selected_columns=analysis_result.get("final_selected", []),
            error_message=None,
        )

        self.update_state(state="SUCCESS", meta={"progress": 100, "message": "Feature Selection Complete"})
        return {"feature_set_id": feature_set_id, "selected_count": len(analysis_result.get("final_selected", []))}

    except Exception as exc:
        logger.exception("Feature selection task failed")
        _update_feature_set_state(feature_set_id, status="failed", error_message=str(exc))
        self.update_state(state="FAILURE", meta={"error": str(exc), "progress": 0, "message": "Failed"})
        raise
