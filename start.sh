#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "========================================"
echo "Starting Quant Backtest Platform..."
echo "========================================"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker is not running or current user does not have permission to access Docker daemon."
    echo "Please ensure Docker is started and you have the correct permissions."
    exit 1
fi

# Build and start the containers in detached mode
echo "Building and starting Docker containers..."
docker compose up --build -d

echo "========================================"
echo "Platform started successfully!"
echo "Services are available at:"
echo "- Frontend:    http://localhost:3000"
echo "- Backend API: http://localhost:8000"
echo "- MLflow:      http://localhost:5000"
echo "- MinIO Web:   http://localhost:9001"
echo "- Flower:      http://localhost:5555"
echo "========================================"
