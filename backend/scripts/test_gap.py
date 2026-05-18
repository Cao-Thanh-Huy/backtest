import polars as pl
from app.core.storage import download_bytes, parse_s3_uri
from sqlalchemy import create_engine
import io

engine = create_engine("postgresql://quant:quant@postgres:5432/quantdb")
with engine.connect() as conn:
    row = conn.execute("SELECT s3_raw_path FROM datasets LIMIT 1").fetchone()

bucket, key = parse_s3_uri(row[0])
df = pl.read_parquet(io.BytesIO(download_bytes(bucket, key)))
print("Total rows:", len(df))

expected_interval_sec = 900 # 15m

ts = df.select("timestamp").to_series()
gaps_no_abs = ((ts.diff().dt.total_milliseconds() / 1000) > (expected_interval_sec * 1.5)).sum()

gaps_abs = ((ts.diff().dt.total_milliseconds().abs() / 1000) > (expected_interval_sec * 1.5)).sum()

ts_sorted = ts.sort()
gaps_sorted = ((ts_sorted.diff().dt.total_milliseconds() / 1000) > (expected_interval_sec * 1.5)).sum()

print("Gaps (no abs):", gaps_no_abs)
print("Gaps (with abs):", gaps_abs)
print("Gaps (with sort):", gaps_sorted)
