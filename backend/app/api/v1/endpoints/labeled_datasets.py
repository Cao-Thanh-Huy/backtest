"""Labeled Dataset endpoints — Labeling System page.

Flow: DataPreparation (completed) → POST / → Celery task → LabeledDataset (completed)
Each LabeledDataset has its own S3 Parquet file. Deleting a LabeledDataset does NOT
touch the parent DataPreparation.
"""
import io
import json
from uuid import UUID

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.db_models import LabeledDataset, DataPreparation, StatusEnum
from app.schemas.schemas import LabeledDatasetCreate, LabeledDatasetRead

router = APIRouter()


async def _reconcile_status(db: AsyncSession, ld: LabeledDataset) -> LabeledDataset:
    """Sync status from Celery if still pending/running."""
    if ld.status not in {StatusEnum.pending, StatusEnum.running}:
        return ld
    if not ld.celery_task_id:
        return ld
    from workers.celery_app import celery_app
    result: AsyncResult = celery_app.AsyncResult(ld.celery_task_id)
    if result.state in {"FAILURE", "REVOKED"}:
        ld.status = StatusEnum.failed
        ld.error_message = str(result.result)
        await db.commit()
        await db.refresh(ld)
    return ld


@router.post("/", response_model=LabeledDatasetRead, status_code=status.HTTP_202_ACCEPTED)
async def create_labeled_dataset(payload: LabeledDatasetCreate, db: AsyncSession = Depends(get_db)):
    """Create a LabeledDataset from a completed DataPreparation and dispatch Celery task."""
    prep = await db.get(DataPreparation, payload.data_prep_id)
    if not prep:
        raise HTTPException(status_code=404, detail="Data preparation not found")
    if prep.status != StatusEnum.completed or not prep.s3_prepared_path:
        raise HTTPException(status_code=409, detail="Data preparation must be completed before labeling")
    if not payload.targets:
        raise HTTPException(status_code=422, detail="At least one target config is required")

    ld = LabeledDataset(
        data_prep_id=payload.data_prep_id,
        name=payload.name or f"labeled_{prep.id}",
        targets_config=[t.model_dump() for t in payload.targets],
        status=StatusEnum.pending,
    )
    db.add(ld)
    await db.flush()
    await db.refresh(ld)
    await db.commit()
    await db.refresh(ld)

    from workers.tasks.labeled_dataset_tasks import generate_labeled_dataset_task
    task = generate_labeled_dataset_task.apply_async(
        args=[str(ld.id)],
        queue="features",
    )
    ld.celery_task_id = task.id
    await db.flush()
    await db.commit()
    await db.refresh(ld)

    return ld


@router.get("/", response_model=list[LabeledDatasetRead])
async def list_labeled_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LabeledDataset).order_by(LabeledDataset.created_at.desc())
    )
    items = result.scalars().all()
    for item in items:
        await _reconcile_status(db, item)
    return items


@router.get("/{labeled_dataset_id}", response_model=LabeledDatasetRead)
async def get_labeled_dataset(labeled_dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    await _reconcile_status(db, ld)
    return ld


@router.delete("/{labeled_dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_labeled_dataset(labeled_dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete this LabeledDataset and its downstream FeatureSets. DataPreparation is NOT affected."""
    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    await db.delete(ld)
    await db.commit()


@router.get("/{labeled_dataset_id}/preview")
async def preview_labeled_dataset(
    labeled_dataset_id: UUID,
    rows: int = 200,
    db: AsyncSession = Depends(get_db),
):
    """Return column schema + first N rows of the labeled parquet."""
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    if ld.status != StatusEnum.completed or not ld.s3_labeled_path:
        raise HTTPException(status_code=409, detail="Labeled dataset has not completed yet")
    try:
        bucket, key = parse_s3_uri(ld.s3_labeled_path)
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
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")


@router.get("/{labeled_dataset_id}/target-stats")
async def get_target_stats(labeled_dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return distribution statistics for each target column (y_*)."""
    import math
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    if not ld.s3_labeled_path:
        raise HTTPException(status_code=409, detail="Labeled dataset has no S3 file")

    try:
        bucket, key = parse_s3_uri(ld.s3_labeled_path)
        parquet_bytes = download_bytes(bucket, key)
        df = pl.read_parquet(io.BytesIO(parquet_bytes))

        target_cols = [c for c in df.columns if c.startswith("y_")]
        total_rows = len(df)
        stats = {}

        cfg_list = ld.targets_config or []
        for col in target_cols:
            series = df[col]
            null_count = series.null_count()
            valid_series = series.drop_nulls()
            unique_vals = valid_series.unique().to_list()
            is_class = len(unique_vals) <= 5

            cfg_entry = next((t for t in cfg_list if t.get("name") == col), {})
            method = str(cfg_entry.get("method", "n_bar"))
            params = cfg_entry.get("params", {})

            if is_class:
                counts = valid_series.value_counts().to_dicts()
                label_counts = {str(r[col]): r["count"] for r in counts}
                stats[col] = {
                    "name": col,
                    "type": "classification",
                    "method": method,
                    "params": params,
                    "nullCount": null_count,
                    "totalRows": total_rows,
                    "labelCounts": label_counts,
                }
            else:
                std_val = valid_series.std()
                stats[col] = {
                    "name": col,
                    "type": "regression",
                    "method": method,
                    "params": params,
                    "nullCount": null_count,
                    "totalRows": total_rows,
                    "min": valid_series.min(),
                    "max": valid_series.max(),
                    "mean": valid_series.mean(),
                    "std": std_val if std_val is not None and not math.isnan(std_val) else 0,
                }

        return {"total_rows": total_rows, "stats": list(stats.values())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{labeled_dataset_id}/download")
async def download_labeled_dataset(labeled_dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return a presigned URL for downloading the labeled parquet."""
    from app.core.storage import get_presigned_url, parse_s3_uri

    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    if not ld.s3_labeled_path:
        raise HTTPException(status_code=409, detail="Labeled dataset has no S3 file")
    try:
        bucket, key = parse_s3_uri(ld.s3_labeled_path)
        url = get_presigned_url(bucket, key)
        return {"url": url}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Download failed: {exc}")
