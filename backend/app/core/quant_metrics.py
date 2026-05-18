import pandas as pd
import numpy as np
import lightgbm as lgb
import shap
from scipy.stats import ks_2samp
from scipy.cluster import hierarchy
from scipy.spatial.distance import squareform
from typing import Dict, List, Tuple, Any

def run_shap_analysis(X_train: pd.DataFrame, y_train: pd.Series, X_test: pd.DataFrame, model_params: dict) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Trains a LightGBM model and calculates SHAP values.
    Returns feature SHAP mean and standard deviation for this window.
    """
    # basic train
    model = lgb.LGBMRegressor(**model_params)
    model.fit(X_train, y_train)

    # shap
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_test)

    # for each feature, get mean absolute SHAP and std of absolute SHAP
    shap_abs = np.abs(shap_values)
    
    mean_shap = np.mean(shap_abs, axis=0)
    std_shap = np.std(shap_abs, axis=0)
    
    features = X_train.columns.tolist()
    
    mean_dict = {f: float(mean_shap[i]) for i, f in enumerate(features)}
    std_dict = {f: float(std_shap[i]) for i, f in enumerate(features)}
    
    return mean_dict, std_dict


def calculate_distribution_drift(X_prev: pd.DataFrame, X_curr: pd.DataFrame) -> Dict[str, float]:
    """
    Calculates Kolmogorov-Smirnov p-value for each feature between two windows.
    p-value < 0.05 indicates significant distribution drift.
    """
    drift_pvalues = {}
    for col in X_curr.columns:
        if col in X_prev.columns:
            stat, p_val = ks_2samp(X_prev[col].dropna(), X_curr[col].dropna())
            drift_pvalues[col] = float(p_val)
    return drift_pvalues


def hierarchical_clustering(X: pd.DataFrame, distance_threshold: float = 0.2) -> Dict[str, List[str]]:
    """
    Groups features into clusters based on Spearman correlation distance.
    Returns a dict mapping cluster_id to a list of feature names.
    """
    corr = X.corr(method='spearman')
    
    # Distance matrix
    # ensure values are in [0, 2] to avoid precision issues creating negatives
    dist = np.clip(1 - np.abs(corr.values), 0, 2)
    
    # Needs a condensed distance matrix
    condensed_dist = squareform(dist, checks=False)
    
    linkage_matrix = hierarchy.linkage(condensed_dist, method='complete')
    
    cluster_labels = hierarchy.fcluster(linkage_matrix, t=distance_threshold, criterion='distance')
    
    clusters = {}
    for feature_name, cluster_id in zip(X.columns, cluster_labels):
        cid = str(cluster_id)
        if cid not in clusters:
            clusters[cid] = []
        clusters[cid].append(feature_name)
        
    return clusters


def calculate_stability_score(shap_mean: float, shap_std: float) -> float:
    """
    Calculates stability score. 
    Formula: 1 - (std/mean). 
    Higher is more stable.
    """
    if shap_mean == 0:
        return 0.0
    score = 1.0 - (shap_std / shap_mean)
    # Clip to sensible range [-1, 1] for normalization later
    return max(-1.0, min(1.0, score))
