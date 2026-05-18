-- Migration: Add data_preparations table
-- Created for Data Preparation Pipeline feature

CREATE TABLE IF NOT EXISTS data_preparations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    name VARCHAR(120),
    alignment_config JSONB NOT NULL DEFAULT '{}',
    cleaning_config JSONB NOT NULL DEFAULT '{}',
    missing_value_config JSONB NOT NULL DEFAULT '{}',
    normalization_config JSONB NOT NULL DEFAULT '{}',
    s3_prepared_path TEXT,
    quality_before JSONB,
    quality_after JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    celery_task_id VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_data_preparations_dataset_id ON data_preparations(dataset_id);
CREATE INDEX idx_data_preparations_status ON data_preparations(status);
CREATE INDEX idx_data_preparations_created_at ON data_preparations(created_at DESC);
