import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    init_db,
    upsert_user,
    get_user,
    get_feed,
    create_post,
    toggle_like,
    get_profile,
)
from .telegram_auth import validate_init_data


load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "app" / "static"
UPLOADS_DIR = BASE_DIR / "uploads"

UPLOADS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Sqawe v0.1")

init_db()

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static",
)

app.mount(
    "/uploads",
    StaticFiles(directory=UPLOADS_DIR),
    name="uploads",
)


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


def current_user(x_telegram_init_data: str | None):
    if not BOT_TOKEN:
        raise HTTPException(
            status_code=500,
            detail=(
                "BOT_TOKEN is not configured. "
                "Copy .env.example to .env and set BOT_TOKEN."
            ),
        )

    try:
        user = validate_init_data(
            x_telegram_init_data or "",
            BOT_TOKEN,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail=str(exc),
        )

    upsert_user(user)

    return user


@app.get("/api/me")
def me(
    x_telegram_init_data: str | None = Header(default=None),
):
    user = current_user(x_telegram_init_data)
    return get_user(user["id"])


@app.get("/api/feed")
def feed(
    x_telegram_init_data: str | None = Header(default=None),
):
    user = current_user(x_telegram_init_data)
    return get_feed(user["id"])


@app.post("/api/posts")
async def post(
    file: UploadFile = File(...),
    caption: str = Form(""),
    x_telegram_init_data: str | None = Header(default=None),
):
    user = current_user(x_telegram_init_data)

    if (
        not file.content_type
        or not file.content_type.startswith("image/")
    ):
        raise HTTPException(
            status_code=400,
            detail="Only images are allowed.",
        )

    data = await file.read()

    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Image is larger than 10 MB.",
        )

    ext = Path(file.filename or "").suffix.lower()

    if ext not in {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
    }:
        ext = ".jpg"

    filename = f"{uuid.uuid4().hex}{ext}"

    path = UPLOADS_DIR / filename
    path.write_bytes(data)

    post_id = create_post(
        user["id"],
        filename,
        caption[:1000],
    )

    return {
        "ok": True,
        "id": post_id,
    }


@app.post("/api/posts/{post_id}/like")
def like(
    post_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    user = current_user(x_telegram_init_data)

    liked, count = toggle_like(
        post_id,
        user["id"],
    )

    return {
        "liked": liked,
        "likes": count,
    }


@app.get("/api/users/{user_id}")
def profile(
    user_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current_user(x_telegram_init_data)

    user, posts = get_profile(user_id)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    return {
        "user": user,
        "posts": posts,
    }