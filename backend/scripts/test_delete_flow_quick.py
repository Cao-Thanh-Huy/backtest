import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import httpx
from app.models.db_models import Dataset, FeaturePipeline, DataPreparation, LabeledDataset
from app.core.config import settings
import sys

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
        # Find the existing DataPreparation
        dp = (await db.execute(select(DataPreparation).limit(1))).scalars().first()
        if not dp:
            print("No DataPreparation found!")
            sys.exit(1)
            
        print(f"Using DataPreparation: {dp.id}")
        prep_id = str(dp.id)

        async with httpx.AsyncClient(base_url="http://localhost:8000/api/v1", timeout=httpx.Timeout(60.0)) as client:
            # 3. Create LabeledDataset
            print("Creating Labeled Dataset...")
            res = await client.post("/labeled-datasets/", json={
                "data_prep_id": prep_id,
                "name": "test_ld_quick",
                "targets": [{"name": "y_return_5", "method": "n_bar", "params": {"shift": 5, "type": "regression"}}]
            })
            if res.status_code != 202:
                print(f"Error creating: {res.text}")
                sys.exit(1)
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
