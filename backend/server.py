from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import io
import csv


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from email_service import send_completion_email_async, is_email_configured  # noqa: E402

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Ageing Monitor API")
api_router = APIRouter(prefix="/api")


# --------------------- Models ---------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Researcher(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: str = Field(default_factory=now_iso)


class ResearcherCreate(BaseModel):
    name: str


class Experiment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    batch: str
    researcher: str
    condition: str
    hours: float
    start_time: int  # epoch millis (UTC)
    end_time: int    # epoch millis (UTC)
    removed_at: Optional[int] = None  # epoch millis when researcher confirmed removal
    email_notified_at: Optional[int] = None  # epoch millis when completion email was sent
    notes: Optional[str] = ""
    photo_base64: Optional[str] = None  # data URL or raw base64
    created_at: str = Field(default_factory=now_iso)


class ExperimentCreate(BaseModel):
    batch: str
    researcher: str
    condition: str
    hours: float


class ExperimentUpdate(BaseModel):
    notes: Optional[str] = None
    photo_base64: Optional[str] = None
    removed_at: Optional[int] = None


# --------------------- Helpers ---------------------
async def _seed_default_researchers():
    count = await db.researchers.count_documents({})
    if count == 0:
        await db.researchers.insert_one(Researcher(name="Solomon").dict())


# --------------------- Routes ---------------------
@api_router.get("/")
async def root():
    return {"message": "Ageing Monitor API", "status": "ok"}


# Researchers
@api_router.get("/researchers", response_model=List[Researcher])
async def list_researchers():
    items = await db.researchers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return [Researcher(**r) for r in items]


@api_router.post("/researchers", response_model=Researcher)
async def create_researcher(payload: ResearcherCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    existing = await db.researchers.find_one({"name": name}, {"_id": 0})
    if existing:
        return Researcher(**existing)
    r = Researcher(name=name)
    await db.researchers.insert_one(r.dict())
    return r


@api_router.delete("/researchers/{researcher_id}")
async def delete_researcher(researcher_id: str):
    res = await db.researchers.delete_one({"id": researcher_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Researcher not found")
    return {"deleted": True}


# Experiments
@api_router.get("/experiments", response_model=List[Experiment])
async def list_experiments(include_completed: bool = True):
    query = {}
    items = await db.experiments.find(query, {"_id": 0}).sort("end_time", 1).to_list(2000)
    if not include_completed:
        items = [i for i in items if not i.get("removed_at")]
    return [Experiment(**i) for i in items]


@api_router.post("/experiments", response_model=Experiment)
async def create_experiment(payload: ExperimentCreate):
    batch = payload.batch.strip()
    researcher = payload.researcher.strip()
    condition = payload.condition.strip()
    if not batch or not researcher or not condition or payload.hours <= 0:
        raise HTTPException(status_code=400, detail="All fields are required and hours must be > 0")

    # auto-register researcher if new
    existing = await db.researchers.find_one({"name": researcher}, {"_id": 0})
    if not existing:
        await db.researchers.insert_one(Researcher(name=researcher).dict())

    start_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    end_ms = start_ms + int(payload.hours * 60 * 60 * 1000)
    exp = Experiment(
        batch=batch,
        researcher=researcher,
        condition=condition,
        hours=payload.hours,
        start_time=start_ms,
        end_time=end_ms,
    )
    await db.experiments.insert_one(exp.dict())
    return exp


@api_router.get("/experiments/export/csv", response_class=PlainTextResponse)
async def export_csv_v2():
    # Declared before dynamic /{exp_id} to avoid shadowing.
    return await export_csv()


@api_router.get("/experiments/{exp_id}", response_model=Experiment)
async def get_experiment(exp_id: str):
    doc = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return Experiment(**doc)


@api_router.patch("/experiments/{exp_id}", response_model=Experiment)
async def update_experiment(exp_id: str, payload: ExperimentUpdate):
    updates = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        doc = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Experiment not found")
        return Experiment(**doc)

    result = await db.experiments.find_one_and_update(
        {"id": exp_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return Experiment(**result)


@api_router.post("/experiments/{exp_id}/remove", response_model=Experiment)
async def mark_sample_removed(exp_id: str):
    removed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
    result = await db.experiments.find_one_and_update(
        {"id": exp_id},
        {"$set": {"removed_at": removed_at}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return Experiment(**result)


@api_router.delete("/experiments/{exp_id}")
async def delete_experiment(exp_id: str):
    res = await db.experiments.delete_one({"id": exp_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"deleted": True}


@api_router.get("/experiments/export/csv", response_class=PlainTextResponse)
async def export_csv():
    items = await db.experiments.find({}, {"_id": 0}).sort("start_time", -1).to_list(5000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Sample ID", "Researcher", "Condition", "Target Hours",
        "Start (UTC)", "End (UTC)", "Removed At (UTC)", "Status", "Notes",
    ])
    for i in items:
        def fmt(ms):
            if not ms:
                return ""
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
        status = "Removed" if i.get("removed_at") else (
            "Ready to Remove" if i.get("end_time", 0) <= int(datetime.now(timezone.utc).timestamp() * 1000) else "Ageing"
        )
        writer.writerow([
            i.get("batch", ""),
            i.get("researcher", ""),
            i.get("condition", ""),
            i.get("hours", ""),
            fmt(i.get("start_time")),
            fmt(i.get("end_time")),
            fmt(i.get("removed_at")),
            status,
            (i.get("notes") or "").replace("\n", " "),
        ])
    return PlainTextResponse(content=buf.getvalue(), media_type="text/csv")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    await _seed_default_researchers()
    if is_email_configured():
        logger.info("Gmail SMTP configured — completion alerts ENABLED")
    else:
        logger.info("Gmail SMTP NOT configured — completion alerts disabled")
    app.state.watcher_task = asyncio.create_task(_completion_watcher())


@app.on_event("shutdown")
async def shutdown_db_client():
    task: Optional[asyncio.Task] = getattr(app.state, "watcher_task", None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    client.close()


async def _completion_watcher(interval_seconds: int = 60) -> None:
    """Every interval, find experiments whose end_time has passed but no email
    has been sent yet, and dispatch a completion email. Errors are logged and
    retried on the next tick (Gmail rate limits, transient network, etc).
    """
    while True:
        try:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            cursor = db.experiments.find(
                {
                    "end_time": {"$lte": now_ms},
                    "email_notified_at": None,
                    "removed_at": None,
                },
                {"_id": 0},
            )
            due = await cursor.to_list(50)
            for exp in due:
                ok = await send_completion_email_async(exp)
                if ok:
                    await db.experiments.update_one(
                        {"id": exp["id"], "email_notified_at": None},
                        {"$set": {"email_notified_at": now_ms}},
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("completion watcher tick failed: %s", exc)
        await asyncio.sleep(interval_seconds)
