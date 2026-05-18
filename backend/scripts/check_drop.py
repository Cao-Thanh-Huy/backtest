import polars as pl
from app.core.storage import download_bytes, parse_s3_uri
from sqlalchemy import create_engine
import io

engine = create_engine("postgresql://quant:quant@postgres:5432/quantdb")
with engine.connect() as conn:
    row = conn.execute("SELECT s3_raw_path FROM datasets LIMIT 1").fetchone()
    prep_row = conn.execute("SELECT s3_prepared_path FROM data_preparations ORDER BY created_at DESC LIMIT 1").fetchone()

bucket, key = parse_s3_uri(row[0])
df_raw = pl.read_parquet(io.BytesIO(download_bytes(bucket, key)))
df_raw = df_raw.sort("timestamp")

bucket_p, key_p = parse_s3_uri(prep_row[0])
df_prep = pl.read_parquet(io.BytesIO(download_bytes(bucket_p, key_p)))

print("Raw rows:", len(df_raw))
print("Prep rows:", len(df_prep))

ts_raw = set(df_raw["timestamp"].to_list())
ts_prep = set(df_prep["timestamp"].to_list())

missing = ts_raw - ts_prep
print("Missing timestamps in prep:", missing)

# If the first row was missing
first_raw = df_raw["timestamp"][0]
if first_raw in missing:
    print(f"First row {first_raw} is missing!")



