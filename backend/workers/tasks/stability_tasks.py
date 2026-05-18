import structlog
from celery import shared_task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.db_models import ResearchExperiment, StatusEnum
from workers.engines.stability import run_stability_experiment_engine

log = structlog.get_logger()

# Use psycopg2 for synchronous celery workers
sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
engine = create_engine(sync_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@shared_task(bind=True, name="workers.tasks.stability_tasks.run_stability_experiment_task")
def run_stability_experiment_task(self, experiment_id: str):
    """Celery task to run the temporal feature stability research experiment."""
    db = SessionLocal()
    experiment = db.query(ResearchExperiment).filter(ResearchExperiment.id == experiment_id).first()

    if not experiment:
        log.error("Experiment not found", experiment_id=experiment_id)
        db.close()
        return {"status": "failed", "error": "Experiment not found"}

    try:
        experiment.status = StatusEnum.running
        experiment.celery_task_id = self.request.id
        db.commit()
        
        # Pass progress reporting callback
        def progress_cb(step: str, pct: int):
            self.update_state(state="PROGRESS", meta={"step": step, "progress": pct})
            
        run_stability_experiment_engine(db, experiment, progress_cb)
        
        experiment.status = StatusEnum.completed
        db.commit()
        return {"status": "completed", "experiment_id": experiment_id}
        
    except Exception as e:
        db.rollback()
        experiment.status = StatusEnum.failed
        experiment.error_message = str(e)
        db.commit()
        log.exception("Stability experiment failed", experiment_id=experiment_id)
        return {"status": "failed", "error": str(e)}
    finally:
        db.close()
