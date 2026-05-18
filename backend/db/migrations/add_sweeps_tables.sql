-- Migration: Add Sweep and SweepJob tables for hyperparameter tuning

CREATE TABLE IF NOT EXISTS sweeps (
    id UUID PRIMARY KEY,
    feature_set_id UUID NOT NULL REFERENCES feature_sets(id) ON DELETE CASCADE,
    model_type VARCHAR(50) NOT NULL,
    param_grid JSONB NOT NULL,
    cv_splits VARCHAR(10) NOT NULL,
    cv_gap VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_jobs VARCHAR(10) DEFAULT '0',
    completed_jobs VARCHAR(10) DEFAULT '0',
    failed_jobs VARCHAR(10) DEFAULT '0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sweep_jobs (
    id UUID PRIMARY KEY,
    sweep_id UUID NOT NULL REFERENCES sweeps(id) ON DELETE CASCADE,
    model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
    hyperparameters JSONB NOT NULL,
    cv_metrics JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweeps_feature_set_id ON sweeps(feature_set_id);
CREATE INDEX IF NOT EXISTS idx_sweeps_created_at ON sweeps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sweep_jobs_sweep_id ON sweep_jobs(sweep_id);
CREATE INDEX IF NOT EXISTS idx_sweep_jobs_model_id ON sweep_jobs(model_id);
