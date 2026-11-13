import sqlite3
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.routes.auth import current_user

router = APIRouter(prefix="/api/forum", tags=["Forum"])


DEFAULT_CATEGORIES = [
    ("games", "Игры", "Обсуждения, обзоры и игровые впечатления"),
    ("gaming-news", "Новости игровой индустрии", "Анонсы, события и обновления"),
    ("technology", "Технологии", "Оборудование и программное обеспечение"),
    ("development", "Разработка", "Создание игр и программирование"),
    ("guides", "Гайды и помощь", "Советы и инструкции"),
    ("community", "Сообщество", "Общение и свободные темы"),
]


def init_forum():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS forum_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS forum_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                views INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_locked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(category_id)
                    REFERENCES forum_categories(id),
                FOREIGN KEY(author_id)
                    REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS forum_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                edited_at TEXT,
                FOREIGN KEY(topic_id)
                    REFERENCES forum_topics(id) ON DELETE CASCADE,
                FOREIGN KEY(author_id)
                    REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_forum_topics_category
            ON forum_topics(category_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_forum_topics_author
            ON forum_topics(author_id);

            CREATE INDEX IF NOT EXISTS idx_forum_posts_topic
            ON forum_posts(topic_id, id);

            CREATE INDEX IF NOT EXISTS idx_forum_posts_author
            ON forum_posts(author_id);

            CREATE TABLE IF NOT EXISTS forum_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER,
                post_id INTEGER,
                uploader_id INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                content_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(topic_id) REFERENCES forum_topics(id) ON DELETE CASCADE,
                FOREIGN KEY(post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
                FOREIGN KEY(uploader_id) REFERENCES users(id),
                CHECK (
                    (topic_id IS NOT NULL AND post_id IS NULL)
                    OR
                    (topic_id IS NULL AND post_id IS NOT NULL)
                )
            );

            CREATE INDEX IF NOT EXISTS idx_forum_attachments_topic
            ON forum_attachments(topic_id);

            CREATE INDEX IF NOT EXISTS idx_forum_attachments_post
            ON forum_attachments(post_id);
        """)

        for order, (slug, name, description) in enumerate(DEFAULT_CATEGORIES):
            db.execute("""
                INSERT OR IGNORE INTO forum_categories
                (slug, name, description, sort_order)
                VALUES (?, ?, ?, ?)
            """, (slug, name, description, order))


class TopicCreate(BaseModel):
    category_id: int
    title: str = Field(min_length=5, max_length=140)
    content: str = Field(min_length=10, max_length=20000)


class PostCreate(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


class TopicUpdate(BaseModel):
    title: str = Field(min_length=5, max_length=140)
    content: str = Field(min_length=10, max_length=20000)


class PostUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


MAX_FILE_SIZE = 15 * 1024 * 1024
MAX_ATTACHMENTS = 5
UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads" / "forum"

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".zip",
    ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".mov"
}

def attachment_data(row):
    item = dict(row)
    item["download_url"] = f"/api/forum/attachments/{item['id']}/download"
    return item

def get_attachments(db, topic_id=None, post_id=None):
    if topic_id is not None:
        rows = db.execute(
            "SELECT * FROM forum_attachments WHERE topic_id=? ORDER BY id",
            (topic_id,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM forum_attachments WHERE post_id=? ORDER BY id",
            (post_id,)
        ).fetchall()
    return [attachment_data(row) for row in rows]


# _viamucus_safe_get_attachments_wrapper
_viamucus_original_get_attachments = get_attachments

def get_attachments(db, *args, **kwargs):
    try:
        return _viamucus_original_get_attachments(db, *args, **kwargs)
    except Exception as exc:
        if "closed database" not in str(exc).lower():
            raise
        resource = get_db()
        fresh_db = next(resource)
        try:
            return _viamucus_original_get_attachments(fresh_db, *args, **kwargs)
        finally:
            resource.close()

def remove_attachment_files(db, column, entity_id):
    if column not in ("topic_id", "post_id"):
        raise ValueError("Invalid attachment owner column")
    rows = db.execute(
        f"SELECT stored_name FROM forum_attachments WHERE {column}=?",
        (entity_id,)
    ).fetchall()
    for row in rows:
        try:
            (UPLOAD_DIR / row["stored_name"]).unlink(missing_ok=True)
        except OSError:
            pass

def get_topic(db, topic_id):
    topic = db.execute("""
        SELECT
            t.*,
            u.username AS author,
            COALESCE(u.display_name, '') AS display_name,
            c.name AS category,
            c.slug AS category_slug,
            (SELECT COUNT(*) FROM forum_posts p
             WHERE p.topic_id=t.id) AS replies
        FROM forum_topics t
        JOIN users u ON u.id=t.author_id
        JOIN forum_categories c ON c.id=t.category_id
        WHERE t.id=?
    """, (topic_id,)).fetchone()

    if not topic:
        return None
    result = dict(topic)
    result["attachments"] = get_attachments(db, topic_id=topic_id)
    return result


@router.get("/categories")
def categories(user: dict = Depends(current_user)):
    with get_db() as db:
        rows = db.execute("""
            SELECT
                c.*,
                COUNT(t.id) AS topic_count
            FROM forum_categories c
            LEFT JOIN forum_topics t ON t.category_id=c.id
            GROUP BY c.id
            ORDER BY c.sort_order, c.id
        """).fetchall()

    return [dict(row) for row in rows]


@router.get("/topics")
def topics(
    category_id: int | None = None,
    q: str = Query(default="", max_length=150),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    conditions = []
    params = []

    if category_id is not None:
        conditions.append("t.category_id=?")
        params.append(category_id)

    if q.strip():
        conditions.append("(t.title LIKE ? OR t.content LIKE ?)")
        term = "%" + q.strip() + "%"
        params.extend([term, term])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db() as db:
        rows = db.execute(f"""
            SELECT
                t.id,
                t.category_id,
                t.author_id,
                t.title,
                t.content,
                t.views,
                t.is_pinned,
                t.is_locked,
                t.created_at,
                t.updated_at,
                u.username AS author,
                c.name AS category,
                c.slug AS category_slug,
                (SELECT COUNT(*) FROM forum_posts p
                 WHERE p.topic_id=t.id) AS replies
            FROM forum_topics t
            JOIN users u ON u.id=t.author_id
            JOIN forum_categories c ON c.id=t.category_id
            {where}
            ORDER BY t.is_pinned DESC, t.created_at DESC, t.id DESC
            LIMIT ? OFFSET ?
        """, (*params, limit, offset)).fetchall()

        total = db.execute(f"""
            SELECT COUNT(*) AS total
            FROM forum_topics t
            {where}
        """, params).fetchone()["total"]

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/topics", status_code=201)
def create_topic(
    data: TopicCreate,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        category = db.execute(
            "SELECT id FROM forum_categories WHERE id=?",
            (data.category_id,)
        ).fetchone()

        if category is None:
            raise HTTPException(404, "Категория не найдена")

        cursor = db.execute("""
            INSERT INTO forum_topics
            (category_id, author_id, title, content)
            VALUES (?, ?, ?, ?)
        """, (
            data.category_id,
            user["id"],
            data.title.strip(),
            data.content.strip(),
        ))

        topic = get_topic(db, cursor.lastrowid)

    return topic


@router.get("/topics/{topic_id}")
def topic_detail(
    topic_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        db.execute(
            "UPDATE forum_topics SET views=views+1 WHERE id=?",
            (topic_id,)
        )
        topic = get_topic(db, topic_id)

    if topic is None:
        raise HTTPException(404, "Тема не найдена")

    return topic


@router.patch("/topics/{topic_id}")
def update_topic(
    topic_id: int,
    data: TopicUpdate,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        topic = db.execute(
            "SELECT author_id FROM forum_topics WHERE id=?",
            (topic_id,)
        ).fetchone()

        if topic is None:
            raise HTTPException(404, "Тема не найдена")

        if topic["author_id"] != user["id"] and not user.get("is_admin"):
            raise HTTPException(403, "Недостаточно прав")

        db.execute("""
            UPDATE forum_topics
            SET title=?, content=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        """, (data.title.strip(), data.content.strip(), topic_id))

        result = get_topic(db, topic_id)

    return result


@router.delete("/topics/{topic_id}")
def delete_topic(
    topic_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        topic = db.execute(
            "SELECT author_id FROM forum_topics WHERE id=?",
            (topic_id,)
        ).fetchone()

        if topic is None:
            raise HTTPException(404, "Тема не найдена")

        if topic["author_id"] != user["id"] and not user.get("is_admin"):
            raise HTTPException(403, "Недостаточно прав")

        remove_attachment_files(db, "topic_id", topic_id)
        post_rows = db.execute(
            "SELECT id FROM forum_posts WHERE topic_id=?",
            (topic_id,)
        ).fetchall()
        for post_row in post_rows:
            remove_attachment_files(db, "post_id", post_row["id"])
        db.execute("DELETE FROM forum_topics WHERE id=?", (topic_id,))

    return {"status": "deleted", "topic_id": topic_id}


@router.get("/topics/{topic_id}/posts")
def get_posts(
    topic_id: int,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    with get_db() as db:
        topic = db.execute(
            "SELECT id FROM forum_topics WHERE id=?",
            (topic_id,)
        ).fetchone()

        if topic is None:
            raise HTTPException(404, "Тема не найдена")

        rows = db.execute("""
            SELECT
                p.id,
                p.topic_id,
                p.author_id,
                p.content,
                p.created_at,
                p.edited_at,
                u.username AS author,
                COALESCE(u.display_name, '') AS display_name
            FROM forum_posts p
            JOIN users u ON u.id=p.author_id
            WHERE p.topic_id=?
            ORDER BY p.id ASC
            LIMIT ? OFFSET ?
        """, (topic_id, limit, offset)).fetchall()

        total = db.execute(
            "SELECT COUNT(*) AS total FROM forum_posts WHERE topic_id=?",
            (topic_id,)
        ).fetchone()["total"]

    return {
        "items": [
            {**dict(row), "attachments": get_attachments(db, post_id=row["id"])}
            for row in rows
        ],
        "total": total,
    }


@router.post("/topics/{topic_id}/posts", status_code=201)
def create_post(
    topic_id: int,
    data: PostCreate,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        topic = db.execute(
            "SELECT id, is_locked FROM forum_topics WHERE id=?",
            (topic_id,)
        ).fetchone()

        if topic is None:
            raise HTTPException(404, "Тема не найдена")

        if topic["is_locked"]:
            raise HTTPException(403, "Тема закрыта для ответов")

        cursor = db.execute("""
            INSERT INTO forum_posts (topic_id, author_id, content)
            VALUES (?, ?, ?)
        """, (topic_id, user["id"], data.content.strip()))

        db.execute(
            "UPDATE forum_topics SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (topic_id,)
        )

        post = db.execute("""
            SELECT
                p.*,
                u.username AS author,
                COALESCE(u.display_name, '') AS display_name
            FROM forum_posts p
            JOIN users u ON u.id=p.author_id
            WHERE p.id=?
        """, (cursor.lastrowid,)).fetchone()

    return dict(post)


@router.patch("/posts/{post_id}")
def update_post(
    post_id: int,
    data: PostUpdate,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        post = db.execute(
            "SELECT author_id FROM forum_posts WHERE id=?",
            (post_id,)
        ).fetchone()

        if post is None:
            raise HTTPException(404, "Ответ не найден")

        if post["author_id"] != user["id"] and not user.get("is_admin"):
            raise HTTPException(403, "Недостаточно прав")

        db.execute("""
            UPDATE forum_posts
            SET content=?, edited_at=CURRENT_TIMESTAMP
            WHERE id=?
        """, (data.content.strip(), post_id))

        result = db.execute("""
            SELECT p.*, u.username AS author,
                   COALESCE(u.display_name, '') AS display_name
            FROM forum_posts p
            JOIN users u ON u.id=p.author_id
            WHERE p.id=?
        """, (post_id,)).fetchone()

    return dict(result)


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        post = db.execute(
            "SELECT author_id, topic_id FROM forum_posts WHERE id=?",
            (post_id,)
        ).fetchone()

        if post is None:
            raise HTTPException(404, "Ответ не найден")

        if post["author_id"] != user["id"] and not user.get("is_admin"):
            raise HTTPException(403, "Недостаточно прав")

        remove_attachment_files(db, "post_id", post_id)
        db.execute("DELETE FROM forum_posts WHERE id=?", (post_id,))
        topic_id = post["topic_id"]

    return {"status": "deleted", "post_id": post_id, "topic_id": topic_id}


# ---------------------------------------------------------
# Загрузка, скачивание и удаление вложений форума
# ---------------------------------------------------------

def check_upload_access(db, entity_type, entity_id, user):
    if entity_type == "topic":
        entity = db.execute(
            "SELECT id, author_id FROM forum_topics WHERE id=?",
            (entity_id,)
        ).fetchone()
        column = "topic_id"
    else:
        entity = db.execute(
            "SELECT id, author_id FROM forum_posts WHERE id=?",
            (entity_id,)
        ).fetchone()
        column = "post_id"

    if entity is None:
        raise HTTPException(404, "Публикация не найдена")

    if entity["author_id"] != user["id"] and not user.get("is_admin"):
        raise HTTPException(403, "Прикреплять файлы может автор публикации или администратор")

    count = db.execute(
        f"SELECT COUNT(*) AS total FROM forum_attachments WHERE {column}=?",
        (entity_id,)
    ).fetchone()["total"]

    if count >= MAX_ATTACHMENTS:
        raise HTTPException(400, f"Можно прикрепить не более {MAX_ATTACHMENTS} файлов")

    return column

async def save_forum_attachment(file, entity_type, entity_id, user):
    original_name = Path(file.filename or "file").name
    suffix = Path(original_name).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Этот тип файла запрещён")

    content = await file.read(MAX_FILE_SIZE + 1)
    if not content:
        raise HTTPException(400, "Файл пуст")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "Максимальный размер файла — 15 МБ")

    content_type = file.content_type or "application/octet-stream"
    stored_name = f"{uuid.uuid4().hex}{suffix}"

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOAD_DIR / stored_name
    destination.write_bytes(content)

    try:
        with get_db() as db:
            column = check_upload_access(db, entity_type, entity_id, user)
            if entity_type == "topic":
                db.execute("""
                    INSERT INTO forum_attachments
                    (topic_id, uploader_id, original_name, stored_name, content_type, file_size)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (entity_id, user["id"], original_name, stored_name, content_type, len(content)))
            else:
                db.execute("""
                    INSERT INTO forum_attachments
                    (post_id, uploader_id, original_name, stored_name, content_type, file_size)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (entity_id, user["id"], original_name, stored_name, content_type, len(content)))

            row = db.execute(
                "SELECT * FROM forum_attachments WHERE stored_name=?",
                (stored_name,)
            ).fetchone()
            return attachment_data(row)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

@router.post("/topics/{topic_id}/attachments", status_code=201)
async def upload_topic_attachment(
    topic_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    return await save_forum_attachment(file, "topic", topic_id, user)

@router.post("/posts/{post_id}/attachments", status_code=201)
async def upload_post_attachment(
    post_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    return await save_forum_attachment(file, "post", post_id, user)

@router.get("/attachments/{attachment_id}/download")
def download_forum_attachment(
    attachment_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        row = db.execute("""
            SELECT a.*, t.id AS parent_topic_id, p.topic_id AS post_topic_id
            FROM forum_attachments a
            LEFT JOIN forum_topics t ON t.id=a.topic_id
            LEFT JOIN forum_posts p ON p.id=a.post_id
            WHERE a.id=?
        """, (attachment_id,)).fetchone()

        if row is None:
            raise HTTPException(404, "Файл не найден")

        path = UPLOAD_DIR / row["stored_name"]
        if not path.is_file():
            raise HTTPException(404, "Файл отсутствует на сервере")

        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=row["original_name"],
            headers={"X-Content-Type-Options": "nosniff"}
        )

@router.delete("/attachments/{attachment_id}")
def delete_forum_attachment(
    attachment_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        row = db.execute("""
            SELECT a.*, t.author_id AS topic_author, p.author_id AS post_author
            FROM forum_attachments a
            LEFT JOIN forum_topics t ON t.id=a.topic_id
            LEFT JOIN forum_posts p ON p.id=a.post_id
            WHERE a.id=?
        """, (attachment_id,)).fetchone()

        if row is None:
            raise HTTPException(404, "Файл не найден")

        parent_author = row["topic_author"] if row["topic_id"] is not None else row["post_author"]
        allowed = (
            row["uploader_id"] == user["id"]
            or parent_author == user["id"]
            or user.get("is_admin")
        )
        if not allowed:
            raise HTTPException(403, "Недостаточно прав")

        (UPLOAD_DIR / row["stored_name"]).unlink(missing_ok=True)
        db.execute("DELETE FROM forum_attachments WHERE id=?", (attachment_id,))

    return {"status": "deleted", "attachment_id": attachment_id}

# VIAMUCUS_TOPIC_ATTACHMENTS_RESPONSE
_viamucus_original_get_topic = get_topic

def get_topic(db, topic_id):
    result = _viamucus_original_get_topic(db, topic_id)

    if result is None:
        return result

    try:
        result["attachments"] = get_attachments(db, topic_id=topic_id)
    except Exception as exc:
        if "closed database" not in str(exc).lower():
            raise

        resource = get_db()
        fresh_db = next(resource) if hasattr(resource, "__next__") else resource

        try:
            result["attachments"] = get_attachments(
                fresh_db,
                topic_id=topic_id
            )
        finally:
            if hasattr(resource, "close"):
                resource.close()
            elif hasattr(fresh_db, "close"):
                fresh_db.close()

    return result