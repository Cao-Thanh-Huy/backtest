import requests

BASE_URL = "http://localhost:8000/api/v1"

# Create a dataset or use existing
ds = requests.get(f"{BASE_URL}/datasets/").json()
ds_id = ds[0]["id"]

# Create pipeline
pipe = requests.post(f"{BASE_URL}/pipelines/generate", json={
    "dataset_id": ds_id,
    "name": "Test Pipe",
    "indicators": [{"name": "rsi", "params": {"period": 14}}],
    "lags": [1]
}).json()
pipe_id = pipe["id"]
import time
time.sleep(2)

# Create prep
prep = requests.post(f"{BASE_URL}/data-prep/prepare", json={
    "pipeline_id": pipe_id,
    "name": "Test Prep",
    "alignment_config": {"enabled": True},
    "cleaning_config": {"enabled": True},
    "missing_value_config": {"enabled": True},
    "normalization_config": {"enabled": True},
}).json()
prep_id = prep["id"]
time.sleep(2)

# Create labeled dataset
ld = requests.post(f"{BASE_URL}/labeled-datasets/", json={
    "data_prep_id": prep_id,
    "name": "Test LD",
    "targets": [{"name": "y_dir", "method": "n_bar", "params": {"shift": 1, "type": "classification"}}]
}).json()
ld_id = ld["id"]
time.sleep(2)

# Delete LD
print("Deleting LD...")
requests.delete(f"{BASE_URL}/labeled-datasets/{ld_id}")

# Check pipeline
pipe_check = requests.get(f"{BASE_URL}/pipelines/{pipe_id}")
print("Pipeline exists after LD delete:", pipe_check.status_code == 200)
