"""AI Model endpoints: trigger training, read results."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.db_models import AIModel, FeaturePipeline, FeatureSet, StatusEnum
from app.schemas.schemas import ModelTrainRequest, ModelRead

router = APIRouter()


@router.post("/train", response_model=ModelRead, status_code=status.HTTP_202_ACCEPTED)
async def train_model(payload: ModelTrainRequest, db: AsyncSession = Depends(get_db)):
    pipeline = await db.get(FeaturePipeline, payload.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.status != StatusEnum.completed:
        raise HTTPException(status_code=409, detail="Pipeline has not completed yet")

    if payload.feature_set_id:
        fs = await db.get(FeatureSet, payload.feature_set_id)
        if not fs:
            raise HTTPException(status_code=404, detail="Feature set not found")
        if fs.pipeline_id != payload.pipeline_id:
            raise HTTPException(status_code=400, detail="Feature set does not belong to the specified pipeline")

    model = AIModel(
        pipeline_id=payload.pipeline_id,
        feature_set_id=payload.feature_set_id,
        target_column=payload.target_column,
        model_type=payload.model_type,
        hyperparameters=payload.hyperparameters,
        status=StatusEnum.pending,
    )
    db.add(model)
    await db.flush()
    await db.refresh(model)

    from workers.tasks.training_tasks import train_model_task
    task = train_model_task.apply_async(
        args=[
            str(model.id),
            payload.n_splits,
            payload.gap,
            payload.auto_tune,
            payload.tune_trials,
            payload.tune_search_space,
            payload.optimize_metric,
        ],
        queue="training",
    )
    model.celery_task_id = task.id
    await db.flush()
    await db.commit()
    await db.refresh(model)
    return model


@router.get("/", response_model=list[ModelRead])
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AIModel).order_by(AIModel.created_at.desc()))
    return result.scalars().all()


@router.get("/{model_id}", response_model=ModelRead)
async def get_model(model_id: UUID, db: AsyncSession = Depends(get_db)):
    model = await db.get(AIModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(model_id: UUID, db: AsyncSession = Depends(get_db)):
    model = await db.get(AIModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    await db.delete(model)
    await db.commit()
