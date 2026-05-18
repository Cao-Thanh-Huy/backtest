"""
E2E Test: 6-tầng Atomic Pipeline
===================================
Luồng: Dataset → FeaturePipeline → DataPreparation → LabeledDataset → FeatureSet → ResearchExperiment

Mỗi tầng có bảng DB và file S3 riêng.
Xóa tầng X không ảnh hưởng tầng Y.
"""
import time
import requests
import json
import sys

BASE_URL = "http://localhost:8000/api/v1"


def wait_for_task(endpoint: str, resource_id: str, timeout: int = 120):
    start = time.time()
    while time.time() - start < timeout:
        resp = requests.get(f"{BASE_URL}/{endpoint}/{resource_id}")
        if resp.status_code == 200:
            data = resp.json()
            status = data.get("status")
            if status == "completed":
                return data
            if status == "failed":
                raise Exception(f"[{endpoint}/{resource_id}] Task FAILED: {data.get('error_message')}")
        time.sleep(2)
    raise Exception(f"Timeout waiting for {endpoint}/{resource_id}")


def run_e2e():
    print("=" * 55)
    print("  E2E Pipeline Test: 6 tầng Atomic")
    print("=" * 55)

    # ---------------------------------------------------------------
    # TẦNG 1: Market Intake → Dataset
    # ---------------------------------------------------------------
    print("\n[1/6] Fetch Market Data → Dataset")
    fetch_payload = {
        "symbol": "BTC/USDT",
        "timeframe": "1h",
        "exchange": "binance",
        "start_date": "2023-01-01",
        "end_date": "2023-02-01",
    }
    resp = requests.post(f"{BASE_URL}/fetch/market-data", json=fetch_payload)
    if resp.status_code == 200:
        dataset_id = resp.json().get("dataset_id")
        print(f"     Fetching... Dataset ID: {dataset_id}")
        wait_for_task("datasets", dataset_id, timeout=120)
    else:
        print("     Fetch failed — using existing dataset")
        resp = requests.get(f"{BASE_URL}/datasets/")
        datasets = resp.json()
        if not datasets:
            raise Exception("No datasets available and fetch failed.")
        dataset_id = datasets[0]["id"]
    print(f"     ✅  Dataset ready: {dataset_id}")

    # ---------------------------------------------------------------
    # TẦNG 2: Feature Factory → FeaturePipeline
    # ---------------------------------------------------------------
    print("\n[2/6] Feature Factory → FeaturePipeline (indicators + lags only, NO targets)")
    pipe_payload = {
        "dataset_id": dataset_id,
        "name": "E2E Feature Pipeline",
        "indicators": [{"name": "rsi", "params": {"period": 14}}],
        "lags": [1, 2, 5],
    }
    resp = requests.post(f"{BASE_URL}/pipelines/generate", json=pipe_payload)
    if resp.status_code != 202:
        raise Exception(f"Pipeline generate failed: {resp.text}")
    pipeline_id = resp.json()["id"]
    wait_for_task("pipelines", pipeline_id)
    print(f"     ✅  Pipeline ready: {pipeline_id}")

    # Verify: pipeline must NOT have any y_* columns
    pipe_data = requests.get(f"{BASE_URL}/pipelines/{pipeline_id}").json()
    feature_cols = pipe_data.get("feature_columns", [])
    target_cols_in_pipe = [c for c in feature_cols if c.startswith("y_")]
    assert len(target_cols_in_pipe) == 0, f"Pipeline should NOT have target columns! Found: {target_cols_in_pipe}"
    print(f"     ✅  No target columns in pipeline ({len(feature_cols)} features only)")

    # ---------------------------------------------------------------
    # TẦNG 3: Data Preparation → DataPreparation
    # ---------------------------------------------------------------
    print("\n[3/6] Data Preparation → DataPreparation")
    prep_payload = {
        "pipeline_id": pipeline_id,
        "name": "E2E Data Prep",
        "alignment_config": {"enabled": True},
        "cleaning_config": {"enabled": True},
        "missing_value_config": {"enabled": True},
        "normalization_config": {"enabled": True},
    }
    resp = requests.post(f"{BASE_URL}/data-prep/prepare", json=prep_payload)
    if resp.status_code != 202:
        raise Exception(f"Data prep failed: {resp.text}")
    prep_id = resp.json()["id"]
    wait_for_task("data-prep", prep_id)
    print(f"     ✅  DataPrep ready: {prep_id}")

    # ---------------------------------------------------------------
    # TẦNG 4: Labeling System → LabeledDataset
    # Input: DataPreparation (không phải FeaturePipeline!)
    # ---------------------------------------------------------------
    print("\n[4/6] Labeling System → LabeledDataset")
    label_payload = {
        "data_prep_id": prep_id,
        "name": "E2E Labels",
        "targets": [
            {"name": "y_direction_5", "method": "n_bar", "params": {"shift": 5, "type": "classification"}},
            {"name": "y_return_10", "method": "n_bar", "params": {"shift": 10, "type": "regression"}},
        ],
    }
    resp = requests.post(f"{BASE_URL}/labeled-datasets/", json=label_payload)
    if resp.status_code != 202:
        raise Exception(f"Labeled dataset create failed: {resp.text}")
    labeled_id = resp.json()["id"]
    wait_for_task("labeled-datasets", labeled_id)
    print(f"     ✅  LabeledDataset ready: {labeled_id}")

    # Verify: LabeledDataset has target columns
    ld_data = requests.get(f"{BASE_URL}/labeled-datasets/{labeled_id}").json()
    assert "y_direction_5" in (ld_data.get("target_columns") or []), "y_direction_5 missing from labeled dataset"
    print(f"     ✅  Target columns: {ld_data.get('target_columns')}")

    # Test: Delete pipeline → DataPrep and LabeledDataset should still exist
    print("\n     [Test DELETE isolation] Deleting FeaturePipeline...")
    del_resp = requests.delete(f"{BASE_URL}/pipelines/{pipeline_id}")
    assert del_resp.status_code == 204, f"Delete pipeline failed: {del_resp.text}"
    # DataPrep should still exist
    dp_check = requests.get(f"{BASE_URL}/data-prep/{prep_id}")
    assert dp_check.status_code == 200, "DataPrep was deleted when pipeline was deleted — isolation FAILED!"
    # LabeledDataset should still exist
    ld_check = requests.get(f"{BASE_URL}/labeled-datasets/{labeled_id}")
    assert ld_check.status_code == 200, "LabeledDataset was deleted when pipeline was deleted — isolation FAILED!"
    print("     ✅  DELETE isolation OK: DataPrep + LabeledDataset unaffected by pipeline deletion")

    # ---------------------------------------------------------------
    # TẦNG 5: Feature Selection → FeatureSet
    # Input: LabeledDataset (không phải FeaturePipeline!)
    # ---------------------------------------------------------------
    print("\n[5/6] Feature Selection → FeatureSet")
    ld_refreshed = requests.get(f"{BASE_URL}/labeled-datasets/{labeled_id}").json()
    feature_cols = ld_refreshed.get("feature_columns", [])[:10]  # use first 10 features
    fset_payload = {
        "labeled_dataset_id": labeled_id,
        "name": "E2E Feature Set",
        "selected_columns": feature_cols,
        "target_column": "y_direction_5",
    }
    resp = requests.post(f"{BASE_URL}/feature-sets/", json=fset_payload)
    if resp.status_code != 201:
        raise Exception(f"Feature set create failed: {resp.text}")
    fset_id = resp.json()["id"]
    print(f"     ✅  FeatureSet ready: {fset_id}")

    # Verify FeatureSet references labeled_dataset_id (not pipeline_id)
    fs_data = requests.get(f"{BASE_URL}/feature-sets/{fset_id}").json()
    assert fs_data.get("labeled_dataset_id") == labeled_id, "FeatureSet must reference labeled_dataset_id!"
    print(f"     ✅  FeatureSet.labeled_dataset_id correctly set to: {labeled_id}")

    # ---------------------------------------------------------------
    # TẦNG 6: Feature Stability → ResearchExperiment
    # ---------------------------------------------------------------
    print("\n[6/6] Feature Stability → ResearchExperiment")
    stab_payload = {
        "feature_set_id": fset_id,
        "name": "E2E Stability",
        "target_column": "y_direction_5",
        "cv_strategy": {"type": "purged_walk_forward", "train_bars": 300, "test_bars": 60},
        "clustering_config": {"method": "hierarchical"},
        "regime_method": "volatility_hmm",
    }
    resp = requests.post(f"{BASE_URL}/stability/", json=stab_payload)
    if resp.status_code not in (200, 201, 202):
        raise Exception(f"Stability create failed: {resp.text}")
    exp_id = resp.json()["id"]
    wait_for_task("stability", exp_id, timeout=180)
    print(f"     ✅  Experiment ready: {exp_id}")

    print("\n" + "=" * 55)
    print("  🎉  E2E Pipeline Test PASSED!")
    print("=" * 55)
    print(f"""
  Dataset:         {dataset_id}
  FeaturePipeline: DELETED (isolation test)
  DataPrep:        {prep_id}  ✅  still exists
  LabeledDataset:  {labeled_id}  ✅  still exists
  FeatureSet:      {fset_id}
  Experiment:      {exp_id}
""")


if __name__ == "__main__":
    run_e2e()
