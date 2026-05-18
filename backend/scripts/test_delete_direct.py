import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models.db_models import Dataset, FeaturePipeline, DataPreparation, LabeledDataset
from app.core.config import settings
import sys

engine = create_async_engine(settings.database_url)
async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def main():
    async with async_session() as db:
        ld = (await db.execute(select(LabeledDataset).limit(1))).scalars().first()
        if not ld:
            print("No LabeledDataset found!")
            sys.exit(1)
            
        print(f"Found LabeledDataset: {ld.id}")

        pl_count = len((await db.execute(select(FeaturePipeline))).scalars().all())
        dp_count = len((await db.execute(select(DataPreparation))).scalars().all())
        ld_count = len((await db.execute(select(LabeledDataset))).scalars().all())
        print(f"BEFORE DELETE: Pipelines={pl_count}, Preps={dp_count}, Labeled={ld_count}")

        print(f"Deleting Labeled Dataset {ld.id}...")
        await db.delete(ld)
        await db.commit()
        print("Delete committed.")

        pl_count_after = len((await db.execute(select(FeaturePipeline))).scalars().all())
        dp_count_after = len((await db.execute(select(DataPreparation))).scalars().all())
        ld_count_after = len((await db.execute(select(LabeledDataset))).scalars().all())
        print(f"AFTER DELETE:  Pipelines={pl_count_after}, Preps={dp_count_after}, Labeled={ld_count_after}")

asyncio.run(main())
