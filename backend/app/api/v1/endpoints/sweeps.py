"""Hyperparameter sweep endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.db_models import Sweep, SweepJob, FeatureSet, StatusEnum
from app.schemas.schemas import SweepCreate, SweepRead, SweepJobCreate, SweepJobRead

router = APIRouter(tags=["sweeps"])


# ─────────────────────────────────────────────────────────────────────────
# CREATE SWEEP
# ─────────────────────────────────────────────────────────────────────────
@router.post("", response_model=SweepRead)
async def create_sweep(req: SweepCreate, db: AsyncSession = Depends(get_db)):
    """Create a new hyperparameter sweep session."""
    # Verify feature set exists
    fs = await db.get(FeatureSet, req.feature_set_id)
    if not fs:
        raise HTTPException(status_code=404, detail="Feature set not found")

    sweep = Sweep(
        feature_set_id=req.feature_set_id,
        model_type=req.model_type,
        param_grid=req.param_grid,
        cv_splits=req.cv_splits,
        cv_gap=req.cv_gap,
        status=StatusEnum.pending,
    )
    db.add(sweep)
    await db.flush()
    sweep_id = sweep.id
    await db.commit()

    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.jobs)).where(Sweep.id == sweep_id)
    )
    created = result.scalar_one()
    return created


# ─────────────────────────────────────────────────────────────────────────
# LIST SWEEPS
# ─────────────────────────────────────────────────────────────────────────
@router.get("", response_model=list[SweepRead])
async def list_sweeps(db: AsyncSession = Depends(get_db)):
    """List all hyperparameter sweeps, ordered by most recent first."""
    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.jobs)).order_by(Sweep.created_at.desc())
    )
    return result.scalars().all()


# ─────────────────────────────────────────────────────────────────────────
# GET SWEEP DETAIL
# ─────────────────────────────────────────────────────────────────────────
@router.get("/{sweep_id}", response_model=SweepRead)
async def get_sweep(sweep_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get sweep details with all jobs."""
    result = await db.execute(
        select(Sweep).options(selectinload(Sweep.jobs)).where(Sweep.id == sweep_id)
    )
    sweep = result.scalar_one_or_none()
    if not sweep:
        raise HTTPException(status_code=404, detail="Sweep not found")
    return sweep


# ─────────────────────────────────────────────────────────────────────────
# ADD JOB TO SWEEP
# ─────────────────────────────────────────────────────────────────────────
@router.post("/{sweep_id}/jobs", response_model=SweepJobRead)
async def add_sweep_job(sweep_id: UUID, req: SweepJobCreate, db: AsyncSession = Depends(get_db)):
    """Add a new job (hyperparameter combination) to a sweep."""
    sweep = await db.get(Sweep, sweep_id)
    if not sweep:
        raise HTTPException(status_code=404, detail="Sweep not found")

    job = SweepJob(
        sweep_id=sweep_id,
        hyperparameters=req.hyperparameters,
        status=StatusEnum.pending,
    )
    db.add(job)

    # Increment total_jobs counter
    sweep.total_jobs = str(int(sweep.total_jobs or 0) + 1)
    sweep.status = StatusEnum.running  # Mark sweep as running once jobs are added

    await db.flush()
    await db.commit()
    await db.refresh(job)
    return job


# ─────────────────────────────────────────────────────────────────────────
# UPDATE JOB STATUS & METRICS
# ─────────────────────────────────────────────────────────────────────────
@router.patch("/{sweep_id}/jobs/{job_id}", response_model=SweepJobRead)
async def update_sweep_job(
    sweep_id: UUID,
    job_id: UUID,
    updates: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update job status, model_id, and/or cv_metrics. Used when training completes."""
    sweep = await db.get(Sweep, sweep_id)
    if not sweep:
        raise HTTPException(status_code=404, detail="Sweep not found")

    result = await db.execute(
        select(SweepJob).where(SweepJob.id == job_id, SweepJob.sweep_id == sweep_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Update job fields
    if "status" in updates:
        new_status = updates["status"]
        old_status = job.status
        job.status = new_status
        # Update sweep counters
        if old_status != StatusEnum.completed and new_status == StatusEnum.completed:
            sweep.completed_jobs = str(int(sweep.completed_jobs or 0) + 1)
        elif old_status != StatusEnum.failed and new_status == StatusEnum.failed:
            sweep.failed_jobs = str(int(sweep.failed_jobs or 0) + 1)

    if "model_id" in updates:
        job.model_id = updates["model_id"]

    if "cv_metrics" in updates:
        job.cv_metrics = updates["cv_metrics"]

    # Check if sweep is done
    total = int(sweep.total_jobs or 0)
    completed = int(sweep.completed_jobs or 0)
    failed = int(sweep.failed_jobs or 0)
    if total > 0 and (completed + failed) >= total:
        sweep.status = StatusEnum.completed
    elif total > 0:
        sweep.status = StatusEnum.running

    await db.flush()
    await db.commit()
    await db.refresh(job)
    return job


# ─────────────────────────────────────────────────────────────────────────
# GET SWEEP JOBS
# ─────────────────────────────────────────────────────────────────────────
@router.get("/{sweep_id}/jobs", response_model=list[SweepJobRead])
async def get_sweep_jobs(sweep_id: UUID, db: AsyncSession = Depends(get_db)):
    """List all jobs in a sweep."""
    sweep = await db.get(Sweep, sweep_id)
    if not sweep:
        raise HTTPException(status_code=404, detail="Sweep not found")

    result = await db.execute(select(SweepJob).where(SweepJob.sweep_id == sweep_id).order_by(SweepJob.created_at))
    return result.scalars().all()
