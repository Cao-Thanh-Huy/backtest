from fastapi import APIRouter
from app.api.v1.endpoints import (
    datasets, pipelines, data_prep, labeled_datasets,
    feature_sets, models, backtests, websocket, fetch,
    experiments, sweeps, stability,
)

api_router = APIRouter()

# Pipeline: Raw Dataset → Feature Factory → Data Preparation → Labeling System → Feature Selection → Stability
api_router.include_router(datasets.router, prefix="/datasets", tags=["1. Market Intake"])
api_router.include_router(pipelines.router, prefix="/pipelines", tags=["2. Feature Factory"])
api_router.include_router(data_prep.router, prefix="/data-prep", tags=["3. Data Preparation"])
api_router.include_router(labeled_datasets.router, prefix="/labeled-datasets", tags=["4. Labeling System"])
api_router.include_router(feature_sets.router, prefix="/feature-sets", tags=["5. Feature Selection"])
api_router.include_router(stability.router, prefix="/stability", tags=["6. Feature Stability"])

# Other services
api_router.include_router(models.router, prefix="/models", tags=["AI Models"])
api_router.include_router(backtests.router, prefix="/backtests", tags=["Backtests"])
api_router.include_router(sweeps.router, prefix="/sweeps", tags=["Sweeps"])
api_router.include_router(websocket.router, prefix="/ws", tags=["WebSocket"])
api_router.include_router(fetch.router, prefix="/fetch", tags=["Market Data Fetch"])
api_router.include_router(experiments.router, prefix="/experiments", tags=["Experiments"])
