#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "========================================"
echo "Stopping Quant Backtest Platform..."
echo "========================================"

# Stop and remove containers, networks
echo "Stopping Docker containers..."
docker compose down

echo "========================================"
echo "Platform stopped successfully!"
echo "========================================"
