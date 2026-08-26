const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";
const headers = { "X-Telegram-Init-Data": initData };
const selectedTagMap = new Map();
const tagSearchUserMap = new Map();

function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), ...headers };
  return fetch(path, options);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
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
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  if (!loadData) return;
  if (viewId === "feed-view") loadFeed();
  if (viewId === "friends-view") loadFriends();
  if (viewId === "people-view") loadPeople();
  if (viewId === "notifications-view") loadNotifications();
  if (viewId === "profile-view") loadProfile();
}

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.getElementById("refresh-btn")?.addEventListener("click", loadFeed);
document.getElementById("refresh-friends-btn")?.addEventListener("click", loadFriends);
document.getElementById("refresh-people-btn")?.addEventListener("click", loadPeople);
document.getElementById("refresh-notifications-btn")?.addEventListener("click", loadNotifications);
document.getElementById("read-all-btn")?.addEventListener("click", markAllNotificationsRead);

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

function postImageMarkup(path, postId = null) {
  if (!path) return "";
  const src = `/uploads/${encodeURIComponent(path)}`;
  return `<img class="post-image" src="${src}" data-image-src="${src}" data-post-id="${postId || ""}" loading="lazy" alt="Фото">`;
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
        <article class="post" id="post-${post.id}">
          <div class="post-head">
            <img class="avatar profile-click" src="${avatar(post.photo_url)}" onclick="openProfile(${post.user_id})">
            <div class="profile-click" onclick="openProfile(${post.user_id})">
              <div class="name">${esc(post.first_name)} ${esc(post.last_name || "")}</div>
              <div class="username">${post.username ? "@" + esc(post.username) : "Telegram user"}</div>
            </div>
            <div class="feed-friend-button">${getMiniFriendButton(post.user_id, profile?.friend_status || "none")}</div>
          </div>

          ${postImageMarkup(post.image_path, post.id)}

          <div class="post-body">
            ${post.caption ? `<p class="caption">${esc(post.caption)}</p>` : ""}
            <div class="post-tags-line">
              <button class="post-tags-link" type="button" onclick="showPostTags(${post.id})">Отметки</button>
            </div>
            <div class="meta">
              <button class="like ${post.liked ? "liked" : ""}" onclick="likePost(${post.id}, this)">
                ${post.liked ? "♥" : "♡"} ${post.likes}
              </button>
              <button class="comment-toggle" type="button" onclick="toggleComments(${post.id})">
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
  updateNotificationBadge();
}

async function toggleComments(postId) {
  const box = document.getElementById(`comments-${postId}`);
  if (!box) return;

  if (!box.hidden) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  box.innerHTML = '<div class="comments-loading">загрузка...</div>';

  const res = await api(`/api/posts/${postId}/comments`);
  if (!res.ok) {
    box.innerHTML = '<div class="comments-error">Не удалось загрузить комментарии.</div>';
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
              <span class="comment-username">${comment.username ? "@" + esc(comment.username) : ""}</span>
            </div>
            <div class="comment-text">${esc(comment.text)}</div>
          </div>
        </div>
      `).join("") : '<div class="comments-empty">Комментариев пока нет.</div>'}
    </div>
    <form class="comment-form" onsubmit="submitComment(event, ${postId})">
      <input id="comment-input-${postId}" maxlength="500" placeholder="Написать комментарий...">
      <button class="primary" type="submit">Отправить</button>
    </form>
  `;
}

async function submitComment(event, postId) {
  event.preventDefault();
  const input = document.getElementById(`comment-input-${postId}`);
  if (!input) return;

  const formData = new FormData();
  formData.append("text", input.value);

  const res = await api(`/api/posts/${postId}/comments`, { method: "POST", body: formData });
  if (!res.ok) {
    alert(await res.text());
    return;
  }

  await loadFeed();
  const commentsBox = document.getElementById(`comments-${postId}`);
  if (commentsBox) {
    commentsBox.hidden = false;
    await toggleComments(postId);
    await toggleComments(postId);
  }
  updateNotificationBadge();
}

async function showPostTags(postId) {
  const res = await api(`/api/posts/${postId}`);
  if (!res.ok) return;
  const post = await res.json();
  const tags = post.tags || [];
  if (!tags.length) {
    alert("Отмеченных людей нет.");
    return;
  }
  alert("Отмечены: " + tags.map(user => "@" + (user.username || user.first_name)).join(", "));
}

const imageInput = document.getElementById("image");
imageInput?.addEventListener("change", () => {
  const file = imageInput.files[0];
  const preview = document.getElementById("preview");
  if (!preview) return;
  if (!file) {
    preview.textContent = "＋ Выбрать фото";
    return;
  }
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="preview">`;
});

function renderSelectedTags() {
  const box = document.getElementById("selected-tags");
  if (!box) return;
  box.innerHTML = [...selectedTagMap.values()].map(user => `
    <span class="tag-chip">
      @${esc(user.username)}
      <button type="button" onclick="removeTag(${user.id})">×</button>
    </span>
  `).join("");
  document.getElementById("tag-ids").value = [...selectedTagMap.keys()].join(",");
}

function addTag(user) {
  selectedTagMap.set(Number(user.id), user);
  renderSelectedTags();
  document.getElementById("tag-search-results").innerHTML = "";
  document.getElementById("tag-search-input").value = "";
}

function addTagById(userId) {
  const user = tagSearchUserMap.get(String(userId));
  if (user) addTag(user);
}

function removeTag(userId) {
  selectedTagMap.delete(Number(userId));
  renderSelectedTags();
}

async function searchTagUsers() {
  const input = document.getElementById("tag-search-input");
  const box = document.getElementById("tag-search-results");
  if (!input || !box) return;
  const query = input.value.trim().replace(/^@+/, "");
  if (!query) {
    box.innerHTML = "";
    return;
  }

  const res = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    box.innerHTML = '<div class="empty">Ошибка поиска.</div>';
    return;
  }

  const users = await res.json();
  tagSearchUserMap.clear();
  users.forEach(user => tagSearchUserMap.set(String(user.id), user));
  box.innerHTML = users.map(user => `
    <button type="button" class="tag-result" onclick="addTagById(${user.id})">
      <img class="avatar" src="${avatar(user.photo_url)}">
      <span><b>${esc(user.first_name)} ${esc(user.last_name || "")}</b><small>@${esc(user.username)}</small></span>
    </button>
  `).join("") || '<div class="empty">Пользователь не найден.</div>';
}

document.getElementById("tag-search-btn")?.addEventListener("click", searchTagUsers);
document.getElementById("tag-search-input")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchTagUsers();
  }
});

const postForm = document.getElementById("post-form");
postForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const error = document.getElementById("form-error");
  error.textContent = "";

  const file = document.getElementById("image")?.files[0];
  const caption = document.getElementById("caption")?.value || "";
  const tagIds = document.getElementById("tag-ids")?.value || "";

  if (!file && !caption.trim()) {
    error.textContent = "Добавь фото или напиши текст.";
    return;
  }

  const formData = new FormData();
  if (file) formData.append("file", file);
  formData.append("caption", caption);
  formData.append("tag_ids", tagIds);

  const button = postForm.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Публикация...";
  }

  const res = await api("/api/posts", { method: "POST", body: formData });
  if (!res.ok) {
    error.textContent = await res.text();
  } else {
    postForm.reset();
    selectedTagMap.clear();
    renderSelectedTags();
    document.getElementById("tag-search-results").innerHTML = "";
    document.getElementById("preview").textContent = "＋ Выбрать фото";
    showView("feed-view");
  }

  if (button) {
    button.disabled = false;
    button.textContent = "Опубликовать";
  }
});

function friendButtonForProfile(userId, status) {
  if (status === "self") return "";
  if (status === "friends") return `<div class="friend-actions"><button class="primary" disabled>✓ Уже друзья</button><button class="ghost" onclick="removeFriend(${userId})">Удалить</button></div>`;
  if (status === "pending") return '<button class="primary" disabled>Запрос отправлен</button>';
  if (status === "incoming") {
    return `<div class="friend-actions"><button class="primary" onclick="acceptFriendRequest(${userId})">Принять</button><button class="ghost" onclick="declineFriendRequest(${userId})">Отклонить</button></div>`;
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
  const user = data.user;

  profile.innerHTML = `
    <div class="profile-back"><button class="ghost" type="button" onclick="showView('feed-view')">← Назад</button></div>
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
      ${data.posts.length ? data.posts.map(post => postImageMarkup(post.image_path, post.id)).join("") : '<div class="empty">Пока нет публикаций.</div>'}
    </div>
  `;
  showView("profile-view", false);
}

async function sendFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/request`, { method: "POST" });
  if (!res.ok) return alert("Не удалось отправить запрос");
  await openProfile(userId);
  updateNotificationBadge();
}

async function acceptFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/accept`, { method: "POST" });
  if (!res.ok) return alert("Не удалось принять запрос");
  await openProfile(userId);
  updateNotificationBadge();
}

async function removeFriend(userId) {
  const ok = confirm("Удалить пользователя из друзей?");
  if (!ok) return;

  const res = await api(`/api/friends/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Не удалось удалить из друзей");
    return;
  }

  await loadFriends();
  if (document.getElementById("profile-view")?.classList.contains("active")) {
    await openProfile(userId);
  }
}

async function declineFriendRequest(userId) {
  const res = await api(`/api/friends/${userId}/decline`, { method: "POST" });
  if (!res.ok) return alert("Не удалось отклонить запрос");
  await loadFriends();
  updateNotificationBadge();
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
  box.innerHTML = friends.length ? friends.map(user => `
    <div class="friend-card" onclick="openProfile(${user.id})">
      <img class="avatar" src="${avatar(user.photo_url)}">
      <div class="friend-info">
        <div class="name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="username">${user.username ? "@" + esc(user.username) : "Telegram user"}</div>
        ${onlineText(user.last_seen)}
      </div>
      <button class="friend-mini danger" type="button" onclick="event.stopPropagation(); removeFriend(${user.id})">Удалить</button>
    </div>
  `).join("") : '<div class="empty">У тебя пока нет друзей.</div>';
}

function renderPeople(users) {
  const box = document.getElementById("people-list");
  if (!box) return;
  box.innerHTML = users.length ? users.map(user => `
    <div class="friend-card">
      <img class="avatar profile-click" src="${avatar(user.photo_url)}" onclick="openProfile(${user.id})">
      <div class="friend-info profile-click" onclick="openProfile(${user.id})">
        <div class="name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="username">${user.username ? "@" + esc(user.username) : "Telegram user"}</div>
        ${onlineText(user.last_seen)}
      </div>
      <div class="search-friend-button">${getMiniFriendButton(user.id, user.friend_status || "none")}</div>
    </div>
  `).join("") : '<div class="empty">Пока никто не зарегистрирован.</div>';
}

async function loadPeople(query = "") {
  const box = document.getElementById("people-list");
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';
  const url = query ? `/api/users/search?q=${encodeURIComponent(query.replace(/^@+/, ""))}` : "/api/people";
  const res = await api(url);
  if (!res.ok) {
    box.innerHTML = '<div class="empty">Не удалось загрузить пользователей.</div>';
    return;
  }
  renderPeople(await res.json());
}

document.getElementById("people-search-input")?.addEventListener("input", event => {
  loadPeople(event.target.value.trim());
});

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
    searchResults.innerHTML = '<div class="empty">Ошибка поиска.</div>';
    return;
  }
  const users = await res.json();
  searchResults.innerHTML = users.length ? users.map(user => `
    <div class="friend-card">
      <img class="avatar profile-click" src="${avatar(user.photo_url)}" onclick="openProfile(${user.id})">
      <div class="friend-info profile-click" onclick="openProfile(${user.id})">
        <div class="name">${esc(user.first_name)} ${esc(user.last_name || "")}</div>
        <div class="username">@${esc(user.username)}</div>
        ${onlineText(user.last_seen)}
      </div>
      <div class="search-friend-button">${getMiniFriendButton(user.id, user.friend_status || "none")}</div>
    </div>
  `).join("") : '<div class="empty">Пользователь не найден.</div>';
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
      ${data.posts.length ? data.posts.map(post => postImageMarkup(post.image_path, post.id)).join("") : '<div class="empty">У тебя пока нет публикаций.</div>'}
    </div>
  `;
}

function notificationText(notification) {
  const actor = notification.actor_username ? `@${notification.actor_username}` : (notification.actor_first_name || "Пользователь");
  if (notification.type === "friend_request") return `${actor} отправил(а) вам запрос в друзья`;
  if (notification.type === "friend_accepted") return `${actor} принял(а) ваш запрос в друзья`;
  if (notification.type === "like") return `${actor} поставил(а) лайк вашей публикации`;
  if (notification.type === "comment") return `${actor} прокомментировал(а) вашу публикацию`;
  if (notification.type === "tag") return `${actor} отметил(а) вас в публикации`;
  return "Новое уведомление";
}

function notificationIcon(type) {
  if (type === "friend_request") return "♡";
  if (type === "friend_accepted") return "✓";
  if (type === "like") return "♥";
  if (type === "comment") return "💬";
  if (type === "tag") return "@";
  return "•";
}

async function loadNotifications() {
  const box = document.getElementById("notifications");
  if (!box) return;
  box.innerHTML = '<div class="empty">загрузка...</div>';
  const res = await api("/api/notifications");
  if (!res.ok) {
    box.innerHTML = '<div class="empty">Не удалось загрузить уведомления.</div>';
    return;
  }
  const notifications = await res.json();
  if (!notifications.length) {
    box.innerHTML = '<div class="empty">Пока нет уведомлений.</div>';
    return;
  }
  box.innerHTML = notifications.map(notification => `
    <button class="notification-card ${notification.is_read ? "read" : "unread"}" type="button" onclick="openNotification(${notification.id})">
      <div class="notification-icon">${notificationIcon(notification.type)}</div>
      <img class="notification-avatar" src="${avatar(notification.actor_photo_url)}">
      <div class="notification-content">
        <div class="notification-text">${esc(notificationText(notification))}</div>
        <div class="notification-time">${esc(notification.created_at)}</div>
      </div>
      ${notification.is_read ? "" : '<span class="notification-dot"></span>'}
    </button>
  `).join("");
}

async function updateNotificationBadge() {
  const badge = document.getElementById("notification-badge");
  if (!badge) return;
  const res = await api("/api/notifications/unread-count");
  if (!res.ok) return;
  const data = await res.json();
  const count = Number(data.count || 0);
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

async function markAllNotificationsRead() {
  const res = await api("/api/notifications/read-all", { method: "POST" });
  if (!res.ok) return;
  await loadNotifications();
  updateNotificationBadge();
}

async function openNotification(notificationId) {
  const res = await api(`/api/notifications`);
  if (!res.ok) return;
  const notifications = await res.json();
  const item = notifications.find(notification => notification.id === Number(notificationId));
  if (!item) return;

  await api(`/api/notifications/${notificationId}/read`, { method: "POST" });
  updateNotificationBadge();

  if (item.type === "friend_request" || item.type === "friend_accepted") {
    if (item.actor_id) await openProfile(item.actor_id);
    return;
  }

  if (item.post_id) {
    await openPost(item.post_id, item.type === "comment");
    return;
  }
}

async function openPost(postId, openComments = false) {
  showView("feed-view", false);
  const box = document.getElementById(`post-${postId}`);
  if (!box) {
    await loadFeed();
  }
  const target = document.getElementById(`post-${postId}`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("post-highlight");
    setTimeout(() => target.classList.remove("post-highlight"), 1400);
  }
  if (openComments) {
    await toggleComments(postId);
  }
}

async function openImageViewer(src, postId = null) {
  const viewer = document.getElementById("image-viewer");
  if (!viewer) return;

  viewer.classList.add("active");
  viewer.dataset.postId = postId || "";
  viewer.querySelector(".image-viewer-image").src = src;
  viewer.querySelector(".image-viewer-comments").innerHTML = '<div class="comments-loading">загрузка...</div>';
  viewer.querySelector(".image-viewer-menu").classList.remove("active");

  const saveLink = viewer.querySelector(".image-save-link");
  saveLink.href = src;
  saveLink.download = `sqawe-${postId || "photo"}.jpg`;

  let postData = null;
  if (postId) {
    const res = await api(`/api/posts/${postId}`);
    if (res.ok) postData = await res.json();
  }

  const deleteButton = viewer.querySelector(".image-viewer-delete");
  deleteButton.hidden = true;
  if (postData) {
    const meRes = await api("/api/me");
    if (meRes.ok) {
      const me = await meRes.json();
      deleteButton.hidden = Number(me.id) !== Number(postData.user_id);
    }
  }

  if (postId) {
    await loadViewerComments(postId);
  } else {
    viewer.querySelector(".image-viewer-comments").innerHTML = '<div class="comments-empty">Комментарии доступны для публикации.</div>';
  }
}

async function loadViewerComments(postId) {
  const viewer = document.getElementById("image-viewer");
  if (!viewer) return;
  const box = viewer.querySelector(".image-viewer-comments");
  const res = await api(`/api/posts/${postId}/comments`);
  if (!res.ok) {
    box.innerHTML = '<div class="comments-error">Не удалось загрузить комментарии.</div>';
    return;
  }
  const comments = await res.json();
  box.innerHTML = `
    <div class="comments-list">
      ${comments.length ? comments.map(comment => `
        <div class="comment">
          <img class="comment-avatar" src="${avatar(comment.photo_url)}" onclick="openProfile(${comment.user_id}); closeImageViewer();">
          <div class="comment-content">
            <div class="comment-head">
              <span class="comment-author" onclick="openProfile(${comment.user_id}); closeImageViewer();">${esc(comment.first_name)} ${esc(comment.last_name || "")}</span>
              <span class="comment-username">${comment.username ? "@" + esc(comment.username) : ""}</span>
            </div>
            <div class="comment-text">${esc(comment.text)}</div>
          </div>
        </div>
      `).join("") : '<div class="comments-empty">Комментариев пока нет.</div>'}
    </div>
    <form class="comment-form" onsubmit="submitViewerComment(event, ${postId})">
      <input id="viewer-comment-input-${postId}" maxlength="500" placeholder="Написать комментарий...">
      <button class="primary" type="submit">Отправить</button>
    </form>
  `;
}

async function submitViewerComment(event, postId) {
  event.preventDefault();
  const input = document.getElementById(`viewer-comment-input-${postId}`);
  if (!input) return;
  const formData = new FormData();
  formData.append("text", input.value);
  const res = await api(`/api/posts/${postId}/comments`, { method: "POST", body: formData });
  if (!res.ok) {
    alert(await res.text());
    return;
  }
  await loadViewerComments(postId);
  updateNotificationBadge();
}

async function deleteCurrentViewerPost() {
  const viewer = document.getElementById("image-viewer");
  const postId = Number(viewer?.dataset.postId || 0);
  if (!postId) return;
  const ok = confirm("Удалить эту публикацию? Фото и комментарии тоже будут удалены.");
  if (!ok) return;
  const res = await api(`/api/posts/${postId}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Не удалось удалить публикацию");
    return;
  }
  closeImageViewer();
  await loadFeed();
  if (document.getElementById("profile-view")?.classList.contains("active")) {
    await loadProfile();
  }
}

function closeImageViewer() {
  const viewer = document.getElementById("image-viewer");
  if (!viewer) return;
  viewer.classList.remove("active");
  viewer.querySelector(".image-viewer-image").src = "";
  viewer.querySelector(".image-viewer-menu").classList.remove("active");
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeImageViewer();
});

const imageViewer = document.getElementById("image-viewer");
if (imageViewer) {
  imageViewer.querySelector(".image-viewer-close")?.addEventListener("click", closeImageViewer);
  imageViewer.querySelector(".image-viewer-dots")?.addEventListener("click", event => {
    event.stopPropagation();
    imageViewer.querySelector(".image-viewer-menu").classList.toggle("active");
  });
  imageViewer.querySelector(".image-viewer-menu")?.addEventListener("click", event => event.stopPropagation());
  imageViewer.addEventListener("click", event => {
    if (event.target === imageViewer || event.target.classList.contains("image-viewer-backdrop")) closeImageViewer();
  });
  imageViewer.querySelector(".image-viewer-delete")?.addEventListener("click", deleteCurrentViewerPost);
}

document.addEventListener("click", event => {
  const image = event.target.closest("img[data-image-src]");
  if (image) {
    event.preventDefault();
    event.stopPropagation();
    openImageViewer(image.dataset.imageSrc, image.dataset.postId || null);
  }
});

loadFeed();
loadPeople();
updateNotificationBadge();
setInterval(updateNotificationBadge, 15000);
