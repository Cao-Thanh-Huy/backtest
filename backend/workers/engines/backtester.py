"""
Engine E: VectorBT Backtester
- Maps AI probabilities/predictions to entry/exit signals
- Runs vectorbt portfolio simulation
- Computes Sharpe, Max Drawdown, Winrate, Total Return
- Returns equity curve + trade signals for frontend charts
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Timeframe helpers
# ---------------------------------------------------------------------------

def _infer_bars_per_year(index) -> float:
    """Infer annualization factor (bars per year) from a datetime index.
    Works for any bar size (daily, hourly, 4h, 15m, …).
    """
    try:
        if len(index) >= 2:
            total_seconds = (index[-1] - index[0]).total_seconds()
            freq_seconds = total_seconds / max(len(index) - 1, 1)
            if freq_seconds > 0:
                return 86400.0 * 365.25 / freq_seconds
    except Exception:
        pass
    return 252.0  # fallback: assume daily


def _infer_vbt_freq(index) -> str:
    """Infer a VectorBT-compatible pandas offset alias from a datetime index."""
    try:
        if len(index) >= 3:
            freq = pd.infer_freq(index[:50])
            if freq is not None:
                return freq
        if len(index) >= 2:
            delta = int((index[1] - index[0]).total_seconds())
            mapping = {86400: "1D", 3600: "1h", 14400: "4h", 900: "15min", 60: "1min"}
            if delta in mapping:
                return mapping[delta]
    except Exception:
        pass
    return "1D"


# ---------------------------------------------------------------------------
# Rich metrics helpers
# ---------------------------------------------------------------------------

def _compute_rich_metrics(
    equity_series: pd.Series,
    strategy_returns: pd.Series,
    signals: list[dict],
    initial_capital: float,
    ann_factor: float = 252.0,
) -> dict:
    """Compute the full suite of quant metrics."""
    total_return = float((equity_series.iloc[-1] / initial_capital) - 1.0)

    # CAGR
    try:
        n_days = max((equity_series.index[-1] - equity_series.index[0]).days, 1)
    except Exception:
        n_days = max(len(equity_series), 1)
    years = n_days / 365.25
    cagr = float((equity_series.iloc[-1] / initial_capital) ** (1.0 / max(years, 0.001)) - 1.0)

    # Drawdown
    running_peak = equity_series.cummax()
    drawdown_series = (equity_series / running_peak) - 1.0
    max_drawdown = float(drawdown_series.min())

    # Sharpe (annualised, ddof=1 per convention)
    returns_std = float(strategy_returns.std(ddof=1))
    mean_ret = float(strategy_returns.mean())
    sharpe = float((mean_ret / returns_std) * np.sqrt(ann_factor)) if returns_std > 0 else 0.0

    # Sortino (downside deviation, ddof=1)
    downside = strategy_returns[strategy_returns < 0]
    downside_std = float(downside.std(ddof=1)) if len(downside) > 1 else 1e-10
    sortino = float((mean_ret / downside_std) * np.sqrt(ann_factor)) if downside_std > 0 else 0.0

    # Calmar
    calmar = float(cagr / abs(max_drawdown)) if max_drawdown != 0 else 0.0

    # Win rate + profit factor
    trade_pnls = [t["pnl"] for t in signals if "pnl" in t]
    wins = [p for p in trade_pnls if p > 0]
    losses = [p for p in trade_pnls if p < 0]
    win_rate = len(wins) / max(len(trade_pnls), 1)
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = float(gross_profit / gross_loss) if gross_loss > 0 else 0.0
    avg_win = float(sum(wins) / len(wins)) if wins else 0.0
    avg_loss = float(sum(losses) / len(losses)) if losses else 0.0
    expectancy = float(win_rate * avg_win + (1 - win_rate) * avg_loss)

    n_long = sum(1 for t in signals if t.get("direction") == "long")
    n_short = sum(1 for t in signals if t.get("direction") == "short")

    # Monthly returns heatmap {year: {month: pct}}
    monthly: dict = {}
    try:
        if len(equity_series) > 0 and hasattr(equity_series.index[0], "year"):
            monthly_equity = equity_series.resample("ME").last()
            monthly_ret = monthly_equity.pct_change().fillna(0)
            for ts, ret in monthly_ret.items():
                monthly.setdefault(str(ts.year), {})[str(ts.month)] = round(float(ret) * 100, 2)
    except Exception:
        pass

    # Rolling Sharpe (30-bar)
    rolling_sharpe: list = []
    try:
        if len(strategy_returns) >= 30:
            rs = (strategy_returns.rolling(30).mean() / strategy_returns.rolling(30).std(ddof=1).replace(0, np.nan)) * np.sqrt(ann_factor)
            rolling_sharpe = [
                {"time": str(t.date() if hasattr(t, "date") else t), "value": round(float(v), 4)}
                for t, v in rs.dropna().items()
            ]
    except Exception:
        pass

    # Full drawdown curve
    drawdown_curve = [
        {"time": str(t.date() if hasattr(t, "date") else t), "value": round(float(v) * 100, 4)}
        for t, v in drawdown_series.items()
    ]

    # Trade distribution for histogram
    trade_distribution = [round(p * 100, 4) for p in trade_pnls]

    # Equity R²
    equity_r2 = 0.0
    try:
        x = np.arange(len(equity_series))
        y = equity_series.values
        coeffs = np.polyfit(x, y, 1)
        y_hat = np.polyval(coeffs, x)
        ss_res = np.sum((y - y_hat) ** 2)
        ss_tot = np.sum((y - y.mean()) ** 2)
        equity_r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    except Exception:
        pass

    return {
        "total_return": round(total_return * 100, 2),
        "cagr": round(cagr * 100, 2),
        "sharpe_ratio": round(sharpe, 4),
        "sortino_ratio": round(sortino, 4),
        "calmar_ratio": round(calmar, 4),
        "max_drawdown": round(max_drawdown * 100, 2),
        "profit_factor": round(profit_factor, 4),
        "expectancy": round(expectancy * 100, 4),
        "win_rate": round(win_rate * 100, 2),
        "n_trades": len(trade_pnls),
        "n_long": n_long,
        "n_short": n_short,
        "avg_win_pct": round(avg_win * 100, 4),
        "avg_loss_pct": round(avg_loss * 100, 4),
        "gross_profit": round(gross_profit * 100, 4),
        "gross_loss": round(gross_loss * 100, 4),
        "equity_r2": round(equity_r2, 4),
        "monthly_returns": monthly,
        "trade_distribution": trade_distribution,
        "rolling_sharpe": rolling_sharpe,
        "drawdown_curve": drawdown_curve,
    }


def _run_fallback_backtest(
    df: pd.DataFrame,
    long_entries: np.ndarray,
    short_entries: np.ndarray,
    initial_capital: float,
    fee_pct: float,
    slippage_pct: float,
    ann_factor: float = 252.0,
) -> dict:
    close_series = pd.Series(df["close"].values, index=df.index, dtype=float)
    positions = np.where(long_entries, 1.0, np.where(short_entries, -1.0, 0.0))
    position_series = pd.Series(positions, index=df.index, dtype=float)

    price_returns = close_series.pct_change().fillna(0.0)
    turnover = position_series.diff().abs().fillna(position_series.abs())
    trading_costs = turnover * (fee_pct + slippage_pct)
    strategy_returns = position_series.shift(1).fillna(0.0) * price_returns - trading_costs

    equity_series = initial_capital * (1.0 + strategy_returns).cumprod()

    equity_curve = [
        {"time": str(t.date() if hasattr(t, "date") else t), "value": float(v)}
        for t, v in equity_series.items()
    ]

    signals = []
    previous_position = 0.0
    entry_time = None
    for t, position in position_series.items():
        if position != previous_position:
            if previous_position != 0.0 and entry_time is not None:
                pnl = float(strategy_returns.loc[entry_time:t].sum())
                signals.append(
                    {
                        "entry_time": str(entry_time.date() if hasattr(entry_time, "date") else entry_time),
                        "exit_time": str(t.date() if hasattr(t, "date") else t),
                        "direction": "long" if previous_position > 0 else "short",
                        "pnl": float(pnl),
                    }
                )
            if position != 0.0:
                entry_time = t
            else:
                entry_time = None
            previous_position = position

    rich = _compute_rich_metrics(equity_series, strategy_returns, signals, initial_capital, ann_factor)
    running_peak = equity_series.cummax()
    drawdown_series = (equity_series / running_peak) - 1.0
    return {
        "metrics": rich,
        "equity_curve": equity_curve,
        "drawdown_zones": _extract_drawdown_zones(drawdown_series, equity_series),
        "signals": signals,
    }


def run_backtest(
    df: pd.DataFrame,
    predictions: np.ndarray,
    probabilities: np.ndarray | None,
    strategy_config: dict,
) -> dict:
    """
    Execute VectorBT backtest.

    Parameters
    ----------
    df              : processed DataFrame with OHLCV + datetime index
    predictions     : array of predicted labels (1=long, -1=short, 0=flat)
    probabilities   : array of max class probabilities (for threshold filtering)
    strategy_config : {initial_capital, fee_pct, slippage_pct, long_threshold, short_threshold}
    """
    try:
        import vectorbt as vbt
    except ImportError:
        vbt = None

    initial_capital: float = strategy_config.get("initial_capital", 10_000.0)
    fee_pct: float = strategy_config.get("fee_pct", 0.001)
    slippage_pct: float = strategy_config.get("slippage_pct", 0.0005)
    long_thresh: float = strategy_config.get("long_threshold", 0.6)
    short_thresh: float = strategy_config.get("short_threshold", 0.4)

    close = df["close"].values
    n = len(close)

    # Align predictions to df length.
    # Predictions may be shorter because the processed dataset has trailing NaN rows
    # removed due to forward-shifted targets (shift(-n) creates NaN at the END).
    # Pad at the END with neutral values so signals are absent for those tail bars.
    pred_len = len(predictions)
    if pred_len < n:
        pad = np.zeros(n - pred_len)
        predictions = np.concatenate([predictions, pad])
        if probabilities is not None:
            prob_pad = np.full(n - pred_len, 0.5)
            probabilities = np.concatenate([probabilities, prob_pad])

    # Build signal masks
    if probabilities is not None:
        long_entries = (predictions == 1) & (probabilities >= long_thresh)
        long_exits = (predictions != 1) | (probabilities < long_thresh)
        short_entries = (predictions == -1) & (probabilities <= short_thresh)
        short_exits = (predictions != -1) | (probabilities > short_thresh)
    else:
        long_entries = predictions == 1
        long_exits = predictions != 1
        short_entries = predictions == -1
        short_exits = predictions != -1

    ann_factor = _infer_bars_per_year(df.index)
    vbt_freq = _infer_vbt_freq(df.index)

    if vbt is None:
        return _run_fallback_backtest(
            df=df,
            long_entries=long_entries,
            short_entries=short_entries,
            initial_capital=initial_capital,
            fee_pct=fee_pct,
            slippage_pct=slippage_pct,
            ann_factor=ann_factor,
        )

    # Run VectorBT portfolio
    pf = vbt.Portfolio.from_signals(
        close=pd.Series(close, index=df.index),
        entries=pd.Series(long_entries.astype(bool), index=df.index),
        exits=pd.Series(long_exits.astype(bool), index=df.index),
        short_entries=pd.Series(short_entries.astype(bool), index=df.index),
        short_exits=pd.Series(short_exits.astype(bool), index=df.index),
        init_cash=initial_capital,
        fees=fee_pct,
        slippage=slippage_pct,
        freq=vbt_freq,
    )

    # Metrics
    equity_series: pd.Series = pf.value()
    strategy_returns = equity_series.pct_change().fillna(0.0)

    equity_curve = [
        {"time": str(t.date() if hasattr(t, "date") else t), "value": float(v)}
        for t, v in equity_series.items()
    ]

    # Drawdown zones for frontend shading
    dd_series: pd.Series = pf.drawdown()
    drawdown_zones = _extract_drawdown_zones(dd_series, equity_series)

    # Trade signals for candlestick overlay
    trades_df = pf.trades.records_readable
    signals = []
    if len(trades_df) > 0:
        for _, row in trades_df.iterrows():
            signals.append({
                "entry_time": str(row.get("Entry Timestamp", "")),
                "exit_time": str(row.get("Exit Timestamp", "")),
                "direction": "long" if row.get("Direction") == "Long" else "short",
                "pnl": float(row.get("PnL", 0.0)),
            })

    rich = _compute_rich_metrics(equity_series, strategy_returns, signals, initial_capital, ann_factor)
    return {
        "metrics": rich,
        "equity_curve": equity_curve,
        "drawdown_zones": drawdown_zones,
        "signals": signals,
    }


def _extract_drawdown_zones(dd_series: pd.Series, equity_series: pd.Series) -> list[dict]:
    """Extract start/end/depth of significant drawdown zones (> 5%)."""
    zones = []
    in_dd = False
    start_time = None

    for t, dd_val in dd_series.items():
        if dd_val < -0.05 and not in_dd:
            in_dd = True
            start_time = t
        elif dd_val >= -0.01 and in_dd:
            in_dd = False
            zones.append({
                "start": str(start_time.date() if hasattr(start_time, "date") else start_time),
                "end": str(t.date() if hasattr(t, "date") else t),
                "depth": round(float(dd_series[start_time:t].min() * 100), 2),
            })

    return zones
