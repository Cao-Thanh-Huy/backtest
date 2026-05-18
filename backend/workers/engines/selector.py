"""
Engine C: Auto Feature Selection
Pipeline:
  1. VIF drop (remove multicollinear features)
  2. Spearman correlation drop (|corr| > 0.95)
  3. Mutual Information — keep Top 50
  4. LightGBM tree importance — keep Top 20
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
from statsmodels.stats.outliers_influence import variance_inflation_factor
import lightgbm as lgb


MAX_SELECTOR_ROWS = 10000


def _sample_rows(X: pd.DataFrame, y: pd.Series, max_rows: int = MAX_SELECTOR_ROWS) -> tuple[pd.DataFrame, pd.Series]:
    """Cap row count for expensive selector stages on large datasets."""
    if len(X) <= max_rows:
        return X, y
    sample_idx = X.sample(n=max_rows, random_state=42).index
    return X.loc[sample_idx], y.loc[sample_idx]


def _vif_drop(X: pd.DataFrame, threshold: float = 10.0) -> list[str]:
    """Iteratively drop features with VIF > threshold."""
    # Only keep numeric columns; drop constant (zero-variance) cols that cause OLS singularity
    X = X.select_dtypes(include=[np.number]).fillna(0).astype(float)
    X = X.loc[:, X.std() > 0]
    cols = list(X.columns)
    while True:
        vif_data = pd.DataFrame({
            "feature": cols,
            "vif": [
                variance_inflation_factor(X[cols].values, i)
                for i in range(len(cols))
            ],
        })
        max_vif = vif_data["vif"].max()
        if max_vif <= threshold or len(cols) <= 2:
            break
        drop_col = vif_data.loc[vif_data["vif"].idxmax(), "feature"]
        cols.remove(drop_col)
    return cols


def _spearman_drop_with_reasons(
    X: pd.DataFrame, threshold: float = 0.95
) -> tuple[list[str], dict[str, dict[str, float | str]]]:
    """Drop one feature from each highly correlated pair (Spearman) with explainable reasons."""
    corr_matrix = X.corr(method="spearman").abs()
    upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))

    to_drop: list[str] = []
    reasons: dict[str, dict[str, float | str]] = {}

    for col in upper.columns:
        high_corr_with = upper.index[upper[col] > threshold].tolist()
        if not high_corr_with:
            continue
        to_drop.append(col)
        partner = max(high_corr_with, key=lambda other: float(upper.loc[other, col]))
        reasons[col] = {
            "with": str(partner),
            "corr": round(float(upper.loc[partner, col]), 4),
        }

    return [c for c in X.columns if c not in to_drop], reasons


def _spearman_drop(X: pd.DataFrame, threshold: float = 0.95) -> list[str]:
    """Backward-compatible wrapper: return only surviving columns."""
    surviving, _ = _spearman_drop_with_reasons(X, threshold)
    return surviving


def _mutual_info_top_k(
    X: pd.DataFrame, y: pd.Series, k: int = 50, task: str = "classification"
) -> list[str]:
    fn = mutual_info_classif if task == "classification" else mutual_info_regression
    mi = fn(X.fillna(0), y, random_state=42)
    mi_series = pd.Series(mi, index=X.columns).sort_values(ascending=False)
    return list(mi_series.head(k).index)


def _lgbm_importance_top_k(
    X: pd.DataFrame, y: pd.Series, k: int = 20, task: str = "classification"
) -> tuple[list[str], dict[str, float]]:
    objective = "binary" if task == "classification" else "regression"
    model = lgb.LGBMClassifier(n_estimators=200, n_jobs=-1, random_state=42, verbose=-1) \
        if task == "classification" \
        else lgb.LGBMRegressor(n_estimators=200, n_jobs=-1, random_state=42, verbose=-1)

    model.fit(X.fillna(0), y)
    imp = pd.Series(model.feature_importances_, index=X.columns).sort_values(ascending=False)
    top_k = list(imp.head(k).index)
    importance_dict = imp.head(k).to_dict()
    return top_k, importance_dict


from typing import Any

def analyze_features(
    df: pd.DataFrame,
    target_col: str,
    feature_cols: list[str],
    task: str = "regression",
    vif_threshold: float = 10.0,
    corr_threshold: float = 0.95,
    mi_top_k: int = 50,
    tree_top_k: int = 20,
    celery_task: Any = None,
) -> dict:
    """
    Full analysis pipeline returning intermediate scores for each step.
    Used to render explanatory charts in the UI.
    Returns dict with:
      vif_scores, dropped_vif,
      spearman_with_target, inter_feature_corr, dropped_corr,
      mutual_information, feature_importance, final_selected
    """
    X = df[feature_cols].copy()
    y = df[target_col].copy()
    mask = y.notna()
    X, y = X[mask], y[mask]
    X, y = _sample_rows(X, y)
    # Keep only numeric columns; cast to float and drop zero-variance cols
    X = X.select_dtypes(include=[np.number]).fillna(0).astype(float)
    X = X.loc[:, X.std() > 0]

    all_cols = list(X.columns)

    # ── Step 1: Spearman correlation with target and Inter-feature correlation drop ─
    if celery_task:
        celery_task.update_state(state="PROGRESS", meta={"progress": 40, "message": "Stage 1: Removing highly correlated duplicates (Spearman)..."})
    
    spearman_with_target: dict[str, float] = {}
    for col in X.columns:
        try:
            r = float(X[col].corr(y, method="spearman"))
            spearman_with_target[col] = round(r if not np.isnan(r) else 0.0, 4)
        except Exception:
            spearman_with_target[col] = 0.0

    surviving_corr, dropped_corr_reasons = _spearman_drop_with_reasons(X, threshold=corr_threshold)
    dropped_corr = [c for c in X.columns if c not in surviving_corr]

    # Build heatmap for top-40 features by |spearman with target|
    top_for_heatmap = sorted(
        surviving_corr,
        key=lambda c: abs(spearman_with_target.get(c, 0)),
        reverse=True,
    )[:40]
    inter_feature_corr: dict[str, dict[str, float]] = {}
    if top_for_heatmap:
        cm = X[top_for_heatmap].corr(method="spearman").round(3)
        inter_feature_corr = {
            r: {c: float(v) for c, v in row.items()}
            for r, row in cm.to_dict().items()
        }

    X = X[surviving_corr]

    # ── Step 2: VIF ──────────────────────────────────────────────────────
    if celery_task:
        celery_task.update_state(state="PROGRESS", meta={"progress": 55, "message": "Stage 2: Removing multicollinear features (VIF)..."})
    vif_scores: dict[str, float] = {}
    # We no longer need to heavily limit this because surviving_corr is usually < 100 features. We limit to 100 just in case.
    vif_cols = surviving_corr[:100]
    try:
        for i, col in enumerate(vif_cols):
            v = float(variance_inflation_factor(X[vif_cols].values, i))
            vif_scores[col] = round(min(v, 9999.0) if np.isfinite(v) else 9999.0, 2)
    except Exception:
        vif_scores = {col: 1.0 for col in surviving_corr}

    surviving_vif = _vif_drop(X[vif_cols], threshold=vif_threshold)
    dropped_vif = [c for c in vif_cols if c not in surviving_vif]
    kept_all = surviving_vif + [c for c in surviving_corr if c not in vif_cols]
    X = X[kept_all]

    # ── Step 3: Mutual Information ───────────────────────────────────────
    if celery_task:
        celery_task.update_state(state="PROGRESS", meta={"progress": 70, "message": "Stage 3: Computing Mutual Information..."})
    fn = mutual_info_classif if task == "classification" else mutual_info_regression
    mi = fn(X.fillna(0), y, random_state=42)
    mi_series = pd.Series(mi, index=X.columns).sort_values(ascending=False)
    mi_scores: dict[str, float] = {k: round(float(v), 4) for k, v in mi_series.items()}
    mi_top = list(mi_series.head(min(mi_top_k, len(mi_series))).index)
    X_mi = X[mi_top]

    # ── Step 4: LightGBM importance ──────────────────────────────────────
    if celery_task:
        celery_task.update_state(state="PROGRESS", meta={"progress": 85, "message": "Stage 4: Fitting LightGBM for Tree Importance..."})
    final_features, importances = _lgbm_importance_top_k(
        X_mi, y, k=min(tree_top_k, len(mi_top)), task=task
    )

    return {
        "vif_scores": vif_scores,
        "dropped_vif": dropped_vif,
        "spearman_with_target": spearman_with_target,
        "inter_feature_corr": inter_feature_corr,
        "dropped_corr": dropped_corr,
        "dropped_corr_reasons": dropped_corr_reasons,
        "mutual_information": mi_scores,
        "feature_importance": {k: round(float(v), 4) for k, v in importances.items()},
        "final_selected": final_features,
        "stage_counts": {
            "input": len(all_cols),
            "after_vif": len(kept_all),
            "after_corr": len(surviving_corr),
            "after_mi": len(mi_top),
            "final": len(final_features),
        },
    }


def select_features(
    df: pd.DataFrame,
    target_col: str,
    feature_cols: list[str],
    task: str = "classification",
    vif_threshold: float = 10.0,
    corr_threshold: float = 0.95,
    mi_top_k: int = 50,
    tree_top_k: int = 20,
) -> tuple[list[str], dict[str, float]]:
    """
    Full feature selection pipeline.
    Returns (selected_features, importance_dict).
    """
    X = df[feature_cols].copy()
    y = df[target_col].copy()

    # Drop rows where target is NaN (should already be done, but safety check)
    mask = y.notna()
    X, y = X[mask], y[mask]
    X, y = _sample_rows(X, y)

    print(f"[Selector] Starting with {len(feature_cols)} features")

    # Step 1: Spearman correlation
    surviving = _spearman_drop(X, threshold=corr_threshold)
    X = X[surviving]
    print(f"[Selector] After Spearman drop: {len(surviving)} features")

    # Step 2: VIF
    # Only run VIF on up to 100 features to save time
    vif_cols = surviving[:100]
    surviving_vif = _vif_drop(X[vif_cols], threshold=vif_threshold)
    surviving = surviving_vif + [c for c in surviving if c not in vif_cols]
    X = X[surviving]
    print(f"[Selector] After VIF drop: {len(surviving)} features")

    # Step 3: Mutual Information → Top 50
    surviving = _mutual_info_top_k(X, y, k=min(mi_top_k, len(surviving)), task=task)
    X = X[surviving]
    print(f"[Selector] After MI filter: {len(surviving)} features")

    # Step 4: LightGBM tree importance → Top 20
    final_features, importances = _lgbm_importance_top_k(X, y, k=min(tree_top_k, len(surviving)), task=task)
    print(f"[Selector] Final selected features: {len(final_features)}")

    return final_features, importances
