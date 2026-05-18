"""Phase 1 test: run fetch engine directly (no API, no Celery)."""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from workers.engines.fetcher import fetch_market_data, get_data_preview


def main() -> None:
    parser = argparse.ArgumentParser(description="Core market-data fetch smoke test")
    parser.add_argument("--source", default="binance", choices=["binance", "yahoo"])
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--timeframe", default="1h")
    parser.add_argument("--date-from", default="2024-01-01")
    parser.add_argument("--date-to", default="2024-01-31")
    args = parser.parse_args()

    def progress(pct: int, msg: str) -> None:
        print(f"[{pct:3d}%] {msg}")

    df = fetch_market_data(
        source=args.source,
        symbol=args.symbol,
        timeframe=args.timeframe,
        date_from=args.date_from,
        date_to=args.date_to,
        progress_cb=progress,
    )
    preview = get_data_preview(df)

    print("\nFetch completed")
    print(json.dumps(preview, indent=2, default=str))


if __name__ == "__main__":
    main()
