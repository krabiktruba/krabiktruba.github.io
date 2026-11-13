import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
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

    return dict(topic) if topic else None


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
        "items": [dict(row) for row in rows],
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

        db.execute("DELETE FROM forum_posts WHERE id=?", (post_id,))
        topic_id = post["topic_id"]

    return {"status": "deleted", "post_id": post_id, "topic_id": topic_id}
