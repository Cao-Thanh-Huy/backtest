"""Endpoints for fetching market data from external sources."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from workers.tasks.fetch_tasks import fetch_market_data_task
from workers.engines.fetcher import SUPPORTED_SOURCES

router = APIRouter()


class FetchRequest(BaseModel):
    source: str          # "binance" | "yahoo"
    symbol: str          # e.g. "BTCUSDT" or "BTC-USD"
    timeframe: str       # e.g. "1h", "1d"
    date_from: str       # "2022-01-01"
    date_to: str         # "2025-01-01"
    enrich_columns: list[str] | None = None


class FetchResponse(BaseModel):
    task_id: str
    message: str


@router.get("/sources")
async def list_sources():
    """Return supported data sources and their configs."""
    return SUPPORTED_SOURCES


@router.post("/market-data", response_model=FetchResponse, status_code=status.HTTP_202_ACCEPTED)
async def fetch_market_data(payload: FetchRequest):
    """
    Dispatch an async task to fetch OHLCV data from an external source.
    Monitor progress via WS /ws/task/{task_id}.
    On completion, task result contains {dataset_id, preview}.
    """
    if payload.source.lower() not in SUPPORTED_SOURCES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported source: {payload.source!r}. Use: {list(SUPPORTED_SOURCES.keys())}",
        )

    task = fetch_market_data_task.apply_async(
        kwargs={
            "source": payload.source.lower(),
            "symbol": payload.symbol.strip().upper(),
            "timeframe": payload.timeframe,
            "date_from": payload.date_from,
            "date_to": payload.date_to,
            "enrich_columns": payload.enrich_columns,
        },
        queue="features",
    )

    return FetchResponse(
        task_id=task.id,
        message=f"Fetching {payload.symbol} {payload.timeframe} from {payload.source}...",
    )
