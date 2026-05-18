"""Data Preparation endpoints: alignment, cleaning, missing value handling, normalization."""
import io
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.db_models import Dataset, FeaturePipeline, DataPreparation, StatusEnum
from app.schemas.schemas import DataPrepCreate, DataPrepRead

router = APIRouter()


@router.post("/prepare", response_model=DataPrepRead, status_code=status.HTTP_202_ACCEPTED)
async def prepare_data(payload: DataPrepCreate, db: AsyncSession = Depends(get_db)):
    """Create a data preparation job sourced from a completed indicator pipeline and dispatch Celery task."""
    pipeline = await db.get(FeaturePipeline, payload.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Indicator pipeline not found")
    if pipeline.status != "completed" or not pipeline.s3_processed_path:
        raise HTTPException(status_code=409, detail="Indicator pipeline must be completed before data preparation")

    dataset = await db.get(Dataset, pipeline.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found for indicator pipeline")

    # Production guardrail: all 4 steps are mandatory and must be enabled.
    alignment_config = payload.alignment_config or {}
    cleaning_config = payload.cleaning_config or {}
    missing_value_config = payload.missing_value_config or {}
    normalization_config = payload.normalization_config or {}
    if not bool(alignment_config.get("enabled")):
        raise HTTPException(status_code=422, detail="Timestamp Alignment must be enabled")
    if not bool(cleaning_config.get("enabled")):
        raise HTTPException(status_code=422, detail="Data Cleaning must be enabled")
    if not bool(missing_value_config.get("enabled")):
        raise HTTPException(status_code=422, detail="Missing Value Handling must be enabled")
    if not bool(normalization_config.get("enabled") or normalization_config.get("enable_scaling")):
        raise HTTPException(status_code=422, detail="Normalization must be enabled")

    prep = DataPreparation(
        dataset_id=pipeline.dataset_id,
        pipeline_id=pipeline.id,  # Stored for traceability — SET NULL if pipeline is deleted
        name=payload.name or f"{dataset.symbol}_{dataset.timeframe}_prepared",
        alignment_config={
            **alignment_config,
            "source": "feature_pipeline",
            "source_s3_path": pipeline.s3_processed_path,
        },
        cleaning_config=cleaning_config,
        missing_value_config=missing_value_config,
        normalization_config={
            **normalization_config,
            "enabled": True,
            "enable_scaling": True,
        },
        status=StatusEnum.pending,
    )
    db.add(prep)
    await db.flush()
    await db.refresh(prep)
    await db.commit()
    await db.refresh(prep)

    # Dispatch task
    from workers.tasks.data_prep_tasks import prepare_data_task
    task = prepare_data_task.apply_async(
        args=[str(prep.id)],
        queue="features",
    )
    prep.celery_task_id = task.id
    await db.flush()
    await db.commit()
    await db.refresh(prep)

    return prep


@router.get("/", response_model=list[DataPrepRead])
async def list_data_preps(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DataPreparation).order_by(DataPreparation.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{prep_id}", response_model=DataPrepRead)
async def get_data_prep(prep_id: UUID, db: AsyncSession = Depends(get_db)):
    prep = await db.get(DataPreparation, prep_id)
    if not prep:
        raise HTTPException(status_code=404, detail="Data preparation job not found")
    return prep


@router.delete("/{prep_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_data_prep(prep_id: UUID, db: AsyncSession = Depends(get_db)):
    prep = await db.get(DataPreparation, prep_id)
    if not prep:
        raise HTTPException(status_code=404, detail="Data preparation job not found")
    await db.delete(prep)
    await db.commit()


@router.get("/{prep_id}/preview")
async def preview_prepared_data(prep_id: UUID, rows: int = 200, db: AsyncSession = Depends(get_db)):
    """Return column schema + first N rows of the prepared parquet."""
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    prep = await db.get(DataPreparation, prep_id)
    if not prep:
        raise HTTPException(status_code=404, detail="Data preparation job not found")
    if prep.status != "completed" or not prep.s3_prepared_path:
        raise HTTPException(status_code=409, detail="Preparation has not completed yet")
    try:
        bucket, key = parse_s3_uri(prep.s3_prepared_path)
        raw = download_bytes(bucket, key)
        df = pl.read_parquet(io.BytesIO(raw))
        schema = [{"name": c, "type": str(df.schema[c])} for c in df.columns]
        rows_data = df.head(rows).to_dicts()
        rows_str = json.loads(json.dumps(rows_data, default=str))
        return {
            "row_count": len(df),
            "column_count": len(df.columns),
            "columns": schema,
            "rows": rows_str,
            "quality_before": prep.quality_before,
            "quality_after": prep.quality_after,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")


@router.get("/{prep_id}/download")
async def download_prepared_data(prep_id: UUID, db: AsyncSession = Depends(get_db)):
    """Download the prepared Parquet file."""
    from fastapi.responses import StreamingResponse
    import io as _io
    from app.core.storage import download_bytes, parse_s3_uri

    prep = await db.get(DataPreparation, prep_id)
    if not prep:
        raise HTTPException(status_code=404, detail="Data preparation job not found")
    if not prep.s3_prepared_path:
        raise HTTPException(status_code=409, detail="No prepared data available")

    try:
        bucket, key = parse_s3_uri(prep.s3_prepared_path)
        data = download_bytes(bucket, key)
        return StreamingResponse(
            _io.BytesIO(data),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={prep.name}.parquet"}
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Download failed: {exc}")
