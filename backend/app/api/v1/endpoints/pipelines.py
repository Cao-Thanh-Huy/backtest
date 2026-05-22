"""Pipeline endpoints: Feature Factory — generate indicator + lag features via Celery.

NOTE: Target generation is handled by /labeled-datasets/ endpoints (Labeling System page).
"""
from typing import Any
from uuid import UUID

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.db_models import Dataset, FeaturePipeline, StatusEnum
from app.schemas.schemas import (
    IndicatorConfig,
    PipelineCreate,
    PipelinePreflightCreate,
    PipelinePreflightRead,
    PipelineRead,
)
from workers.celery_app import celery_app

router = APIRouter()

_INDICATOR_OUTPUT_WIDTHS: dict[str, int] = {
    "macd": 5,
    "bbands": 4,
    "stoch": 2,
}


def _parse_row_count(value: str | None) -> int | None:
    if not value:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return int(digits) if digits else None


def _combo_count_from_sweep(sweep: dict[str, dict[str, Any]]) -> int:
    total = 1
    for cfg in sweep.values():
        lo = cfg.get("min", 1)
        hi = cfg.get("max", lo)
        step = cfg.get("step", 1) or 1
        try:
            lo_num = float(lo)
            hi_num = float(hi)
            step_num = abs(float(step)) or 1.0
        except (TypeError, ValueError):
            lo_num = 1.0
            hi_num = 1.0
            step_num = 1.0
        if hi_num < lo_num:
            lo_num, hi_num = hi_num, lo_num
        count = int((hi_num - lo_num) / step_num) + 1
        total *= max(1, min(count, 50))
    return total


def _indicator_column_estimate(indicator: IndicatorConfig | dict[str, Any]) -> int:
    raw = indicator if isinstance(indicator, dict) else indicator.model_dump()
    name = str(raw.get("name", "")).lower()
    params = raw.get("params", {}) or {}
    sweep = raw.get("params_sweep", {}) or {}
    combo_count = _combo_count_from_sweep(sweep) if sweep else 1
    
    width = _INDICATOR_OUTPUT_WIDTHS.get(name, 1)
    if name == "rsi":
        width = 1
        if params.get("include_threshold", False):
            width += 2
        if params.get("include_trend", False):
            width += 1
        if params.get("include_raw_extras", False):
            width += 5
        if params.get("include_multi_zone", False):
            width += 3
        if params.get("include_momentum_slope", False):
            width += 6
        if params.get("include_divergence", False):
            width += 4
        if params.get("include_trend_structure", False):
            width += 5
        if params.get("include_statistical", False):
            width += 4
        if params.get("include_persistence", False):
            width += 4
        if params.get("include_crossovers", False):
            width += 3
            
    return combo_count * width


def build_pipeline_preflight_report(
    indicators: list[IndicatorConfig] | list[dict[str, Any]],
    lags: list[int],
    row_count: int | None,
) -> dict[str, int | None]:
    normalized_lags = sorted({lag for lag in lags if lag > 0})
    base_feature_columns = sum(_indicator_column_estimate(ind) for ind in indicators)
    total_feature_columns = base_feature_columns * (1 + len(normalized_lags))
    estimated_bytes = None
    if row_count is not None and total_feature_columns > 0:
        estimated_bytes = int(
            row_count
            * total_feature_columns
            * 8
            * settings.feature_pipeline_preflight_memory_multiplier
        )
    return {
        "row_count": row_count,
        "lag_count": len(normalized_lags),
        "base_feature_columns": base_feature_columns,
        "total_feature_columns": total_feature_columns,
        "estimated_bytes": estimated_bytes,
    }


def _format_bytes(num_bytes: int | None) -> str:
    if num_bytes is None:
        return "unknown"
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}TB"


def validate_pipeline_preflight(
    indicators: list[IndicatorConfig],
    lags: list[int],
    row_count: int | None,
) -> dict[str, int | None]:
    report = build_pipeline_preflight_report(indicators, lags, row_count)
    column_limit = settings.feature_pipeline_preflight_max_columns
    byte_limit = settings.feature_pipeline_preflight_max_estimated_bytes
    reasons = _build_preflight_reasons(report, column_limit, byte_limit)

    if reasons:
        raise HTTPException(
            status_code=422,
            detail=(
                "Pipeline request rejected by server-side preflight: "
                + "; ".join(reasons)
                + ". Reduce enabled generators, narrow params_sweep ranges, or shorten lags before retrying."
            ),
        )
    return report


def _build_preflight_reasons(
    report: dict[str, int | None],
    column_limit: int,
    byte_limit: int,
) -> list[str]:
    reasons: list[str] = []
    over_columns = report["total_feature_columns"] > column_limit
    over_bytes = report["estimated_bytes"] is not None and report["estimated_bytes"] > byte_limit

    if over_columns:
        reasons.append(
            f"estimated {report['total_feature_columns']:,} generated columns exceeds hard limit {column_limit:,}"
        )
    if over_bytes:
        reasons.append(
            f"estimated working set {_format_bytes(report['estimated_bytes'])} exceeds memory budget {_format_bytes(byte_limit)}"
        )
    return reasons


@router.post("/preflight", response_model=PipelinePreflightRead)
async def pipeline_preflight(payload: PipelinePreflightCreate, db: AsyncSession = Depends(get_db)):
    """Preview server-side pipeline cost guard without enqueuing a Celery job."""
    dataset = await db.get(Dataset, payload.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    report = build_pipeline_preflight_report(payload.indicators, payload.lags, _parse_row_count(dataset.row_count))
    column_limit = settings.feature_pipeline_preflight_max_columns
    byte_limit = settings.feature_pipeline_preflight_max_estimated_bytes
    reasons = _build_preflight_reasons(report, column_limit, byte_limit)

    return PipelinePreflightRead(
        **report,
        column_limit=column_limit,
        estimated_bytes_limit=byte_limit,
        over_columns=report["total_feature_columns"] > column_limit,
        over_bytes=report["estimated_bytes"] is not None and report["estimated_bytes"] > byte_limit,
        accepted=len(reasons) == 0,
        message=None if not reasons else "; ".join(reasons),
    )


async def _reconcile_pipeline_status(db: AsyncSession, pipeline: FeaturePipeline) -> FeaturePipeline:
    # Initialize dynamic attributes
    pipeline.progress = None
    pipeline.progress_message = None
    pipeline.celery_ram_mb = None

    if pipeline.status == StatusEnum.completed:
        pipeline.progress = 100
        pipeline.progress_message = "Completed"
        return pipeline
    elif pipeline.status == StatusEnum.failed:
        pipeline.progress = None
        pipeline.progress_message = f"Failed: {pipeline.error_message or 'Unknown error'}"
        return pipeline

    if not pipeline.celery_task_id:
        return pipeline

    result: AsyncResult = celery_app.AsyncResult(pipeline.celery_task_id)
    state = result.state

    if state in {"FAILURE", "REVOKED"}:
        pipeline.status = StatusEnum.failed
        pipeline.error_message = str(result.result)
        await db.commit()
        await db.refresh(pipeline)
        pipeline.progress = None
        pipeline.progress_message = f"Failed: {pipeline.error_message}"
    elif state == "PROGRESS" and result.info:
        pipeline.progress = result.info.get("progress")
        pipeline.progress_message = result.info.get("message")
        pipeline.celery_ram_mb = result.info.get("celery_ram_mb")
    elif state == "PENDING":
        pipeline.progress = 0
        pipeline.progress_message = "Waiting in queue..."
    elif state == "SUCCESS":
        pipeline.progress = 100
        pipeline.progress_message = "Completed"

    return pipeline


@router.post("/generate", response_model=PipelineRead, status_code=status.HTTP_202_ACCEPTED)
async def generate_pipeline(payload: PipelineCreate, db: AsyncSession = Depends(get_db)):
    """Create a pipeline record and dispatch the Celery feature-generation task."""
    # Validate dataset exists
    dataset = await db.get(Dataset, payload.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    validate_pipeline_preflight(payload.indicators, payload.lags, _parse_row_count(dataset.row_count))

    pipeline = FeaturePipeline(
        dataset_id=payload.dataset_id,
        name=payload.name or f"{dataset.symbol}_{dataset.timeframe}_pipeline",
        indicators_config=[i.model_dump() for i in payload.indicators],
        lags=payload.lags,
        status=StatusEnum.pending,
    )
    db.add(pipeline)
    await db.flush()
    await db.refresh(pipeline)
    await db.commit()
    await db.refresh(pipeline)

    # Dispatch task (import here to avoid circular at module load)
    from workers.tasks.pipeline_tasks import generate_pipeline_task
    task = generate_pipeline_task.apply_async(
        args=[str(pipeline.id)],
        queue="features",
    )
    pipeline.celery_task_id = task.id
    await db.flush()
    await db.commit()
    await db.refresh(pipeline)

    return pipeline


@router.get("/", response_model=list[PipelineRead])
async def list_pipelines(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FeaturePipeline).order_by(FeaturePipeline.created_at.desc()))
    pipelines = result.scalars().all()
    for pipeline in pipelines:
        await _reconcile_pipeline_status(db, pipeline)
    return pipelines


@router.get("/{pipeline_id}", response_model=PipelineRead)
async def get_pipeline(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    pipeline = await db.get(FeaturePipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    await _reconcile_pipeline_status(db, pipeline)
    return pipeline


@router.delete("/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pipeline(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    pipeline = await db.get(FeaturePipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    await db.delete(pipeline)
    await db.commit()


@router.get("/{pipeline_id}/preview")
async def preview_pipeline(pipeline_id: UUID, rows: int = 200, db: AsyncSession = Depends(get_db)):
    """Return column schema + first N rows of the processed feature parquet."""
    import io
    import json
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    pipeline = await db.get(FeaturePipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.status != "completed" or not pipeline.s3_processed_path:
        raise HTTPException(status_code=409, detail="Pipeline has not completed yet")
    try:
        bucket, key = parse_s3_uri(pipeline.s3_processed_path)
        raw = download_bytes(bucket, key)
        df = pl.read_parquet(io.BytesIO(raw))
        schema = [{"name": c, "type": str(df.schema[c])} for c in df.columns]
        rows_data = df.head(rows).to_dicts()
        rows_str = json.loads(json.dumps(rows_data, default=str))
        return {"row_count": len(df), "column_count": len(df.columns), "columns": schema, "rows": rows_str}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")


@router.get("/{pipeline_id}/download")
async def download_pipeline(pipeline_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return a presigned URL for downloading the processed feature parquet."""
    from app.core.storage import get_presigned_url, parse_s3_uri

    pipeline = await db.get(FeaturePipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.status != "completed" or not pipeline.s3_processed_path:
        raise HTTPException(status_code=409, detail="Pipeline has not completed yet")
    try:
        bucket, key = parse_s3_uri(pipeline.s3_processed_path)
        url = get_presigned_url(bucket, key)
        return {"url": url}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Download failed: {exc}")
