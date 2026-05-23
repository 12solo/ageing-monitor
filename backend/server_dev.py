"""Dev version — in-memory MongoDB via mongomock-motor. No real DB needed."""
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from starlette.middleware.cors import CORSMiddleware
from mongomock_motor import AsyncMongoMockClient
import asyncio, os, logging, io, csv, uuid
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone

client = AsyncMongoMockClient()
db = client["ageing_monitor"]

app = FastAPI(title="Ageing Monitor API")
api_router = APIRouter(prefix="/api")

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
    start_time: int
    end_time: int
    removed_at: Optional[int] = None
    email_notified_at: Optional[int] = None
    notes: Optional[str] = ""
    photo_base64: Optional[str] = None
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

async def _seed():
    if await db.researchers.count_documents({}) == 0:
        for name in ["Solomon", "sol", "user"]:
            await db.researchers.insert_one(Researcher(name=name).dict())

    if await db.experiments.count_documents({}) == 0:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        seeds = [
            ("PBS-CSS-01",  "Solomon", "Hydrothermal ageing – Water bath at 60°C",  336),
            ("PBS-MP-01",   "sol",   "Hydrothermal ageing – Water bath at 80°C",  168),
            ("ECO-CSS-01",  "user",     "Oven ageing at 70°C",                       500),
            ("PBS-WP-01",   "Solomon", "UV ageing – UVA",                           720),
            ("ECO-OP-01",   "sol",   "UV ageing – UVC",                           240),
        ]
        for batch, researcher, condition, hours in seeds:
            start_ms = now_ms
            end_ms   = now_ms + int(hours * 3_600_000)
            exp = Experiment(batch=batch, researcher=researcher, condition=condition,
                             hours=hours, start_time=start_ms, end_time=end_ms)
            await db.experiments.insert_one(exp.dict())

@api_router.get("/")
async def root():
    return {"message": "Ageing Monitor API", "status": "ok"}

@api_router.get("/researchers", response_model=List[Researcher])
async def list_researchers():
    items = await db.researchers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return [Researcher(**r) for r in items]

@api_router.post("/researchers", response_model=Researcher)
async def create_researcher(payload: ResearcherCreate):
    name = payload.name.strip()
    if not name: raise HTTPException(400, "Name is required")
    existing = await db.researchers.find_one({"name": name}, {"_id": 0})
    if existing: return Researcher(**existing)
    r = Researcher(name=name)
    await db.researchers.insert_one(r.dict())
    return r

@api_router.delete("/researchers/{researcher_id}")
async def delete_researcher(researcher_id: str):
    res = await db.researchers.delete_one({"id": researcher_id})
    if res.deleted_count == 0: raise HTTPException(404, "Researcher not found")
    return {"deleted": True}

@api_router.get("/experiments", response_model=List[Experiment])
async def list_experiments(include_completed: bool = True):
    items = await db.experiments.find({}, {"_id": 0}).sort("end_time", 1).to_list(2000)
    if not include_completed:
        items = [i for i in items if not i.get("removed_at")]
    return [Experiment(**i) for i in items]

@api_router.post("/experiments", response_model=Experiment)
async def create_experiment(payload: ExperimentCreate):
    batch = payload.batch.strip(); researcher = payload.researcher.strip()
    condition = payload.condition.strip()
    if not batch or not researcher or not condition or payload.hours <= 0:
        raise HTTPException(400, "All fields required and hours must be > 0")
    if not await db.researchers.find_one({"name": researcher}):
        await db.researchers.insert_one(Researcher(name=researcher).dict())
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    exp = Experiment(batch=batch, researcher=researcher, condition=condition,
                     hours=payload.hours, start_time=now_ms,
                     end_time=now_ms + int(payload.hours * 3_600_000))
    await db.experiments.insert_one(exp.dict())
    return exp

@api_router.get("/experiments/export/csv", response_class=PlainTextResponse)
async def export_csv_alias():
    return await export_csv()

@api_router.get("/experiments/{exp_id}", response_model=Experiment)
async def get_experiment(exp_id: str):
    doc = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    if not doc: raise HTTPException(404, "Not found")
    return Experiment(**doc)

@api_router.patch("/experiments/{exp_id}", response_model=Experiment)
async def update_experiment(exp_id: str, payload: ExperimentUpdate):
    updates = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        doc = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
        if not doc: raise HTTPException(404, "Not found")
        return Experiment(**doc)
    result = await db.experiments.find_one_and_update(
        {"id": exp_id}, {"$set": updates}, return_document=True, projection={"_id": 0})
    if not result: raise HTTPException(404, "Not found")
    return Experiment(**result)

@api_router.post("/experiments/{exp_id}/remove", response_model=Experiment)
async def mark_removed(exp_id: str):
    removed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
    result = await db.experiments.find_one_and_update(
        {"id": exp_id}, {"$set": {"removed_at": removed_at}},
        return_document=True, projection={"_id": 0})
    if not result: raise HTTPException(404, "Not found")
    return Experiment(**result)

@api_router.delete("/experiments/{exp_id}")
async def delete_experiment(exp_id: str):
    res = await db.experiments.delete_one({"id": exp_id})
    if res.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"deleted": True}

@api_router.get("/experiments/export/csv", response_class=PlainTextResponse)
async def export_csv():
    items = await db.experiments.find({}, {"_id": 0}).sort("start_time", -1).to_list(5000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Sample ID","Researcher","Condition","Target Hours",
                "Start (UTC)","End (UTC)","Removed At (UTC)","Status","Notes"])
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    for i in items:
        def fmt(ms):
            return "" if not ms else datetime.fromtimestamp(ms/1000, tz=timezone.utc).isoformat()
        status = ("Removed" if i.get("removed_at") else
                  "Ready to Remove" if i.get("end_time",0) <= now_ms else "Ageing")
        w.writerow([i.get("batch",""), i.get("researcher",""), i.get("condition",""),
                    i.get("hours",""), fmt(i.get("start_time")), fmt(i.get("end_time")),
                    fmt(i.get("removed_at")), status, (i.get("notes") or "").replace("\n"," ")])
    return PlainTextResponse(content=buf.getvalue(), media_type="text/csv")

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)

@app.on_event("startup")
async def startup():
    await _seed()
    logging.getLogger(__name__).info("Ageing Monitor API running (in-memory dev mode)")
