"""Celery backtest task: Engine E (VectorBT)."""
import io
import json
import pickle

from workers.celery_app import celery_app
from app.core.storage import download_bytes, upload_file, parse_s3_uri
from app.core.config import settings


def _get_backtest_row(backtest_id: str):
    from sqlalchemy import create_engine as _ce, text

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT bt.strategy_config,
                       m.s3_model_path, m.selected_features, m.target_column,
                       fp.s3_processed_path, m.cv_metrics
                FROM backtests bt
                JOIN ai_models m ON m.id = bt.model_id
                JOIN feature_pipelines fp ON fp.id = m.pipeline_id
                WHERE bt.id = :bid
            """),
            {"bid": backtest_id},
        ).fetchone()
    engine.dispose()
    return row


def _update_backtest_state(backtest_id: str, **kwargs):
    from sqlalchemy import create_engine as _ce, text

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    set_clauses = ", ".join(f"{k} = :{k}" for k in kwargs)
    with engine.begin() as conn:
        params = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in kwargs.items()
        }
        params["bid"] = backtest_id
        conn.execute(
            text(f"UPDATE backtests SET {set_clauses} WHERE id = :bid"),
            params,
        )
    engine.dispose()


@celery_app.task(
    bind=True,
    name="workers.tasks.backtest_tasks.run_backtest_task",
    max_retries=1,
    default_retry_delay=30,
)
def run_backtest_task(self, backtest_id: str):
    """
    1. Load processed data + trained model from MinIO
    2. Generate predictions
    3. Engine E: VectorBT simulation
    4. Save equity curve to MinIO, update DB
    """
    try:
        import numpy as np
        import pandas as pd
        import polars as pl

        self.update_state(state="PROGRESS", meta={"progress": 5, "message": "Loading backtest config..."})
        row = _get_backtest_row(backtest_id)
        if row is None:
            raise ValueError(f"Backtest {backtest_id} not found")

        strategy_config = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        s3_model_path: str = row[1]
        selected_features = row[2] if isinstance(row[2], list) else json.loads(row[2])
        target_col: str = row[3]
        s3_processed: str = row[4]
        cv_metrics = row[5] if isinstance(row[5], dict) else json.loads(row[5]) if row[5] else {}
        oos_start_index: int = int(cv_metrics.get("oos_start_index", 0))

        _update_backtest_state(backtest_id, status="running")

        # --- Load model ---
        self.update_state(state="PROGRESS", meta={"progress": 20, "message": "Loading trained model..."})
        bucket, key = parse_s3_uri(s3_model_path)
        model_bytes = download_bytes(bucket, key)
        model = pickle.loads(model_bytes)

        # --- Load processed data ---
        self.update_state(state="PROGRESS", meta={"progress": 35, "message": "Loading processed data..."})
        bucket2, key2 = parse_s3_uri(s3_processed)
        raw_bytes = download_bytes(bucket2, key2)
        df = pl.read_parquet(io.BytesIO(raw_bytes)).to_pandas()

        # Set datetime index if available
        date_col = next((c for c in df.columns if c.lower() in ("date", "datetime", "timestamp", "time")), None)
        if date_col:
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.set_index(date_col)

        # Slice to OOS region only — avoids predicting on data the model was trained on.
        # oos_start_index is the row index of the first bar in the last CV test fold.
        # Backtest on data the model has never seen → realistic out-of-sample metrics.
        if oos_start_index > 0 and oos_start_index < len(df):
            df = df.iloc[oos_start_index:].copy()

        # Ensure selected features exist
        features_present = [f for f in selected_features if f in df.columns]
        X = df[features_present].fillna(0).values

        # --- Generate predictions ---
        self.update_state(state="PROGRESS", meta={"progress": 55, "message": "Generating predictions..."})
        predictions = model.predict(X)
        probabilities = None
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(X)
            probabilities = proba.max(axis=1)

        # --- VectorBT backtest ---
        self.update_state(state="PROGRESS", meta={"progress": 70, "message": "Running VectorBT simulation..."})
        from workers.engines.backtester import run_backtest
        result = run_backtest(df, predictions, probabilities, strategy_config)

        # --- Save equity curve to MinIO ---
        self.update_state(state="PROGRESS", meta={"progress": 90, "message": "Saving results..."})
        equity_bytes = json.dumps(result["equity_curve"]).encode()
        s3_equity_path = upload_file(
            settings.minio_bucket_processed,
            f"backtests/{backtest_id}/equity_curve.json",
            equity_bytes,
            "application/json",
        )

        signals_bytes = json.dumps(result["signals"]).encode()
        s3_signals_path = upload_file(
            settings.minio_bucket_processed,
            f"backtests/{backtest_id}/signals.json",
            signals_bytes,
            "application/json",
        )

        _update_backtest_state(
            backtest_id,
            status="completed",
            metrics=result["metrics"],
            s3_equity_curve_path=s3_equity_path,
            s3_signals_path=s3_signals_path,
        )

        return {"backtest_id": backtest_id, "metrics": result["metrics"]}

    except Exception as exc:
        _update_backtest_state(backtest_id, status="failed", error_message=str(exc))
        raise self.retry(exc=exc)
