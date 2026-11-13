import os

APP_NAME = "COMIND"
APP_VERSION = "0.1.0"

HOST = os.getenv("COMIND_HOST", "127.0.0.1")
PORT = int(os.getenv("COMIND_PORT", "8000"))
DEBUG = os.getenv("COMIND_DEBUG", "false").lower() == "true"

API_PREFIX = "/api"
