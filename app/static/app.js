const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";
const headers = { "X-Telegram-Init-Data": initData };

function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), ...headers };
  return fetch(path, options);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function avatar(url) {
  return url ? esc(url) : "/static/default-avatar.svg";
}

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  const timestamp = new Date(lastSeen.replace(" ", "T") + "Z").getTime();
  return !Number.isNaN(timestamp) && Date.now() - timestamp < 2 * 60 * 1000;
}

function onlineText(lastSeen) {
  return isOnline(lastSeen)
    ? '<div class="online-status online">● В сети</div>'
    : '<div class="online-status offline">○ Был(а) недавно</div>';
}

function showView(viewId, loadData = true) {
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (!target) return;
  target.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === viewId));
  if (!loadData) return;
  if (viewId === "feed-view") loadFeed();
  if (viewId === "friends-view") loadFriends();
  if (viewId === "notifications-view") loadNotifications();
  if (viewId === "profile-view") loadProfile();
}

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.getElementById("refresh-btn")?.addEventListener("click", loadFeed);
document.getElementById("refresh-friends-btn")?.addEventListener("click", loadFriends);
document.getElementById("refresh-notifications-btn")?.addEventListener("click", loadNotifications);

async function getUserProfile(userId) {
  const res = await api(`/api/users/${userId}`);
  if (!res.ok) return null;
  return res.json();
}

function getMiniFriendButton(userId, status) {
  if (status === "self") return "";
  if (status === "friends") return '<button class="friend-mini" disabled>✓ Друзья</button>';
  if (status === "pending") return '<button class="friend-mini" disabled>Запрос отправлен</button>';
  if (status === "incoming") return `<button class="friend-mini" onclick="acceptFriendRequest(${userId})">Принять</button>`;
  return `<button class="friend-mini" onclick="sendFriendRequest(${userId})">Добавить</button>`;
}

async function loadFeed() {
  const box = document.getElementById("feed");
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';

  try {
    const res = await api("/api/feed");
    if (!res.ok) {
      box.innerHTML = `<div class="empty">Не удалось загрузить ленту.<br>${esc(await res.text())}</div>`;
      return;
    }

    const posts = await res.json();
    if (!posts.length) {
      box.innerHTML = '<div class="empty">Здесь пока пусто.<br>Будь первым.</div>';
      return;
    }

    const cache = new Map();
    const html = [];

    for (const post of posts) {
      let profile = cache.get(post.user_id);
      if (!profile) {
        profile = await getUserProfile(post.user_id);
        cache.set(post.user_id, profile);
      }

      html.push(`
        <article class="post">
          <div class="post-head">
            <img class="avatar profile-click" src="${avatar(post.photo_url)}" onclick="openProfile(${post.user_id})">
            <div class="profile-click" onclick="openProfile(${post.user_id})">
              <div class="name">${esc(post.first_name)} ${esc(post.last_name || "")}</div>
              <div class="username">${post.username ? "@" + esc(post.username) : "Telegram user"}</div>
            </div>
            <div class="feed-friend-button">${getMiniFriendButton(post.user_id, profile?.friend_status || "none")}</div>
          </div>
          <img class="post-image" src="/uploads/${esc(post.image_path)}" loading="lazy">
          <div class="post-body">
            ${post.caption ? `<p class="caption">${esc(post.caption)}</p>` : ""}
            <div class="meta">
              <button class="like ${post.liked ? "liked" : ""}" onclick="likePost(${post.id}, this)">
                ${post.liked ? "♥" : "♡"} ${post.likes}
              </button>
              <button class="comment-toggle" onclick="toggleComments(${post.id}, this)">
                💬 ${post.comments || 0}
              </button>
            </div>
            <div id="comments-${post.id}" class="comments" hidden></div>
          </div>
        </article>
      `);
    }

    box.innerHTML = html.join("");
  } catch {
    box.innerHTML = '<div class="empty">Ошибка загрузки ленты.</div>';
  }
}

async function likePost(postId, button) {
  const res = await api(`/api/posts/${postId}/like`, { method: "POST" });
  if (!res.ok) return;
  const data = await res.json();
  button.classList.toggle("liked", data.liked);
  button.innerHTML = `${data.liked ? "♥" : "♡"} ${data.likes}`;
}

async function toggleComments(postId, button) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;

  if (!box.hidden) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  box.innerHTML = '<div class="comments-loading">загрузка комментариев...</div>';

  const res = await api(`/api/posts/${postId}/comments`);

  if (!res.ok) {
    box.innerHTML = `<div class="comments-error">${esc(await res.text())}</div>`;
    return;
  }

  const comments = await res.json();

  box.innerHTML = `
    <div class="comments-list">
      ${comments.length ? comments.map(comment => `
        <div class="comment">
          <img class="comment-avatar" src="${avatar(comment.photo_url)}" onclick="openProfile(${comment.user_id})">
          <div class="comment-content">
            <div class="comment-head">
              <span class="comment-author" onclick="openProfile(${comment.user_id})">
                ${esc(comment.first_name)} ${esc(comment.last_name || "")}
              </span>
              <span class="comment-username">
                ${comment.username ? "@" + esc(comment.username) : ""}
              </span>
            </div>
            <div class="comment-text">${esc(comment.text)}</div>
          </div>
        </div>
      `).join("") : '<div class="comments-empty">Пока нет комментариев.</div>'}
    </div>

    <form class="comment-form" onsubmit="submitComment(event, ${postId})">
      <input
        type="text"
        maxlength="500"
        placeholder="Написать комментарий..."
        autocomplete="off"
      >
      <button class="primary" type="submit">Отправить</button>
    </form>
  `;

  box.scrollIntoView({ block: "nearest" });
}


async function submitComment(event, postId) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = form.querySelector("input");
  const text = input.value.trim();

  if (!text) return;

  const button = form.querySelector("button");
  button.disabled = true;

  const body = new URLSearchParams();
  body.set("text", text);

  const res = await api(`/api/posts/${postId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body
  });

  button.disabled = false;

  if (!res.ok) {
    alert(await res.text());
    return;
  }

  await refreshComments(postId);
}


async function refreshComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;
  box.hidden = false;

  const res = await api(`/api/posts/${postId}/comments`);
  if (!res.ok) return;

  const comments = await res.json();

  const existingForm = box.querySelector(".comment-form");
  const formHtml = existingForm ? existingForm.outerHTML : `
    <form class="comment-form" onsubmit="submitComment(event, ${postId})">
      <input type="text" maxlength="500" placeholder="Написать комментарий..." autocomplete="off">
      <button class="primary" type="submit">Отправить</button>
    </form>
  `;

  box.innerHTML = `
    <div class="comments-list">
      ${comments.length ? comments.map(comment => `
        <div class="comment">
          <img class="comment-avatar" src="${avatar(comment.photo_url)}" onclick="openProfile(${comment.user_id})">
          <div class="comment-content">
            <div class="comment-head">
              <span class="comment-author" onclick="openProfile(${comment.user_id})">
                ${esc(comment.first_name)} ${esc(comment.last_name || "")}
              </span>
              <span class="comment-username">
                ${comment.username ? "@" + esc(comment.username) : ""}
              </span>
            </div>
            <div class="comment-text">${esc(comment.text)}</div>
          </div>
        </div>
      `).join("") : '<div class="comments-empty">Пока нет комментариев.</div>'}
    </div>
    ${formHtml}
  `;

  const toggle = document.querySelector(`[onclick="toggleComments(${postId}, this)"]`);
  if (toggle) {
    toggle.textContent = `💬 ${comments.length}`;
  }
}


const imageInput = document.getElementById("image");
imageInput?.addEventListener("change", () => {
  const preview = document.getElementById("preview");
  const file = imageInput.files[0];
  if (!preview) return;
  if (!file) {
    preview.textContent = "＋ Выбрать фото";
    return;
  }
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="preview">`;
});

const postForm = document.getElementById("post-form");
postForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const error = document.getElementById("form-error");
  if (error) error.textContent = "";

  const file = document.getElementById("image")?.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("caption", document.getElementById("caption")?.value || "");

  const button = postForm.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Публикация...";
  }

  const res = await api("/api/posts", { method: "POST", body: formData });

  if (!res.ok) {
    if (error) error.textContent = await res.text();
  } else {
    postForm.reset();
    const preview = document.getElementById("preview");
    if (preview) preview.textContent = "＋ Выбрать фото";
    showView("feed-view");
  }

  if (button) {
    button.disabled = false;
    button.textContent = "Опубликовать";
  }
});

function friendButtonForProfile(userId, status) {
  if (status === "self") return "";
  if (status === "friends") return '<button class="primary" disabled>✓ Уже друзья</button>';
  if (status === "pending") return '<button class="primary" disabled>Запрос отправлен</button>';
  if (status === "incoming") {
    return `
      <div class="friend-actions">
        <button class="primary" onclick="acceptFriendRequest(${userId})">Принять</button>
        <button class="ghost" onclick="declineFriendRequest(${userId})">Отклонить</button>
      </div>
    `;
  }
  return `<button class="primary" onclick="sendFriendRequest(${userId})">Добавить в друзья</button>`;
}

async function openProfile(userId) {
  const data = await getUserProfile(userId);
  if (!data) {
    alert("Не удалось загрузить профиль");
    return;
  }

  const profile = document.getElementById("profile");
  if (!profile) return;

  const user = data.user;
  profile.innerHTML = `
    <div class="profile-back">
      <button class="ghost" type="button" onclick="showView('feed-view')">← Назад</button>
    </div>
    <div class="profile-head">
      <img class="profile-avatar" src="${avatar(user.photo_url)}">
      <div>
        <div class="profile-name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="profile-stats">${user.username ? "@" + esc(user.username) : "Telegram user"}</div>
        <div class="profile-stats">${data.friend_count} друзей · ${data.posts.length} постов</div>
        ${onlineText(user.last_seen)}
      </div>
    </div>
    <div class="friend-button">${friendButtonForProfile(user.id, data.friend_status)}</div>
    <div class="grid">
      ${data.posts.length ? data.posts.map(post => `<img src="/uploads/${esc(post.image_path)}" loading="lazy">`).join("") : '<div class="empty">Пока нет публикаций.</div>'}
    </div>
  `;
  showView("profile-view", false);
}

async function sendFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/request`, { method: "POST" });
  if (!res.ok) {
    alert("Не удалось отправить запрос");
    return;
  }
  await openProfile(userId);
}

async function acceptFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/accept`, { method: "POST" });
  if (!res.ok) {
    alert("Не удалось принять запрос");
    return;
  }
  await openProfile(userId);
}

async function declineFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/decline`, { method: "POST" });
  if (!res.ok) {
    alert("Не удалось отклонить запрос");
    return;
  }
  await loadFriends();
}

async function loadFriends() {
  const box = document.getElementById("friends");
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';

  const res = await api("/api/friends");
  if (!res.ok) {
    box.innerHTML = `<div class="empty">Не удалось загрузить друзей.<br>${esc(await res.text())}</div>`;
    return;
  }

  const friends = await res.json();
  if (!friends.length) {
    box.innerHTML = '<div class="empty">У тебя пока нет друзей.</div>';
    return;
  }

  box.innerHTML = friends.map(user => `
    <div class="friend-card" onclick="openProfile(${user.id})">
      <img class="avatar" src="${avatar(user.photo_url)}">
      <div class="friend-info">
        <div class="name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="username">${user.username ? "@" + esc(user.username) : "Telegram user"}</div>
        ${onlineText(user.last_seen)}
      </div>
    </div>
  `).join("");
}

async function loadProfile() {
  const box = document.getElementById("profile");
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';

  const meRes = await api("/api/me");
  if (!meRes.ok) {
    box.innerHTML = `<div class="empty">Профиль недоступен.<br>${esc(await meRes.text())}</div>`;
    return;
  }

  const me = await meRes.json();
  const data = await getUserProfile(me.id);
  if (!data) {
    box.innerHTML = '<div class="empty">Ошибка профиля.</div>';
    return;
  }

  const user = data.user;
  box.innerHTML = `
    <div class="profile-head">
      <img class="profile-avatar" src="${avatar(user.photo_url)}">
      <div>
        <div class="profile-name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="profile-stats">${user.username ? "@" + esc(user.username) : ""}</div>
        <div class="profile-stats">${data.friend_count} друзей · ${data.posts.length} постов</div>
        ${onlineText(user.last_seen)}
      </div>
    </div>
    <div class="grid">
      ${data.posts.length ? data.posts.map(post => `<img src="/uploads/${esc(post.image_path)}" loading="lazy">`).join("") : '<div class="empty">У тебя пока нет публикаций.</div>'}
    </div>
  `;
}

const searchInput = document.getElementById("friend-search-input");
const searchButton = document.getElementById("friend-search-btn");
const searchResults = document.getElementById("friend-search-results");

searchButton?.addEventListener("click", searchUsers);
searchInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchUsers();
  }
});

async function searchUsers() {
  if (!searchInput || !searchResults) return;

  const query = searchInput.value.trim().replace(/^@+/, "");

  if (!query) {
    searchResults.innerHTML = "";
    return;
  }

  searchResults.innerHTML = '<div class="empty">поиск...</div>';

  const res = await api(`/api/users/search?q=${encodeURIComponent(query)}`);

  if (!res.ok) {
    searchResults.innerHTML = `<div class="empty">Ошибка поиска.<br>${esc(await res.text())}</div>`;
    return;
  }

  const users = await res.json();

  if (!users.length) {
    searchResults.innerHTML = '<div class="empty">Пользователь не найден.</div>';
    return;
  }

  searchResults.innerHTML = users.map(user => `
    <div class="friend-card">
      <img class="avatar profile-click" src="${avatar(user.photo_url)}" onclick="openProfile(${user.id})">
      <div class="friend-info profile-click" onclick="openProfile(${user.id})">
        <div class="name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="username">@${esc(user.username)}</div>
        ${onlineText(user.last_seen)}
      </div>
      <div class="search-friend-button">
        ${getMiniFriendButton(user.id, user.friend_status || "none")}
      </div>
    </div>
  `).join("");
}


function notificationText(notification) {
  const actor = notification.actor_username
    ? "@" + esc(notification.actor_username)
    : `${esc(notification.actor_first_name || "Пользователь")} ${esc(notification.actor_last_name || "")}`;

  if (notification.type === "friend_request") {
    return `${actor} отправил(а) вам запрос в друзья`;
  }

  if (notification.type === "friend_accepted") {
    return `${actor} принял(а) ваш запрос в друзья`;
  }

  if (notification.type === "like") {
    return `${actor} поставил(а) лайк вашей публикации`;
  }

  if (notification.type === "comment") {
    return `${actor} написал(а) комментарий к вашей публикации`;
  }

  return "Новое уведомление";
}


function notificationIcon(type) {
  if (type === "friend_request") return "♡";
  if (type === "friend_accepted") return "✓";
  if (type === "like") return "♥";
  if (type === "comment") return "💬";
  return "•";
}


function notificationClick(actorId) {
  if (actorId) {
    openProfile(actorId);
    return;
  }

  showView("notifications-view", false);
}


async function updateNotificationBadge() {
  const badge = document.getElementById("notification-badge");
  if (!badge) return;

  const res = await api("/api/notifications/unread-count");
  if (!res.ok) return;

  const data = await res.json();
  const count = Number(data.count || 0);

  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
}


async function loadNotifications() {
  const box = document.getElementById("notifications");
  if (!box) return;

  box.innerHTML = '<div class="empty">загрузка...</div>';

  const res = await api("/api/notifications");

  if (!res.ok) {
    box.innerHTML = `<div class="empty">Не удалось загрузить уведомления.<br>${esc(await res.text())}</div>`;
    return;
  }

  const notifications = await res.json();

  if (!notifications.length) {
    box.innerHTML = '<div class="empty">Пока нет уведомлений.</div>';
    await markNotificationsRead();
    return;
  }

  box.innerHTML = notifications.map(notification => `
    <button
      class="notification-card ${notification.is_read ? "read" : "unread"}"
      type="button"
      onclick="notificationClick(${Number(notification.actor_id || 0)})"
    >
      <div class="notification-icon">${notificationIcon(notification.type)}</div>
      <img class="notification-avatar" src="${avatar(notification.actor_photo_url)}">
      <div class="notification-content">
        <div class="notification-text">${notificationText(notification)}</div>
        <div class="notification-time">${esc(notification.created_at || "")}</div>
      </div>
      ${notification.is_read ? "" : '<span class="notification-dot"></span>'}
    </button>
  `).join("");

  await markNotificationsRead();
}


async function markNotificationsRead() {
  const res = await api("/api/notifications/read-all", { method: "POST" });
  if (res.ok) {
    const badge = document.getElementById("notification-badge");
    if (badge) {
      badge.textContent = "0";
      badge.hidden = true;
    }
  }
}


setInterval(updateNotificationBadge, 15000);

updateNotificationBadge();

loadFeed();
