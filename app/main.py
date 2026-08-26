import os
import shutil
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    init_db,
    upsert_user,
    update_last_seen,
    get_user,
    get_feed,
    create_post,
    toggle_like,
    create_comment,
    get_comments,
    get_post_owner,
    get_post,
    get_profile,
    get_friend_status,
    get_friend_count,
    send_friend_request,
    accept_friend_request,
    decline_friend_request,
    get_friends,
    search_users,
    create_notification,
    get_notifications,
    get_unread_notification_count,
    mark_notification_read,
    mark_all_notifications_read,
    add_post_tags,
    get_post_tags,
    get_post_tag_user_ids,
    get_people,
)
from .telegram_auth import validate_init_data

load_dotenv()
BOT_TOKEN = os.getenv('BOT_TOKEN', '').strip()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path('/app/data') if Path('/app/data').exists() else BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = BASE_DIR / 'app' / 'static'
UPLOADS_DIR = DATA_DIR / 'uploads'
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

LEGACY_DB = BASE_DIR / 'sqawe.db'
TARGET_DB = DATA_DIR / 'sqawe.db'
LEGACY_UPLOADS = BASE_DIR / 'uploads'

if not TARGET_DB.exists() and LEGACY_DB.exists():
    shutil.copy2(LEGACY_DB, TARGET_DB)

if LEGACY_UPLOADS.exists() and LEGACY_UPLOADS.is_dir():
    for item in LEGACY_UPLOADS.iterdir():
        destination = UPLOADS_DIR / item.name
        if not destination.exists():
            if item.is_file():
                shutil.copy2(item, destination)
            elif item.is_dir():
                shutil.copytree(item, destination)

app = FastAPI(title='Sqawe v0.1')
init_db()

app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')
app.mount('/uploads', StaticFiles(directory=UPLOADS_DIR), name='uploads')


@app.get('/')
def index():
    return FileResponse(STATIC_DIR / 'index.html')


def current_user(x_telegram_init_data: str | None):
    if not BOT_TOKEN:
        raise HTTPException(status_code=500, detail='BOT_TOKEN is not configured.')
    try:
        user = validate_init_data(x_telegram_init_data or '', BOT_TOKEN)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    upsert_user(user)
    update_last_seen(user['id'])
    return user


@app.get('/api/me')
def me(x_telegram_init_data: str | None = Header(default=None)):
    user = current_user(x_telegram_init_data)
    return get_user(user['id'])


@app.get('/api/feed')
def feed(x_telegram_init_data: str | None = Header(default=None)):
    user = current_user(x_telegram_init_data)
    return get_feed(user['id'])


@app.post('/api/posts')
async def post(
    file: UploadFile | None = File(default=None),
    caption: str = Form(''),
    tag_ids: str = Form(''),
    x_telegram_init_data: str | None = Header(default=None),
):
    user = current_user(x_telegram_init_data)

    image_path = ''

    if file is not None and file.filename:
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail='Only images are allowed.')

        data = await file.read()
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail='Image is larger than 10 MB.')

        ext = Path(file.filename).suffix.lower()
        if ext not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
            ext = '.jpg'

        filename = f'{uuid.uuid4().hex}{ext}'
        (UPLOADS_DIR / filename).write_bytes(data)
        image_path = filename

    caption = caption.strip()[:1000]

    raw_tag_ids = []
    for item in tag_ids.split(','):
        item = item.strip()
        if not item:
            continue
        try:
            raw_tag_ids.append(int(item))
        except ValueError:
            continue

    raw_tag_ids = [uid for uid in set(raw_tag_ids) if uid != user['id'] and get_user(uid)]

    if not image_path and not caption:
        raise HTTPException(status_code=400, detail='Add a photo or write something.')

    post_id = create_post(user['id'], image_path, caption)

    if raw_tag_ids:
        add_post_tags(post_id, raw_tag_ids)
        for tagged_user_id in raw_tag_ids:
            create_notification(
                recipient_id=tagged_user_id,
                actor_id=user['id'],
                notification_type='tag',
                post_id=post_id,
            )

    return {'ok': True, 'id': post_id}


@app.get('/api/posts/{post_id}')
def get_post_endpoint(
    post_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current_user(x_telegram_init_data)
    post_data = get_post(post_id)
    if not post_data:
        raise HTTPException(status_code=404, detail='Post not found')
    post_data['tags'] = get_post_tags(post_id)
    return post_data


@app.get('/api/posts/{post_id}/comments')
def post_comments(
    post_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current_user(x_telegram_init_data)
    return get_comments(post_id)


@app.post('/api/posts/{post_id}/comments')
def add_comment(
    post_id: int,
    text: str = Form(''),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail='Comment cannot be empty.')
    if len(text) > 500:
        raise HTTPException(status_code=400, detail='Comment is too long.')
    if not get_post(post_id):
        raise HTTPException(status_code=404, detail='Post not found')

    comment_id = create_comment(post_id, current['id'], text)
    owner_id = get_post_owner(post_id)
    if owner_id is not None:
        create_notification(
            recipient_id=owner_id,
            actor_id=current['id'],
            notification_type='comment',
            post_id=post_id,
            comment_id=comment_id,
        )
    return {'ok': True, 'id': comment_id}


@app.post('/api/posts/{post_id}/like')
def like(
    post_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    liked, count = toggle_like(post_id, current['id'])
    if liked:
        owner_id = get_post_owner(post_id)
        if owner_id is not None:
            create_notification(
                recipient_id=owner_id,
                actor_id=current['id'],
                notification_type='like',
                post_id=post_id,
            )
    return {'liked': liked, 'likes': count}


@app.get('/api/users/search')
def user_search(
    q: str = '',
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    users = search_users(q, current['id'])
    for user in users:
        user['friend_status'] = get_friend_status(current['id'], user['id'])
    return users


@app.get('/api/users/{user_id}')
def profile(
    user_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    user, posts = get_profile(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    return {
        'user': user,
        'posts': posts,
        'friend_status': get_friend_status(current['id'], user_id),
        'friend_count': get_friend_count(user_id),
    }


@app.get('/api/people')
def people(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    users = get_people(current['id'])
    for user in users:
        user['friend_status'] = get_friend_status(current['id'], user['id'])
    return users


@app.post('/api/friends/{user_id}/request')
def friend_request(
    user_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    if not get_user(user_id):
        raise HTTPException(status_code=404, detail='User not found')
    created = send_friend_request(current['id'], user_id)
    if created:
        create_notification(
            recipient_id=user_id,
            actor_id=current['id'],
            notification_type='friend_request',
        )
    return {'ok': created, 'status': get_friend_status(current['id'], user_id)}


@app.post('/api/friends/{user_id}/accept')
def friend_accept(
    user_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    accepted = accept_friend_request(current['id'], user_id)
    if accepted:
        create_notification(
            recipient_id=user_id,
            actor_id=current['id'],
            notification_type='friend_accepted',
        )
    return {'ok': accepted, 'status': get_friend_status(current['id'], user_id)}


@app.post('/api/friends/{user_id}/decline')
def friend_decline(
    user_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    declined = decline_friend_request(current['id'], user_id)
    return {'ok': declined, 'status': get_friend_status(current['id'], user_id)}


@app.get('/api/friends')
def friends(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    return get_friends(current['id'])


@app.get('/api/notifications')
def notifications(
    x_telegram_init_data: str | None = Header(default=None),
    unread: int = 0,
):
    current = current_user(x_telegram_init_data)
    return get_notifications(current['id'], unread_only=bool(unread))


@app.get('/api/notifications/unread-count')
def notifications_unread_count(
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    return {'count': get_unread_notification_count(current['id'])}


@app.post('/api/notifications/{notification_id}/read')
def notification_read(
    notification_id: int,
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    mark_notification_read(current['id'], notification_id)
    return {'ok': True}


@app.post('/api/notifications/read-all')
def notifications_read_all(
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    mark_all_notifications_read(current['id'])
    return {'ok': True}
