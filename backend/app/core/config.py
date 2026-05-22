from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL
    database_url: str = "postgresql+asyncpg://quant:quant_secret_2024@postgres:5432/quantdb"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin_secret_2024"
    minio_bucket_raw: str = "raw-data"
    minio_bucket_processed: str = "processed-data"
    minio_bucket_models: str = "ml-models"

    # Valkey / Celery
    celery_broker_url: str = "redis://valkey:6379/0"
    celery_result_backend: str = "redis://valkey:6379/1"
    valkey_url: str = "redis://valkey:6379/0"
    celery_worker_max_memory_per_child: int = 0
    celery_task_time_limit: int = 0
    celery_task_soft_time_limit: int = 0

    # Feature pipeline preflight guard
    # Column limit synced with MAX_ENGINE_A_OUTPUT_COLUMNS in features.py
    feature_pipeline_preflight_max_columns: int = 10000
    feature_pipeline_preflight_max_estimated_bytes: int = 50 * 1024 * 1024 * 1024
    feature_pipeline_preflight_memory_multiplier: float = 1.5

    # MLflow
    mlflow_tracking_uri: str = "http://mlflow:5000"
    mlflow_s3_endpoint_url: str = "http://minio:9000"
    aws_access_key_id: str = "minioadmin"
    aws_secret_access_key: str = "minioadmin_secret_2024"

    # App
    secret_key: str = "super_secret_key_change_in_production_32chars"
    debug: bool = True
    allowed_origins: str = "http://localhost:3000"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
