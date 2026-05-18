import numpy as np
import pandas as pd
import polars as pl

from workers.engines.backtester import run_backtest
from workers.engines.features import generate_features, generate_targets


def _mock_ohlcv(rows: int = 120) -> pl.DataFrame:
    index = pd.date_range("2024-01-01", periods=rows, freq="D")
    base = np.linspace(100.0, 130.0, rows)
    wave = np.sin(np.linspace(0, 8, rows)) * 2.0
    close = base + wave

    df = pd.DataFrame(
        {
            "datetime": index,
            "open": close - 0.4,
            "high": close + 0.8,
            "low": close - 0.8,
            "close": close,
            "volume": np.linspace(1_000, 5_000, rows),
        }
    )
    return pl.from_pandas(df)


def test_engine_a_generates_dynamic_indicator_columns():
    df_raw = _mock_ohlcv()
    indicators = [
        {"name": "rsi", "params": {"length": 14}},
        {"name": "macd", "params": {"fast": 12, "slow": 26, "signal": 9}},
    ]

    df_features, generated_cols = generate_features(df_raw, indicators, lags=[1])

    expected = {
        "rsi_14",
        "macd_12_26",
        "macd_signal_12_26_9",   # format: macd_signal_{fast}_{slow}_{signal}
        "macd_hist_12_26_9",
        "rsi_14_lag1",
    }
    assert expected.issubset(set(df_features.columns))
    assert expected.issubset(set(generated_cols))


def test_engine_b_drops_exactly_three_rows_for_nbar_target():
    df_raw = _mock_ohlcv(rows=120)
    df_features, _ = generate_features(df_raw, indicators=[], lags=[])
    original_len = len(df_features)

    df_targeted, target_cols = generate_targets(
        df_features,
        [
            {
                "name": "y_return_3d",
                "method": "n_bar",
                "params": {"shift": 3, "type": "regression"},
            }
        ],
    )

    assert target_cols == ["y_return_3d"]
    assert len(df_targeted) == original_len - 3
    assert df_targeted["y_return_3d"].isna().sum() == 0


def test_engine_e_backtest_returns_metrics_without_crashing():
    df = _mock_ohlcv(rows=90).to_pandas().set_index("datetime")
    predictions = np.where(np.arange(len(df)) % 10 < 4, 1, np.where(np.arange(len(df)) % 10 < 7, -1, 0))
    probabilities = np.where(predictions == 1, 0.75, np.where(predictions == -1, 0.25, 0.5))

    result = run_backtest(
        df=df,
        predictions=predictions,
        probabilities=probabilities,
        strategy_config={
            "initial_capital": 10_000.0,
            "fee_pct": 0.001,
            "slippage_pct": 0.0005,
            "long_threshold": 0.6,
            "short_threshold": 0.4,
        },
    )

    assert {"total_return", "sharpe_ratio", "max_drawdown", "win_rate", "n_trades"}.issubset(result["metrics"])
    assert isinstance(result["equity_curve"], list)
    assert len(result["equity_curve"]) == len(df)


def test_engine_a_generates_feature_factory_extensions_when_columns_exist():
    df_pd = _mock_ohlcv(rows=150).to_pandas()
    df_pd["funding_rate"] = np.sin(np.linspace(0, 6, len(df_pd))) * 0.001
    df_pd["open_interest"] = np.linspace(1_000_000, 1_200_000, len(df_pd))
    df_pd["futures_price"] = df_pd["close"] * 1.0008
    df_pd["spot_price"] = df_pd["close"]
    df_pd["liquidation_long"] = np.linspace(100, 300, len(df_pd))
    df_pd["liquidation_short"] = np.linspace(120, 260, len(df_pd))
    df_pd["bid_volume"] = np.linspace(500, 700, len(df_pd))
    df_pd["ask_volume"] = np.linspace(480, 710, len(df_pd))
    df_pd["taker_buy_base_volume"] = np.linspace(200, 450, len(df_pd))
    df_pd["volume"] = np.linspace(500, 900, len(df_pd))

    indicators = [
        {"name": "ema_distance", "params": {"fast": 20, "slow": 50}},
        {"name": "rolling_std", "params": {"length": 20}},
        {"name": "autocorr", "params": {"length": 30, "lag": 1}},
        {"name": "trend_regime", "params": {"fast": 50, "slow": 200}},
        {"name": "funding_zscore", "params": {"length": 30}},
        {"name": "oi_change", "params": {"length": 2}},
        {"name": "basis_spread", "params": {}},
        {"name": "liquidation_imbalance", "params": {}},
        {"name": "bid_ask_imbalance", "params": {}},
        {"name": "delta_volume", "params": {}},
        {"name": "cvd", "params": {}},
    ]

    df_features, generated_cols = generate_features(pl.from_pandas(df_pd), indicators, lags=[1])
    expected = {
        "ema_distance_20_50",
        "rolling_std_20",
        "autocorr_30_1",
        "trend_regime_50_200",
        "funding_zscore_30",
        "oi_change_2",
        "basis_spread",
        "liquidation_imbalance",
        "bid_ask_imbalance",
        "delta_volume",
        "cvd",
        "ema_distance_20_50_lag1",
    }
    assert expected.issubset(set(df_features.columns))
    assert expected.issubset(set(generated_cols))