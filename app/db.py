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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT
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

    CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sender_id, receiver_id),
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
        user_id INTEGER NOT NULL,
        friend_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, friend_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(friend_id) REFERENCES users(id)
    );
    """)

    try:
        conn.execute(
            "ALTER TABLE users ADD COLUMN last_seen TEXT"
        )
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


def upsert_user(user):
    conn = get_conn()

    conn.execute("""
        INSERT INTO users (
            id,
            username,
            first_name,
            last_name,
            photo_url
        )
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


def update_last_seen(user_id):
    conn = get_conn()

    conn.execute(
        """
        UPDATE users
        SET last_seen=CURRENT_TIMESTAMP
        WHERE id=?
        """,
        (user_id,)
    )

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
        """
        INSERT INTO posts (
            user_id,
            image_path,
            caption
        )
        VALUES (?, ?, ?)
        """,
        (user_id, image_path, caption)
    )

    conn.commit()
    post_id = cur.lastrowid
    conn.close()

    return post_id


def toggle_like(post_id, user_id):
    conn = get_conn()

    exists = conn.execute(
        """
        SELECT 1
        FROM likes
        WHERE post_id=? AND user_id=?
        """,
        (post_id, user_id)
    ).fetchone()

    if exists:
        conn.execute(
            """
            DELETE FROM likes
            WHERE post_id=? AND user_id=?
            """,
            (post_id, user_id)
        )
        liked = False
    else:
        conn.execute(
            """
            INSERT INTO likes (
                post_id,
                user_id
            )
            VALUES (?, ?)
            """,
            (post_id, user_id)
        )
        liked = True

    conn.commit()

    count = conn.execute(
        """
        SELECT COUNT(*)
        AS n
        FROM likes
        WHERE post_id=?
        """,
        (post_id,)
    ).fetchone()["n"]

    conn.close()

    return liked, count


def get_profile(user_id):
    conn = get_conn()

    user = conn.execute(
        """
        SELECT *
        FROM users
        WHERE id=?
        """,
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


def get_friend_status(current_user_id, other_user_id):
    if current_user_id == other_user_id:
        return "self"

    conn = get_conn()

    friend = conn.execute(
        """
        SELECT 1
        FROM friendships
        WHERE user_id=? AND friend_id=?
        """,
        (current_user_id, other_user_id)
    ).fetchone()

    if friend:
        conn.close()
        return "friends"

    outgoing = conn.execute(
        """
        SELECT 1
        FROM friend_requests
        WHERE sender_id=?
          AND receiver_id=?
          AND status='pending'
        """,
        (current_user_id, other_user_id)
    ).fetchone()

    if outgoing:
        conn.close()
        return "pending"

    incoming = conn.execute(
        """
        SELECT 1
        FROM friend_requests
        WHERE sender_id=?
          AND receiver_id=?
          AND status='pending'
        """,
        (other_user_id, current_user_id)
    ).fetchone()

    conn.close()

    if incoming:
        return "incoming"

    return "none"


def send_friend_request(sender_id, receiver_id):
    if sender_id == receiver_id:
        return False

    conn = get_conn()

    exists = conn.execute(
        """
        SELECT 1
        FROM friendships
        WHERE user_id=? AND friend_id=?
        """,
        (sender_id, receiver_id)
    ).fetchone()

    if exists:
        conn.close()
        return False

    conn.execute(
        """
        INSERT OR IGNORE INTO friend_requests (
            sender_id,
            receiver_id,
            status
        )
        VALUES (?, ?, 'pending')
        """,
        (sender_id, receiver_id)
    )

    conn.commit()
    conn.close()

    return True


def accept_friend_request(receiver_id, sender_id):
    conn = get_conn()

    request = conn.execute(
        """
        SELECT 1
        FROM friend_requests
        WHERE sender_id=?
          AND receiver_id=?
          AND status='pending'
        """,
        (sender_id, receiver_id)
    ).fetchone()

    if not request:
        conn.close()
        return False

    conn.execute(
        """
        UPDATE friend_requests
        SET status='accepted'
        WHERE sender_id=?
          AND receiver_id=?
        """,
        (sender_id, receiver_id)
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO friendships (
            user_id,
            friend_id
        )
        VALUES (?, ?)
        """,
        (receiver_id, sender_id)
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO friendships (
            user_id,
            friend_id
        )
        VALUES (?, ?)
        """,
        (sender_id, receiver_id)
    )

    conn.commit()
    conn.close()

    return True


def decline_friend_request(receiver_id, sender_id):
    conn = get_conn()

    cur = conn.execute(
        """
        UPDATE friend_requests
        SET status='declined'
        WHERE sender_id=?
          AND receiver_id=?
          AND status='pending'
        """,
        (sender_id, receiver_id)
    )

    conn.commit()

    changed = cur.rowcount > 0

    conn.close()

    return changed


def get_friends(user_id):
    conn = get_conn()

    rows = conn.execute(
        """
        SELECT u.*
        FROM users u
        JOIN friendships f
          ON f.friend_id=u.id
        WHERE f.user_id=?
        ORDER BY u.first_name
        """,
        (user_id,)
    ).fetchall()

    conn.close()

    return [dict(row) for row in rows]