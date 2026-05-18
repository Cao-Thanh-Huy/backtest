from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine
from app.models.db_models import Base
from app.api.v1.router import api_router

log = structlog.get_logger()


async def ensure_feature_set_analysis_columns() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE feature_sets ADD COLUMN IF NOT EXISTS analysis_snapshot JSONB"))
        await conn.execute(text("ALTER TABLE feature_sets ADD COLUMN IF NOT EXISTS analysis_config JSONB"))


async def ensure_schema_migrations() -> None:
    """Run idempotent column additions for schema evolution."""
    async with engine.begin() as conn:
        # Add pipeline_id to data_preparations for traceability (SET NULL on pipeline delete)
        await conn.execute(text("""
            ALTER TABLE data_preparations
            ADD COLUMN IF NOT EXISTS pipeline_id UUID
            REFERENCES feature_pipelines(id) ON DELETE SET NULL
        """))
        # Migrate feature_sets: add labeled_dataset_id, make pipeline_id nullable
        await conn.execute(text("""
            ALTER TABLE feature_sets
            ADD COLUMN IF NOT EXISTS labeled_dataset_id UUID
            REFERENCES labeled_datasets(id) ON DELETE SET NULL
        """))
        # Remove targets_config from feature_pipelines if it exists (cleanup old schema)
        # Note: We keep it nullable but stop writing to it
        # New feature_pipelines have no targets_config column usage


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    log.info("Starting up: creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_feature_set_analysis_columns()
    await ensure_schema_migrations()
    log.info("Database tables ready.")
    yield
    # --- Shutdown ---
    await engine.dispose()
    log.info("Engine disposed. Shutdown complete.")


app = FastAPI(
    title="Quant Research & ML Trading Platform",
    version="1.0.0",
    description="Dynamic, async, config-driven quant research platform.",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}
