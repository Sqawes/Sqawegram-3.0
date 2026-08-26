import json
import os
import shutil
import urllib.request
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    init_db, upsert_user, update_last_seen, get_user, get_feed, create_post,
    toggle_like, create_comment, get_comments, get_post_owner, get_post,
    get_profile, get_friend_status, get_friend_count, remove_friendship,
    delete_post, send_friend_request, accept_friend_request, decline_friend_request,
    get_friends, search_users, create_notification, get_notifications,
    get_unread_notification_count, mark_notification_read, mark_all_notifications_read,
    add_post_tags, get_post_tags, get_people, get_profile_settings, update_profile,
    mark_phone_requested, set_phone, set_write_access, set_push_enabled,
    get_news, upsert_news, get_meta, set_meta, create_story, get_stories,
    view_story, get_story,
)
from .news import refresh_news
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

app = FastAPI(title='Sqawe v0.2')
init_db()
app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')
app.mount('/uploads', StaticFiles(directory=UPLOADS_DIR), name='uploads')


def public_app_url():
    domain = os.getenv('RAILWAY_PUBLIC_DOMAIN', '').strip()
    return f'https://{domain}' if domain else ''


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


def safe_push(recipient_id, text, post_id=None):
    if not BOT_TOKEN:
        return False
    user = get_user(recipient_id)
    if not user or not user.get('write_access') or not user.get('push_enabled'):
        return False

    app_url = public_app_url()
    payload = {
        'chat_id': recipient_id,
        'text': text,
        'disable_web_page_preview': True,
    }
    if app_url:
        payload['reply_markup'] = {
            'inline_keyboard': [[{'text': 'Открыть Sqawe', 'web_app': {'url': app_url}}]]
        }

    req = urllib.request.Request(
        f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def notify(recipient_id, actor_id, kind, text, post_id=None, comment_id=None):
    notification_id = create_notification(
        recipient_id, actor_id, kind, post_id=post_id, comment_id=comment_id
    )
    if notification_id:
        safe_push(recipient_id, text, post_id=post_id)
    return notification_id


@app.on_event('startup')
def configure_webhook():
    if not BOT_TOKEN:
        return
    domain = os.getenv('RAILWAY_PUBLIC_DOMAIN', '').strip()
    secret = os.getenv('TELEGRAM_WEBHOOK_SECRET', '').strip()
    if not domain:
        return
    url = f'https://api.telegram.org/bot{BOT_TOKEN}/setWebhook'
    payload = {'url': f'https://{domain}/telegram/webhook'}
    if secret:
        payload['secret_token'] = secret
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception:
        pass


@app.get('/')
def index():
    return FileResponse(STATIC_DIR / 'index.html')


@app.post('/telegram/webhook')
async def telegram_webhook(payload: dict):
    message = payload.get('message') or {}
    from_user = message.get('from') or {}
    contact = message.get('contact') or {}
    phone = contact.get('phone_number')
    contact_user_id = contact.get('user_id')
    sender_id = from_user.get('id')
    if phone and sender_id and (not contact_user_id or contact_user_id == sender_id):
        set_phone(int(sender_id), phone)
    return {'ok': True}


@app.get('/api/me')
def me(x_telegram_init_data: str | None = Header(default=None)):
    user = current_user(x_telegram_init_data)
    profile = get_user(user['id'])
    return profile


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
    if not image_path and not caption:
        raise HTTPException(status_code=400, detail='Add a photo or write something.')

    raw_tag_ids = []
    for item in tag_ids.split(','):
        item = item.strip()
        if not item:
            continue
        try:
            raw_tag_ids.append(int(item))
        except ValueError:
            pass
    raw_tag_ids = [uid for uid in set(raw_tag_ids) if uid != user['id'] and get_user(uid)]
    post_id = create_post(user['id'], image_path, caption)

    if raw_tag_ids:
        add_post_tags(post_id, raw_tag_ids)
        for tagged_user_id in raw_tag_ids:
            name = f"{user.get('first_name', 'Пользователь')}".strip()
            notify(tagged_user_id, user['id'], 'tag', f'{name} отметил(а) вас в публикации.', post_id=post_id)
    return {'ok': True, 'id': post_id}


@app.get('/api/posts/{post_id}')
def get_post_endpoint(post_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current_user(x_telegram_init_data)
    post_data = get_post(post_id)
    if not post_data:
        raise HTTPException(status_code=404, detail='Post not found')
    post_data['tags'] = get_post_tags(post_id)
    return post_data


@app.get('/api/posts/{post_id}/comments')
def post_comments(post_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current_user(x_telegram_init_data)
    return get_comments(post_id)


@app.post('/api/posts/{post_id}/comments')
def add_comment(post_id: int, text: str = Form(''), x_telegram_init_data: str | None = Header(default=None)):
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
        name = current.get('first_name', 'Пользователь')
        notify(owner_id, current['id'], 'comment', f'{name} прокомментировал(а) вашу публикацию.', post_id=post_id, comment_id=comment_id)
    return {'ok': True, 'id': comment_id}


@app.post('/api/posts/{post_id}/like')
def like(post_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    liked, count = toggle_like(post_id, current['id'])
    if liked:
        owner_id = get_post_owner(post_id)
        if owner_id is not None:
            name = current.get('first_name', 'Пользователь')
            notify(owner_id, current['id'], 'like', f'{name} поставил(а) лайк вашей публикации.', post_id=post_id)
    return {'liked': liked, 'likes': count}


@app.get('/api/users/search')
def user_search(q: str = '', x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    users = search_users(q, current['id'])
    for user in users:
        user['friend_status'] = get_friend_status(current['id'], user['id'])
    return users


@app.get('/api/users/{user_id}')
def profile(user_id: int, x_telegram_init_data: str | None = Header(default=None)):
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
def friend_request(user_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    if not get_user(user_id):
        raise HTTPException(status_code=404, detail='User not found')
    created = send_friend_request(current['id'], user_id)
    if created:
        name = current.get('first_name', 'Пользователь')
        notify(user_id, current['id'], 'friend_request', f'{name} отправил(а) вам запрос в друзья.')
    return {'ok': created, 'status': get_friend_status(current['id'], user_id)}


@app.post('/api/friends/{user_id}/accept')
def friend_accept(user_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    accepted = accept_friend_request(current['id'], user_id)
    if accepted:
        name = current.get('first_name', 'Пользователь')
        notify(user_id, current['id'], 'friend_accepted', f'{name} принял(а) ваш запрос в друзья.')
    return {'ok': accepted, 'status': get_friend_status(current['id'], user_id)}


@app.post('/api/friends/{user_id}/decline')
def friend_decline(user_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    declined = decline_friend_request(current['id'], user_id)
    return {'ok': declined, 'status': get_friend_status(current['id'], user_id)}


@app.get('/api/friends')
def friends(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    return get_friends(current['id'])


@app.delete('/api/friends/{user_id}')
def friend_remove(user_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    removed = remove_friendship(current['id'], user_id)
    return {'ok': removed}


@app.delete('/api/posts/{post_id}')
def post_delete(post_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    image_path = delete_post(post_id, current['id'])
    if image_path is None:
        raise HTTPException(status_code=404, detail='Post not found or not yours')
    if image_path:
        image_file = UPLOADS_DIR / Path(image_path).name
        try:
            if image_file.exists():
                image_file.unlink()
        except OSError:
            pass
    return {'ok': True}


@app.get('/api/notifications')
def notifications(x_telegram_init_data: str | None = Header(default=None), unread: int = 0):
    current = current_user(x_telegram_init_data)
    return get_notifications(current['id'], unread_only=bool(unread))


@app.get('/api/notifications/unread-count')
def notifications_unread_count(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    return {'count': get_unread_notification_count(current['id'])}


@app.post('/api/notifications/{notification_id}/read')
def notification_read(notification_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    mark_notification_read(current['id'], notification_id)
    return {'ok': True}


@app.post('/api/notifications/read-all')
def notifications_read_all(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    mark_all_notifications_read(current['id'])
    return {'ok': True}


@app.get('/api/news')
def news_feed(x_telegram_init_data: str | None = Header(default=None)):
    current_user(x_telegram_init_data)
    last = get_meta('news_last_sync')
    should_sync = True
    if last:
        try:
            should_sync = __import__('time').time() - float(last) > 900
        except Exception:
            should_sync = True
    if should_sync:
        items = refresh_news()
        if items:
            upsert_news(items)
        set_meta('news_last_sync', str(__import__('time').time()))
    return get_news(30)


@app.get('/api/stories')
def stories(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    return get_stories(current['id'])


@app.post('/api/stories')
async def story_create(
    file: UploadFile = File(...),
    caption: str = Form(''),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='Only images are allowed.')
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='Image is larger than 10 MB.')
    ext = Path(file.filename or '').suffix.lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
        ext = '.jpg'
    filename = f'story_{uuid.uuid4().hex}{ext}'
    (UPLOADS_DIR / filename).write_bytes(data)
    story_id = create_story(current['id'], filename, caption.strip()[:300])
    return {'ok': True, 'id': story_id}


@app.post('/api/stories/{story_id}/view')
def story_view(story_id: int, x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    story = get_story(story_id)
    if not story:
        raise HTTPException(status_code=404, detail='Story not found')
    view_story(story_id, current['id'])
    return {'ok': True}


@app.get('/api/settings')
def settings_get(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    return get_profile_settings(current['id'])


@app.post('/api/settings/profile')
def settings_profile(
    bio: str = Form(''),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    update_profile(current['id'], bio=bio)
    return get_profile_settings(current['id'])


@app.post('/api/settings/avatar')
async def settings_avatar(
    file: UploadFile = File(...),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='Only images are allowed.')
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='Avatar is larger than 8 MB.')
    ext = Path(file.filename or '').suffix.lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
        ext = '.jpg'
    filename = f'avatar_{uuid.uuid4().hex}{ext}'
    (UPLOADS_DIR / filename).write_bytes(data)
    update_profile(current['id'], photo_url=f'/uploads/{filename}')
    return get_profile_settings(current['id'])


@app.post('/api/settings/phone-requested')
def settings_phone_requested(x_telegram_init_data: str | None = Header(default=None)):
    current = current_user(x_telegram_init_data)
    mark_phone_requested(current['id'])
    return {'ok': True}


@app.post('/api/settings/write-access')
def settings_write_access(
    allowed: int = Form(0),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    set_write_access(current['id'], bool(allowed))
    return {'ok': True}


@app.post('/api/settings/push')
def settings_push(
    enabled: int = Form(1),
    x_telegram_init_data: str | None = Header(default=None),
):
    current = current_user(x_telegram_init_data)
    set_push_enabled(current['id'], bool(enabled))
    return {'ok': True}
