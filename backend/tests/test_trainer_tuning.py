import numpy as np
import pandas as pd

from workers.engines.trainer import tune_hyperparameters_walk_forward


def _mock_binary_df(rows: int = 180) -> pd.DataFrame:
    rng = np.random.default_rng(123)
    x1 = rng.normal(0, 1, rows)
    x2 = rng.normal(0, 1, rows)
    signal = 0.8 * x1 - 0.3 * x2 + rng.normal(0, 0.3, rows)
    y = (signal > 0).astype(int)
    return pd.DataFrame({"x1": x1, "x2": x2, "y": y})


def test_auto_tune_returns_best_hyperparameters_and_trials():
    df = _mock_binary_df()

    result = tune_hyperparameters_walk_forward(
        df=df,
        feature_cols=["x1", "x2"],
        target_col="y",
        model_type="lightgbm",
        base_hyperparameters={"n_estimators": 40},
        n_trials=4,
        search_space={
            "n_estimators": [30, 60],
            "learning_rate": [0.03, 0.1],
            "num_leaves": [15, 31],
        },
        n_splits=3,
        gap=1,
        task="classification",
    )

    assert isinstance(result["best_hyperparameters"], dict)
    assert len(result["trials"]) >= 1
    assert len(result["trials"]) <= 4
    assert result["optimize_metric"] == "accuracy_mean"
    assert "accuracy_mean" in result["cv_metrics"]["aggregate"]
    assert result["best_score"] == max(t["score"] for t in result["trials"])
