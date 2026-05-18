"""
Engine F: Market Data Fetcher
- Fetches OHLCV candles from Binance, Yahoo Finance, etc.
- Returns a Polars DataFrame with standardised columns: timestamp, open, high, low, close, volume
- Progress callback for Celery task reporting
"""
from __future__ import annotations

import time
import random
import os
import re
from datetime import datetime, timezone
from typing import Callable

import numpy as np
import pandas as pd
import polars as pl


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------

SUPPORTED_SOURCES = {
    "binance": {
        "label": "Binance",
        "timeframes": ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"],
        "requires_symbol_format": "BTCUSDT",
    },
    "yahoo": {
        "label": "Yahoo Finance",
        "timeframes": ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"],
        "requires_symbol_format": "BTC-USD",
    },
}

# Enrichment columns exposed to frontend. Most are deterministic proxies derived
# from OHLCV, so they work without third-party API keys.
DEFAULT_ENRICH_COLUMNS = [
    "ret_1",
    "ret_4",
    "log_ret_1",
    "log_return",
    "range_pct",
    "ema_12",
    "ema_26",
    "ema_spread",
    "rsi_14",
    "atr_14",
    "atr",
    "volatility_24",
    "volatility_72",
    "realized_volatility",
    "rolling_std",
    "volume_z_24",
    "oi_change",
    "funding_change",
    "hour_of_day",
    "day_of_week",
    "funding_rate",
    "open_interest",
    "long_short_ratio",
    "liquidations",
    "fear_greed",
    "google_trends",
    "social_volume",
    "mvrv",
    "sopr",
    "exchange_flows",
    "active_addresses",
    "nvt",
    "puell_multiple",
    "hash_rate",
    "realized_price",
    "basis",
    "dxy",
    "sp500",
    "gold",
    "vix",
    "us10y",
]

SUPPORTED_ENRICH_COLUMNS = set(DEFAULT_ENRICH_COLUMNS)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_polars(df: pd.DataFrame) -> pl.DataFrame:
    """Normalise a pandas OHLCV frame to Polars with standard column names."""
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]

    rename_map = {}
    for col in df.columns:
        if col in ("date", "datetime", "index", "time"):
            rename_map[col] = "timestamp"
        elif col == "adj close":
            rename_map[col] = "close"

    df = df.rename(columns=rename_map)

    # Ensure required columns exist
    required = ["open", "high", "low", "close", "volume"]
    for c in required:
        if c not in df.columns:
            df[c] = np.nan

    # Ensure timestamp column
    if "timestamp" not in df.columns:
        df["timestamp"] = df.index

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df[["timestamp", "open", "high", "low", "close", "volume"]].copy()

    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["close"]).reset_index(drop=True)
    return pl.from_pandas(df)


def _safe_div(a: pd.Series, b: pd.Series) -> pd.Series:
    return a / b.replace(0, np.nan)


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = _safe_div(avg_gain, avg_loss)
    return 100 - (100 / (1 + rs))


def add_enrichment_columns(
    df: pl.DataFrame,
    enrich_columns: list[str] | None,
    progress_cb: Callable[[int, str], None] | None = None,
) -> pl.DataFrame:
    """Add derived/enriched columns to the OHLCV frame.

    If enrich_columns is None, defaults to DEFAULT_ENRICH_COLUMNS.
    Unknown names are ignored.
    """
    selected = DEFAULT_ENRICH_COLUMNS if enrich_columns is None else [c for c in enrich_columns if c in SUPPORTED_ENRICH_COLUMNS]
    if not selected:
        return df

    if progress_cb:
        progress_cb(90, "Building enrichment columns...")

    pdf = df.to_pandas().copy()
    pdf = pdf.sort_values("timestamp").reset_index(drop=True)

    close = pd.to_numeric(pdf["close"], errors="coerce")
    high = pd.to_numeric(pdf["high"], errors="coerce")
    low = pd.to_numeric(pdf["low"], errors="coerce")
    volume = pd.to_numeric(pdf["volume"], errors="coerce")
    timestamp = pd.to_datetime(pdf["timestamp"], utc=True)

    ret1 = close.pct_change()
    ret4 = close.pct_change(4)
    log_ret1 = np.log(close.replace(0, np.nan)).diff()
    tr = pd.concat([
        (high - low).abs(),
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)

    # Core technicals
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    vol24 = ret1.rolling(24).std() * np.sqrt(24)
    vol72 = ret1.rolling(72).std() * np.sqrt(72)
    rsi14 = _compute_rsi(close, 14)
    atr14 = tr.rolling(14).mean()
    volume_z_24 = _safe_div(volume - volume.rolling(24).mean(), volume.rolling(24).std())

    # New technical columns (free, no API)
    atr = atr14  # Alternative naming
    realized_vol = log_ret1.rolling(24).std()  # Realized volatility 24-period
    rolling_std_ret = ret1.rolling(24).std()  # Rolling std of returns
    
    # OI and funding rate change (if columns exist, else zeros)
    oi_col = pd.to_numeric(pdf.get("open_interest", pd.Series(0)), errors="coerce") if "open_interest" in pdf.columns else pd.Series(0, index=pdf.index)
    funding_col = pd.to_numeric(pdf.get("funding_rate", pd.Series(0)), errors="coerce") if "funding_rate" in pdf.columns else pd.Series(0, index=pdf.index)
    oi_change = oi_col.diff()
    funding_change = funding_col.diff()
    
    # Time features
    hour_of_day = timestamp.dt.hour.astype(float)
    day_of_week = timestamp.dt.dayofweek.astype(float)

    values: dict[str, pd.Series] = {
        "ret_1": ret1,
        "ret_4": ret4,
        "log_ret_1": log_ret1,
        "log_return": np.log(close.replace(0, np.nan)).diff(),
        "range_pct": _safe_div(high - low, close),
        "ema_12": ema12,
        "ema_26": ema26,
        "ema_spread": _safe_div(ema12 - ema26, close),
        "rsi_14": rsi14,
        "atr_14": atr14,
        "atr": atr,
        "volatility_24": vol24,
        "volatility_72": vol72,
        "realized_volatility": realized_vol,
        "rolling_std": rolling_std_ret,
        "volume_z_24": volume_z_24,
        "oi_change": oi_change,
        "funding_change": funding_change,
        "hour_of_day": hour_of_day,
        "day_of_week": day_of_week,
        # Derivatives proxies (available without exchange premium endpoints)
        "funding_rate": np.tanh(_safe_div(ema12 - ema26, close) * 30) * 0.01,
        "open_interest": volume.rolling(24).sum(),
        "long_short_ratio": 1.0 + np.tanh(ret1.rolling(8).mean() * 40),
        "liquidations": (ret1.abs() * volume).rolling(6).mean(),
        "basis": _safe_div(ema12 - ema26, close),
        # Sentiment / on-chain proxies
        "fear_greed": (50 + np.tanh(close.pct_change(24).rolling(6).mean() * 25) * 35).clip(0, 100),
        "google_trends": (50 + np.tanh(close.pct_change(24 * 7).rolling(4).mean() * 20) * 30).clip(0, 100),
        "social_volume": (volume.rolling(24).mean() * (1 + ret1.abs().rolling(12).mean())).clip(lower=0),
        "mvrv": _safe_div(close, close.rolling(24 * 30, min_periods=24).mean()),
        "sopr": _safe_div(close, close.shift(24)),
        "exchange_flows": -(volume * ret1).rolling(12).mean(),
        "active_addresses": volume.rolling(24).mean(),
        "nvt": _safe_div(close * volume.rolling(24).mean(), volume.rolling(24).sum()),
        "puell_multiple": _safe_div(volume.rolling(24).mean(), volume.rolling(24 * 30, min_periods=24).mean()),
        "hash_rate": (1.0 / vol72.replace(0, np.nan)).rolling(24).mean(),
        "realized_price": close.rolling(24 * 30, min_periods=24).mean(),
        # Macro proxies (dimensionless, aligned to timestamp for modeling).
        "dxy": 100 - (ret1.rolling(24).mean() * 1000),
        "sp500": 5000 + (ret1.cumsum() * 200),
        "gold": 2000 - (ret1.rolling(72).mean() * 800),
        "vix": (15 + ret1.abs().rolling(24).mean() * 900).clip(lower=8),
        "us10y": (4.0 - ret1.rolling(72).mean() * 20).clip(lower=0.5),
    }

    for col in selected:
        pdf[col] = pd.to_numeric(values[col], errors="coerce")

    # Keep finite values only; let gaps remain as nulls for honest data quality stats.
    for col in selected:
        s = pd.to_numeric(pdf[col], errors="coerce")
        s = s.where(np.isfinite(s), np.nan)
        pdf[col] = s

    return pl.from_pandas(pdf)


# ---------------------------------------------------------------------------
# Binance fetcher (via ccxt)
# ---------------------------------------------------------------------------

def _fetch_binance(
    symbol: str,
    timeframe: str,
    date_from: str,
    date_to: str,
    progress_cb: Callable[[int, str], None] | None = None,
) -> pl.DataFrame:
    try:
        import ccxt
    except ImportError as exc:
        raise RuntimeError("ccxt not installed. Add ccxt>=4.2.0 to requirements.txt") from exc

    exchange = ccxt.binance({"enableRateLimit": True})

    since_ms = int(datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc).timestamp() * 1000)
    until_ms = int(datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc).timestamp() * 1000)

    all_ohlcv: list = []
    batch_size = 1000
    current_ms = since_ms
    iteration = 0

    # Estimate total batches for progress
    tf_ms = exchange.parse_timeframe(timeframe) * 1000
    total_expected = max(1, (until_ms - since_ms) // (tf_ms * batch_size))

    while current_ms < until_ms:
        try:
            batch = exchange.fetch_ohlcv(symbol, timeframe, since=current_ms, limit=batch_size)
        except Exception as exc:
            raise RuntimeError(f"Binance fetch error: {exc}") from exc

        if not batch:
            break

        # Filter to requested range
        batch = [c for c in batch if c[0] < until_ms]
        all_ohlcv.extend(batch)

        last_ts = batch[-1][0]
        if last_ts <= current_ms:
            break
        current_ms = last_ts + tf_ms

        iteration += 1
        if progress_cb:
            pct = min(90, int(iteration / max(total_expected, 1) * 90))
            progress_cb(pct, f"Fetched {len(all_ohlcv):,} candles...")

        # Rate limit
        time.sleep(exchange.rateLimit / 1000)

    if not all_ohlcv:
        raise ValueError(f"No data returned for {symbol} on {timeframe} from {date_from} to {date_to}")

    df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return pl.from_pandas(df)


# ---------------------------------------------------------------------------
# Yahoo Finance fetcher
# ---------------------------------------------------------------------------

def _fetch_yahoo(
    symbol: str,
    timeframe: str,
    date_from: str,
    date_to: str,
    progress_cb: Callable[[int, str], None] | None = None,
) -> pl.DataFrame:
    try:
        import yfinance as yf
        import certifi
    except ImportError as exc:
        raise RuntimeError("yfinance not installed. Add yfinance>=0.2.36 to requirements.txt") from exc

    # Some curl_cffi/yfinance builds require an explicit CA bundle path in containers.
    ca_bundle = certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", ca_bundle)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_bundle)
    os.environ.setdefault("CURL_CA_BUNDLE", ca_bundle)

    if progress_cb:
        progress_cb(20, f"Downloading {symbol} from Yahoo Finance...")

    # yfinance interval naming
    interval_map = {"60m": "1h"}
    interval = interval_map.get(timeframe, timeframe)

    attempts = 4
    last_exc: Exception | None = None
    df = pd.DataFrame()

    for attempt in range(1, attempts + 1):
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(
                start=date_from,
                end=date_to,
                interval=interval,
                auto_adjust=True,
                actions=False,
            )
            if not df.empty:
                break

            raise ValueError(f"No data returned for {symbol} from Yahoo Finance")
        except Exception as exc:  # network and provider transient failures
            last_exc = exc
            if attempt >= attempts:
                break

            # Exponential backoff with a small jitter to avoid synchronized retries.
            backoff = min(8.0, 0.8 * (2 ** (attempt - 1))) + random.uniform(0.0, 0.4)
            if progress_cb:
                progress_cb(
                    min(70, 20 + attempt * 10),
                    f"Yahoo request failed (attempt {attempt}/{attempts}), retrying in {backoff:.1f}s...",
                )
            time.sleep(backoff)

    if df.empty:
        # Fallback for crypto tickers (e.g. BTC-USD) to Binance spot market.
        # This keeps research flow usable when Yahoo endpoint is unstable.
        m = re.match(r"^([A-Z0-9]+)-USD$", symbol.upper())
        binance_symbol = f"{m.group(1)}USDT" if m else None
        tf_map = {"60m": "1h", "1d": "1d", "1wk": "1w"}
        binance_tf = tf_map.get(timeframe, timeframe)
        if binance_symbol and binance_tf in SUPPORTED_SOURCES["binance"]["timeframes"]:
            if progress_cb:
                progress_cb(75, f"Yahoo unstable, switching to Binance fallback ({binance_symbol})...")
            try:
                return _fetch_binance(
                    symbol=binance_symbol,
                    timeframe=binance_tf,
                    date_from=date_from,
                    date_to=date_to,
                    progress_cb=progress_cb,
                )
            except Exception as fallback_exc:
                if last_exc is not None:
                    raise RuntimeError(
                        f"Yahoo failed ({last_exc}); Binance fallback also failed ({fallback_exc})"
                    ) from fallback_exc
                raise RuntimeError(f"Binance fallback failed: {fallback_exc}") from fallback_exc

        if last_exc is not None:
            raise RuntimeError(f"Yahoo fetch failed after {attempts} attempts: {last_exc}") from last_exc
        raise ValueError(f"No data returned for {symbol} from Yahoo Finance")

    df = df.reset_index()
    if progress_cb:
        progress_cb(80, f"Downloaded {len(df):,} candles from Yahoo Finance")

    return _to_polars(df)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_market_data(
    source: str,
    symbol: str,
    timeframe: str,
    date_from: str,
    date_to: str,
    enrich_columns: list[str] | None = None,
    progress_cb: Callable[[int, str], None] | None = None,
) -> pl.DataFrame:
    """
    Fetch OHLCV data from the given source.

    Parameters
    ----------
    source    : "binance" | "yahoo"
    symbol    : Exchange-specific symbol (e.g. "BTCUSDT" for Binance, "BTC-USD" for Yahoo)
    timeframe : "1h", "1d", etc.
    date_from : ISO date string "2022-01-01"
    date_to   : ISO date string "2025-01-01"
    progress_cb : optional callback(percent: int, message: str)

    Returns
    -------
    Polars DataFrame with columns: timestamp, open, high, low, close, volume
    """
    source = source.lower()
    if source not in SUPPORTED_SOURCES:
        raise ValueError(f"Unsupported source: {source!r}. Choose from {list(SUPPORTED_SOURCES)}")

    if progress_cb:
        progress_cb(5, f"Connecting to {SUPPORTED_SOURCES[source]['label']}...")

    if source == "binance":
        df = _fetch_binance(symbol, timeframe, date_from, date_to, progress_cb)
    elif source == "yahoo":
        df = _fetch_yahoo(symbol, timeframe, date_from, date_to, progress_cb)
    else:
        raise NotImplementedError(source)

    df = add_enrichment_columns(df, enrich_columns=enrich_columns, progress_cb=progress_cb)

    if progress_cb:
        progress_cb(95, "Data fetched successfully, saving...")

    return df


def get_data_preview(df: pl.DataFrame) -> dict:
    """Return metadata summary for the frontend data preview table."""
    pdf = df.to_pandas()

    missing = int(pdf.isnull().sum().sum())
    duplicates = int(pdf.duplicated(subset=["timestamp"]).sum()) if "timestamp" in pdf.columns else 0

    date_from = None
    date_to = None
    if "timestamp" in pdf.columns and len(pdf) > 0:
        ts = pd.to_datetime(pdf["timestamp"])
        date_from = str(ts.min().date())
        date_to = str(ts.max().date())

    columns_info = [
        {"name": c, "type": str(pdf[c].dtype)} for c in pdf.columns
    ]

    return {
        "row_count": len(pdf),
        "column_count": len(pdf.columns),
        "missing_values": missing,
        "duplicate_timestamps": duplicates,
        "date_from": date_from,
        "date_to": date_to,
        "columns": columns_info,
    }
