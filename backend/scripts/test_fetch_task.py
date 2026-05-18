"""Phase 2 test: dispatch Celery fetch task directly and poll result."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from workers.tasks.fetch_tasks import fetch_market_data_task


def main() -> None:
    parser = argparse.ArgumentParser(description="Celery fetch task smoke test")
    parser.add_argument("--source", default="binance", choices=["binance", "yahoo"])
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--timeframe", default="1h")
    parser.add_argument("--date-from", default="2024-01-01")
    parser.add_argument("--date-to", default="2024-01-31")
    parser.add_argument("--interval", type=float, default=1.5, help="poll interval seconds")
    args = parser.parse_args()

    result = fetch_market_data_task.apply_async(
        kwargs={
            "source": args.source,
            "symbol": args.symbol,
            "timeframe": args.timeframe,
            "date_from": args.date_from,
            "date_to": args.date_to,
        },
        queue="features",
    )

    print(f"Task queued: {result.id}")

    while not result.ready():
        result = fetch_market_data_task.AsyncResult(result.id)
        info = result.info if isinstance(result.info, dict) else {}
        pct = info.get("progress", 0)
        msg = info.get("message", result.state)
        print(f"[{result.state:>8}] {pct:>3}% | {msg}")
        time.sleep(args.interval)

    final = fetch_market_data_task.AsyncResult(result.id)
    print(f"\nFinal state: {final.state}")
    if final.successful():
        print(json.dumps(final.result, indent=2, default=str))
    else:
        print(final.result)


if __name__ == "__main__":
    main()
