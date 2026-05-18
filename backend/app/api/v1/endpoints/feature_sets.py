"""Feature Set endpoints — Feature Selection page.

Input: LabeledDataset (completed) → reads s3_labeled_path for analysis.
Output: FeatureSet (metadata record — selected_columns + target_column).
No new S3 file is created. FeatureSet references LabeledDataset via labeled_dataset_id.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.db_models import FeatureSet, LabeledDataset, StatusEnum
from app.schemas.schemas import (
    FeatureSetGenerateRequest,
    FeatureSetRead,
    FeatureSetSuggestRequest,
    FeatureSetSuggestResponse,
)

router = APIRouter()


def _load_labeled_df(s3_uri: str):
    import io
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    bucket, key = parse_s3_uri(s3_uri)
    raw = download_bytes(bucket, key)
    return pl.read_parquet(io.BytesIO(raw)).to_pandas()


def _analyze_df(df, target_column, task, vif_threshold, corr_threshold, mi_top_k, tree_top_k):
    from workers.engines.selector import analyze_features
    feature_cols = [c for c in df.columns if c != target_column and not c.startswith("y_") and c != "timestamp"]

    if not feature_cols:
        raise ValueError("No candidate feature columns found")
    return analyze_features(
        df=df, target_col=target_column, feature_cols=feature_cols, task=task,
        vif_threshold=vif_threshold, corr_threshold=corr_threshold,
        mi_top_k=mi_top_k, tree_top_k=tree_top_k,
    )


def _suggest_df(df, target_column, task, vif_threshold, corr_threshold, mi_top_k, tree_top_k):
    from workers.engines.selector import select_features
    feature_cols = [c for c in df.columns if c != target_column and not c.startswith("y_") and c != "timestamp"]

    if not feature_cols:
        raise ValueError("No candidate feature columns found")
    return select_features(
        df=df, target_col=target_column, feature_cols=feature_cols, task=task,
        vif_threshold=vif_threshold, corr_threshold=corr_threshold,
        mi_top_k=mi_top_k, tree_top_k=tree_top_k,
    )


async def _get_labeled_dataset_or_raise(db: AsyncSession, labeled_dataset_id: UUID) -> LabeledDataset:
    ld = await db.get(LabeledDataset, labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    if ld.status != StatusEnum.completed or not ld.s3_labeled_path:
        raise HTTPException(status_code=409, detail="Labeled dataset has not completed yet")
    return ld



@router.post("/suggest", response_model=FeatureSetSuggestResponse)
async def suggest_feature_columns(payload: FeatureSetSuggestRequest, db: AsyncSession = Depends(get_db)):
    """Suggest important feature columns from a completed LabeledDataset."""
    ld = await _get_labeled_dataset_or_raise(db, payload.labeled_dataset_id)
    try:
        df = await run_in_threadpool(_load_labeled_df, ld.s3_labeled_path)
        if payload.target_column not in df.columns:
            raise HTTPException(status_code=400, detail=f"Target column not found: {payload.target_column}")
        selected, importances = await run_in_threadpool(
            _suggest_df, df, payload.target_column, payload.task,
            payload.vif_threshold, payload.corr_threshold, payload.mi_top_k, payload.tree_top_k,
        )
        return FeatureSetSuggestResponse(selected_columns=selected, feature_importances=importances)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Auto feature selection failed: {exc}")


@router.post("/", response_model=FeatureSetRead, status_code=status.HTTP_201_CREATED)
async def create_feature_set(payload: FeatureSetGenerateRequest, db: AsyncSession = Depends(get_db)):
    ld = await db.get(LabeledDataset, payload.labeled_dataset_id)
    if not ld:
        raise HTTPException(status_code=404, detail="Labeled dataset not found")
    if ld.status != StatusEnum.completed:
        raise HTTPException(status_code=409, detail="Labeled dataset has not completed yet")

    analysis_config = {
        "task": payload.task,
        "mi_top_k": payload.mi_top_k,
        "tree_top_k": payload.tree_top_k,
        "vif_threshold": payload.vif_threshold,
        "corr_threshold": payload.corr_threshold,
    }

    fs = FeatureSet(
        labeled_dataset_id=payload.labeled_dataset_id,
        name=payload.name or f"Feature Set — {ld.name or str(ld.id)[:8]}",
        selected_columns=[],
        target_column=payload.target_column,
        analysis_config=analysis_config,
        status=StatusEnum.pending,
    )
    db.add(fs)
    await db.flush()
    await db.refresh(fs)

    from workers.tasks.feature_tasks import generate_feature_set_task
    task = generate_feature_set_task.apply_async(
        args=[str(fs.id)],
        queue="features",
    )
    fs.celery_task_id = task.id
    await db.commit()
    await db.refresh(fs)
    return fs


@router.get("/", response_model=list[FeatureSetRead])
async def list_feature_sets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FeatureSet).order_by(FeatureSet.created_at.desc()))
    return result.scalars().all()


@router.get("/{feature_set_id}", response_model=FeatureSetRead)
async def get_feature_set(feature_set_id: UUID, db: AsyncSession = Depends(get_db)):
    fs = await db.get(FeatureSet, feature_set_id)
    if not fs:
        raise HTTPException(status_code=404, detail="Feature set not found")
    return fs


@router.get("/{feature_set_id}/preview")
async def preview_feature_set(feature_set_id: UUID, rows: int = 200, db: AsyncSession = Depends(get_db)):
    """Return only selected columns + target from the LabeledDataset's parquet."""
    import io
    import json
    import polars as pl
    from app.core.storage import download_bytes, parse_s3_uri

    fs = await db.get(FeatureSet, feature_set_id)
    if not fs:
        raise HTTPException(status_code=404, detail="Feature set not found")
    if not fs.labeled_dataset_id:
        raise HTTPException(status_code=409, detail="Feature set has no linked labeled dataset")

    ld = await db.get(LabeledDataset, fs.labeled_dataset_id)
    if not ld or not ld.s3_labeled_path:
        raise HTTPException(status_code=409, detail="Linked labeled dataset has no S3 file")

    try:
        bucket, key = parse_s3_uri(ld.s3_labeled_path)
        raw = download_bytes(bucket, key)
        df = pl.read_parquet(io.BytesIO(raw))

        keep = [c for c in fs.selected_columns if c in df.columns]
        if fs.target_column in df.columns and fs.target_column not in keep:
            keep.append(fs.target_column)
        df = df.select(keep)

        schema = [{"name": c, "type": str(df.schema[c])} for c in df.columns]
        rows_data = df.head(rows).to_dicts()
        rows_str = json.loads(json.dumps(rows_data, default=str))
        return {"row_count": len(df), "column_count": len(df.columns), "columns": schema, "rows": rows_str}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")


@router.delete("/{feature_set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature_set(feature_set_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete this FeatureSet. LabeledDataset is NOT affected."""
    fs = await db.get(FeatureSet, feature_set_id)
    if not fs:
        raise HTTPException(status_code=404, detail="Feature set not found")
    await db.delete(fs)
    await db.commit()
