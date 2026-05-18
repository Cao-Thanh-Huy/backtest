import polars as pl
from app.core.storage import download_bytes, parse_s3_uri
from sqlalchemy import create_engine
import io

engine = create_engine("postgresql://quant:quant@localhost:5432/quantdb")
with engine.connect() as conn:
    row = conn.execute("SELECT s3_raw_path FROM datasets LIMIT 1").fetchone()

bucket, key = parse_s3_uri(row[0])
df = pl.read_parquet(io.BytesIO(download_bytes(bucket, key)))
print("First 3 timestamps:")
print(df.head(3).select("timestamp"))
print("Last 3 timestamps:")
print(df.tail(3).select("timestamp"))
