-- PostgreSQL initialization script
-- Run automatically on first container start

-- MLflow needs its own schema space, using same DB
CREATE SCHEMA IF NOT EXISTS mlflow;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
