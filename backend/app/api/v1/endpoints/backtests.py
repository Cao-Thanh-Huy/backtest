"""Backtest endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.db_models import AIModel, Backtest, StatusEnum
from app.schemas.schemas import BacktestCreate, BacktestRead

router = APIRouter()


@router.post("/run", response_model=BacktestRead, status_code=status.HTTP_202_ACCEPTED)
async def run_backtest(payload: BacktestCreate, db: AsyncSession = Depends(get_db)):
    model = await db.get(AIModel, payload.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.status != StatusEnum.completed:
        raise HTTPException(status_code=409, detail="Model has not completed training yet")

    bt = Backtest(
        model_id=payload.model_id,
        strategy_config=payload.model_dump(mode="json"),
        status=StatusEnum.pending,
    )
    db.add(bt)
    await db.flush()
    await db.refresh(bt)

    from workers.tasks.backtest_tasks import run_backtest_task
    task = run_backtest_task.apply_async(
        args=[str(bt.id)],
        queue="backtest",
    )
    bt.celery_task_id = task.id
    await db.flush()
    await db.commit()
    await db.refresh(bt)
    return bt


@router.get("/", response_model=list[BacktestRead])
async def list_backtests(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Backtest).order_by(Backtest.created_at.desc()))
    return result.scalars().all()


@router.get("/{backtest_id}", response_model=BacktestRead)
async def get_backtest(backtest_id: UUID, db: AsyncSession = Depends(get_db)):
    bt = await db.get(Backtest, backtest_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return bt


@router.delete("/{backtest_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backtest(backtest_id: UUID, db: AsyncSession = Depends(get_db)):
    bt = await db.get(Backtest, backtest_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Backtest not found")
    await db.delete(bt)
    await db.commit()


@router.get("/{backtest_id}/equity-curve")
async def get_equity_curve(backtest_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return equity curve array stored in MinIO as JSON."""
    import orjson
    from app.core.storage import download_bytes, parse_s3_uri

    bt = await db.get(Backtest, backtest_id)
    if not bt or not bt.s3_equity_curve_path:
        raise HTTPException(status_code=404, detail="Equity curve not available")
    bucket, key = parse_s3_uri(bt.s3_equity_curve_path)
    data = download_bytes(bucket, key)
    return orjson.loads(data)
