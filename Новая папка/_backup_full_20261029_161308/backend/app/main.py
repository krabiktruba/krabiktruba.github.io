from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db
from app.api.routes.auth import router as auth_router
from app.api.routes.communities import router as communities_router
from app.api.routes.channels import router as channels_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="API игровой социальной платформы",
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
        "capacitor://localhost",
        "http://localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(communities_router)
app.include_router(channels_router)


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

