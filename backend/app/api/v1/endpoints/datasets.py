"""Dataset endpoints: upload CSV/Parquet → MinIO → DB record."""
import io
import json
import re
from datetime import datetime
from uuid import UUID

import polars as pl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.storage import upload_file, get_presigned_url, parse_s3_uri, download_bytes, delete_file
from app.core.config import settings
from app.db.session import get_db
from app.models.db_models import Dataset, FeaturePipeline
from app.schemas.schemas import DatasetRead

router = APIRouter()

MAX_CHART_BARS = 5000

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_parquet_preview(s3_path: str, rows: int) -> dict:
    """Download parquet from MinIO and return column schema + first N rows."""
    bucket, key = parse_s3_uri(s3_path)
    raw = download_bytes(bucket, key)
    df = pl.read_parquet(io.BytesIO(raw))
    schema = [{"name": c, "type": str(df.schema[c])} for c in df.columns]

    # Format datetime columns as ISO strings (truncate nanoseconds) for clean display
    preview_df = df.head(rows)
    for col in preview_df.columns:
        if preview_df[col].dtype in (pl.Datetime, pl.Date):
            preview_df = preview_df.with_columns(
                pl.col(col).cast(pl.Utf8).str.slice(0, 19).alias(col)
            )

    rows_data = json.loads(json.dumps(preview_df.to_dicts(), default=str))
    return {
        "row_count": len(df),
        "column_count": len(df.columns),
        "columns": schema,
        "rows": rows_data,
    }


def _timeframe_to_seconds(timeframe: str | None) -> int | None:
    if not timeframe:
        return None
    tf = str(timeframe).strip().lower()
    m = re.match(r"^(\d+)(m|h|d|w|wk|mo)$", tf)
    if not m:
        return None
    n = int(m.group(1))
    u = m.group(2)
    if u == "m":
        return n * 60
    if u == "h":
        return n * 3600
    if u == "d":
        return n * 86400
    if u in ("w", "wk"):
        return n * 7 * 86400
    if u == "mo":
        # Approx month for robust gap checks when only timeframe string is available.
        return n * 30 * 86400
    return None


def _compute_stats(s3_path: str, timeframe: str | None = None) -> dict:
    """Compute data quality stats from the raw parquet file."""
    bucket, key = parse_s3_uri(s3_path)
    raw = download_bytes(bucket, key)
    df = pl.read_parquet(io.BytesIO(raw))

    null_counts = {c: int(df[c].null_count()) for c in df.columns}

    # Price range from close column
    price_range = None
    if "close" in df.columns:
        price_range = {
            "min": float(df["close"].drop_nulls().min() or 0),
            "max": float(df["close"].drop_nulls().max() or 0),
        }

    # Volume average
    volume_avg = None
    if "volume" in df.columns:
        vol = df["volume"].drop_nulls()
        volume_avg = float(vol.mean()) if len(vol) else None

    # Gap detection / quality checks via time column
    time_col = next(
        (c for c in df.columns if c.lower() in ("date", "datetime", "timestamp", "time")), None
    )
    gap_count = 0
    coverage_pct = 100.0
    duplicate_candles = 0
    missing_candles = 0
    expected_interval_sec = _timeframe_to_seconds(timeframe)
    expected_rows = None
    observed_unique_timestamps = None
    if time_col and len(df) > 1:
        try:
            tf = df.select(pl.col(time_col).cast(pl.Datetime("us")).alias("t")).sort("t")
            tf = tf.with_columns(pl.col("t").dt.epoch(time_unit="s").alias("ts"))
            total_rows = len(tf)
            unique_ts = tf.select(pl.col("ts").n_unique()).item()
            duplicate_candles = max(int(total_rows - unique_ts), 0)
            observed_unique_timestamps = int(unique_ts)

            unique_times = tf.select(pl.col("ts").unique().sort()).get_column("ts").to_list()
            if expected_interval_sec is None and len(unique_times) > 2:
                # Infer interval from the median positive diff between unique timestamps.
                diffs = [int(unique_times[i] - unique_times[i - 1]) for i in range(1, len(unique_times))]
                diffs = [d for d in diffs if d > 0]
                if diffs:
                    diffs.sort()
                    expected_interval_sec = int(diffs[len(diffs) // 2])

            if expected_interval_sec and len(unique_times) > 1:
                for i in range(1, len(unique_times)):
                    dt = int(unique_times[i] - unique_times[i - 1])
                    if dt > int(expected_interval_sec * 1.5):
                        gap_count += 1
                        missing_candles += max(int(round(dt / expected_interval_sec)) - 1, 0)

                expected_rows = max(
                    int((unique_times[-1] - unique_times[0]) // expected_interval_sec) + 1,
                    1,
                )
                coverage_pct = round(100.0 * (len(unique_times) / expected_rows), 2)
            else:
                coverage_pct = round(100.0 * (1 - sum(null_counts.values()) / max(len(df) * len(df.columns), 1)), 2)
        except Exception:
            pass

    corrupted_rows = 0
    spikes = 0
    try:
        # Validate row-level OHLCV consistency on full dataset (not downsampled chart data).
        if all(c in df.columns for c in ("open", "high", "low", "close")):
            qdf = df.select([
                pl.col("open").cast(pl.Float64).alias("open"),
                pl.col("high").cast(pl.Float64).alias("high"),
                pl.col("low").cast(pl.Float64).alias("low"),
                pl.col("close").cast(pl.Float64).alias("close"),
                (pl.col("volume").cast(pl.Float64) if "volume" in df.columns else pl.lit(0.0)).alias("volume"),
            ])

            invalid = qdf.filter(
                pl.col("open").is_null()
                | pl.col("high").is_null()
                | pl.col("low").is_null()
                | pl.col("close").is_null()
                | (pl.col("high") < pl.col("low"))
                | (pl.col("open") < pl.col("low"))
                | (pl.col("open") > pl.col("high"))
                | (pl.col("close") < pl.col("low"))
                | (pl.col("close") > pl.col("high"))
                | (pl.col("volume") < 0)
            )
            corrupted_rows = len(invalid)

            # Spike detection from close-to-close returns.
            rets = qdf.with_columns(
                ((pl.col("close") / pl.col("close").shift(1)) - 1.0).abs().alias("ret_abs")
            ).get_column("ret_abs").drop_nulls()
            if len(rets) > 5:
                mu = float(rets.mean())
                sigma = float(rets.std() or 0.0)
                threshold = max(0.15, mu + 4.0 * sigma)
                spikes = int(sum(1 for v in rets.to_list() if v is not None and float(v) > threshold))
    except Exception:
        pass

    missing_funding = int(null_counts.get("funding_rate", 0)) if "funding_rate" in df.columns else None
    null_cells = int(sum(null_counts.values()))
    null_rows_estimate = int(min(len(df), max(null_counts.values()) if null_counts else 0))

    return {
        "row_count": len(df),
        "column_count": len(df.columns),
        "null_counts": null_counts,
        "price_range": price_range,
        "volume_avg": round(volume_avg, 2) if volume_avg is not None else None,
        "coverage_pct": coverage_pct,
        "gap_count": gap_count,
        "quality": {
            "duplicate_candles": int(duplicate_candles),
            "corrupted_rows": int(corrupted_rows),
            "spikes": int(spikes),
            "gap_segments": int(gap_count),
            "missing_candles": int(missing_candles),
            "null_cells": int(null_cells),
            "null_rows_estimate": int(null_rows_estimate),
            "missing_funding": missing_funding,
            "expected_interval_sec": int(expected_interval_sec) if expected_interval_sec else None,
            "observed_rows": int(len(df)),
            "observed_unique_timestamps": observed_unique_timestamps,
            "expected_rows": int(expected_rows) if expected_rows else None,
        },
    }


def _read_chart_data(s3_path: str) -> list[dict]:
    """Return OHLCV rows suitable for lightweight-charts (time as UTC seconds, open, high, low, close, volume)."""
    bucket, key = parse_s3_uri(s3_path)
    raw = download_bytes(bucket, key)
    df = pl.read_parquet(io.BytesIO(raw))

    time_col = next(
        (c for c in df.columns if c.lower() in ("date", "datetime", "timestamp", "time")), None
    )
    ohlcv_cols = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
    select_cols = ([time_col] if time_col else []) + ohlcv_cols
    df = df.select(select_cols)

    # Convert time column to UTC epoch seconds (integer) for lightweight-charts
    if time_col:
        try:
            df = df.with_columns(
                pl.col(time_col).cast(pl.Datetime("us")).dt.epoch(time_unit="s").alias("__epoch")
            ).drop(time_col).rename({"__epoch": "time"})
            time_col = "time"
        except Exception:
            pass

    # Downsample if too many rows
    if len(df) > MAX_CHART_BARS:
        step = max(len(df) // MAX_CHART_BARS, 1)
        df = df[::step]

    rows = df.to_dicts()

    # Normalise time key to "time" for lightweight-charts
    if time_col and time_col != "time":
        rows = [{"time": r.pop(time_col), **r} for r in rows]

    # Ensure numeric OHLCV values (cast from Decimal / str if needed)
    def _float(v):
        try:
            return float(v) if v is not None else None
        except Exception:
            return None

    result = []
    for r in rows:
        entry: dict = {"time": r.get("time")}
        for col in ohlcv_cols:
            entry[col] = _float(r.get(col))
        result.append(entry)

    return result



def _normalize_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime()
        except Exception:
            pass
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


@router.post("/upload", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    symbol: str = Form(...),
    timeframe: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a CSV or Parquet OHLCV file. Stored in MinIO, metadata in DB."""
    allowed = {"text/csv", "application/octet-stream", "application/x-parquet"}
    content = await file.read()

    # Parse to validate & extract metadata
    try:
        if file.filename.endswith(".csv"):
            df = pl.read_csv(io.BytesIO(content))
        else:
            df = pl.read_parquet(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot parse file: {exc}")

    # Convert to Parquet for storage normalisation
    buf = io.BytesIO()
    df.write_parquet(buf)
    buf.seek(0)

    key = f"{symbol}/{timeframe}/{file.filename.rsplit('.', 1)[0]}.parquet"
    s3_path = upload_file(settings.minio_bucket_raw, key, buf, "application/octet-stream")

    # Extract date range if possible
    date_col = next((c for c in df.columns if c.lower() in ("date", "datetime", "timestamp", "time")), None)
    date_from = date_to = None
    if date_col:
        try:
            date_from = _normalize_datetime(df[date_col].min())
            date_to = _normalize_datetime(df[date_col].max())
        except Exception:
            pass

    dataset = Dataset(
        symbol=symbol.upper(),
        timeframe=timeframe,
        source="upload",
        s3_raw_path=s3_path,
        row_count=str(len(df)),
        date_from=date_from,
        date_to=date_to,
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    return dataset


@router.get("/", response_model=list[DatasetRead])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    datasets = result.scalars().all()

    # Fetch pipeline counts in one query
    count_result = await db.execute(
        select(FeaturePipeline.dataset_id, func.count(FeaturePipeline.id))
        .group_by(FeaturePipeline.dataset_id)
    )
    counts = {str(row[0]): int(row[1]) for row in count_result.fetchall()}

    out = []
    for d in datasets:
        item = DatasetRead.model_validate(d).model_dump()
        item["pipeline_count"] = counts.get(str(d.id), 0)
        out.append(item)
    return out


@router.get("/{dataset_id}", response_model=DatasetRead)
async def get_dataset(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.get("/{dataset_id}/preview")
async def preview_dataset(dataset_id: UUID, rows: int = 200, db: AsyncSession = Depends(get_db)):
    """Return column schema + first N rows of the raw parquet file."""
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset.s3_raw_path:
        raise HTTPException(status_code=404, detail="No raw file stored for this dataset")
    try:
        return _read_parquet_preview(dataset.s3_raw_path, rows)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")


@router.get("/{dataset_id}/stats")
async def dataset_stats(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return data quality statistics (null counts, price range, coverage, volume avg)."""
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset.s3_raw_path:
        raise HTTPException(status_code=404, detail="No raw file stored")
    try:
        return _compute_stats(dataset.s3_raw_path, dataset.timeframe)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stats failed: {exc}")


@router.get("/{dataset_id}/chart-data")
async def dataset_chart_data(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return OHLCV rows for charting (up to 5 000 bars, downsampled if needed)."""
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset.s3_raw_path:
        raise HTTPException(status_code=404, detail="No raw file stored")
    try:
        return _read_chart_data(dataset.s3_raw_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chart data failed: {exc}")


@router.get("/{dataset_id}/download")
async def download_dataset_url(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return a presigned URL to download the raw parquet file from MinIO."""
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset.s3_raw_path:
        raise HTTPException(status_code=404, detail="No raw file stored")
    try:
        bucket, key = parse_s3_uri(dataset.s3_raw_path)
        url = get_presigned_url(bucket, key, expires=3600)
        return {"url": url, "filename": key.split("/")[-1]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Download URL failed: {exc}")


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: UUID, db: AsyncSession = Depends(get_db)):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Clean up file on MinIO S3
    if dataset.s3_raw_path:
        try:
            bucket, key = parse_s3_uri(dataset.s3_raw_path)
            delete_file(bucket, key)
        except Exception:
            pass
            
    await db.delete(dataset)
    await db.commit()
