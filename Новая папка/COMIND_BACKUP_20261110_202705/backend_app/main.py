from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db, init_chat_access

from app.api.routes.auth import router as auth_router
from app.api.routes.communities import router as communities_router
from app.api.routes.channels import router as channels_router
from app.api.routes.admin import router as admin_router
from app.api.routes.voice import router as voice_router
from app.api.routes.dm import router as dm_router, init_dm
from app.api.routes.extended import router as extended_router, init_extended


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_chat_access()
    init_extended()
    init_dm()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="Gaming community and social platform API",
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "null",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "capacitor://localhost",
        "http://localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core API
app.include_router(auth_router)
app.include_router(communities_router)
app.include_router(channels_router)
app.include_router(admin_router)

# Social and platform features
app.include_router(extended_router)
app.include_router(dm_router)

# Voice communication
app.include_router(voice_router)


@app.get("/")
def root():
    return {
        "message": settings.APP_NAME,
        "status": "running",
        "version": settings.APP_VERSION,
    }


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "backend"}


@app.get("/api/database/health")
def database_health():
    from app.core.database import get_db

    with get_db() as connection:
        connection.execute("SELECT 1").fetchone()

    return {"status": "ok", "database": "sqlite"}

