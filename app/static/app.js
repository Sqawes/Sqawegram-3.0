const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const initData = tg?.initData || '';
const headers = { 'X-Telegram-Init-Data': initData };
let currentUserId = null;
const selectedTagMap = new Map();
const tagSearchUserMap = new Map();
let stories = [];
let storyIndex = 0;
let storyGroup = [];
let storyGroupIndex = 0;
let storyTimer = null;
let storyStartedAt = 0;
const STORY_DURATION_MS = 5000;
let storySeekPointerDown = false;
let feedTab = 'people';
const THEME_KEY = 'sqawe-theme';
const THEMES = {
  mono: { name: 'Classic Mono' },
  graphite: { name: 'Graphite' },
  ocean: { name: 'Ocean' },
  lavender: { name: 'Lavender' },
  sand: { name: 'Sand' }
};


async function loadBuildNumber() {
  const el = document.getElementById('build-number');
  if (!el) return;
  try {
    const res = await api('/api/build');
    if (!res.ok) return;
    const data = await res.json();
    el.textContent = data.label || 'build';
  } catch (_) {}
}

function applyTheme(theme) {
  const value = THEMES[theme] ? theme : 'mono';
  document.documentElement.setAttribute('data-theme', value);
  localStorage.setItem(THEME_KEY, value);
  document.querySelectorAll('.theme-choice').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === value);
    b.setAttribute('aria-pressed', b.dataset.theme === value ? 'true' : 'false');
  });
}

function getStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES[stored] ? stored : 'mono';
}

function renderThemeOptions() {
  const box = document.getElementById('theme-options');
  if (!box) return;
  box.innerHTML = Object.entries(THEMES).map(([key, meta]) => `
    <button type="button" class="theme-choice" data-theme="${key}" aria-pressed="false">
      <span class="theme-preview theme-preview-${key}"></span>
      <span><strong>${esc(meta.name)}</strong></span>
    </button>
  `).join('');
  box.querySelectorAll('.theme-choice').forEach(button => {
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
  });
  applyTheme(getStoredTheme());
}

function openThemePicker() {
  document.getElementById('top-menu')?.setAttribute('hidden', '');
  renderThemeOptions();
  document.getElementById('theme-picker')?.removeAttribute('hidden');
}

function closeThemePicker() {
  document.getElementById('theme-picker')?.setAttribute('hidden', '');
}

function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), ...headers };
  return fetch(path, options);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function avatar(url) { return url ? esc(url) : '/static/default-avatar.svg'; }

function verifiedMark(user) { return user?.verified ? '<span class="verified-badge" title="Verified">✓</span>' : ''; }

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  const t = new Date(lastSeen.replace(' ', 'T') + 'Z').getTime();
  return !Number.isNaN(t) && Date.now() - t < 2 * 60 * 1000;
}

function onlineText(lastSeen) {
  return isOnline(lastSeen) ? '<div class="online-status online">● В сети</div>' : '<div class="online-status offline">○ Был(а) недавно</div>';
}

function showView(viewId, loadData = true) {
  const current = document.querySelector('.view.active');
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active', 'view-enter');
  });
  const target = document.getElementById(viewId);
  if (!target) return;
  target.classList.add('active');
  requestAnimationFrame(() => target.classList.add('view-enter'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  moveGlassIndicator();
  if (!loadData) return;
  if (viewId === 'feed-view') { loadFeed(); loadStories(); if (feedTab === 'global') loadNews(); }
  if (viewId === 'friends-view') loadFriends();
  if (viewId === 'people-view') loadPeople();
  if (viewId === 'notifications-view') loadNotifications();
  if (viewId === 'profile-view') loadProfile();
  if (viewId === 'settings-view') loadSettings();
}


function ensureGlassIndicator() {
  const nav = document.querySelector('.nav');
  if (!nav) return null;
  let glass = nav.querySelector('.nav-glass');
  if (!glass) {
    glass = document.createElement('div');
    glass.className = 'nav-glass';
    nav.prepend(glass);
  }
  return glass;
}

function moveGlassIndicator() {
  const nav = document.querySelector('.nav');
  const active = nav?.querySelector('.nav-btn.active');
  const glass = ensureGlassIndicator();
  if (!nav || !active || !glass) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  const inset = 3;
  glass.style.width = `${Math.max(0, btnRect.width - inset * 2)}px`;
  glass.style.height = `${Math.max(0, btnRect.height - inset * 2)}px`;
  glass.style.transform = `translate3d(${btnRect.left - navRect.left + inset}px, ${btnRect.top - navRect.top + inset}px, 0)`;
}

document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
window.addEventListener('resize', moveGlassIndicator);
window.addEventListener('orientationchange', () => setTimeout(moveGlassIndicator, 120));
document.getElementById('refresh-btn')?.addEventListener('click', () => {
  if (feedTab === 'global') loadNews();
  else { loadFeed(); loadStories(); }
});
document.getElementById('feed-tab-people')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setFeedTab('people'); });
document.getElementById('feed-tab-global')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setFeedTab('global'); });
document.getElementById('refresh-friends-btn')?.addEventListener('click', loadFriends);
document.getElementById('refresh-people-btn')?.addEventListener('click', loadPeople);
document.getElementById('refresh-notifications-btn')?.addEventListener('click', loadNotifications);
document.getElementById('read-all-btn')?.addEventListener('click', markAllNotificationsRead);
document.getElementById('theme-menu-btn')?.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  const menu = document.getElementById('top-menu');
  if (!menu) return;
  menu.toggleAttribute('hidden');
});
document.getElementById('open-theme-picker')?.addEventListener('click', e => { e.stopPropagation(); openThemePicker(); });
document.getElementById('theme-picker-close')?.addEventListener('click', closeThemePicker);
document.querySelector('.theme-picker-backdrop')?.addEventListener('click', closeThemePicker);

tg?.MainButton?.hide?.();

function setFeedTab(tab) {
  feedTab = tab === 'global' ? 'global' : 'people';
  const peopleTab = document.getElementById('feed-tab-people');
  const globalTab = document.getElementById('feed-tab-global');
  peopleTab?.classList.toggle('active', feedTab === 'people');
  globalTab?.classList.toggle('active', feedTab === 'global');
  peopleTab?.setAttribute('aria-pressed', feedTab === 'people' ? 'true' : 'false');
  globalTab?.setAttribute('aria-pressed', feedTab === 'global' ? 'true' : 'false');
  document.getElementById('people-feed-panel')?.classList.toggle('active', feedTab === 'people');
  document.getElementById('global-news-panel')?.classList.toggle('active', feedTab === 'global');
  if (feedTab === 'people') {
    loadFeed();
    loadStories();
  } else {
    loadNews();
  }
}

async function getUserProfile(userId) {
  const res = await api(`/api/users/${userId}`);
  return res.ok ? res.json() : null;
}

function getMiniFriendButton(userId, status) {
  if (status === 'self') return '';
  if (status === 'friends') return `<button class="friend-mini" disabled>✓ Друзья</button>`;
  if (status === 'pending') return `<button class="friend-mini" disabled>Запрос отправлен</button>`;
  if (status === 'incoming') return `<button class="friend-mini" onclick="acceptFriendRequest(${userId})">Принять</button>`;
  return `<button class="friend-mini" onclick="sendFriendRequest(${userId})">Добавить</button>`;
}

function postImageMarkup(path, postId = null) {
  if (!path) return '';
  const src = `/uploads/${encodeURIComponent(path)}`;
  return `<img class="post-image" src="${src}" data-image-src="${src}" data-post-id="${postId || ''}" loading="lazy" alt="Фото">`;
}

function renderPostTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  const names = tags.map(u => {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || 'Пользователь';
    return `<button type="button" class="post-tag-link" onclick="openProfile(${Number(u.id)})">${esc(name)}</button>`;
  });
  return `<div class="post-tags-line">${names.join('')}</div>`;
}

async function deletePostById(postId) {
  if (!confirm('Удалить эту публикацию?')) return;
  const res = await api(`/api/posts/${postId}`, { method: 'DELETE' });
  if (!res.ok) {
    alert(await res.text());
    return;
  }
  await loadFeed();
  await loadProfile();
}

async function loadFeed() {
  const meRes = await api('/api/me');
  if (meRes.ok) {
    const me = await meRes.json();
    currentUserId = Number(me.id);
  }
  const box = document.getElementById('feed');
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';
  const res = await api('/api/feed');
  if (!res.ok) { box.innerHTML = `<div class="empty">Не удалось загрузить ленту.<br>${esc(await res.text())}</div>`; return; }
  const posts = await res.json();
  if (!posts.length) { box.innerHTML = '<div class="empty">Здесь пока пусто.<br>Будь первым.</div>'; return; }

  const cache = new Map();
  const html = [];
  for (const post of posts) {
    if (!cache.has(post.user_id)) cache.set(post.user_id, await getUserProfile(post.user_id));
    const profile = cache.get(post.user_id);
    html.push(`
      <article class="post" id="post-${post.id}">
        <div class="post-head">
          <img class="avatar profile-click" src="${avatar(post.photo_url)}" onclick="openProfile(${post.user_id})">
          <div class="profile-click" onclick="openProfile(${post.user_id})"><div class="name">${esc(post.first_name)} ${esc(post.last_name || '')}${verifiedMark(post)}</div><div class="username">${post.username ? '@' + esc(post.username) : 'Telegram user'}</div></div>
          <div class="feed-friend-button">${getMiniFriendButton(post.user_id, profile?.friend_status || 'none')}</div>
        </div>
        ${post.image_path ? postImageMarkup(post.image_path, post.id) : ''}
        ${post.caption ? `<p class="caption">${esc(post.caption)}</p>` : ''}
        ${renderPostTags(post.tags)}
        <div class="meta"><button class="like ${post.liked ? 'liked' : ''}" onclick="likePost(${post.id}, this)">${post.liked ? '♥' : '♡'} ${post.likes}</button><button class="comment-toggle" type="button" onclick="toggleComments(${post.id})">💬 ${post.comments || 0}</button></div>
        
        <div id="comments-${post.id}" class="comments" hidden></div>
      </article>
    `);
  }
  box.innerHTML = html.join('');
}

async function likePost(postId, button) {
  const res = await api(`/api/posts/${postId}/like`, { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  button.classList.toggle('liked', data.liked);
  button.innerHTML = `${data.liked ? '♥' : '♡'} ${data.likes}`;
  updateNotificationBadge();
}

async function toggleComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="comments-loading">загрузка...</div>';
  const res = await api(`/api/posts/${postId}/comments`);
  if (!res.ok) { box.innerHTML = '<div class="comments-error">Не удалось загрузить комментарии.</div>'; return; }
  const comments = await res.json();
  box.innerHTML = `<div class="comments-list">${comments.length ? comments.map(c => `<div class="comment"><img class="comment-avatar" src="${avatar(c.photo_url)}" onclick="openProfile(${c.user_id})"><div class="comment-content"><div class="comment-head"><span class="comment-author" onclick="openProfile(${c.user_id})">${esc(c.first_name)} ${esc(c.last_name || '')}${verifiedMark(c)}</span><span class="comment-username">${c.username ? '@' + esc(c.username) : ''}</span></div><div class="comment-text">${esc(c.text)}</div></div></div>`).join('') : '<div class="comments-empty">Комментариев пока нет.</div>'}</div><form class="comment-form" onsubmit="submitComment(event, ${postId})"><input id="comment-input-${postId}" maxlength="500" placeholder="Написать комментарий..."><button class="primary" type="submit">Отправить</button></form>`;
}

async function submitComment(event, postId) {
  event.preventDefault();
  const input = document.getElementById(`comment-input-${postId}`);
  const fd = new FormData(); fd.append('text', input?.value || '');
  const res = await api(`/api/posts/${postId}/comments`, { method: 'POST', body: fd });
  if (!res.ok) return alert(await res.text());
  await loadFeed();
  document.getElementById(`comments-${postId}`)?.removeAttribute('hidden');
  await toggleComments(postId); await toggleComments(postId);
  updateNotificationBadge();
}

async function showPostTags(postId) {
  const res = await api(`/api/posts/${postId}`); if (!res.ok) return;
  const data = await res.json();
  const tags = data.tags || [];
  alert(tags.length ? 'Отмечены: ' + tags.map(u => '@' + (u.username || u.first_name)).join(', ') : 'Отмеченных людей нет.');
}

const imageInput = document.getElementById('image');
imageInput?.addEventListener('change', () => {
  const file = imageInput.files[0]; const preview = document.getElementById('preview'); if (!preview) return;
  preview.innerHTML = file ? `<img src="${URL.createObjectURL(file)}" alt="preview">` : '＋ Выбрать фото';
});

function renderSelectedTags() {
  const box = document.getElementById('selected-tags'); if (!box) return;
  box.innerHTML = [...selectedTagMap.values()].map(u => { const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || 'Пользователь'; return `<span class="tag-chip">${esc(name)} <button type="button" onclick="removeTag(${u.id})">×</button></span>`; }).join('');
  document.getElementById('tag-ids').value = [...selectedTagMap.keys()].join(',');
}
function addTag(user) { selectedTagMap.set(Number(user.id), user); renderSelectedTags(); document.getElementById('tag-search-results').innerHTML = ''; document.getElementById('tag-search-input').value = ''; }
function addTagById(id) { const u = tagSearchUserMap.get(String(id)); if (u) addTag(u); }
function removeTag(id) { selectedTagMap.delete(Number(id)); renderSelectedTags(); }

async function searchTagUsers() {
  const q = document.getElementById('tag-search-input')?.value.trim().replace(/^@+/, ''); const box = document.getElementById('tag-search-results'); if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`); if (!res.ok) { box.innerHTML = '<div class="empty">Ошибка поиска.</div>'; return; }
  const users = await res.json(); tagSearchUserMap.clear(); users.forEach(u => tagSearchUserMap.set(String(u.id), u));
  box.innerHTML = users.map(u => `<button type="button" class="tag-result" onclick="addTagById(${u.id})"><img class="avatar" src="${avatar(u.photo_url)}"><span><b>${esc(u.first_name)} ${esc(u.last_name || '')}</b><small>@${esc(u.username)}</small></span></button>`).join('') || '<div class="empty">Пользователь не найден.</div>';
}
document.getElementById('tag-search-btn')?.addEventListener('click', searchTagUsers);
document.getElementById('tag-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchTagUsers(); } });

const postForm = document.getElementById('post-form');
postForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('form-error'); error.textContent = '';
  const file = document.getElementById('image')?.files[0]; const caption = document.getElementById('caption')?.value || ''; const tagIds = document.getElementById('tag-ids')?.value || '';
  if (!file) { error.textContent = 'Для публикации нужно выбрать фото.'; return; }
  const fd = new FormData(); fd.append('file', file); fd.append('caption', caption); fd.append('tag_ids', tagIds);
  const button = postForm.querySelector('button[type="submit"]'); if (button) { button.disabled = true; button.textContent = 'Публикация...'; }
  const res = await api('/api/posts', { method: 'POST', body: fd });
  if (!res.ok) error.textContent = await res.text(); else { postForm.reset(); selectedTagMap.clear(); renderSelectedTags(); document.getElementById('tag-search-results').innerHTML = ''; document.getElementById('preview').textContent = '＋ Выбрать фото'; showView('feed-view'); }
  if (button) { button.disabled = false; button.textContent = 'Опубликовать'; }
});

function friendButtonForProfile(userId, status) {
  if (status === 'self') return '';
  if (status === 'friends') return `<div class="friend-actions"><button class="primary" disabled>✓ Уже друзья</button><button class="ghost" onclick="removeFriend(${userId})">Удалить</button></div>`;
  if (status === 'pending') return '<button class="primary" disabled>Запрос отправлен</button>';
  if (status === 'incoming') return `<div class="friend-actions"><button class="primary" onclick="acceptFriendRequest(${userId})">Принять</button><button class="ghost" onclick="declineFriendRequest(${userId})">Отклонить</button></div>`;
  return `<button class="primary" onclick="sendFriendRequest(${userId})">Добавить в друзья</button>`;
}

function renderProfilePost(post, ownProfile) {
  if (post.image_path) {
    return `<div class="profile-post">${postImageMarkup(post.image_path, post.id)}${post.caption ? `<p class="caption">${esc(post.caption)}</p>` : ''}${renderPostTags(post.tags)}</div>`;
  }
  return `<article class="profile-text-post" data-text-post-id="${post.id}">${post.caption ? `<p class="caption">${esc(post.caption)}</p>` : ''}${renderPostTags(post.tags)}${ownProfile ? `<div class="text-post-hint">Нажмите и удерживайте, чтобы удалить</div>` : ''}</article>`;
}

async function openProfile(userId) {
  const data = await getUserProfile(userId);
  if (!data) return alert('Не удалось загрузить профиль');

  const meRes = await api('/api/me');
  const me = meRes.ok ? await meRes.json() : null;
  const p = document.getElementById('profile');
  const u = data.user;
  const own = me && Number(me.id) === Number(u.id);

  const avatarPlus = own ? `
    <button
      class="profile-avatar-story-plus"
      type="button"
      onclick="event.stopPropagation(); chooseStoryPhoto()"
      aria-label="Добавить историю"
    >+</button>
  ` : '';

  const profileMenu = own ? `
    <div class="profile-more-wrap">
      <button
        class="profile-more-btn"
        type="button"
        aria-label="Настройки профиля"
        onclick="toggleProfileMenu(event)"
      >⋯</button>
      <div id="profile-menu" class="profile-menu">
        <button type="button" onclick="openSettingsFromMenu()">Редактировать профиль</button>
        <button type="button" onclick="changeAvatar()">Сменить фото</button>
        <button type="button" onclick="openSettingsFromMenu('notifications')">Настройки уведомлений</button>
      </div>
    </div>
  ` : '';

  const postsCount = data.posts.length;
  const friendCount = data.friend_count;
  const bio = u.bio ? `<div class="profile-bio">${esc(u.bio)}</div>` : '';

  p.innerHTML = `
    <div class="profile-topline">
      <button
        class="profile-create-btn"
        type="button"
        onclick="showView('create-view')"
        aria-label="Новая публикация"
      >＋</button>
      <div class="profile-brand">SQAWE<span>.</span></div>
      <div class="profile-topline-spacer"></div>
    </div>

    <div class="profile-head profile-head-modern">
      <div class="profile-avatar-wrap">
        <img class="profile-avatar" src="${avatar(u.photo_url)}" alt="">
        ${avatarPlus}
      </div>

      <div class="profile-main">
        <div class="profile-name-row">
          <div class="profile-identity">
            <div class="profile-name">${esc(u.first_name)} ${esc(u.last_name || '')}${verifiedMark(u)}</div>
            <div class="profile-stats">${u.username ? '@' + esc(u.username) : 'Telegram user'}</div>
          </div>
          ${profileMenu}
        </div>

        <div class="profile-stat-row">
          <div class="profile-stat-block">
            <strong>${postsCount}</strong>
            <span>публикации</span>
          </div>
          <button type="button" class="profile-stat-block profile-stat-button" onclick="openProfileFriends(${u.id})">
            <strong>${friendCount}</strong>
            <span>друзья</span>
          </button>
        </div>

        ${onlineText(u.last_seen)}
        ${bio}
      </div>
    </div>

    <div class="profile-actions profile-actions-modern">
      ${friendButtonForProfile(u.id, data.friend_status)}
      <button class="ghost profile-share-btn" type="button" onclick="shareProfile(${u.id}, this)">Поделиться профилем</button>
    </div>

    <div class="grid">
      ${data.posts.length
        ? data.posts.map(post => renderProfilePost(post, own)).join('')
        : `<div class="profile-empty">${own ? 'У тебя пока нет публикаций.' : 'Пока нет публикаций.'}</div>`}
    </div>
  `;

  showView('profile-view', false);
}

function toggleProfileMenu(event) {
  event?.stopPropagation();
  document.getElementById('profile-menu')?.classList.toggle('active');
}
function openSettingsFromMenu(section='profile') {
  document.getElementById('profile-menu')?.classList.remove('active');
  showView('settings-view');
  setTimeout(() => document.getElementById('settings-view')?.scrollIntoView({behavior:'smooth', block:'start'}), 0);
}
function changeAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await api('/api/settings/avatar', {method:'POST', body:fd});
    if (!res.ok) return alert(await res.text());
    await loadProfile();
    if (feedTab === 'people') await loadFeed();
    await loadPeople();
    await loadFriends();
  };
  input.click();
}


async function shareProfile(userId, button) {
  try {
    const res = await api(`/api/users/${userId}/share-link`);
    if (!res.ok) throw new Error('share link failed');
    const data = await res.json();
    const url = data.url;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const area = document.createElement('textarea');
      area.value = url;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }

    const oldText = button?.textContent;
    if (button) {
      button.textContent = 'Ссылка скопирована';
      setTimeout(() => { if (button) button.textContent = oldText; }, 1400);
    }
  } catch (_) {
    alert('Не удалось скопировать ссылку на профиль.');
  }
}

async function sendFriendRequest(id) { const res = await api(`/api/friends/${id}/request`, { method: 'POST' }); if (!res.ok) return alert(await res.text()); await openProfile(id); updateNotificationBadge(); }
async function acceptFriendRequest(id) { const res = await api(`/api/friends/${id}/accept`, { method: 'POST' }); if (!res.ok) return alert(await res.text()); await openProfile(id); updateNotificationBadge(); }
async function declineFriendRequest(id) { const res = await api(`/api/friends/${id}/decline`, { method: 'POST' }); if (!res.ok) return alert(await res.text()); await loadFriends(); updateNotificationBadge(); }
async function removeFriend(id) { if (!confirm('Удалить пользователя из друзей?')) return; const res = await api(`/api/friends/${id}`, { method: 'DELETE' }); if (!res.ok) return alert('Не удалось удалить из друзей'); await openProfile(id); }

async function loadFriends() {
  const box = document.getElementById('friends'); if (!box) return; box.innerHTML = '<div class="empty">загрузка...</div>';
  const res = await api('/api/friends'); if (!res.ok) { box.innerHTML = '<div class="empty">Не удалось загрузить друзей.</div>'; return; }
  const friends = await res.json(); box.innerHTML = friends.length ? friends.map(u => `<div class="friend-card" onclick="openProfile(${u.id})"><img class="avatar" src="${avatar(u.photo_url)}"><div class="friend-info"><div class="name">${esc(u.first_name)} ${esc(u.last_name || '')}${verifiedMark(u)}</div><div class="username">${u.username ? '@' + esc(u.username) : 'Telegram user'}</div>${onlineText(u.last_seen)}</div><button class="friend-delete-small" onclick="event.stopPropagation(); removeFriend(${u.id})">Удалить</button></div>`).join('') : '<div class="empty">У тебя пока нет друзей.</div>';
}

async function searchFriends() {
  const q = document.getElementById('friend-search-input')?.value.trim(); const box = document.getElementById('friend-search-results'); if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`); if (!res.ok) return;
  const users = await res.json(); box.innerHTML = users.length ? users.map(u => `<div class="friend-card"><img class="avatar profile-click" src="${avatar(u.photo_url)}" onclick="openProfile(${u.id})"><div class="friend-info profile-click" onclick="openProfile(${u.id})"><div class="name">${esc(u.first_name)} ${esc(u.last_name || '')}${verifiedMark(u)}</div><div class="username">@${esc(u.username)}</div>${onlineText(u.last_seen)}</div>${getMiniFriendButton(u.id, u.friend_status || 'none')}</div>`).join('') : '<div class="empty">Пользователь не найден.</div>';
}
document.getElementById('friend-search-btn')?.addEventListener('click', searchFriends);
document.getElementById('friend-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchFriends(); } });

async function loadPeople() {
  const box = document.getElementById('people-list'); if (!box) return; box.innerHTML = '<div class="empty">загрузка...</div>';
  const res = await api('/api/people'); if (!res.ok) return;
  const users = await res.json(); renderPeople(users);
}
function renderPeople(users) {
  const box = document.getElementById('people-list'); if (!box) return;
  box.innerHTML = users.length ? users.map(u => `<div class="person-card"><div class="friend-card" onclick="openProfile(${u.id})"><img class="avatar" src="${avatar(u.photo_url)}"><div class="friend-info"><div class="name">${esc(u.first_name)} ${esc(u.last_name || '')}${verifiedMark(u)}</div><div class="username">${u.username ? '@' + esc(u.username) : 'Telegram user'}</div>${onlineText(u.last_seen)}</div><div>${getMiniFriendButton(u.id, u.friend_status || 'none')}</div></div></div>`).join('') : '<div class="empty">Пока никто не зарегистрировался.</div>';
}
document.getElementById('people-search-input')?.addEventListener('input', async e => { const q = e.target.value.trim(); if (!q) return loadPeople(); const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`); if (res.ok) renderPeople(await res.json()); });

async function loadProfile() {
  const box = document.getElementById('profile'); if (!box) return; const meRes = await api('/api/me'); if (!meRes.ok) return;
  const me = await meRes.json(); await openOwnProfileFromUser(me);
}
async function openOwnProfileFromUser(me) {
  const data = await getUserProfile(me.id);
  if (!data) return;

  const u = data.user;
  const p = document.getElementById('profile');
  if (!p) return;

  const avatarPlus = `
    <button
      class="profile-avatar-story-plus"
      type="button"
      onclick="event.stopPropagation(); chooseStoryPhoto()"
      aria-label="Добавить историю"
    >+</button>
  `;

  const menu = `
    <div class="profile-more-wrap">
      <button class="profile-more-btn" type="button" aria-label="Настройки профиля" onclick="toggleProfileMenu(event)">⋯</button>
      <div id="profile-menu" class="profile-menu">
        <button type="button" onclick="openSettingsFromMenu()">Редактировать профиль</button>
        <button type="button" onclick="changeAvatar()">Сменить фото</button>
        <button type="button" onclick="openSettingsFromMenu('notifications')">Настройки уведомлений</button>
      </div>
    </div>
  `;

  p.innerHTML = `
    <div class="profile-topline">
      <button class="profile-create-btn" type="button" onclick="showView('create-view')" aria-label="Новая публикация">＋</button>
      <div class="profile-brand">SQAWE<span>.</span></div>
      <div class="profile-topline-spacer"></div>
    </div>

    <div class="profile-head profile-head-modern">
      <div class="profile-avatar-wrap">
        <img class="profile-avatar" src="${avatar(u.photo_url)}" alt="">
        ${avatarPlus}
      </div>

      <div class="profile-main">
        <div class="profile-name-row">
          <div class="profile-identity">
            <div class="profile-name">${esc(u.first_name)} ${esc(u.last_name || '')}${verifiedMark(u)}</div>
            <div class="profile-stats">${u.username ? '@' + esc(u.username) : ''}</div>
          </div>
          ${menu}
        </div>

        <div class="profile-stat-row">
          <div class="profile-stat-block">
            <strong>${data.posts.length}</strong>
            <span>публикации</span>
          </div>
          <button type="button" class="profile-stat-block profile-stat-button" onclick="openProfileFriends(${u.id})">
            <strong>${data.friend_count}</strong>
            <span>друзья</span>
          </button>
        </div>

        ${onlineText(u.last_seen)}
        ${u.bio ? `<div class="profile-bio">${esc(u.bio)}</div>` : ''}
      </div>
    </div>

    <div class="profile-actions profile-actions-modern">
      <button class="primary" type="button" onclick="openSettingsFromMenu()">Редактировать профиль</button>
      <button class="ghost profile-share-btn" type="button" onclick="shareProfile(${u.id}, this)">Поделиться профилем</button>
    </div>

    <div class="grid">
      ${data.posts.length
        ? data.posts.map(post => renderProfilePost(post, true)).join('')
        : '<div class="profile-empty">У тебя пока нет публикаций.</div>'}
    </div>
  `;
}


async function openProfileFriends(userId) {
  const existing = document.getElementById('profile-friends-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'profile-friends-modal';
  modal.className = 'profile-friends-modal';
  modal.innerHTML = `
    <div class="profile-friends-backdrop" onclick="closeProfileFriends(event)"></div>
    <div class="profile-friends-sheet" role="dialog" aria-modal="true" aria-label="Друзья пользователя">
      <div class="profile-friends-head">
        <h2>Друзья</h2>
        <button type="button" class="profile-friends-close" onclick="closeProfileFriends()" aria-label="Закрыть">×</button>
      </div>
      <div id="profile-friends-list" class="profile-friends-list">
        <div class="empty">загрузка...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.classList.add('profile-modal-open');
  requestAnimationFrame(() => modal.classList.add('active'));

  const res = await api(`/api/users/${userId}/friends`);
  const list = document.getElementById('profile-friends-list');
  if (!list) return;

  if (!res.ok) {
    list.innerHTML = '<div class="empty">Не удалось загрузить друзей.</div>';
    return;
  }

  const friends = await res.json();
  if (!friends.length) {
    list.innerHTML = '<div class="profile-friends-empty">У этого пользователя пока нет друзей.</div>';
    return;
  }

  list.innerHTML = friends.map(friend => `
    <button type="button" class="profile-friend-item" onclick="closeProfileFriends(); openProfile(${friend.id})">
      <img class="avatar" src="${avatar(friend.photo_url)}" alt="">
      <span class="profile-friend-info">
        <span class="name">${esc(friend.first_name)} ${esc(friend.last_name || '')}${verifiedMark(friend)}</span>
        <span class="username">${friend.username ? '@' + esc(friend.username) : 'Telegram user'}</span>
        ${onlineText(friend.last_seen)}
      </span>
    </button>
  `).join('');
}

function closeProfileFriends(event) {
  if (event && event.target && !event.target.classList.contains('profile-friends-backdrop')) return;
  const modal = document.getElementById('profile-friends-modal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 180);
  }
  document.body.classList.remove('profile-modal-open');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProfileFriends();
});


let textPostPressTimer = null;
let activeTextPostMenu = null;

function closeTextPostMenu() {
  if (activeTextPostMenu) { activeTextPostMenu.remove(); activeTextPostMenu = null; }
}

function showTextPostMenu(postId, x, y) {
  closeTextPostMenu();
  const menu = document.createElement('div');
  menu.className = 'text-post-menu';
  menu.innerHTML = `<button type="button" class="danger">Удалить публикацию</button>`;
  document.body.appendChild(menu);
  const width = 190;
  const left = Math.min(Math.max(10, x), window.innerWidth - width - 10);
  const top = Math.min(Math.max(10, y), window.innerHeight - 70);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button').addEventListener('click', async () => {
    closeTextPostMenu();
    if (!confirm('Удалить эту публикацию?')) return;
    const res = await api(`/api/posts/${postId}`, {method:'DELETE'});
    if (!res.ok) return alert(await res.text());
    await loadProfile();
    if (feedTab === 'people') await loadFeed();
  });
  activeTextPostMenu = menu;
}

document.addEventListener('pointerdown', e => {
  const card = e.target.closest('.profile-text-post');
  if (!card) return;
  clearTimeout(textPostPressTimer);
  textPostPressTimer = setTimeout(() => {
    showTextPostMenu(Number(card.dataset.textPostId), e.clientX, e.clientY);
  }, 550);
});
document.addEventListener('pointerup', () => clearTimeout(textPostPressTimer));
document.addEventListener('pointercancel', () => clearTimeout(textPostPressTimer));
document.addEventListener('pointermove', () => clearTimeout(textPostPressTimer));
document.addEventListener('contextmenu', e => {
  if (e.target.closest('.profile-text-post')) e.preventDefault();
  else if (activeTextPostMenu) closeTextPostMenu();
});
document.addEventListener('click', e => {
  if (activeTextPostMenu && !e.target.closest('.text-post-menu') && !e.target.closest('.profile-text-post')) closeTextPostMenu();
});

async function loadNotifications() {
  const box = document.getElementById('notifications'); if (!box) return; box.innerHTML = '<div class="empty">загрузка...</div>';
  const res = await api('/api/notifications'); if (!res.ok) { box.innerHTML = '<div class="empty">Не удалось загрузить уведомления.</div>'; return; }
  const items = await res.json();
  box.innerHTML = items.length ? items.map(n => `<button class="notification-card ${n.is_read ? 'read' : 'unread'}" type="button" onclick="openNotification(${n.id})"><div class="notification-icon">${notificationIcon(n.type)}</div><img class="notification-avatar" src="${avatar(n.actor_photo_url)}"><div class="notification-content"><div class="notification-text">${esc(notificationText(n))}</div><div class="notification-time">${esc(n.created_at)}</div></div>${n.is_read ? '' : '<span class="notification-dot"></span>'}</button>`).join('') : '<div class="empty">Пока нет уведомлений.</div>';
}
function notificationText(n) { const a = n.actor_username ? '@' + n.actor_username : (n.actor_first_name || 'Пользователь'); if (n.type === 'friend_request') return `${a} отправил(а) вам запрос в друзья`; if (n.type === 'friend_accepted') return `${a} принял(а) ваш запрос в друзья`; if (n.type === 'like') return `${a} поставил(а) лайк вашей публикации`; if (n.type === 'comment') return `${a} прокомментировал(а) вашу публикацию`; if (n.type === 'tag') return `${a} отметил(а) вас в публикации`; return 'Новое уведомление'; }
function notificationIcon(t) { return ({ friend_request:'♡', friend_accepted:'✓', like:'♥', comment:'💬', tag:'@' }[t] || '•'); }
async function updateNotificationBadge() { const b = document.getElementById('notification-badge'); if (!b) return; const res = await api('/api/notifications/unread-count'); if (!res.ok) return; const c = Number((await res.json()).count || 0); b.hidden = c === 0; b.textContent = c > 99 ? '99+' : String(c); }
async function markAllNotificationsRead() { await api('/api/notifications/read-all', { method:'POST' }); await loadNotifications(); updateNotificationBadge(); }
async function openNotification(id) {
  const res = await api('/api/notifications'); if (!res.ok) return; const item = (await res.json()).find(n => n.id === Number(id)); if (!item) return;
  await api(`/api/notifications/${id}/read`, { method:'POST' }); updateNotificationBadge();
  if (item.type === 'friend_request' || item.type === 'friend_accepted') { if (item.actor_id) openProfile(item.actor_id); return; }
  if (item.post_id) openPost(item.post_id, item.type === 'comment');
}
async function openPost(postId, openComments = false) { showView('feed-view', false); await loadFeed(); const el = document.getElementById(`post-${postId}`); if (!el) return; el.scrollIntoView({behavior:'smooth', block:'center'}); el.classList.add('post-highlight'); setTimeout(() => el.classList.remove('post-highlight'), 1500); if (openComments) { await toggleComments(postId); } }

async function openImageViewer(src, postId = null) {
  const viewer = document.getElementById('image-viewer'); if (!viewer) return;
  viewer.classList.add('active'); viewer.dataset.postId = postId || ''; viewer.querySelector('.image-viewer-image').src = src;
  viewer.querySelector('.image-viewer-menu').classList.remove('active');
  const saveLink = viewer.querySelector('#image-save-link'); saveLink.href = src; saveLink.download = `sqawe-${postId || 'photo'}.jpg`;
  const del = viewer.querySelector('#image-delete-button'); del.hidden = true;
  if (postId) { const postRes = await api(`/api/posts/${postId}`); if (postRes.ok) { const p = await postRes.json(); const meRes = await api('/api/me'); if (meRes.ok) del.hidden = Number((await meRes.json()).id) !== Number(p.user_id); await loadViewerComments(postId); } }
}
async function loadViewerComments(postId) {
  const box = document.querySelector('#image-viewer .image-viewer-comments'); const res = await api(`/api/posts/${postId}/comments`); if (!res.ok) { box.innerHTML = '<div class="comments-error">Не удалось загрузить комментарии.</div>'; return; }
  const comments = await res.json(); box.innerHTML = `<div class="comments-list">${comments.length ? comments.map(c => `<div class="comment"><img class="comment-avatar" src="${avatar(c.photo_url)}"><div class="comment-content"><div class="comment-head"><span class="comment-author">${esc(c.first_name)} ${esc(c.last_name || '')}</span><span class="comment-username">${c.username ? '@' + esc(c.username) : ''}</span></div><div class="comment-text">${esc(c.text)}</div></div></div>`).join('') : '<div class="comments-empty">Комментариев пока нет.</div>'}</div><form class="comment-form" onsubmit="submitViewerComment(event, ${postId})"><input id="viewer-comment-input-${postId}" maxlength="500" placeholder="Написать комментарий..."><button class="primary" type="submit">Отправить</button></form>`;
}
async function submitViewerComment(event, postId) { event.preventDefault(); const input = document.getElementById(`viewer-comment-input-${postId}`); const fd = new FormData(); fd.append('text', input?.value || ''); const res = await api(`/api/posts/${postId}/comments`, {method:'POST',body:fd}); if (!res.ok) return alert(await res.text()); await loadViewerComments(postId); updateNotificationBadge(); }
async function deleteCurrentViewerPost() { const id = Number(document.getElementById('image-viewer')?.dataset.postId || 0); if (!id || !confirm('Удалить эту публикацию?')) return; const res = await api(`/api/posts/${id}`, {method:'DELETE'}); if (!res.ok) return alert(await res.text()); closeImageViewer(); loadFeed(); loadProfile(); }
function closeImageViewer() { const v = document.getElementById('image-viewer'); if (!v) return; v.classList.remove('active'); v.querySelector('.image-viewer-image').src = ''; v.querySelector('.image-viewer-menu').classList.remove('active'); }

document.addEventListener('click', e => { const image = e.target.closest('img[data-image-src]'); if (image) { e.preventDefault(); e.stopPropagation(); openImageViewer(image.dataset.imageSrc, image.dataset.postId || null); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeImageViewer(); closeStoryViewer(); } });
document.getElementById('image-viewer-close')?.addEventListener('click', closeImageViewer);
document.getElementById('image-viewer-dots')?.addEventListener('click', e => { e.stopPropagation(); document.getElementById('image-viewer-menu')?.classList.toggle('active'); });
document.getElementById('image-viewer-delete')?.addEventListener('click', deleteCurrentViewerPost);
document.getElementById('image-delete-button')?.addEventListener('click', deleteCurrentViewerPost);
document.getElementById('image-viewer')?.addEventListener('click', e => { if (e.target.id === 'image-viewer' || e.target.classList.contains('image-viewer-backdrop')) closeImageViewer(); });

function renderStoryStrip() {
  const box = document.getElementById('stories-strip');
  if (!box) return;

  const groups = new Map();
  stories.forEach(s => {
    if (!groups.has(s.user_id)) groups.set(s.user_id, []);
    groups.get(s.user_id).push(s);
  });

  const bubbles = [...groups.values()].map(group => {
    const first = group[0];
    const hasUnviewed = group.some(s => !Boolean(s.viewed));
    return `
      <button class="story-bubble ${hasUnviewed ? 'unviewed' : 'viewed'}" type="button" onclick="openStoryForUser(${first.user_id})">
        <span class="story-ring">
          <img src="${avatar(first.photo_url)}" alt="">
        </span>
        <span class="story-name">${esc(first.first_name)}</span>
      </button>
    `;
  }).join('');

  box.innerHTML = `
    <button class="story-add" type="button" onclick="chooseStoryPhoto()">
      <span class="story-add-circle">＋</span>
      <small>Ваша история</small>
    </button>
    ${bubbles}
  `;
}

async function loadStories() {
  const box = document.getElementById('stories-strip');
  if (!box) return;

  const res = await api('/api/stories');
  if (!res.ok) { box.innerHTML = ''; return; }

  stories = await res.json();
  renderStoryStrip();
}

function chooseStoryPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => input.files[0] && uploadStory(input.files[0]);
  input.click();
}

async function uploadStory(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('/api/stories', {method:'POST',body:fd});
  if (!res.ok) return alert(await res.text());
  await loadStories();
}

function getStoryTimeLabel(createdAt) {
  if (!createdAt) return '';
  const parsed = new Date(String(createdAt).replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) return '';
  const diff = Math.max(0, Date.now() - parsed.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return 'вчера';
  return `${days} дн назад`;
}

function storyMediaUrl(story) {
  return `/uploads/${encodeURIComponent(story.image_path)}`;
}

function clearStoryTimer() {
  if (storyTimer) {
    clearInterval(storyTimer);
    storyTimer = null;
  }
}

function closeStoryViewer() {
  clearStoryTimer();
  const viewer = document.getElementById('stories-viewer');
  if (viewer) viewer.hidden = true;
  storyGroup = [];
  storyGroupIndex = 0;
}

function setStoryProgress(progress) {
  const bar = document.getElementById('story-progress-fill');
  if (!bar) return;
  bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
}

function storyProgressFromEvent(event) {
  const track = document.getElementById('story-progress-track');
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  const clientX = event.touches?.[0]?.clientX ?? event.clientX;
  if (typeof clientX !== 'number') return 0;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function seekStory(progress) {
  if (!storyGroup.length) return;
  clearStoryTimer();
  const p = Math.max(0, Math.min(1, progress));
  storyStartedAt = Date.now() - p * STORY_DURATION_MS;
  setStoryProgress(p);
  storyTimer = setInterval(updateStoryProgress, 50);
}

function updateStoryProgress() {
  if (!storyGroup.length) return;
  const progress = (Date.now() - storyStartedAt) / STORY_DURATION_MS;
  setStoryProgress(progress);
  if (progress >= 1) {
    clearStoryTimer();
    if (storyGroupIndex < storyGroup.length - 1) {
      storyGroupIndex += 1;
      renderStory();
    } else {
      closeStoryViewer();
    }
  }
}

function openStoryForUser(userId) {
  storyGroup = stories.filter(s => s.user_id === userId);
  if (!storyGroup.length) return;
  storyGroupIndex = 0;
  renderStory();
}

async function renderStory() {
  const s = storyGroup[storyGroupIndex];
  if (!s) return;

  clearStoryTimer();

  const v = document.getElementById('stories-viewer');
  const image = document.getElementById('story-image');
  const bg = document.getElementById('story-backdrop');
  const owner = document.getElementById('story-owner');
  const count = document.getElementById('story-count');
  const time = document.getElementById('story-time');
  const caption = document.getElementById('story-caption');

  if (!v || !image) return;

  v.hidden = false;
  image.src = storyMediaUrl(s);
  if (bg) bg.style.backgroundImage = `url("${storyMediaUrl(s)}")`;
  if (owner) owner.textContent = s.username ? '@' + s.username : s.first_name;
  if (count) count.textContent = `${storyGroupIndex + 1}/${storyGroup.length}`;
  if (time) time.textContent = getStoryTimeLabel(s.created_at);
  if (caption) caption.textContent = s.caption || '';

  setStoryProgress(0);
  storyStartedAt = Date.now();
  storyTimer = setInterval(updateStoryProgress, 50);

  if (!s.viewed) {
    const res = await api(`/api/stories/${s.id}/view`, { method: 'POST' });
    if (res.ok) {
      s.viewed = 1;
      renderStoryStrip();
    }
  }
}

function showPreviousStory() {
  if (storyGroupIndex > 0) {
    storyGroupIndex -= 1;
    renderStory();
  }
}

function showNextStory() {
  if (storyGroupIndex < storyGroup.length - 1) {
    storyGroupIndex += 1;
    renderStory();
  } else {
    closeStoryViewer();
  }
}

document.getElementById('story-close')?.addEventListener('click', closeStoryViewer);
document.getElementById('story-next')?.addEventListener('click', showNextStory);
document.getElementById('story-prev')?.addEventListener('click', showPreviousStory);
document.getElementById('stories-viewer')?.addEventListener('click', e => {
  if (e.target.classList.contains('stories-viewer-backdrop')) closeStoryViewer();
});

document.getElementById('story-progress-track')?.addEventListener('pointerdown', e => {
  storySeekPointerDown = true;
  e.currentTarget.setPointerCapture?.(e.pointerId);
  seekStory(storyProgressFromEvent(e));
});

document.getElementById('story-progress-track')?.addEventListener('pointermove', e => {
  if (!storySeekPointerDown) return;
  seekStory(storyProgressFromEvent(e));
});

document.getElementById('story-progress-track')?.addEventListener('pointerup', () => {
  storySeekPointerDown = false;
});

document.getElementById('story-progress-track')?.addEventListener('pointercancel', () => {
  storySeekPointerDown = false;
});

async function loadNews() {
  const box = document.getElementById('news-strip'); if (!box) return;
  const res = await api('/api/news'); if (!res.ok) { box.innerHTML=''; return; }
  const items = await res.json();
  box.innerHTML = items.length ? `<div class="news-title-row"><h2>Новости</h2></div><div class="news-list">${items.slice(0,6).map(n => `<article class="news-card"><div class="news-source">📰 ${esc(n.source)}</div><h3>${esc(n.title)}</h3>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}<a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">Читать источник →</a></article>`).join('')}</div>` : '';
}

async function loadSettings() {
  const box = document.getElementById('settings');
  if (!box) return;
  const res = await api('/api/settings');
  if (!res.ok) return;
  const s = await res.json();
  box.innerHTML = `<div class="settings-card"><div class="settings-avatar-row"><img class="settings-avatar" src="${avatar(s.photo_url)}"><div><h2>Профиль</h2><p>${s.username ? '@' + esc(s.username) : 'Telegram user'}</p><button id="settings-avatar-btn" class="ghost" type="button">Сменить фотографию</button></div></div><label>Имя</label><input id="settings-first-name" value="${esc(s.first_name || '')}" maxlength="80"><label>Username</label><input id="settings-username" value="${s.username ? '@'+esc(s.username) : ''}" maxlength="33" autocapitalize="none"><small class="settings-hint">3–32 символа, латинские буквы, цифры и _</small><label>О себе</label><textarea id="settings-bio" maxlength="500">${esc(s.bio || '')}</textarea><button id="save-profile-btn" class="primary" type="button">Сохранить</button></div><div class="settings-card"><h2>Telegram-уведомления</h2><p>${s.write_access ? '✓ Sqawe может присылать сообщения в Telegram.' : 'Разреши Sqawe присылать уведомления в Telegram.'}</p><button id="settings-push-btn" class="primary" type="button">${s.write_access ? 'Разрешение включено' : 'Включить Telegram-уведомления'}</button><label class="switch-row"><input id="push-enabled" type="checkbox" ${s.push_enabled ? 'checked' : ''}> Получать push-уведомления</label></div>`;
  document.getElementById('settings-avatar-btn').onclick = changeAvatar;
  document.getElementById('save-profile-btn').onclick = async () => { const fd = new FormData(); fd.append('bio', document.getElementById('settings-bio').value); fd.append('first_name', document.getElementById('settings-first-name').value.trim()); fd.append('username', document.getElementById('settings-username').value.trim()); const r = await api('/api/settings/profile', {method:'POST',body:fd}); if (r.ok) { await loadProfile(); alert('Профиль сохранён.'); } else { let msg='Не удалось сохранить профиль.'; try { const d=await r.json(); msg=d.detail || msg; } catch {} alert(msg); } };
  document.getElementById('settings-push-btn').onclick = requestWriteAccess;
  document.getElementById('push-enabled').onchange = async e => { const fd=new FormData(); fd.append('enabled',e.target.checked?'1':'0'); await api('/api/settings/push',{method:'POST',body:fd}); };
}


function requestWriteAccess() {
  if (!tg?.requestWriteAccess) return alert('Telegram не поддерживает запрос разрешения на этой версии клиента.');
  tg.requestWriteAccess(async allowed => { const fd=new FormData(); fd.append('allowed',allowed?'1':'0'); await api('/api/settings/write-access',{method:'POST',body:fd}); await loadSettings(); });
}


async function refreshAdminAccess() {
  const button=document.getElementById('open-admin-panel'); if(!button) return;
  try { const r=await api('/api/admin/me'); if(!r.ok){button.hidden=true;return;} const d=await r.json(); button.hidden=!d.is_admin; button.dataset.owner=d.is_owner?'1':'0'; } catch(_){button.hidden=true;}
}
function openAdminPanel(){ document.getElementById('top-menu')?.setAttribute('hidden',''); const m=document.getElementById('admin-modal'); if(!m)return; m.hidden=false; document.body.classList.add('profile-modal-open'); loadAdminPanel(); }
function closeAdminPanel(){ const m=document.getElementById('admin-modal'); if(!m)return; m.hidden=true; document.body.classList.remove('profile-modal-open'); }
async function loadAdminPanel(query=''){ const stats=document.getElementById('admin-stats'); const role=document.getElementById('admin-role-label'); const r=await api('/api/admin/overview'); if(!r.ok){closeAdminPanel();return;} const o=await r.json(); if(role)role.textContent=o.me.is_owner?'Owner':'Administrator'; const s=o.stats; if(stats)stats.innerHTML=`<div class="admin-stat"><strong>${s.users}</strong><span>Users</span></div><div class="admin-stat"><strong>${s.posts}</strong><span>Posts</span></div><div class="admin-stat"><strong>${s.comments}</strong><span>Comments</span></div><div class="admin-stat"><strong>${s.verified}</strong><span>Verified</span></div>`; await loadAdminUsers(query,o.me.is_owner); }
async function loadAdminUsers(query='',isOwner=false){ const box=document.getElementById('admin-users'); if(!box)return; box.innerHTML='<div class="empty">Loading...</div>'; const r=await api(`/api/admin/users?q=${encodeURIComponent(query)}`); if(!r.ok){box.innerHTML='<div class="empty">Access denied.</div>';return;} const users=await r.json(); box.innerHTML=users.length?users.map(u=>{const name=`${esc(u.first_name)} ${esc(u.last_name||'')}`.trim();const role=u.is_owner?'Owner':(u.is_admin?'Admin':'User');return `<div class="admin-user"><img class="avatar" src="${avatar(u.photo_url)}" alt=""><div class="admin-user-main"><div class="admin-user-name">${name}${verifiedMark(u)}</div><div class="admin-user-meta">${u.username?'@'+esc(u.username)+' · ':''}${role}${u.suspended?' · Suspended':''}</div></div><div class="admin-user-actions"><button type="button" onclick="adminToggleVerified(${u.id},${u.verified?0:1})">${u.verified?'Unverify':'Verify'}</button>${isOwner&&!u.is_owner?`<button type="button" onclick="adminToggleRole(${u.id},${u.is_admin?0:1})">${u.is_admin?'Revoke admin':'Make admin'}</button>`:''}${!u.is_owner?`<button type="button" class="danger" onclick="adminToggleSuspend(${u.id},${u.suspended?0:1})">${u.suspended?'Unsuspend':'Suspend'}</button>`:''}${!u.is_owner?`<button type="button" class="danger" onclick="adminDeleteUserPosts(${u.id})">Delete posts</button>`:''}<button type="button" onclick="openProfile(${u.id});closeAdminPanel();">Profile</button></div></div>`;}).join(''):'<div class="empty">No users found.</div>'; }
async function adminToggleVerified(id,enabled){const fd=new FormData();fd.append('enabled',String(enabled));const r=await api(`/api/admin/users/${id}/verified`,{method:'POST',body:fd});if(!r.ok)return alert(await r.text());await loadAdminPanel(document.getElementById('admin-user-search')?.value||'');}
async function adminToggleRole(id,enabled){const fd=new FormData();fd.append('enabled',String(enabled));const r=await api(`/api/admin/users/${id}/admin`,{method:'POST',body:fd});if(!r.ok)return alert(await r.text());await loadAdminPanel(document.getElementById('admin-user-search')?.value||'');}
async function adminToggleSuspend(id,enabled){const fd=new FormData();fd.append('enabled',String(enabled));const r=await api(`/api/admin/users/${id}/suspend`,{method:'POST',body:fd});if(!r.ok)return alert(await r.text());await loadAdminPanel(document.getElementById('admin-user-search')?.value||'');}
async function adminDeleteUserPosts(id){if(!confirm('Delete all posts from this user?'))return;const r=await api(`/api/admin/users/${id}/posts`,{method:'DELETE'});if(!r.ok)return alert(await r.text());await loadAdminPanel(document.getElementById('admin-user-search')?.value||'');}
document.getElementById('open-admin-panel')?.addEventListener('click',openAdminPanel);document.getElementById('admin-close')?.addEventListener('click',closeAdminPanel);document.querySelector('.admin-backdrop')?.addEventListener('click',closeAdminPanel);document.getElementById('admin-user-search')?.addEventListener('input',e=>loadAdminUsers(e.target.value.trim(),document.getElementById('open-admin-panel')?.dataset.owner==='1'));

(async () => {
  applyTheme(getStoredTheme());
  loadBuildNumber();
  await refreshAdminAccess();
  ensureGlassIndicator();
  moveGlassIndicator();
  await setFeedTab('people');
  await loadPeople();
  await updateNotificationBadge();

  const startParam = tg?.initDataUnsafe?.start_param || '';
  const profileMatch = startParam.match(/^profile_(\d+)$/);
  if (profileMatch) {
    await openProfile(Number(profileMatch[1]));
  } else {
    const urlProfile = new URLSearchParams(window.location.search).get('profile');
    if (urlProfile && /^\d+$/.test(urlProfile)) {
      await openProfile(Number(urlProfile));
    }
  }
})();
setInterval(updateNotificationBadge, 15000);


document.addEventListener('click', e => { if (!e.target.closest('.profile-more-wrap')) document.getElementById('profile-menu')?.classList.remove('active'); if (!e.target.closest('.topbar-right')) document.getElementById('top-menu')?.setAttribute('hidden',''); });
