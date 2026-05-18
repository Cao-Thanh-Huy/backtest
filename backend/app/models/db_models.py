import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Text, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, DeclarativeBase
from sqlalchemy.sql import func
import enum


class Base(DeclarativeBase):
    pass


class StatusEnum(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


# ---------------------------------------------------------------------------
# Dataset  (Market Intake page output)
# ---------------------------------------------------------------------------
class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    symbol = Column(String(20), nullable=False, index=True)
    timeframe = Column(String(10), nullable=False)
    s3_raw_path = Column(Text, nullable=False)
    row_count = Column(String(20))
    source = Column(String(50))
    date_from = Column(DateTime)
    date_to = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

    # Downstream (cascade delete — dataset is the root)
    pipelines = relationship("FeaturePipeline", back_populates="dataset", cascade="all, delete-orphan")
    preparations = relationship("DataPreparation", back_populates="dataset", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Feature Pipeline  (Feature Factory page output)
# Input:  Dataset.s3_raw_path
# Output: s3://bucket/pipelines/{id}/processed.parquet
# ---------------------------------------------------------------------------
class FeaturePipeline(Base):
    __tablename__ = "feature_pipelines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120))
    indicators_config = Column(JSONB, nullable=False, default=list)
    lags = Column(JSONB, default=list)
    s3_processed_path = Column(Text)
    feature_columns = Column(JSONB, default=list)   # list of generated feature names
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    dataset = relationship("Dataset", back_populates="pipelines")


# ---------------------------------------------------------------------------
# Data Preparation  (Data Preparation page output)
# Input:  FeaturePipeline.s3_processed_path
# Output: s3://bucket/prepared/{id}/prepared.parquet
# ---------------------------------------------------------------------------
class DataPreparation(Base):
    __tablename__ = "data_preparations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    # FK to FeaturePipeline — SET NULL so deleting pipeline doesn't remove prep
    pipeline_id = Column(UUID(as_uuid=True), ForeignKey("feature_pipelines.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120))
    alignment_config = Column(JSONB, nullable=False, default=dict)
    cleaning_config = Column(JSONB, nullable=False, default=dict)
    missing_value_config = Column(JSONB, nullable=False, default=dict)
    normalization_config = Column(JSONB, nullable=False, default=dict)
    s3_prepared_path = Column(Text)
    quality_before = Column(JSONB)
    quality_after = Column(JSONB)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    dataset = relationship("Dataset", back_populates="preparations")
    # Downstream — cascade so deleting DataPrep removes LabeledDatasets
    labeled_datasets = relationship("LabeledDataset", back_populates="data_prep", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Labeled Dataset  (Labeling System page output)
# Input:  DataPreparation.s3_prepared_path
# Output: s3://bucket/labeled/{id}/labeled.parquet
# ---------------------------------------------------------------------------
class LabeledDataset(Base):
    __tablename__ = "labeled_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # FK to DataPreparation — SET NULL so deleting prep doesn't remove labeled dataset
    data_prep_id = Column(UUID(as_uuid=True), ForeignKey("data_preparations.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120))
    targets_config = Column(JSONB, nullable=False, default=list)   # list[TargetConfig dicts]
    target_columns = Column(JSONB, default=list)                   # ["y_return_5", "y_direction_5", ...]
    feature_columns = Column(JSONB, default=list)                  # feature columns inherited from prep
    s3_labeled_path = Column(Text)                                 # s3://bucket/labeled/{id}/labeled.parquet
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    data_prep = relationship("DataPreparation", back_populates="labeled_datasets")
    # Downstream — cascade so deleting LabeledDataset removes FeatureSets
    feature_sets = relationship("FeatureSet", back_populates="labeled_dataset", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Feature Set  (Feature Selection page output — metadata only, no new S3 file)
# Input:  LabeledDataset.s3_labeled_path
# Output: metadata record (selected_columns + target_column)
# ---------------------------------------------------------------------------
class FeatureSet(Base):
    __tablename__ = "feature_sets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # FK to LabeledDataset — SET NULL so deleting labeled dataset doesn't remove feature set
    labeled_dataset_id = Column(UUID(as_uuid=True), ForeignKey("labeled_datasets.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120), nullable=False)
    selected_columns = Column(JSONB, nullable=False, default=list)
    target_column = Column(String(100), nullable=False)
    analysis_snapshot = Column(JSONB)
    analysis_config = Column(JSONB)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    labeled_dataset = relationship("LabeledDataset", back_populates="feature_sets")
    ai_models = relationship("AIModel", back_populates="feature_set")
    research_experiments = relationship("ResearchExperiment", back_populates="feature_set", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# AI Model
# ---------------------------------------------------------------------------
class AIModel(Base):
    __tablename__ = "ai_models"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_set_id = Column(UUID(as_uuid=True), ForeignKey("feature_sets.id", ondelete="SET NULL"), nullable=True)
    target_column = Column(String(100), nullable=False)
    model_type = Column(String(50), nullable=False)
    hyperparameters = Column(JSONB, default=dict)
    selected_features = Column(JSONB, default=list)
    feature_importances = Column(JSONB, default=dict)
    cv_metrics = Column(JSONB, default=dict)
    mlflow_run_id = Column(String(64))
    s3_model_path = Column(Text)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    feature_set = relationship("FeatureSet", back_populates="ai_models")
    backtests = relationship("Backtest", back_populates="ai_model", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------
class Backtest(Base):
    __tablename__ = "backtests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id = Column(UUID(as_uuid=True), ForeignKey("ai_models.id", ondelete="CASCADE"), nullable=False)
    strategy_config = Column(JSONB, nullable=False, default=dict)
    metrics = Column(JSONB, default=dict)
    s3_equity_curve_path = Column(Text)
    s3_signals_path = Column(Text)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    ai_model = relationship("AIModel", back_populates="backtests")


# ---------------------------------------------------------------------------
# Hyperparameter Sweep
# ---------------------------------------------------------------------------
class Sweep(Base):
    __tablename__ = "sweeps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_set_id = Column(UUID(as_uuid=True), ForeignKey("feature_sets.id", ondelete="CASCADE"), nullable=False)
    model_type = Column(String(50), nullable=False)
    param_grid = Column(JSONB, nullable=False)
    cv_splits = Column(String(10), nullable=False)
    cv_gap = Column(String(10), nullable=False)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    total_jobs = Column(String(10), default="0")
    completed_jobs = Column(String(10), default="0")
    failed_jobs = Column(String(10), default="0")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    feature_set = relationship("FeatureSet")
    jobs = relationship("SweepJob", back_populates="sweep", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Sweep Job
# ---------------------------------------------------------------------------
class SweepJob(Base):
    __tablename__ = "sweep_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sweep_id = Column(UUID(as_uuid=True), ForeignKey("sweeps.id", ondelete="CASCADE"), nullable=False)
    model_id = Column(UUID(as_uuid=True), ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True)
    hyperparameters = Column(JSONB, nullable=False)
    cv_metrics = Column(JSONB)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    sweep = relationship("Sweep", back_populates="jobs")
    model = relationship("AIModel")


# ---------------------------------------------------------------------------
# Research Experiment  (Feature Stability page output)
# Input:  FeatureSet (reads LabeledDataset.s3_labeled_path via feature_set.labeled_dataset)
# ---------------------------------------------------------------------------
class ResearchExperiment(Base):
    __tablename__ = "research_experiments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_set_id = Column(UUID(as_uuid=True), ForeignKey("feature_sets.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120))
    target_column = Column(String(100), nullable=False)
    cv_strategy = Column(JSONB, nullable=False, default=dict)
    clustering_config = Column(JSONB, default=dict)
    regime_method = Column(String(50))
    status = Column(SAEnum(StatusEnum), default=StatusEnum.pending)
    celery_task_id = Column(String(64))
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    feature_set = relationship("FeatureSet", back_populates="research_experiments")
    metrics = relationship("ExperimentMetric", back_populates="experiment", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Experiment Metric
# ---------------------------------------------------------------------------
class ExperimentMetric(Base):
    __tablename__ = "experiment_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey("research_experiments.id", ondelete="CASCADE"), nullable=False)
    window_idx = Column(String(20), nullable=False)
    window_start = Column(DateTime)
    window_end = Column(DateTime)
    regime = Column(String(50))
    feature_name = Column(String(100), nullable=False)
    shap_mean = Column(String(20))
    shap_std = Column(String(20))
    importance = Column(String(20))
    ks_pvalue = Column(String(20))
    created_at = Column(DateTime, server_default=func.now())

    experiment = relationship("ResearchExperiment", back_populates="metrics")
