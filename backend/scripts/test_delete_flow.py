import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import httpx
from app.models.db_models import Dataset, FeaturePipeline, DataPreparation, LabeledDataset
from app.core.config import settings

engine = create_async_engine(settings.database_url)
async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def wait_for_completion(db, model, record_id, timeout=60):
    for _ in range(timeout):
        record = await db.get(model, record_id)
        if record.status.name == "completed":
            return record
        if record.status.name == "failed":
            raise Exception(f"Task failed: {record.error_message}")
        await asyncio.sleep(1)
    raise Exception("Timeout")

async def main():
    async with async_session() as db:
        # Get dataset
        dataset = (await db.execute(select(Dataset))).scalars().first()
        if not dataset:
            print("No dataset found!")
            return

        print(f"Using dataset: {dataset.id}")

        async with httpx.AsyncClient(base_url="http://localhost:8000/api/v1") as client:
            # 1. Create FeaturePipeline
            print("Creating Feature Pipeline...")
            res = await client.post("/pipelines/generate", json={
                "dataset_id": str(dataset.id),
                "name": "test_pipeline_e2e",
                "indicators": [{"name": "sma_20", "type": "sma", "params": {"period": 20}}],
                "lags": []
            })
            pipeline_id = res.json()["id"]
            await wait_for_completion(db, FeaturePipeline, pipeline_id)
            print(f"Pipeline {pipeline_id} completed.")

            # 2. Create DataPreparation
            print("Creating Data Preparation...")
            res = await client.post("/data-prep/prepare", json={
                "pipeline_id": pipeline_id,
                "name": "test_prep_e2e",
                "alignment_config": {"enabled": True},
                "cleaning_config": {"enabled": True},
                "missing_value_config": {"enabled": True},
                "normalization_config": {"enabled": True, "enable_scaling": True}
            })
            prep_id = res.json()["id"]
            await wait_for_completion(db, DataPreparation, prep_id)
            print(f"Data Prep {prep_id} completed.")

            # 3. Create LabeledDataset
            print("Creating Labeled Dataset...")
            res = await client.post("/labeled-datasets/", json={
                "data_prep_id": prep_id,
                "name": "test_ld_e2e",
                "targets": [{"name": "y_return_5", "method": "n_bar", "params": {"shift": 5, "type": "regression"}}]
            })
            ld_id = res.json()["id"]
            await wait_for_completion(db, LabeledDataset, ld_id)
            print(f"Labeled Dataset {ld_id} completed.")

            # Verify counts before delete
            pl_count = len((await db.execute(select(FeaturePipeline))).scalars().all())
            dp_count = len((await db.execute(select(DataPreparation))).scalars().all())
            ld_count = len((await db.execute(select(LabeledDataset))).scalars().all())
            print(f"BEFORE DELETE: Pipelines={pl_count}, Preps={dp_count}, Labeled={ld_count}")

            # 4. DELETE LabeledDataset
            print(f"Deleting Labeled Dataset {ld_id}...")
            res = await client.delete(f"/labeled-datasets/{ld_id}")
            print(f"Delete response: {res.status_code}")

            # Verify counts after delete
            pl_count_after = len((await db.execute(select(FeaturePipeline))).scalars().all())
            dp_count_after = len((await db.execute(select(DataPreparation))).scalars().all())
            ld_count_after = len((await db.execute(select(LabeledDataset))).scalars().all())
            print(f"AFTER DELETE:  Pipelines={pl_count_after}, Preps={dp_count_after}, Labeled={ld_count_after}")

asyncio.run(main())
