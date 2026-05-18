# Quant Research and ML Trading Platform

This repository contains a full-stack quant workflow platform with:

- Data ingestion and validation
- Feature and target pipeline generation
- Model training with walk-forward validation
- Strategy backtesting and equity analytics
- Real-time task progress via WebSocket

The stack runs with Docker Compose and includes PostgreSQL, MinIO, Valkey, FastAPI, Celery, MLflow, Next.js, and Nginx.

## 1) High-Level Architecture

Core services:

- PostgreSQL: metadata store for datasets, pipelines, models, backtests, and MLflow backend
- MinIO: object storage for raw and processed parquet, trained model artifacts, equity and signal JSON
- Valkey: Celery broker and result backend
- FastAPI backend: REST API and WebSocket progress stream
- Celery worker: async execution for feature pipeline, training, and backtesting
- MLflow: experiment tracking and run metadata
- Next.js frontend: operator UI across Data Hub, Strategy Studio, Auto-ML Lab, Backtest Simulator
- Nginx: optional reverse proxy

Execution model:

1. Frontend calls REST endpoint to create a job record.
2. Backend dispatches Celery task and stores celery_task_id.
3. Frontend opens WebSocket by task id.
4. Worker updates task state and database.
5. Frontend receives progress and final result, then fetches detail resources (for example equity curve).

## 2) Repository Structure

- backend: FastAPI app, SQLAlchemy models, Celery workers, engines, tests
- frontend: Next.js app router UI pages and client data layer
- mlflow: custom MLflow image setup
- nginx: reverse proxy config
- docker-compose.yml: orchestration for all services
- .env: environment values used by backend, frontend, worker, and compose

## 3) Service Map and Ports

- backend: http://localhost:8000
- frontend: http://localhost:3000
- mlflow: http://localhost:5000
- flower: http://localhost:5555
- minio api: http://localhost:9000
- minio console: http://localhost:9001
- nginx: http://localhost:80
- postgres: localhost:5432
- valkey: localhost:6379

Important health endpoints:

- backend health: GET /health
- mlflow health: GET /health

## 4) Data Model (PostgreSQL)

Main tables:

- datasets
	- symbol, timeframe, s3_raw_path, row_count, date_from, date_to
- feature_pipelines
	- dataset_id, indicators_config, targets_config, lags, feature_columns, s3_processed_path, status, celery_task_id
- ai_models
	- pipeline_id, target_column, model_type, selected_features, feature_importances, cv_metrics, mlflow_run_id, s3_model_path, status, celery_task_id
- backtests
	- model_id, strategy_config, metrics, s3_equity_curve_path, s3_signals_path, status, celery_task_id

Status lifecycle used by async entities:

- pending -> running -> completed
- pending -> running -> failed

## 5) Frontend UX and Page-by-Page Dynamic Behavior

The frontend uses Next.js App Router and redirects root path to Data Hub.

- / -> redirect to /data

Global UI behavior:

- Persistent left sidebar with 4 main pages
- Shared dark theme tokens:
	- brand.500: #6366f1
	- surface default: #0f172a
	- card: #1e293b
	- border: #334155
- Global query cache via React Query Provider
- Task progress state kept in Zustand store:
	- activeTaskId, taskProgress, taskMessage, taskStatus

### 5.1 Data Hub page (/data)

Purpose:

- Upload OHLCV file (CSV or Parquet)
- Create dataset record
- List uploaded datasets

UI interactions:

- Symbol input and timeframe selector
- Drag-and-drop upload zone (react-dropzone)
- Upload button enabled only when symbol and file are present
- Dataset table renders latest items from API

API usage:

- POST /api/v1/datasets/upload (multipart form)
- GET /api/v1/datasets/

Backend behavior:

- Parses uploaded file with Polars
- Normalizes to parquet before storing in MinIO
- Extracts min and max date when date column exists
- Stores metadata in datasets table

MinIO path pattern:

- s3://raw-data/{SYMBOL}/{TIMEFRAME}/{FILENAME}.parquet

### 5.2 Strategy Studio page (/studio)

Purpose:

- Build feature and target generation config
- Dispatch feature pipeline generation
- Watch real-time progress

UI interactions:

- Select dataset
- Add indicator presets (rsi, macd, bbands, atr, ema, sma, stoch, adx)
- Add one or more targets
- Configure lags as comma-separated list
- Dispatch button requires dataset and at least one indicator

Async behavior:

1. POST /api/v1/pipelines/generate
2. Receives pipeline id and celery_task_id
3. Opens ws://.../api/v1/ws/task/{task_id}
4. Progress bar updates from WebSocket payload
5. On success, progress clears and pipeline appears in pipeline list API

Pipeline task internals:

- Load raw dataset from MinIO
- Engine A generates indicators and lag features
- Engine B generates targets and drops leakage rows
- Save processed parquet to MinIO
- Update feature_columns and status in DB

MinIO processed path:

- s3://processed-data/pipelines/{pipeline_id}/processed.parquet

### 5.3 Auto-ML Lab page (/ai-lab)

Purpose:

- Train model from a completed pipeline
- Observe training task progress
- Visualize top feature importances
- Jump to MLflow UI

UI interactions:

- Pipeline selector (only completed pipelines)
- Target column selector (columns starting with y_)
- Model type selector:
	- xgboost
	- lightgbm (default)
	- random_forest
- CV splits and purge gap inputs
- Feature importance chart with top 20 bars

Async behavior:

1. POST /api/v1/models/train
2. Receive model id and celery task id
3. Subscribe progress on WebSocket
4. On SUCCESS, merge result payload into local trained model state

Training task internals:

- Load processed parquet from MinIO
- Engine C feature selection
- Engine D walk-forward CV training
- Log run to MLflow
- Save trained model artifact to MinIO
- Persist selected_features, importances, cv_metrics, mlflow_run_id

### 5.4 Backtest Simulator page (/backtester)

Purpose:

- Run backtest from a trained model
- Display KPI metrics
- Render equity curve

UI interactions:

- Select model (only completed models)
- Configure initial capital, fee, thresholds
- Run simulation button dispatches backtest task
- KPI cards update from final metrics
- Equity chart updates after SUCCESS and follow-up fetch

Async behavior:

1. POST /api/v1/backtests/run
2. Open WebSocket by returned task id
3. On SUCCESS, call GET /api/v1/backtests/{id}/equity-curve
4. Render returned series in chart

Backtest task internals:

- Load trained model artifact from MinIO
- Load processed dataset from MinIO
- Create predictions and optional probabilities
- Engine E runs VectorBT if available, otherwise fallback pandas/numpy backtest
- Save equity curve JSON and signals JSON to MinIO
- Persist metrics and artifact paths into backtests table

MinIO result paths:

- s3://processed-data/backtests/{backtest_id}/equity_curve.json
- s3://processed-data/backtests/{backtest_id}/signals.json

## 6) WebSocket Contract and Task State Behavior

WebSocket endpoint:

- /api/v1/ws/task/{task_id}

Message shape:

- task_id
- status
- progress (0-100)
- message
- result (optional)
- error (optional)

Current runtime behavior:

- Sends immediate PENDING right after connect
- Sends PROGRESS updates while task is running
- If task finishes too fast without prior progress, server emits synthetic PROGRESS 99 Finalizing before SUCCESS
- Ends stream on SUCCESS or FAILURE

This logic prevents UI from jumping directly from empty state to SUCCESS for very fast tasks.

## 7) API Summary

## 8) Development Mode (Hot Reload)

The compose stack is configured for development DX:

- backend runs with `uvicorn --reload`
- frontend runs with `next dev`
- celery worker runs under `watchfiles` and restarts on Python file changes

Start dev stack:

```bash
docker compose up -d --build backend celery_worker frontend
```

Useful checks:

```bash
docker compose logs -f backend celery_worker frontend
docker compose exec -T celery_worker celery -A workers.celery_app inspect registered
```

## 9) Fetch Debugging By Phases

Use the isolation flow below to debug fetch issues without involving all layers at once.

Phase 1: engine only (no API, no Celery)

```bash
docker compose exec -T backend python scripts/test_fetch_core.py \
	--source binance --symbol BTCUSDT --timeframe 1h \
	--date-from 2024-01-01 --date-to 2024-01-03
```

Phase 2: Celery task execution

```bash
docker compose exec -T backend python scripts/test_fetch_task.py \
	--source binance --symbol BTCUSDT --timeframe 1h \
	--date-from 2024-01-01 --date-to 2024-01-03
```

Phase 3: API dispatch

```bash
curl -sS -X POST http://localhost:8000/api/v1/fetch/market-data \
	-H 'Content-Type: application/json' \
	-d '{"source":"binance","symbol":"BTCUSDT","timeframe":"1h","date_from":"2024-01-01","date_to":"2024-01-03"}'
```

Datasets:

- POST /api/v1/datasets/upload
- GET /api/v1/datasets/
- GET /api/v1/datasets/{id}
- DELETE /api/v1/datasets/{id}

Pipelines:

- POST /api/v1/pipelines/generate
- GET /api/v1/pipelines/
- GET /api/v1/pipelines/{id}

Models:

- POST /api/v1/models/train
- GET /api/v1/models/
- GET /api/v1/models/{id}

Backtests:

- POST /api/v1/backtests/run
- GET /api/v1/backtests/
- GET /api/v1/backtests/{id}
- GET /api/v1/backtests/{id}/equity-curve

WebSocket:

- WS /api/v1/ws/task/{task_id}

## 8) Running the Platform

Start all services:

```bash
docker compose up -d --build
```

Check service status:

```bash
docker compose ps
```

Stop services:

```bash
docker compose down
```

## 9) Test Phases and Current QA Signals

Run all implemented phases:

```bash
docker compose exec -T backend pytest tests/test_infra.py tests/test_engines.py tests/test_e2e.py -q
```

Covered scopes:

- Phase 1 infra
	- DB connectivity
	- table creation
	- Valkey ping
	- MinIO bucket access
	- MLflow health
- Phase 2 engines
	- Engine A expected columns
	- Engine B leakage check with exact row drop
	- Engine E no-crash metrics contract
- Phase 3 e2e
	- dataset upload -> pipeline dispatch -> websocket lifecycle -> db persistence -> minio object existence

## 10) Operational Notes and Gotchas

- Backend runs uvicorn with --reload in compose for development. This can cause occasional websocket close code 1012 during reload windows.
- E2E websocket test includes reconnect logic for 1012 to keep tests stable.
- MLflow is configured with PostgreSQL search_path to isolate MLflow tables from app tables.
- VectorBT is optional. Engine E includes fallback logic so backtest can still complete without vectorbt installed.
- XGBoost is optional and lazily loaded by trainer. If unavailable, choose lightgbm or random_forest.

## 11) Review Checklist for This Build

If you want to review fast but deep, use this order:

1. Bring stack up and verify all key services are healthy.
2. Upload one dataset in Data Hub and confirm it appears in list.
3. Generate a pipeline in Strategy Studio and monitor websocket progress.
4. Train a model in Auto-ML Lab and inspect feature importance chart.
5. Open MLflow UI and confirm run and metrics.
6. Run one backtest and confirm KPI plus equity curve are rendered.
7. Execute test phases to confirm no regression in infra, engines, and e2e contract.

## 12) Suggested Next Improvements

- Add per-page loading and empty-state snapshots to visual regression tests.
- Add API contract tests for error paths (invalid payloads, stale IDs, and race timing).
- Add observability dashboard for Celery queue depth and task latency percentiles.
- Add role-based access and auth for production exposure.