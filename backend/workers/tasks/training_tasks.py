"""Celery training task: Engine C (feature selection) + Engine D (trainer)."""
import io
from typing import Any

from workers.celery_app import celery_app
from workers.engines.selector import select_features
from workers.engines.trainer import train_walk_forward, tune_hyperparameters_walk_forward, _is_classification
from app.core.storage import download_bytes, parse_s3_uri
from app.core.config import settings


def _get_model_row(model_id: str):
    from sqlalchemy import create_engine as _ce, text
    import json as _json

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT m.target_column, m.model_type, m.hyperparameters,
                       m.feature_set_id,
                       fp.s3_processed_path, fp.feature_columns, fp.targets_config,
                       fs.selected_columns
                FROM ai_models m
                JOIN feature_pipelines fp ON fp.id = m.pipeline_id
                LEFT JOIN feature_sets fs ON fs.id = m.feature_set_id
                WHERE m.id = :mid
            """),
            {"mid": model_id},
        ).fetchone()
    engine.dispose()
    return row


def _update_model_state(model_id: str, **kwargs):
    from sqlalchemy import create_engine as _ce, text
    import json as _json

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (_json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["model_id"] = model_id
        conn.execute(
            text(f"UPDATE ai_models SET {set_clauses}, updated_at = now() WHERE id = :model_id"),
            params,
        )
    engine.dispose()


@celery_app.task(
    bind=True,
    name="workers.tasks.training_tasks.train_model_task",
    max_retries=1,
    default_retry_delay=60,
)
def train_model_task(
    self,
    model_id: str,
    n_splits: int = 5,
    gap: int = 10,
    auto_tune: bool = False,
    tune_trials: int = 20,
    tune_search_space: dict[str, Any] | None = None,
    optimize_metric: str | None = None,
):
    """
    1. Load processed Parquet from MinIO
    2. Engine C: Feature selection
    3. Engine D: Optional hyperparameter tuning + walk-forward training + MLflow logging
    4. Update DB
    """
    try:
        import json as _json

        self.update_state(state="PROGRESS", meta={
            "progress": 5,
            "message": "Loading model config...",
            "step": "STEP 1/5 Loading Config",
        })
        row = _get_model_row(model_id)
        if row is None:
            raise ValueError(f"Model {model_id} not found")

        target_col: str = row[0]
        model_type: str = row[1]
        hyperparameters = row[2] if isinstance(row[2], dict) else _json.loads(row[2])
        feature_set_id = row[3]
        s3_processed: str = row[4]
        pipeline_feature_cols = row[5] if isinstance(row[5], list) else _json.loads(row[5])
        targets_config = row[6] if isinstance(row[6], list) else _json.loads(row[6])
        feature_set_cols = []
        if row[7] is not None:
            feature_set_cols = row[7] if isinstance(row[7], list) else _json.loads(row[7])

        # Derive explicit task type from target config to avoid fragile heuristics
        explicit_task: str | None = None
        for t in targets_config:
            if t.get("name") == target_col:
                t_type = t.get("params", {}).get("type", t.get("type", ""))
                if t_type == "classification":
                    explicit_task = "classification"
                elif t_type == "regression":
                    explicit_task = "regression"
                break

        _update_model_state(model_id, status="running")

        # --- Load Parquet ---
        self.update_state(state="PROGRESS", meta={
            "progress": 15,
            "message": "Loading processed dataset from MinIO...",
            "step": "STEP 2/5 Loading Data",
        })
        bucket, key = parse_s3_uri(s3_processed)
        raw_bytes = download_bytes(bucket, key)
        import polars as pl
        df = pl.read_parquet(io.BytesIO(raw_bytes)).to_pandas()

        # Resolve candidate columns from feature_set when provided, otherwise fallback to pipeline columns.
        candidate_cols = feature_set_cols if feature_set_id and feature_set_cols else pipeline_feature_cols
        # Filter to only feature cols that actually exist
        feature_cols = [c for c in candidate_cols if c in df.columns and c != target_col and not c.startswith("y_")]
        if target_col not in df.columns:
            raise ValueError(f"Target column {target_col!r} not in dataset")
        if not feature_cols:
            src = "feature set" if feature_set_id else "pipeline"
            raise ValueError(f"No usable feature columns found from {src} for model {model_id}")

        # Drop rows with NaN in target
        df = df.dropna(subset=[target_col]).reset_index(drop=True)

        inferred_task = explicit_task or ("classification" if _is_classification(df[target_col]) else "regression")

        # --- Engine C: Feature Selection ---
        self.update_state(state="PROGRESS", meta={
            "progress": 30,
            "message": f"Running feature selection on {len(feature_cols)} candidates...",
            "step": "STEP 3/5 Feature Selection",
            "sub": {
                "total_features": len(feature_cols),
                "source": "feature_set" if feature_set_id else "pipeline",
            },
        })
        selected_features, importances = select_features(
            df=df,
            target_col=target_col,
            feature_cols=feature_cols,
            task=inferred_task,
        )
        self.update_state(state="PROGRESS", meta={
            "progress": 48,
            "message": f"Selected {len(selected_features)} features (from {len(feature_cols)})",
            "step": "STEP 3/5 Feature Selection",
        })

        # --- Engine D: Auto Tune + Walk-Forward Training ---
        import time as _time
        _train_start = _time.time()
        tuning_summary = None

        def _trial_progress(trial: int, total_trials: int, best_score: float | None):
            elapsed = int(_time.time() - _train_start)
            avg_per_trial = elapsed / max(trial, 1)
            remaining = int(avg_per_trial * (total_trials - trial))
            self.update_state(state="PROGRESS", meta={
                "progress": 50 + int((trial / total_trials) * 18),
                "message": f"Auto-tuning trial {trial}/{total_trials} — {model_type.upper()}",
                "step": "STEP 4/5 Hyperparameter Tuning",
                "sub": {
                    "trial": trial,
                    "total_trials": total_trials,
                    "model": model_type,
                    "elapsed_sec": elapsed,
                    "remaining_sec": remaining,
                    "best_score": round(best_score, 6) if best_score is not None else None,
                },
            })

        def _fold_progress(fold: int, total_folds: int, best_metric: float | None):
            elapsed = int(_time.time() - _train_start)
            avg_per_fold = elapsed / max(fold, 1)
            remaining = int(avg_per_fold * (total_folds - fold))
            self.update_state(state="PROGRESS", meta={
                "progress": 70 + int((fold / total_folds) * 20),
                "message": f"Training fold {fold}/{total_folds} — {model_type.upper()}",
                "step": "STEP 4/5 Final Walk-Forward CV",
                "sub": {
                    "fold": fold,
                    "total_folds": total_folds,
                    "model": model_type,
                    "elapsed_sec": elapsed,
                    "remaining_sec": remaining,
                    "best_metric": round(best_metric, 4) if best_metric is not None else None,
                },
            })

        if auto_tune:
            self.update_state(state="PROGRESS", meta={
                "progress": 50,
                "message": f"Starting auto-tuning ({tune_trials} trials) for {model_type.upper()}...",
                "step": "STEP 4/5 Hyperparameter Tuning",
            })
            tune_result = tune_hyperparameters_walk_forward(
                df=df,
                feature_cols=selected_features,
                target_col=target_col,
                model_type=model_type,
                base_hyperparameters=hyperparameters,
                n_trials=tune_trials,
                search_space=tune_search_space,
                optimize_metric=optimize_metric,
                n_splits=n_splits,
                gap=gap,
                task=inferred_task,
                trial_progress_cb=_trial_progress,
            )
            hyperparameters = tune_result["best_hyperparameters"]
            tuning_summary = {
                "enabled": True,
                "n_trials": len(tune_result["trials"]),
                "optimize_metric": tune_result["optimize_metric"],
                "best_score": tune_result["best_score"],
                "best_hyperparameters": tune_result["best_hyperparameters"],
                "trials": tune_result["trials"],
            }

        self.update_state(state="PROGRESS", meta={
            "progress": 70,
            "message": f"Starting final {n_splits}-fold walk-forward CV with {model_type.upper()}...",
            "step": "STEP 4/5 Final Walk-Forward CV",
        })
        result = train_walk_forward(
            df=df,
            feature_cols=selected_features,
            target_col=target_col,
            model_type=model_type,
            hyperparameters=hyperparameters,
            n_splits=n_splits,
            gap=gap,
            model_id=model_id,
            task=inferred_task,
            fold_progress_cb=_fold_progress,
        )

        # --- Update DB ---
        self.update_state(state="PROGRESS", meta={
            "progress": 92,
            "message": "Saving model artifacts to MinIO...",
            "step": "STEP 5/5 Saving Artifacts",
        })
        # Embed oos_start_index in cv_metrics so the backtest task can slice to OOS data
        cv_metrics_with_oos = {
            **result["cv_metrics"],
            "oos_start_index": result["oos_start_index"],
        }
        if result.get("explainability"):
            cv_metrics_with_oos["explainability"] = result["explainability"]
        if tuning_summary is not None:
            cv_metrics_with_oos["tuning"] = tuning_summary
        _update_model_state(
            model_id,
            status="completed",
            selected_features=selected_features,
            feature_importances=importances,
            hyperparameters=hyperparameters,
            cv_metrics=cv_metrics_with_oos,
            mlflow_run_id=result["mlflow_run_id"],
            s3_model_path=result["s3_model_path"],
        )

        return {
            "model_id": model_id,
            "selected_features": len(selected_features),
            "best_hyperparameters": hyperparameters,
            "mlflow_run_id": result["mlflow_run_id"],
            "cv_metrics_summary": result["cv_metrics"]["aggregate"],
        }

    except Exception as exc:
        _update_model_state(model_id, status="failed", error_message=str(exc))
        raise self.retry(exc=exc)
