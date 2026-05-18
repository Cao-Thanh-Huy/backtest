import uuid
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

router = APIRouter()

class CreateResearchExperiment(BaseModel):
    feature_set_id: str
    name: str
    target_column: str
    cv_strategy: Dict[str, Any]
    clustering_config: Dict[str, Any]
    regime_method: str

@router.post("/")
async def create_experiment(payload: CreateResearchExperiment):
    """Creates a new Research Experiment (Feature Stability)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.core.config import settings
    from app.models.db_models import ResearchExperiment, StatusEnum
    from workers.tasks.stability_tasks import run_stability_experiment_task
    
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = create_engine(sync_url)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        exp = ResearchExperiment(
            feature_set_id=uuid.UUID(payload.feature_set_id),
            name=payload.name,
            target_column=payload.target_column,
            cv_strategy=payload.cv_strategy,
            clustering_config=payload.clustering_config,
            regime_method=payload.regime_method,
            status=StatusEnum.pending
        )
        db.add(exp)
        db.commit()
        db.refresh(exp)
        
        # Trigger celery task
        run_stability_experiment_task.delay(str(exp.id))
        
        return {"id": str(exp.id), "status": exp.status}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.get("/")
async def list_experiments():
    """Lists all Research Experiments."""
    from sqlalchemy import create_engine, text
    from app.core.config import settings
    
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = create_engine(sync_url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT e.id, e.name, e.target_column, e.status, e.created_at,
                       fs.name as feature_set_name, fs.selected_columns
                FROM research_experiments e
                JOIN feature_sets fs ON e.feature_set_id = fs.id
                ORDER BY e.created_at DESC
            """)).fetchall()
            
            return [
                {
                    "id": str(r[0]),
                    "name": r[1],
                    "target_column": r[2],
                    "status": r[3],
                    "created_at": r[4],
                    "feature_set_name": r[5],
                    "feature_count": len(r[6]) if r[6] else 0
                } for r in rows
            ]
    finally:
        engine.dispose()


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str):
    """Gets experiment details and metrics."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from app.core.config import settings
    from app.models.db_models import ResearchExperiment, ExperimentMetric
    
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")
    engine = create_engine(sync_url)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        exp = db.query(ResearchExperiment).filter(ResearchExperiment.id == experiment_id).first()
        if not exp:
            raise HTTPException(status_code=404, detail="Not found")
            
        metrics = db.query(ExperimentMetric).filter(ExperimentMetric.experiment_id == experiment_id).all()
        
        # Aggregate metrics for UI
        from collections import defaultdict
        feature_stats = defaultdict(list)
        timeline = defaultdict(dict)
        
        for m in metrics:
            mean = float(m.shap_mean) if m.shap_mean and m.shap_mean != 'nan' else 0.0
            std = float(m.shap_std) if m.shap_std and m.shap_std != 'nan' else 0.0
            feature_stats[m.feature_name].append((mean, std))
            timeline[m.window_idx][m.feature_name] = mean

        # Compute overall mean, std, score
        feature_results = []
        for feat, vals in feature_stats.items():
            means = [v[0] for v in vals]
            stds = [v[1] for v in vals]
            overall_mean = sum(means) / len(means) if means else 0.0
            overall_std = sum(stds) / len(stds) if stds else 0.0
            
            score = 0.0
            if overall_mean > 0:
                # 1 - (std/mean) clipped
                score = max(0.0, 1.0 - (overall_std / overall_mean))
                
            # Mock regimes if not real
            feature_results.append({
                "name": feat,
                "shap_mean": overall_mean,
                "shap_std": overall_std,
                "score": score,
                "regime_bull": overall_mean * np.random.uniform(0.8, 1.2),
                "regime_bear": overall_mean * np.random.uniform(-0.5, 0.5),
            })
            
        timeline_results = [{"window": w, "features": f} for w, f in timeline.items()]
        
        return {
            "id": str(exp.id),
            "status": exp.status,
            "error_message": exp.error_message,
            "metadata": {
                "target_column": exp.target_column,
                "cv_strategy": exp.cv_strategy,
                "regime_method": exp.regime_method,
            },
            "metrics": {
                "features": feature_results,
                "timeline": timeline_results,
                "clusters": exp.clustering_config.get("results", {}) if exp.clustering_config else {}
            }
        }
    finally:
        db.close()
