import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path('/app/data') if Path('/app/data').exists() else BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'sqawe.db'


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
        image_path TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_id INTEGER NOT NULL,
        actor_id INTEGER,
        type TEXT NOT NULL,
        post_id INTEGER,
        comment_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(recipient_id) REFERENCES users(id),
        FOREIGN KEY(actor_id) REFERENCES users(id),
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(comment_id) REFERENCES comments(id)
    );

    CREATE TABLE IF NOT EXISTS post_tags (
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(post_id, user_id),
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    try:
        conn.execute("ALTER TABLE users ADD COLUMN last_seen TEXT")
    except sqlite3.OperationalError:
        pass

    try:
        conn.execute("ALTER TABLE posts ADD COLUMN image_path TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

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
        user['id'],
        user.get('username'),
        user.get('first_name', 'User'),
        user.get('last_name'),
        user.get('photo_url')
    ))
    conn.commit()
    conn.close()


def update_last_seen(user_id):
    conn = get_conn()
    conn.execute('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?', (user_id,))
    conn.commit()
    conn.close()


def get_user(user_id):
    conn = get_conn()
    row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_notification(recipient_id, actor_id, notification_type, post_id=None, comment_id=None):
    if recipient_id == actor_id:
        return None
    conn = get_conn()
    cur = conn.execute(
        'INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)',
        (recipient_id, actor_id, notification_type, post_id, comment_id),
    )
    conn.commit()
    notification_id = cur.lastrowid
    conn.close()
    return notification_id


def get_notifications(user_id, unread_only=False):
    conn = get_conn()
    where = 'WHERE n.recipient_id=?'
    params = [user_id]
    if unread_only:
        where += ' AND n.is_read=0'
    rows = conn.execute(f"""
        SELECT
            n.id, n.type, n.post_id, n.comment_id, n.created_at, n.is_read,
            a.id AS actor_id,
            a.username AS actor_username,
            a.first_name AS actor_first_name,
            a.last_name AS actor_last_name,
            a.photo_url AS actor_photo_url
        FROM notifications n
        LEFT JOIN users a ON a.id=n.actor_id
        {where}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 100
    """, params).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_unread_notification_count(user_id):
    conn = get_conn()
    count = conn.execute(
        'SELECT COUNT(*) FROM notifications WHERE recipient_id=? AND is_read=0',
        (user_id,),
    ).fetchone()[0]
    conn.close()
    return count


def mark_all_notifications_read(user_id):
    conn = get_conn()
    conn.execute('UPDATE notifications SET is_read=1 WHERE recipient_id=? AND is_read=0', (user_id,))
    conn.commit()
    conn.close()


def mark_notification_read(user_id, notification_id):
    conn = get_conn()
    conn.execute(
        'UPDATE notifications SET is_read=1 WHERE id=? AND recipient_id=?',
        (notification_id, user_id),
    )
    conn.commit()
    conn.close()


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
            (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments,
            EXISTS(
                SELECT 1 FROM likes ml
                WHERE ml.post_id=p.id AND ml.user_id=?
            ) AS liked
        FROM posts p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN likes l ON l.post_id=p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100
    """, (current_user_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def create_post(user_id, image_path, caption):
    conn = get_conn()
    cur = conn.execute(
        'INSERT INTO posts (user_id, image_path, caption) VALUES (?, ?, ?)',
        (user_id, image_path or '', caption),
    )
    conn.commit()
    post_id = cur.lastrowid
    conn.close()
    return post_id


def toggle_like(post_id, user_id):
    conn = get_conn()
    exists = conn.execute('SELECT 1 FROM likes WHERE post_id=? AND user_id=?', (post_id, user_id)).fetchone()
    if exists:
        conn.execute('DELETE FROM likes WHERE post_id=? AND user_id=?', (post_id, user_id))
        liked = False
    else:
        conn.execute('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', (post_id, user_id))
        liked = True
    conn.commit()
    count = conn.execute('SELECT COUNT(*) FROM likes WHERE post_id=?', (post_id,)).fetchone()[0]
    conn.close()
    return liked, count


def get_profile(user_id):
    conn = get_conn()
    user = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    posts = conn.execute("""
        SELECT p.id, p.image_path, p.caption, p.created_at, COUNT(l.user_id) AS likes
        FROM posts p
        LEFT JOIN likes l ON l.post_id=p.id
        WHERE p.user_id=?
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
    """, (user_id,)).fetchall()
    conn.close()
    return dict(user) if user else None, [dict(row) for row in posts]


def get_post(post_id):
    conn = get_conn()
    row = conn.execute("""
        SELECT p.*, u.username, u.first_name, u.last_name, u.photo_url
        FROM posts p
        JOIN users u ON u.id=p.user_id
        WHERE p.id=?
    """, (post_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_post_owner(post_id):
    conn = get_conn()
    row = conn.execute('SELECT user_id FROM posts WHERE id=?', (post_id,)).fetchone()
    conn.close()
    return row['user_id'] if row else None


def create_comment(post_id, user_id, text):
    text = text.strip()
    if not text:
        return None
    conn = get_conn()
    cur = conn.execute(
        'INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)',
        (post_id, user_id, text[:500]),
    )
    conn.commit()
    comment_id = cur.lastrowid
    conn.close()
    return comment_id


def get_comments(post_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT c.id, c.post_id, c.user_id, c.text, c.created_at,
               u.username, u.first_name, u.last_name, u.photo_url
        FROM comments c
        JOIN users u ON u.id=c.user_id
        WHERE c.post_id=?
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT 100
    """, (post_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_comment_count(post_id):
    conn = get_conn()
    count = conn.execute('SELECT COUNT(*) FROM comments WHERE post_id=?', (post_id,)).fetchone()[0]
    conn.close()
    return count


def get_friend_count(user_id):
    conn = get_conn()
    count = conn.execute('SELECT COUNT(*) FROM friendships WHERE user_id=?', (user_id,)).fetchone()[0]
    conn.close()
    return count


def get_friend_status(current_user_id, other_user_id):
    if current_user_id == other_user_id:
        return 'self'
    conn = get_conn()
    friend = conn.execute('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?', (current_user_id, other_user_id)).fetchone()
    if friend:
        conn.close()
        return 'friends'
    outgoing = conn.execute("""
        SELECT 1 FROM friend_requests
        WHERE sender_id=? AND receiver_id=? AND status='pending'
    """, (current_user_id, other_user_id)).fetchone()
    if outgoing:
        conn.close()
        return 'pending'
    incoming = conn.execute("""
        SELECT 1 FROM friend_requests
        WHERE sender_id=? AND receiver_id=? AND status='pending'
    """, (other_user_id, current_user_id)).fetchone()
    conn.close()
    return 'incoming' if incoming else 'none'


def send_friend_request(sender_id, receiver_id):
    if sender_id == receiver_id:
        return False
    conn = get_conn()
    exists = conn.execute('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?', (sender_id, receiver_id)).fetchone()
    if exists:
        conn.close()
        return False
    conn.execute("""
        INSERT OR IGNORE INTO friend_requests (sender_id, receiver_id, status)
        VALUES (?, ?, 'pending')
    """, (sender_id, receiver_id))
    conn.commit()
    changed = conn.total_changes > 0
    conn.close()
    return changed


def accept_friend_request(receiver_id, sender_id):
    conn = get_conn()
    request = conn.execute("""
        SELECT 1 FROM friend_requests
        WHERE sender_id=? AND receiver_id=? AND status='pending'
    """, (sender_id, receiver_id)).fetchone()
    if not request:
        conn.close()
        return False
    conn.execute("""
        UPDATE friend_requests SET status='accepted'
        WHERE sender_id=? AND receiver_id=?
    """, (sender_id, receiver_id))
    conn.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)', (receiver_id, sender_id))
    conn.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)', (sender_id, receiver_id))
    conn.commit()
    conn.close()
    return True


def decline_friend_request(receiver_id, sender_id):
    conn = get_conn()
    cur = conn.execute("""
        UPDATE friend_requests SET status='declined'
        WHERE sender_id=? AND receiver_id=? AND status='pending'
    """, (sender_id, receiver_id))
    conn.commit()
    changed = cur.rowcount > 0
    conn.close()
    return changed


def get_friends(user_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT u.*
        FROM users u
        JOIN friendships f ON f.friend_id=u.id
        WHERE f.user_id=?
        ORDER BY u.first_name, u.username
    """, (user_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def search_users(query, current_user_id):
    query = query.strip().lstrip('@')
    if not query:
        return []
    conn = get_conn()
    rows = conn.execute("""
        SELECT id, username, first_name, last_name, photo_url, last_seen
        FROM users
        WHERE id != ?
          AND username IS NOT NULL
          AND username != ''
          AND LOWER(username) LIKE LOWER(?)
        ORDER BY username
        LIMIT 20
    """, (current_user_id, f'%{query}%')).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def add_post_tags(post_id, user_ids):
    conn = get_conn()
    for user_id in set(user_ids):
        conn.execute('INSERT OR IGNORE INTO post_tags (post_id, user_id) VALUES (?, ?)', (post_id, user_id))
    conn.commit()
    conn.close()


def get_post_tags(post_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT u.id, u.username, u.first_name, u.last_name, u.photo_url
        FROM post_tags pt
        JOIN users u ON u.id=pt.user_id
        WHERE pt.post_id=?
        ORDER BY u.username, u.first_name
    """, (post_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_post_tag_user_ids(post_id):
    conn = get_conn()
    rows = conn.execute('SELECT user_id FROM post_tags WHERE post_id=?', (post_id,)).fetchall()
    conn.close()
    return [row['user_id'] for row in rows]


def get_people(current_user_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT id, username, first_name, last_name, photo_url, last_seen
        FROM users
        WHERE id != ?
        ORDER BY
            CASE WHEN last_seen IS NOT NULL THEN 0 ELSE 1 END,
            first_name COLLATE NOCASE,
            username COLLATE NOCASE
        LIMIT 500
    """, (current_user_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]
