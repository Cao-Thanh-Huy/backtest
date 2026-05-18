"""
Engine A: Feature Generator
- Loads raw Parquet from MinIO via Polars
- Dynamically applies indicator functions (RSI, MACD, Bollinger Bands, etc.)
- Supports parameter sweep: auto-generates columns for all param combos (e.g. rsi_6, rsi_8, rsi_10...)
- Generates lag columns
Engine B: Target Generator
- n_bar forward returns (regression/classification)
- Triple-barrier labelling (Numba JIT accelerated)
- Drops trailing NaN rows to prevent look-ahead leakage
"""
from __future__ import annotations

import io
import warnings
import itertools
from typing import Any, Callable

import numba
import gc

import numpy as np
import pandas as pd
import polars as pl

warnings.filterwarnings("ignore")

# ── Memory guardrails ──────────────────────────────────────────────────────────
# Feature Factory (pipeline generation) — hard cap on total output columns.
# Reduces to prevent OOM when param_sweep generates large column sets.
# NOTE: this is SEPARATE from Feature Selection page (/lab/features) which runs
# VIF/Spearman/MI/LightGBM on an already-compiled pipeline.
MAX_ENGINE_A_OUTPUT_COLUMNS = 1000
ENGINE_A_FAMILY_WINDOW_ROWS = 50_000


def _estimate_indicator_lookback(name: str, params: dict[str, Any]) -> int:
    """Best-effort lookback estimate for overlap when processing by windows."""
    name = name.lower()

    def _int_param(key: str, default: int) -> int:
        try:
            return max(int(params.get(key, default)), 1)
        except (TypeError, ValueError):
            return default

    if name in {"rsi", "atr", "adx", "sma", "rolling_std", "returns", "log_return", "oi_change"}:
        length = _int_param("length", 14)
        # Add small buffer to absorb edge effects.
        return length + 4

    if name in {"skew", "kurtosis", "autocorr", "funding_zscore"}:
        length = _int_param("length", 50)
        return length + 8

    if name == "macd":
        fast = _int_param("fast", 12)
        slow = _int_param("slow", 26)
        signal = _int_param("signal", 9)
        return max(fast, slow) + signal + 16

    if name == "bbands":
        return _int_param("length", 20) + 8

    if name == "stoch":
        return _int_param("k", 14) + _int_param("d", 3) + 8

    if name in {"ema", "oi_momentum"}:
        # EWM technically has unbounded memory; finite overlap is a practical approximation.
        return _int_param("length", _int_param("span", 21)) * 6

    if name in {"ema_distance", "ema_compression", "trend_regime"}:
        fast = _int_param("fast", 20)
        slow = _int_param("slow", 50)
        atr_length = _int_param("atr_length", 14)
        return max(fast, slow, atr_length) * 6

    if name == "volatility_regime":
        length = _int_param("length", 20)
        z_window = _int_param("z_window", 100)
        return max(length, z_window) + 16

    # Features with mostly point-in-time arithmetic or internal fallback heuristics.
    return 16


def _is_cumulative_indicator(name: str) -> bool:
    return name.lower() in {"obv", "cvd"}


def _apply_indicator_windowed(
    df: pd.DataFrame,
    name: str,
    params: dict[str, Any],
    window_rows: int,
) -> list[str]:
    """
    Apply one indicator in time windows to reduce peak memory.

    Uses overlap based on estimated lookback, then writes only the active window
    back to the full dataframe.
    """
    total_rows = len(df)
    if total_rows == 0 or total_rows <= max(window_rows, 1):
        return _apply_indicator(df, name, params)

    overlap = max(_estimate_indicator_lookback(name, params), 8)
    generated_order: list[str] = []
    generated_seen: set[str] = set()

    for win_start in range(0, total_rows, window_rows):
        win_end = min(win_start + window_rows, total_rows)
        ctx_start = max(0, win_start - overlap)
        ctx_end = win_end

        # Window-local compute to bound temporary arrays.
        window_df = df.iloc[ctx_start:ctx_end].copy()
        new_cols = _apply_indicator(window_df, name, params)

        local_start = win_start - ctx_start
        local_end = local_start + (win_end - win_start)

        for col in new_cols:
            if col not in generated_seen:
                generated_seen.add(col)
                generated_order.append(col)

            if col not in df.columns:
                df[col] = np.nan

            chunk_values = window_df[col].iloc[local_start:local_end].to_numpy(copy=False)

            if _is_cumulative_indicator(name) and win_start > 0 and local_start > 0:
                prev_global = df[col].iloc[win_start - 1]
                prev_local = window_df[col].iloc[local_start - 1]
                if pd.notna(prev_global) and pd.notna(prev_local):
                    chunk_values = chunk_values + (prev_global - prev_local)

            df.iloc[win_start:win_end, df.columns.get_loc(col)] = chunk_values

        # Free window slice after each chunk to reduce peak RSS
        del window_df

    return generated_order


# =============================================================================
# Indicator Implementations (replacing pandas-ta)
# =============================================================================


# =============================================================================
# ENGINE A — Feature Generator
# =============================================================================

def _rsi(close: np.ndarray, length: int = 14) -> np.ndarray:
    """Calculate RSI using Wilder's Smoothed Moving Average (alpha = 1/length)."""
    delta = np.diff(close)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    alpha = 1.0 / length
    avg_gain = pd.Series(gain).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values
    avg_loss = pd.Series(loss).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values
    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return np.concatenate([[np.nan], rsi])


def _macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple:
    """Calculate MACD, Signal, Histogram."""
    ema_fast = pd.Series(close).ewm(span=fast).mean().values
    ema_slow = pd.Series(close).ewm(span=slow).mean().values
    macd_line = ema_fast - ema_slow
    signal_line = pd.Series(macd_line).ewm(span=signal).mean().values
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def _bbands(close: np.ndarray, length: int = 20, std: float = 2.0) -> tuple:
    """Calculate Bollinger Bands."""
    sma = pd.Series(close).rolling(length).mean().values
    std_dev = pd.Series(close).rolling(length).std().values
    upper = sma + (std * std_dev)
    lower = sma - (std * std_dev)
    return upper, sma, lower


def _adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, length: int = 14) -> np.ndarray:
    """Calculate ADX using Wilder's smoothing (+DI, -DI, DX, ADX)."""
    alpha = 1.0 / length
    up_move = high[1:] - high[:-1]
    down_move = low[:-1] - low[1:]
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr = np.maximum(
        high[1:] - low[1:],
        np.maximum(np.abs(high[1:] - close[:-1]), np.abs(low[1:] - close[:-1])),
    )
    atr = pd.Series(tr).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values
    plus_di = 100.0 * pd.Series(plus_dm).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values / (atr + 1e-10)
    minus_di = 100.0 * pd.Series(minus_dm).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values / (atr + 1e-10)
    dx = 100.0 * np.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    adx = pd.Series(dx).ewm(alpha=alpha, min_periods=length, adjust=False).mean().values
    return np.concatenate([[np.nan], adx])


def _pick_first_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _rolling_autocorr(series: pd.Series, window: int, lag: int) -> pd.Series:
    def _ac(x: pd.Series) -> float:
        if len(x) <= lag:
            return np.nan
        a = x.iloc[:-lag].values
        b = x.iloc[lag:].values
        if len(a) < 3:
            return np.nan
        return float(np.corrcoef(a, b)[0, 1])

    return series.rolling(window).apply(_ac, raw=False)


def _build_param_combos(name: str, params: dict, sweep: dict) -> list[dict]:
    """
    Build a list of param dicts from fixed params + optional sweep ranges.

    Sweep format: {"length": {"min": 6, "max": 30, "step": 2}}
    """
    if not sweep:
        return [params]

    sweep_keys = list(sweep.keys())
    ranges = []
    for k in sweep_keys:
        cfg = sweep[k]
        lo = cfg.get("min", 1)
        hi = cfg.get("max", lo)
        step = cfg.get("step", 1)
        # For float params (std, etc.) use np.arange; otherwise use int range
        if isinstance(lo, float) or isinstance(hi, float) or isinstance(step, float):
            vals = [round(v, 4) for v in np.arange(lo, hi + step * 0.001, step)][:50]
        else:
            vals = list(range(int(lo), int(hi) + 1, max(int(step), 1)))[:50]
        ranges.append(vals)

    combos = []
    for combo_vals in itertools.product(*ranges):
        combo = dict(params)  # start from fixed params
        for k, v in zip(sweep_keys, combo_vals):
            combo[k] = v
        combos.append(combo)

    return combos if combos else [params]


def _apply_indicator(df: pd.DataFrame, name: str, params: dict) -> list[str]:
    """Apply a single indicator with given params. Returns list of new column names."""
    new_cols: list[str] = []

    if name == "rsi":
        length = int(params.get("length", 14))
        col = f"rsi_{length}"
        df[col] = _rsi(df["close"].values, length)
        new_cols.append(col)

    elif name == "macd":
        fast = int(params.get("fast", 12))
        slow = int(params.get("slow", 26))
        signal = int(params.get("signal", 9))
        macd_line, signal_line, hist = _macd(df["close"].values, fast, slow, signal)
        slope = pd.Series(macd_line).diff().values
        accel = pd.Series(slope).diff().values
        df[f"macd_{fast}_{slow}"] = macd_line
        df[f"macd_signal_{fast}_{slow}_{signal}"] = signal_line
        df[f"macd_hist_{fast}_{slow}_{signal}"] = hist
        df[f"macd_slope_{fast}_{slow}_{signal}"] = slope
        df[f"macd_accel_{fast}_{slow}_{signal}"] = accel
        new_cols.extend([
            f"macd_{fast}_{slow}",
            f"macd_signal_{fast}_{slow}_{signal}",
            f"macd_hist_{fast}_{slow}_{signal}",
            f"macd_slope_{fast}_{slow}_{signal}",
            f"macd_accel_{fast}_{slow}_{signal}",
        ])

    elif name == "bbands":
        length = int(params.get("length", 20))
        std = float(params.get("std", 2.0))
        std_str = str(std).replace(".", "_")
        upper, mid, lower = _bbands(df["close"].values, length, std)
        df[f"bb_upper_{length}_{std_str}"] = upper
        df[f"bb_mid_{length}"] = mid
        df[f"bb_lower_{length}_{std_str}"] = lower
        df[f"bb_width_{length}_{std_str}"] = upper - lower
        new_cols.extend([f"bb_upper_{length}_{std_str}", f"bb_mid_{length}", f"bb_lower_{length}_{std_str}", f"bb_width_{length}_{std_str}"])

    elif name == "ema":
        span = int(params.get("length", params.get("span", 21)))
        col = f"ema_{span}"
        df[col] = df["close"].ewm(span=span).mean()
        new_cols.append(col)

    elif name == "sma":
        length = int(params.get("length", 50))
        col = f"sma_{length}"
        df[col] = df["close"].rolling(length).mean()
        new_cols.append(col)

    elif name == "atr":
        length = int(params.get("length", 14))
        high = df.get("high", df["close"])
        low = df.get("low", df["close"])
        tr = np.maximum(
            high - low,
            np.maximum(abs(high - df["close"].shift()), abs(low - df["close"].shift())),
        )
        col = f"atr_{length}"
        df[col] = pd.Series(tr).rolling(length).mean()
        new_cols.append(col)

    elif name == "stoch":
        k = int(params.get("k", 14))
        d = int(params.get("d", 3))
        high = df.get("high", df["close"])
        low = df.get("low", df["close"])
        lowest_low = low.rolling(k).min()
        highest_high = high.rolling(k).max()
        stoch_k = 100 * (df["close"] - lowest_low) / (highest_high - lowest_low + 1e-10)
        stoch_d = stoch_k.rolling(d).mean()
        df[f"stoch_k_{k}"] = stoch_k
        df[f"stoch_d_{k}_{d}"] = stoch_d
        new_cols.extend([f"stoch_k_{k}", f"stoch_d_{k}_{d}"])

    elif name == "adx":
        length = int(params.get("length", 14))
        high = df.get("high", df["close"]).values
        low = df.get("low", df["close"]).values
        close = df["close"].values
        col = f"adx_{length}"
        df[col] = _adx(high, low, close, length)
        new_cols.append(col)

    elif name == "roc":
        length = int(params.get("length", 10))
        col = f"roc_{length}"
        df[col] = df["close"].pct_change(length)
        new_cols.append(col)

    elif name == "returns":
        length = int(params.get("length", 1))
        col = f"returns_{length}"
        df[col] = df["close"].pct_change(length)
        new_cols.append(col)

    elif name == "log_return":
        length = int(params.get("length", 1))
        col = f"log_return_{length}"
        df[col] = np.log(df["close"] / df["close"].shift(length))
        new_cols.append(col)

    elif name == "rolling_std":
        length = int(params.get("length", 20))
        col = f"rolling_std_{length}"
        df[col] = df["close"].pct_change().rolling(length).std()
        new_cols.append(col)

    elif name == "zscore":
        length = int(params.get("length", 20))
        source = str(params.get("source", "close")).lower()
        series = df.get(source)
        if series is None:
            raise ValueError(f"zscore source column missing: {source}")
        mu = series.rolling(length).mean()
        sd = series.rolling(length).std()
        col = f"zscore_{source}_{length}"
        df[col] = (series - mu) / (sd + 1e-10)
        new_cols.append(col)

    elif name == "skew":
        length = int(params.get("length", 50))
        col = f"skew_{length}"
        df[col] = df["close"].pct_change().rolling(length).skew()
        new_cols.append(col)

    elif name == "kurtosis":
        length = int(params.get("length", 50))
        col = f"kurtosis_{length}"
        df[col] = df["close"].pct_change().rolling(length).kurt()
        new_cols.append(col)

    elif name == "autocorr":
        length = int(params.get("length", 50))
        lag = int(params.get("lag", 1))
        col = f"autocorr_{length}_{lag}"
        rets = df["close"].pct_change()
        df[col] = _rolling_autocorr(rets, length, lag)
        new_cols.append(col)

    elif name == "vwap":
        length = int(params.get("length", 20))
        typ = (df["high"] + df["low"] + df["close"]) / 3.0 if "high" in df.columns and "low" in df.columns else df["close"]
        vol = df.get("volume", pd.Series(np.ones(len(df)), index=df.index))
        pv = typ * vol
        col = f"vwap_{length}"
        df[col] = pv.rolling(length).sum() / (vol.rolling(length).sum() + 1e-10)
        new_cols.append(col)

    elif name == "obv":
        vol = df.get("volume", pd.Series(np.zeros(len(df)), index=df.index))
        direction = np.sign(df["close"].diff().fillna(0.0))
        col = "obv"
        df[col] = (direction * vol).cumsum()
        new_cols.append(col)

    elif name == "ema_distance":
        fast = int(params.get("fast", 20))
        slow = int(params.get("slow", 50))
        if fast >= slow:
            raise ValueError("ema_distance requires fast < slow")
        ema_fast = df["close"].ewm(span=fast).mean()
        ema_slow = df["close"].ewm(span=slow).mean()
        col = f"ema_distance_{fast}_{slow}"
        df[col] = (ema_fast - ema_slow) / (df["close"] + 1e-10)
        new_cols.append(col)

    elif name == "ema_compression":
        fast = int(params.get("fast", 20))
        slow = int(params.get("slow", 50))
        atr_length = int(params.get("atr_length", 14))
        if fast >= slow:
            raise ValueError("ema_compression requires fast < slow")
        ema_fast = df["close"].ewm(span=fast).mean()
        ema_slow = df["close"].ewm(span=slow).mean()
        high = df.get("high", df["close"])
        low = df.get("low", df["close"])
        tr = np.maximum(
            high - low,
            np.maximum(abs(high - df["close"].shift()), abs(low - df["close"].shift())),
        )
        atr = pd.Series(tr).rolling(atr_length).mean()
        col = f"ema_compression_{fast}_{slow}_{atr_length}"
        df[col] = np.abs(ema_fast - ema_slow) / (atr + 1e-10)
        new_cols.append(col)

    elif name == "trend_regime":
        fast = int(params.get("fast", 50))
        slow = int(params.get("slow", 200))
        if fast >= slow:
            raise ValueError("trend_regime requires fast < slow")
        ema_fast = df["close"].ewm(span=fast).mean()
        ema_slow = df["close"].ewm(span=slow).mean()
        col = f"trend_regime_{fast}_{slow}"
        df[col] = (ema_fast > ema_slow).astype(float)
        new_cols.append(col)

    elif name == "volatility_regime":
        length = int(params.get("length", 20))
        z_window = int(params.get("z_window", 100))
        threshold = float(params.get("threshold", 1.0))
        vol = df["close"].pct_change().rolling(length).std()
        vol_mu = vol.rolling(z_window).mean()
        vol_sd = vol.rolling(z_window).std()
        vol_z = (vol - vol_mu) / (vol_sd + 1e-10)
        col = f"vol_regime_{length}_{z_window}"
        df[col] = (vol_z > threshold).astype(float)
        new_cols.append(col)

    elif name == "funding_zscore":
        length = int(params.get("length", 50))
        funding_col = _pick_first_column(df, ["funding_rate", "funding", "fundingrate"])
        if funding_col is None:
            raise ValueError("funding_zscore requires a funding_rate column")
        s = df[funding_col]
        col = f"funding_zscore_{length}"
        df[col] = (s - s.rolling(length).mean()) / (s.rolling(length).std() + 1e-10)
        new_cols.append(col)

    elif name == "oi_change":
        length = int(params.get("length", 1))
        oi_col = _pick_first_column(df, ["open_interest", "oi"])
        if oi_col is None:
            raise ValueError("oi_change requires an open_interest/oi column")
        col = f"oi_change_{length}"
        df[col] = df[oi_col].pct_change(length)
        new_cols.append(col)

    elif name == "oi_momentum":
        length = int(params.get("length", 12))
        oi_col = _pick_first_column(df, ["open_interest", "oi"])
        if oi_col is None:
            raise ValueError("oi_momentum requires an open_interest/oi column")
        oi_delta = df[oi_col].pct_change().fillna(0.0)
        col = f"oi_momentum_{length}"
        df[col] = oi_delta.ewm(span=length).mean()
        new_cols.append(col)

    elif name == "basis_spread":
        fut_col = _pick_first_column(df, ["futures_price", "perp_price", "mark_price"])
        spot_col = _pick_first_column(df, ["spot_price", "index_price", "close"])
        if fut_col is None:
            raise ValueError("basis_spread requires futures_price/perp_price/mark_price column")
        if spot_col is None:
            raise ValueError("basis_spread requires spot_price/index_price/close column")
        col = "basis_spread"
        df[col] = df[fut_col] - df[spot_col]
        new_cols.append(col)

    elif name == "liquidation_imbalance":
        long_col = _pick_first_column(df, ["liq_long", "long_liquidation", "liquidation_long"])
        short_col = _pick_first_column(df, ["liq_short", "short_liquidation", "liquidation_short"])
        if long_col is None or short_col is None:
            raise ValueError("liquidation_imbalance requires long and short liquidation columns")
        col = "liquidation_imbalance"
        num = df[long_col] - df[short_col]
        den = df[long_col] + df[short_col] + 1e-10
        df[col] = num / den
        new_cols.append(col)

    elif name == "bid_ask_imbalance":
        bid_col = _pick_first_column(df, ["bid_volume", "bid_size", "bids_volume"])
        ask_col = _pick_first_column(df, ["ask_volume", "ask_size", "asks_volume"])
        if bid_col is None or ask_col is None:
            raise ValueError("bid_ask_imbalance requires bid and ask volume columns")
        col = "bid_ask_imbalance"
        num = df[bid_col] - df[ask_col]
        den = df[bid_col] + df[ask_col] + 1e-10
        df[col] = num / den
        new_cols.append(col)

    elif name == "delta_volume":
        buy_col = _pick_first_column(df, ["buy_volume", "taker_buy_volume", "taker_buy_base_volume"])
        sell_col = _pick_first_column(df, ["sell_volume", "taker_sell_volume"])
        sell_series: pd.Series | None = None
        if sell_col is None and "volume" in df.columns and "taker_buy_base_volume" in df.columns:
            buy_col = "taker_buy_base_volume"
            sell_series = (df["volume"] - df["taker_buy_base_volume"]).clip(lower=0)
        if buy_col is None or (sell_col is None and sell_series is None):
            raise ValueError("delta_volume requires buy and sell volume columns")
        col = "delta_volume"
        sell = sell_series if sell_series is not None else df[sell_col]
        df[col] = df[buy_col] - sell
        new_cols.append(col)

    elif name == "cvd":
        if "delta_volume" in df.columns:
            delta = df["delta_volume"]
        else:
            buy_col = _pick_first_column(df, ["buy_volume", "taker_buy_volume", "taker_buy_base_volume"])
            sell_col = _pick_first_column(df, ["sell_volume", "taker_sell_volume"])
            sell_series: pd.Series | None = None
            if sell_col is None and "volume" in df.columns and "taker_buy_base_volume" in df.columns:
                buy_col = "taker_buy_base_volume"
                sell_series = (df["volume"] - df["taker_buy_base_volume"]).clip(lower=0)
            if buy_col is None or (sell_col is None and sell_series is None):
                raise ValueError("cvd requires buy and sell volume columns or delta_volume")
            sell = sell_series if sell_series is not None else df[sell_col]
            delta = df[buy_col] - sell
        col = "cvd"
        df[col] = delta.cumsum()
        new_cols.append(col)

    else:
        print(f"[FeatureEngine] Warning: unknown indicator {name!r}, skipping")

    return new_cols


def generate_features(
    df_raw: pl.DataFrame,
    indicators: list[dict[str, Any]],
    lags: list[int],
    progress_cb: Callable[[int, str, dict], None] | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Apply indicators dynamically and create lag features.

    Parameters
    ----------
    df_raw      : Polars DataFrame with OHLCV columns
    indicators  : list of {"name": "rsi", "params": {"length": 14}} or
                        {"name": "rsi", "params_sweep": {"length": {"min": 6, "max": 30, "step": 2}}}
    lags        : list of lag periods, e.g. [1, 2, 3]
    progress_cb : optional callback(percent, message, sub_counts) for granular progress

    Returns
    -------
    (pandas DataFrame with original columns + indicator columns + lag columns, generated feature names)
    """
    # Convert to pandas
    df = df_raw.to_pandas()
    df.columns = [c.lower() for c in df.columns]


    # --- Batch by indicator family ---
    from collections import defaultdict
    family_map: dict[str, list[dict]] = defaultdict(list)
    for ind in indicators:
        family_map[ind["name"].lower()].append(ind)

    generated_cols: list[str] = []
    generated_seen: set[str] = set()
    families = list(family_map.keys())
    total_families = len(families)
    for fam_idx, family in enumerate(families):
        inds = family_map[family]
        # Flatten all param combos for this family
        param_combos = []
        for ind in inds:
            params = ind.get("params", {})
            sweep = ind.get("params_sweep", {})
            param_combos.extend(_build_param_combos(family, params, sweep))

        # ── Early column budget check (before generating this family) ──────────
        # Estimate how many new columns this family will add (width × combos)
        _FAMILY_WIDTHS = {"macd": 5, "bbands": 4, "stoch": 2}
        estimated_new = len(param_combos) * _FAMILY_WIDTHS.get(family, 1)
        projected_base = len(generated_cols) + estimated_new
        projected_total = projected_base * (1 + len(lags))
        if projected_total > MAX_ENGINE_A_OUTPUT_COLUMNS:
            raise ValueError(
                f"[FeatureEngine] Column budget exceeded before generating '{family}': "
                f"projected {projected_total} total columns (base {projected_base} × {1 + len(lags)} lag multiplier) "
                f"exceeds hard limit {MAX_ENGINE_A_OUTPUT_COLUMNS}. "
                "Disable some generators or narrow sweep ranges."
            )
        # ──────────────────────────────────────────────────────────────────────

        for combo_idx, combo in enumerate(param_combos):
            try:
                new_cols = _apply_indicator_windowed(
                    df,
                    family,
                    combo,
                    ENGINE_A_FAMILY_WINDOW_ROWS,
                )
                for col in new_cols:
                    if col in df.columns and col not in generated_seen:
                        generated_seen.add(col)
                        generated_cols.append(col)
            except Exception as exc:
                print(f"[FeatureEngine] Warning: indicator {family!r} params={combo} failed — {exc}")
                continue

            if progress_cb:
                pct = int((fam_idx / total_families) * 80) + int((combo_idx / max(len(param_combos), 1)) * (80 // max(total_families, 1)))
                pct = min(pct, 80)
                progress_cb(pct, f"Generating {family.upper()} variant {combo_idx+1}/{len(param_combos)}", {
                    "indicator": family.upper(),
                    "done": combo_idx + 1,
                    "total": len(param_combos),
                })

        # Free unreferenced objects after each indicator family
        gc.collect()

    # ---------- Lag features ----------
    # Final safety check (should be caught earlier per-family, but kept as backstop)
    estimated_total_cols = len(generated_cols) * (1 + len(lags))
    if estimated_total_cols > MAX_ENGINE_A_OUTPUT_COLUMNS:
        raise ValueError(
            "[FeatureEngine] Feature explosion detected: "
            f"{estimated_total_cols} total columns ({len(generated_cols)} base × {1 + len(lags)} lag multiplier) "
            f"exceeds hard limit {MAX_ENGINE_A_OUTPUT_COLUMNS}. "
            "Disable some generators or narrow sweep ranges."
        )

    lag_base_cols = generated_cols.copy()
    for col in lag_base_cols:
        if col in df.columns:
            for lag in lags:
                lag_col = f"{col}_lag{lag}"
                if lag_col in df.columns:
                    continue
                df[lag_col] = df[col].shift(lag)
                generated_cols.append(lag_col)

    return df, generated_cols


# =============================================================================
# ENGINE B — Target Generator
# =============================================================================

def generate_target_nbar(
    df: pd.DataFrame,
    name: str,
    shift: int,
    target_type: str = "regression",
    bins: list[float] | None = None,
) -> pd.DataFrame:
    """
    N-bar forward return target.
    target_type: "regression" → raw return, "classification" → binned labels.
    """
    close = df["close"]
    fwd_return = (close.shift(-shift) / close) - 1.0
    df[name] = fwd_return

    if target_type == "classification":
        _bins = bins or [-np.inf, -0.005, 0.005, np.inf]
        df[name] = pd.cut(fwd_return, bins=_bins, labels=[-1, 0, 1]).astype(float)

    return df


def generate_target_triple_barrier(
    df: pd.DataFrame,
    name: str,
    max_bars: int,
    mode: str = "fixed",  # "fixed", "atr", "volatility"
    tp_val: float = 0.05, # percentage if fixed, multiplier if atr/vol
    sl_val: float = 0.02,
) -> pd.DataFrame:
    """
    Triple-barrier labelling using Numba JIT.
    Labels: +1 (TP hit), -1 (SL hit), 0 (time expiry).
    Supports fixed percentage, ATR-based, or Volatility-based barriers.
    """
    close_arr = df["close"].values.astype(np.float64)
    n = len(close_arr)
    
    tp_arr = np.zeros(n, dtype=np.float64)
    sl_arr = np.zeros(n, dtype=np.float64)

    if mode == "fixed":
        tp_arr[:] = tp_val
        sl_arr[:] = sl_val
    elif mode == "atr":
        # Compute ATR (length=14 by default for targets)
        high = df.get("high", df["close"])
        low = df.get("low", df["close"])
        tr = np.maximum(
            high - low,
            np.maximum(abs(high - df["close"].shift()), abs(low - df["close"].shift())),
        )
        atr = pd.Series(tr).rolling(14).mean().values
        # tp/sl arrays as percentages of close
        tp_arr = (atr * tp_val) / (close_arr + 1e-10)
        sl_arr = (atr * sl_val) / (close_arr + 1e-10)
    elif mode == "volatility":
        # Rolling volatility of returns (length=20 by default)
        vol = df["close"].pct_change().rolling(20).std().values
        tp_arr = vol * tp_val
        sl_arr = vol * sl_val
    else:
        tp_arr[:] = tp_val
        sl_arr[:] = sl_val

    # Replace NaNs with 0 to avoid numba issues
    tp_arr = np.nan_to_num(tp_arr, nan=0.0)
    sl_arr = np.nan_to_num(sl_arr, nan=0.0)

    labels = _triple_barrier_numba(close_arr, tp_arr, sl_arr, max_bars)
    df[name] = labels
    return df


@numba.njit(cache=True)
def _triple_barrier_numba(
    close: np.ndarray,
    tp_arr: np.ndarray,
    sl_arr: np.ndarray,
    max_bars: int,
) -> np.ndarray:
    """
    JIT-compiled triple-barrier loop with dynamic arrays.
    For each bar i, scans forward up to max_bars bars to find first barrier touch.
    """
    n = len(close)
    labels = np.zeros(n, dtype=numba.float64)

    for i in range(n - max_bars):
        entry_price = close[i]
        tp = tp_arr[i]
        sl = sl_arr[i]
        
        # If ATR/Vol is zero (e.g. at start), we can't label
        if tp <= 0 or sl <= 0:
            labels[i] = np.nan
            continue

        tp_price = entry_price * (1.0 + tp)
        sl_price = entry_price * (1.0 - sl)

        label = 0.0
        for j in range(i + 1, min(i + max_bars + 1, n)):
            c = close[j]
            if c >= tp_price:
                label = 1.0
                break
            if c <= sl_price:
                label = -1.0
                break
        labels[i] = label

    # Last max_bars rows get NaN (will be dropped)
    for i in range(n - max_bars, n):
        labels[i] = np.nan

    return labels


def generate_targets(df: pd.DataFrame, targets: list[dict[str, Any]]) -> tuple[pd.DataFrame, list[str]]:
    """Apply all target configs and return df + target column names."""
    target_names: list[str] = []

    for t in targets:
        name = t["name"]
        method = t["method"]
        params = t.get("params", {})

        if method == "n_bar":
            df = generate_target_nbar(
                df,
                name=name,
                shift=params.get("shift", 1),
                target_type=params.get("type", "regression"),
                bins=params.get("bins"),
            )
        elif method == "triple_barrier":
            df = generate_target_triple_barrier(
                df,
                name=name,
                max_bars=params.get("max_bars", 5),
                mode=params.get("mode", "fixed"),
                tp_val=params.get("tp", 0.05),
                sl_val=params.get("sl", 0.02),
            )
        else:
            raise ValueError(f"Unknown target method: {method!r}")

        target_names.append(name)

    # CRITICAL UPDATE: Do not dropna here! Dropping rows permanently shrinks the dataset
    # preventing researchers from training on short-horizon labels if a long-horizon label exists.
    # df = df.dropna(subset=target_names).reset_index(drop=True)
    return df, target_names
