import sqlite3
import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path('/app/data') if Path('/app/data').exists() else BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'sqawe.db'


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn, table, column, definition):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError:
        pass


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

    CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT DEFAULT '',
        link TEXT NOT NULL UNIQUE,
        image_url TEXT DEFAULT '',
        published_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        caption TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS story_views (
        story_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(story_id, user_id),
        FOREIGN KEY(story_id) REFERENCES stories(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """)

    _ensure_column(conn, 'users', 'last_seen', 'TEXT')
    _ensure_column(conn, 'users', 'phone', 'TEXT')
    _ensure_column(conn, 'users', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'phone_requested', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'write_access', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'push_enabled', 'INTEGER NOT NULL DEFAULT 1')
    _ensure_column(conn, 'users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'verified', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'users', 'suspended', 'INTEGER NOT NULL DEFAULT 0')
    _ensure_column(conn, 'posts', 'image_path', "TEXT DEFAULT ''")

    conn.commit()
    conn.close()


def sync_owner_flags(user_id):
    owner_id = os.getenv('SQAWE_OWNER_ID', '').strip()
    conn = get_conn()
    if owner_id.isdigit() and int(owner_id) == int(user_id):
        conn.execute('UPDATE users SET is_owner=1, is_admin=1 WHERE id=?', (user_id,))
    conn.commit()
    conn.close()


def upsert_user(user):
    conn = get_conn()
    existing = conn.execute(
        'SELECT id FROM users WHERE id=?',
        (user['id'],),
    ).fetchone()

    if existing:
        conn.execute(
            """
            UPDATE users
            SET photo_url = CASE
                WHEN photo_url IS NOT NULL AND photo_url != ''
                     AND photo_url LIKE '/uploads/%'
                THEN photo_url
                ELSE ?
            END
            WHERE id=?
            """,
            (user.get('photo_url'), user['id']),
        )
    else:
        conn.execute(
            """
            INSERT INTO users (id, username, first_name, last_name, photo_url)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user['id'],
                user.get('username'),
                user.get('first_name', 'User'),
                user.get('last_name'),
                user.get('photo_url'),
            ),
        )

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


def get_profile_settings(user_id):
    conn = get_conn()
    row = conn.execute(
        'SELECT id, username, first_name, last_name, photo_url, bio, phone, phone_verified, phone_requested, write_access, push_enabled FROM users WHERE id=?',
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_profile(user_id, bio=None, photo_url=None, first_name=None, username=None):
    conn = get_conn()
    if bio is not None:
        conn.execute('UPDATE users SET bio=? WHERE id=?', (bio[:500], user_id))
    if photo_url is not None:
        conn.execute('UPDATE users SET photo_url=? WHERE id=?', (photo_url, user_id))
    if first_name is not None:
        conn.execute('UPDATE users SET first_name=? WHERE id=?', (first_name[:80], user_id))
    if username is not None:
        value = username.strip().lstrip('@').lower()
        value = value[:32] or None
        if value:
            if not re.fullmatch(r'[a-z0-9_]{3,32}', value):
                conn.close()
                raise ValueError('Username: 3–32 символа, только латинские буквы, цифры и _.')
            taken = conn.execute(
                'SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id!=?',
                (value, user_id),
            ).fetchone()
            if taken:
                conn.close()
                raise ValueError('Username уже занят')
        conn.execute('UPDATE users SET username=? WHERE id=?', (value, user_id))
    conn.commit()
    conn.close()


def mark_phone_requested(user_id):
    conn = get_conn()
    conn.execute('UPDATE users SET phone_requested=1 WHERE id=?', (user_id,))
    conn.commit()
    conn.close()


def set_phone(user_id, phone):
    conn = get_conn()
    conn.execute(
        'UPDATE users SET phone=?, phone_verified=1, phone_requested=1 WHERE id=?',
        (phone, user_id),
    )
    conn.commit()
    conn.close()


def set_write_access(user_id, allowed):
    conn = get_conn()
    conn.execute('UPDATE users SET write_access=? WHERE id=?', (1 if allowed else 0, user_id))
    conn.commit()
    conn.close()


def set_push_enabled(user_id, enabled):
    conn = get_conn()
    conn.execute('UPDATE users SET push_enabled=? WHERE id=?', (1 if enabled else 0, user_id))
    conn.commit()
    conn.close()


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
            u.verified,
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
    posts = [dict(row) for row in rows]
    conn.close()
    for post in posts:
        post['tags'] = get_post_tags(post['id'])
    return posts


def create_post(user_id, image_path, caption):
    conn = get_conn()
    cur = conn.execute(
        'INSERT INTO posts (user_id, image_path, caption) VALUES (?, ?, ?)',
        (user_id, image_path or '', caption[:1000]),
    )
    conn.commit()
    post_id = cur.lastrowid
    conn.close()
    return post_id


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
        SELECT
            p.id,
            p.user_id,
            p.image_path,
            p.caption,
            p.created_at,
            u.verified,
            COUNT(DISTINCT l.user_id) AS likes,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments
        FROM posts p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN likes l ON l.post_id = p.id
        WHERE p.user_id=?
        GROUP BY
            p.id,
            p.user_id,
            p.image_path,
            p.caption,
            p.created_at,
            u.verified
        ORDER BY p.created_at DESC, p.id DESC
    """, (user_id,)).fetchall()
    profile_posts = [dict(row) for row in posts]
    conn.close()
    for post in profile_posts:
        post['tags'] = get_post_tags(post['id'])
    return dict(user) if user else None, profile_posts


def create_comment(post_id, user_id, text):
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
               u.username, u.first_name, u.last_name, u.photo_url, u.verified
        FROM comments c
        JOIN users u ON u.id=c.user_id
        WHERE c.post_id=?
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT 100
    """, (post_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


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
    outgoing = conn.execute("SELECT 1 FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'", (current_user_id, other_user_id)).fetchone()
    if outgoing:
        conn.close()
        return 'pending'
    incoming = conn.execute("SELECT 1 FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'", (other_user_id, current_user_id)).fetchone()
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
    conn.execute('INSERT OR IGNORE INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, "pending")', (sender_id, receiver_id))
    changed = conn.total_changes > 0
    conn.commit()
    conn.close()
    return changed


def accept_friend_request(receiver_id, sender_id):
    conn = get_conn()
    request = conn.execute("SELECT 1 FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'", (sender_id, receiver_id)).fetchone()
    if not request:
        conn.close()
        return False
    conn.execute('UPDATE friend_requests SET status="accepted" WHERE sender_id=? AND receiver_id=?', (sender_id, receiver_id))
    conn.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)', (receiver_id, sender_id))
    conn.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)', (sender_id, receiver_id))
    conn.commit()
    conn.close()
    return True


def decline_friend_request(receiver_id, sender_id):
    conn = get_conn()
    cur = conn.execute("UPDATE friend_requests SET status='declined' WHERE sender_id=? AND receiver_id=? AND status='pending'", (sender_id, receiver_id))
    conn.commit()
    changed = cur.rowcount > 0
    conn.close()
    return changed


def remove_friendship(user_id, friend_id):
    conn = get_conn()
    cur = conn.execute('DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', (user_id, friend_id, friend_id, user_id))
    conn.execute('UPDATE friend_requests SET status="removed" WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)', (user_id, friend_id, friend_id, user_id))
    conn.commit()
    changed = cur.rowcount > 0
    conn.close()
    return changed


def get_friends(user_id):
    conn = get_conn()
    rows = conn.execute('SELECT u.* FROM users u JOIN friendships f ON f.friend_id=u.id WHERE f.user_id=? ORDER BY u.first_name, u.username', (user_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def search_users(query, current_user_id):
    query = query.strip().lstrip('@')
    if not query:
        return []
    conn = get_conn()
    rows = conn.execute('''
        SELECT id, username, first_name, last_name, photo_url, last_seen, verified, is_admin, is_owner, suspended
        FROM users
        WHERE id != ? AND username IS NOT NULL AND username != ''
          AND LOWER(username) LIKE LOWER(?)
        ORDER BY username LIMIT 30
    ''', (current_user_id, f'%{query}%')).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_people(current_user_id):
    conn = get_conn()
    rows = conn.execute('''
        SELECT id, username, first_name, last_name, photo_url, last_seen, verified, is_admin, is_owner, suspended
        FROM users WHERE id != ?
        ORDER BY CASE WHEN last_seen IS NOT NULL THEN 0 ELSE 1 END,
                 first_name COLLATE NOCASE, username COLLATE NOCASE
        LIMIT 500
    ''', (current_user_id,)).fetchall()
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
    rows = conn.execute('''
        SELECT u.id, u.username, u.first_name, u.last_name, u.photo_url, u.verified
        FROM post_tags pt JOIN users u ON u.id=pt.user_id
        WHERE pt.post_id=? ORDER BY u.username, u.first_name
    ''', (post_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def delete_post(post_id, user_id):
    conn = get_conn()
    row = conn.execute('SELECT image_path FROM posts WHERE id=? AND user_id=?', (post_id, user_id)).fetchone()
    if not row:
        conn.close()
        return None
    image_path = row['image_path'] or ''
    conn.execute('DELETE FROM comments WHERE post_id=?', (post_id,))
    conn.execute('DELETE FROM likes WHERE post_id=?', (post_id,))
    conn.execute('DELETE FROM post_tags WHERE post_id=?', (post_id,))
    conn.execute('DELETE FROM notifications WHERE post_id=?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id=? AND user_id=?', (post_id, user_id))
    conn.commit()
    conn.close()
    return image_path


def upsert_news(items):
    conn = get_conn()
    for item in items:
        conn.execute('''
            INSERT INTO news (source, source_url, title, summary, link, image_url, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(link) DO UPDATE SET
                title=excluded.title,
                summary=excluded.summary,
                image_url=excluded.image_url,
                published_at=excluded.published_at
        ''', (
            item['source'], item['source_url'], item['title'], item.get('summary', ''),
            item['link'], item.get('image_url', ''), item.get('published_at') or '',
        ))
    conn.commit()
    conn.close()


def get_news(limit=30):
    conn = get_conn()
    rows = conn.execute('''
        SELECT id, source, source_url, title, summary, link, image_url, published_at
        FROM news ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ?
    ''', (limit,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_meta(key):
    conn = get_conn()
    row = conn.execute('SELECT value FROM app_meta WHERE key=?', (key,)).fetchone()
    conn.close()
    return row['value'] if row else None


def set_meta(key, value):
    conn = get_conn()
    conn.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
    conn.commit()
    conn.close()


def create_story(user_id, image_path, caption):
    conn = get_conn()
    cur = conn.execute('''
        INSERT INTO stories (user_id, image_path, caption, expires_at)
        VALUES (?, ?, ?, datetime('now', '+24 hours'))
    ''', (user_id, image_path, caption[:300]))
    conn.commit()
    story_id = cur.lastrowid
    conn.close()
    return story_id


def get_stories(current_user_id):
    conn = get_conn()
    rows = conn.execute('''
        SELECT s.id, s.user_id, s.image_path, s.caption, s.created_at, s.expires_at,
               u.username, u.first_name, u.last_name, u.photo_url,
               (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id=s.id) AS views,
               EXISTS(
                   SELECT 1 FROM story_views me
                   WHERE me.story_id=s.id AND me.user_id=?
               ) AS viewed
        FROM stories s JOIN users u ON u.id=s.user_id
        WHERE s.expires_at > CURRENT_TIMESTAMP
        ORDER BY s.created_at ASC, s.id ASC
    ''', (current_user_id,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def view_story(story_id, user_id):
    conn = get_conn()
    conn.execute('INSERT OR IGNORE INTO story_views(story_id,user_id) VALUES(?,?)', (story_id, user_id))
    conn.commit()
    conn.close()


def get_story(story_id):
    conn = get_conn()
    row = conn.execute('''
        SELECT s.id, s.user_id, s.image_path, s.caption, s.created_at, s.expires_at,
               u.username, u.first_name, u.last_name, u.photo_url
        FROM stories s JOIN users u ON u.id=s.user_id
        WHERE s.id=? AND s.expires_at > CURRENT_TIMESTAMP
    ''', (story_id,)).fetchone()
    conn.close()
    return dict(row) if row else None



def get_admin_overview():
    conn = get_conn()
    out = {
        'users': conn.execute('SELECT COUNT(*) FROM users').fetchone()[0],
        'posts': conn.execute('SELECT COUNT(*) FROM posts').fetchone()[0],
        'comments': conn.execute('SELECT COUNT(*) FROM comments').fetchone()[0],
        'stories': conn.execute("SELECT COUNT(*) FROM stories WHERE expires_at > CURRENT_TIMESTAMP").fetchone()[0],
        'admins': conn.execute('SELECT COUNT(*) FROM users WHERE is_admin=1').fetchone()[0],
        'verified': conn.execute('SELECT COUNT(*) FROM users WHERE verified=1').fetchone()[0],
        'suspended': conn.execute('SELECT COUNT(*) FROM users WHERE suspended=1').fetchone()[0],
    }
    conn.close()
    return out


def admin_search_users(query=''):
    conn = get_conn()
    query = (query or '').strip().lstrip('@')
    if query:
        like = f'%{query}%'
        rows = conn.execute(
            "SELECT id, username, first_name, last_name, photo_url, last_seen, verified, is_admin, is_owner, suspended, created_at "
            "FROM users WHERE LOWER(COALESCE(username,'')) LIKE LOWER(?) OR LOWER(first_name) LIKE LOWER(?) OR LOWER(COALESCE(last_name,'')) LIKE LOWER(?) "
            "ORDER BY first_name COLLATE NOCASE, username COLLATE NOCASE LIMIT 100",
            (like, like, like),
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT id, username, first_name, last_name, photo_url, last_seen, verified, is_admin, is_owner, suspended, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 100'
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def set_user_verified(user_id, verified):
    conn = get_conn(); conn.execute('UPDATE users SET verified=? WHERE id=?', (1 if verified else 0, user_id)); conn.commit(); conn.close()


def set_user_admin(user_id, is_admin):
    conn = get_conn(); conn.execute('UPDATE users SET is_admin=? WHERE id=?', (1 if is_admin else 0, user_id)); conn.commit(); conn.close()


def set_user_suspended(user_id, suspended):
    conn = get_conn(); conn.execute('UPDATE users SET suspended=? WHERE id=?', (1 if suspended else 0, user_id)); conn.commit(); conn.close()


def delete_all_user_posts(user_id):
    conn = get_conn()
    rows = conn.execute('SELECT id, image_path FROM posts WHERE user_id=?', (user_id,)).fetchall()
    for row in rows:
        post_id=row['id']
        conn.execute('DELETE FROM comments WHERE post_id=?', (post_id,))
        conn.execute('DELETE FROM likes WHERE post_id=?', (post_id,))
        conn.execute('DELETE FROM post_tags WHERE post_id=?', (post_id,))
        conn.execute('DELETE FROM notifications WHERE post_id=?', (post_id,))
        conn.execute('DELETE FROM posts WHERE id=?', (post_id,))
    conn.commit(); conn.close()
    return [r['image_path'] for r in rows if r['image_path']]
