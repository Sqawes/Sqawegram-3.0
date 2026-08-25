import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "sqawe.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()

    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT,
        photo_url TEXT,
        bio TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        caption TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(post_id, user_id),
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    conn.commit()
    conn.close()


def upsert_user(user):
    conn = get_conn()

    conn.execute("""
        INSERT INTO users (id, username, first_name, last_name, photo_url)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            username=excluded.username,
            first_name=excluded.first_name,
            last_name=excluded.last_name,
            photo_url=excluded.photo_url
    """, (
        user["id"],
        user.get("username"),
        user.get("first_name", "User"),
        user.get("last_name"),
        user.get("photo_url")
    ))

    conn.commit()
    conn.close()


def get_user(user_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE id=?",
        (user_id,)
    ).fetchone()
    conn.close()

    return dict(row) if row else None


def get_feed(current_user_id):
    conn = get_conn()

    rows = conn.execute("""
        SELECT
            p.id,
            p.user_id,
            p.image_path,
            p.caption,
            p.created_at,
            u.username,
            u.first_name,
            u.last_name,
            u.photo_url,
            COUNT(DISTINCT l.user_id) AS likes,
            EXISTS(
                SELECT 1
                FROM likes ml
                WHERE ml.post_id=p.id
                AND ml.user_id=?
            ) AS liked
        FROM posts p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN likes l ON l.post_id=p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100
    """, (current_user_id,)).fetchall()

    conn.close()

    return [dict(r) for r in rows]


def create_post(user_id, image_path, caption):
    conn = get_conn()

    cur = conn.execute(
        "INSERT INTO posts (user_id, image_path, caption) VALUES (?, ?, ?)",
        (user_id, image_path, caption)
    )

    conn.commit()
    post_id = cur.lastrowid
    conn.close()

    return post_id


def toggle_like(post_id, user_id):
    conn = get_conn()

    exists = conn.execute(
        "SELECT 1 FROM likes WHERE post_id=? AND user_id=?",
        (post_id, user_id)
    ).fetchone()

    if exists:
        conn.execute(
            "DELETE FROM likes WHERE post_id=? AND user_id=?",
            (post_id, user_id)
        )
        liked = False
    else:
        conn.execute(
            "INSERT INTO likes (post_id, user_id) VALUES (?, ?)",
            (post_id, user_id)
        )
        liked = True

    conn.commit()

    count = conn.execute(
        "SELECT COUNT(*) AS n FROM likes WHERE post_id=?",
        (post_id,)
    ).fetchone()["n"]

    conn.close()

    return liked, count


def get_profile(user_id):
    conn = get_conn()

    user = conn.execute(
        "SELECT * FROM users WHERE id=?",
        (user_id,)
    ).fetchone()

    posts = conn.execute("""
        SELECT
            p.id,
            p.image_path,
            p.caption,
            p.created_at,
            COUNT(l.user_id) AS likes
        FROM posts p
        LEFT JOIN likes l ON l.post_id=p.id
        WHERE p.user_id=?
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
    """, (user_id,)).fetchall()

    conn.close()

    return (
        dict(user) if user else None,
        [dict(p) for p in posts]
    )