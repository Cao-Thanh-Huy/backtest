"""Pydantic schemas — request/response contracts for the API."""
from __future__ import annotations
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict, model_validator


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------
class DatasetCreate(BaseModel):
    symbol: str = Field(..., max_length=20)
    timeframe: str = Field(..., max_length=10)


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    symbol: str
    timeframe: str
    s3_raw_path: str
    row_count: str | None
    source: str | None = None
    date_from: datetime | None
    date_to: datetime | None
    created_at: datetime
    pipeline_count: int | None = None


# ---------------------------------------------------------------------------
# Indicator config (nested inside PipelineCreate)
# ---------------------------------------------------------------------------
class IndicatorConfig(BaseModel):
    name: str                                    # e.g. "rsi", "macd"
    params: dict[str, Any] = {}                  # fixed params
    params_sweep: dict[str, dict[str, Any]] = {} # sweep ranges


class TargetConfig(BaseModel):
    name: str                       # e.g. "y_return_3d"
    method: str                     # "n_bar" | "triple_barrier"
    params: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Feature Pipeline  (Feature Factory page)
# ---------------------------------------------------------------------------
class PipelineCreate(BaseModel):
    dataset_id: UUID
    name: str | None = None
    indicators: list[IndicatorConfig] = Field(default_factory=list)
    lags: list[int] = Field(default_factory=list)


class PipelinePreflightCreate(BaseModel):
    dataset_id: UUID
    indicators: list[IndicatorConfig] = Field(default_factory=list)
    lags: list[int] = Field(default_factory=list)


class PipelinePreflightRead(BaseModel):
    row_count: int | None
    lag_count: int
    base_feature_columns: int
    total_feature_columns: int
    estimated_bytes: int | None
    column_limit: int
    estimated_bytes_limit: int
    over_columns: bool
    over_bytes: bool
    accepted: bool
    message: str | None = None


class PipelineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dataset_id: UUID
    name: str | None
    status: str
    celery_task_id: str | None
    feature_columns: list[str] | None
    indicators_config: list[dict] | None = None
    lags: list[int] | None = None
    s3_processed_path: str | None
    error_message: str | None
    progress: int | None = None
    progress_message: str | None = None
    celery_ram_mb: float | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Data Preparation  (Data Preparation page)
# ---------------------------------------------------------------------------
class DataPrepCreate(BaseModel):
    pipeline_id: UUID                            # Feature Factory pipeline to read from
    name: str | None = None
    alignment_config: dict[str, Any] = Field(default_factory=dict)
    cleaning_config: dict[str, Any] = Field(default_factory=dict)
    missing_value_config: dict[str, Any] = Field(default_factory=dict)
    normalization_config: dict[str, Any] = Field(default_factory=dict)


class DataPrepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dataset_id: UUID
    pipeline_id: UUID | None
    name: str | None
    alignment_config: dict[str, Any]
    cleaning_config: dict[str, Any]
    missing_value_config: dict[str, Any]
    normalization_config: dict[str, Any]
    status: str
    celery_task_id: str | None
    s3_prepared_path: str | None
    quality_before: dict[str, Any] | None
    quality_after: dict[str, Any] | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Labeled Dataset  (Labeling System page)
# ---------------------------------------------------------------------------
class LabeledDatasetCreate(BaseModel):
    data_prep_id: UUID                           # Data Preparation to read from
    name: str | None = None
    targets: list[TargetConfig] = Field(default_factory=list)


class LabeledDatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    data_prep_id: UUID | None
    name: str | None
    targets_config: list[dict] | None
    target_columns: list[str] | None
    feature_columns: list[str] | None
    s3_labeled_path: str | None
    status: str
    celery_task_id: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Feature Set  (Feature Selection page)
# ---------------------------------------------------------------------------
class FeatureSetGenerateRequest(BaseModel):
    labeled_dataset_id: UUID
    name: str | None = None
    target_column: str
    task: str = "regression"
    mi_top_k: int = 50
    tree_top_k: int = 20
    vif_threshold: float = 10.0
    corr_threshold: float = 0.95


class FeatureSetSuggestRequest(BaseModel):
    labeled_dataset_id: UUID
    target_column: str
    task: str = "regression"
    mi_top_k: int = 50
    tree_top_k: int = 20
    vif_threshold: float = 10.0
    corr_threshold: float = 0.95


class FeatureSetSuggestResponse(BaseModel):
    selected_columns: list[str]
    feature_importances: dict[str, float]





class FeatureAnalysisResponse(BaseModel):
    vif_scores: dict[str, float]
    dropped_vif: list[str]
    spearman_with_target: dict[str, float]
    inter_feature_corr: dict[str, dict[str, float]]
    dropped_corr: list[str]
    dropped_corr_reasons: dict[str, dict[str, Any]] = Field(default_factory=dict)
    mutual_information: dict[str, float]
    feature_importance: dict[str, float]
    final_selected: list[str]
    stage_counts: dict[str, int] = Field(default_factory=dict)


class FeatureSetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    labeled_dataset_id: UUID | None
    name: str
    selected_columns: list[str]
    target_column: str
    analysis_snapshot: dict[str, Any] | None = None
    analysis_config: dict[str, Any] | None = None
    status: str
    celery_task_id: str | None
    error_message: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# AI Model
# ---------------------------------------------------------------------------
class ModelTrainRequest(BaseModel):
    feature_set_id: UUID
    target_column: str
    model_type: str = "lightgbm"
    hyperparameters: dict[str, Any] = {}
    auto_tune: bool = False
    tune_trials: int = 20
    tune_search_space: dict[str, Any] | None = None
    optimize_metric: str | None = None
    n_splits: int = 5
    gap: int = 10


class ModelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    feature_set_id: UUID | None = None
    target_column: str
    model_type: str
    hyperparameters: dict[str, Any] | None = None
    selected_features: list[str] | None
    feature_importances: dict[str, float] | None
    cv_metrics: dict[str, Any] | None
    mlflow_run_id: str | None
    celery_task_id: str | None
    status: str
    error_message: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------
class BacktestCreate(BaseModel):
    model_id: UUID
    initial_capital: float = Field(default=10_000.0, gt=0)
    fee_pct: float = Field(default=0.001, ge=0, le=0.05)
    slippage_pct: float = Field(default=0.0005, ge=0, le=0.05)
    long_threshold: float = Field(default=0.6, ge=0, le=1)
    short_threshold: float = Field(default=0.4, ge=0, le=1)

    @model_validator(mode="after")
    def validate_threshold_order(self) -> "BacktestCreate":
        if self.long_threshold <= self.short_threshold:
            raise ValueError("long_threshold must be greater than short_threshold")
        return self


class BacktestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    strategy_config: dict[str, Any]
    metrics: dict[str, Any] | None
    s3_equity_curve_path: str | None
    celery_task_id: str | None
    status: str
    error_message: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# WebSocket task progress message
# ---------------------------------------------------------------------------
class TaskProgress(BaseModel):
    task_id: str
    status: str
    progress: int = 0
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Hyperparameter Sweep
# ---------------------------------------------------------------------------
class SweepJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sweep_id: UUID
    model_id: UUID | None
    hyperparameters: dict[str, Any]
    cv_metrics: dict[str, Any] | None
    status: str
    created_at: datetime
    updated_at: datetime


class SweepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    feature_set_id: UUID
    model_type: str
    param_grid: dict[str, Any]
    cv_splits: str
    cv_gap: str
    status: str
    total_jobs: str
    completed_jobs: str
    failed_jobs: str
    created_at: datetime
    updated_at: datetime
    jobs: list[SweepJobRead] = []


class SweepCreate(BaseModel):
    feature_set_id: UUID
    model_type: str
    param_grid: dict[str, Any]
    cv_splits: str = "3"
    cv_gap: str = "5"


class SweepJobCreate(BaseModel):
    hyperparameters: dict[str, Any]
