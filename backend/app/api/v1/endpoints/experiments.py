"""Experiments endpoint: aggregate view of all backtests + equity curve comparison."""
import json
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.storage import download_bytes, parse_s3_uri

router = APIRouter()


def _list_experiments_db() -> list[dict]:
    from sqlalchemy import create_engine as _ce, text
    from app.core.config import settings

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT
                    bt.id            AS experiment_id,
                    bt.status        AS status,
                    bt.metrics       AS metrics,
                    bt.s3_equity_curve_path AS equity_path,
                    bt.created_at    AS created_at,
                    m.id             AS model_id,
                    m.model_type     AS model_type,
                    m.target_column  AS target_column,
                    m.cv_metrics     AS cv_metrics,
                    fp.id            AS pipeline_id,
                    fp.name          AS pipeline_name,
                    d.symbol         AS symbol,
                    d.timeframe      AS timeframe,
                    d.date_from      AS date_from,
                    d.date_to        AS date_to
                FROM backtests bt
                JOIN ai_models m  ON m.id  = bt.model_id
                JOIN feature_pipelines fp ON fp.id = m.pipeline_id
                JOIN datasets d   ON d.id  = fp.dataset_id
                WHERE bt.status = 'completed'
                ORDER BY bt.created_at DESC
            """),
        ).fetchall()
    engine.dispose()
    return [dict(r._mapping) for r in rows]


def _parse_json_field(val):
    if val is None:
        return {}
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return {}


@router.get("/")
async def list_experiments():
    """Return all completed backtests with joined model/dataset info."""
    try:
        rows = _list_experiments_db()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    results = []
    for r in rows:
        metrics = _parse_json_field(r.get("metrics")) or {}
        cv = _parse_json_field(r.get("cv_metrics")) or {}
        results.append({
            "experiment_id": str(r["experiment_id"]),
            "symbol": r["symbol"],
            "timeframe": r["timeframe"],
            "date_from": str(r["date_from"]) if r["date_from"] else None,
            "date_to": str(r["date_to"]) if r["date_to"] else None,
            "model_type": r["model_type"],
            "target_column": r["target_column"],
            "pipeline_name": r["pipeline_name"],
            "status": r["status"],
            "created_at": str(r["created_at"]),
            "sharpe_ratio": metrics.get("sharpe_ratio"),
            "total_return": metrics.get("total_return"),
            "max_drawdown": metrics.get("max_drawdown"),
            "win_rate": metrics.get("win_rate"),
            "cagr": metrics.get("cagr"),
            "profit_factor": metrics.get("profit_factor"),
            "sortino_ratio": metrics.get("sortino_ratio"),
            "calmar_ratio": metrics.get("calmar_ratio"),
            "n_trades": metrics.get("n_trades"),
            "cv_sharpe": cv.get("sharpe_ratio") or cv.get("mean_sharpe"),
            "equity_path": r.get("equity_path"),
        })

    return results


class CompareRequest(BaseModel):
    experiment_ids: list[str]


@router.post("/compare")
async def compare_experiments(payload: CompareRequest):
    """
    Return overlapping equity curves for the requested experiment IDs.
    Each curve is normalised to start at 100 for easy visual comparison.
    """
    if len(payload.experiment_ids) < 2:
        raise HTTPException(status_code=422, detail="Provide at least 2 experiment IDs to compare")
    if len(payload.experiment_ids) > 10:
        raise HTTPException(status_code=422, detail="Maximum 10 experiments can be compared at once")

    # Fetch equity curve paths from DB
    from sqlalchemy import create_engine as _ce, text
    from app.core.config import settings

    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = _ce(sync_url)
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT bt.id, bt.s3_equity_curve_path, bt.metrics,
                       m.model_type, m.target_column, d.symbol
                FROM backtests bt
                JOIN ai_models m ON m.id = bt.model_id
                JOIN feature_pipelines fp ON fp.id = m.pipeline_id
                JOIN datasets d ON d.id = fp.dataset_id
                WHERE bt.id::text = ANY(:ids) AND bt.status = 'completed'
            """),
            {"ids": payload.experiment_ids},
        ).fetchall()
    engine.dispose()

    curves = []
    for row in rows:
        exp_id = str(row[0])
        equity_path: str | None = row[1]
        metrics = _parse_json_field(row[2])

        equity_curve = []
        if equity_path:
            try:
                bucket, key = parse_s3_uri(equity_path)
                raw = download_bytes(bucket, key)
                equity_curve = json.loads(raw)
            except Exception:
                equity_curve = []

        # Normalise to 100 base for visual comparison
        if equity_curve:
            start_val = equity_curve[0]["value"] if equity_curve[0]["value"] else 1
            equity_curve = [
                {"time": p["time"], "value": round(p["value"] / start_val * 100, 4)}
                for p in equity_curve
            ]

        curves.append({
            "experiment_id": exp_id,
            "label": f"{row[5]} | {row[3]} | {row[4]}",
            "symbol": row[5],
            "model_type": row[3],
            "target_column": row[4],
            "sharpe_ratio": metrics.get("sharpe_ratio"),
            "total_return": metrics.get("total_return"),
            "equity_curve": equity_curve,
        })

    return {"curves": curves}
