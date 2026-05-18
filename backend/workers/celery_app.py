"""Celery application factory."""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "quant_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "workers.tasks.fetch_tasks",
        "workers.tasks.pipeline_tasks",
        "workers.tasks.data_prep_tasks",
        "workers.tasks.labeled_dataset_tasks",
        "workers.tasks.feature_tasks",
        "workers.tasks.training_tasks",
        "workers.tasks.backtest_tasks",
        "workers.tasks.stability_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    worker_max_memory_per_child=(settings.celery_worker_max_memory_per_child or None),
    task_time_limit=(settings.celery_task_time_limit or None),
    task_soft_time_limit=(settings.celery_task_soft_time_limit or None),
    result_expires=86400,           # 24h
    task_routes={
        "workers.tasks.fetch_tasks.*": {"queue": "features"},
        "workers.tasks.pipeline_tasks.*": {"queue": "features"},
        "workers.tasks.data_prep_tasks.*": {"queue": "features"},
        "workers.tasks.labeled_dataset_tasks.*": {"queue": "features"},
        "workers.tasks.training_tasks.*": {"queue": "training"},
        "workers.tasks.backtest_tasks.*": {"queue": "backtest"},
        "workers.tasks.stability_tasks.*": {"queue": "training"},
    },
)
