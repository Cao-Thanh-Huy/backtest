"""
MinIO / S3-compatible storage client (async-capable wrapper).
"""
import io
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import settings


def _get_client():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def upload_file(bucket: str, key: str, data: bytes | BinaryIO, content_type: str = "application/octet-stream") -> str:
    """Upload bytes/file-like to MinIO. Returns the s3:// URI."""
    client = _get_client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)
    if isinstance(data, bytes):
        data = io.BytesIO(data)
    client.upload_fileobj(data, bucket, key, ExtraArgs={"ContentType": content_type})
    return f"s3://{bucket}/{key}"


def download_bytes(bucket: str, key: str) -> bytes:
    """Download an object and return raw bytes."""
    client = _get_client()
    buf = io.BytesIO()
    client.download_fileobj(bucket, key, buf)
    buf.seek(0)
    return buf.read()


def download_to_file(bucket: str, key: str, dest_path: str) -> None:
    """Download an object directly to a local file on disk (zero memory footprint)."""
    client = _get_client()
    client.download_file(bucket, key, dest_path)


def get_presigned_url(bucket: str, key: str, expires: int = 3600) -> str:
    """Generate a pre-signed GET URL."""
    client = _get_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def object_exists(bucket: str, key: str) -> bool:
    client = _get_client()
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError:
        return False


def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Parse 's3://bucket/key' -> (bucket, key)."""
    assert uri.startswith("s3://"), f"Not an S3 URI: {uri}"
    parts = uri[5:].split("/", 1)
    return parts[0], parts[1]


def delete_file(bucket: str, key: str) -> None:
    """Delete an object from MinIO."""
    client = _get_client()
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except ClientError:
        pass
