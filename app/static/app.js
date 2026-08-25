const tg = window.Telegram?.WebApp;
const initData = tg?.initData || "";

if (tg) {
  tg.ready();
  tg.expand();
}

const headers = { "X-Telegram-Init-Data": initData };

function api(path, options = {}) {
  options.headers = { ...(options.headers || {}), ...headers };
  return fetch(path, options);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

function avatar(url) {
  return url ? esc(url) : "/static/default-avatar.svg";
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === id);
  });
  if (id === "feed-view") loadFeed();
  if (id === "profile-view") loadProfile();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.getElementById("refresh-btn").onclick = loadFeed;

async function loadFeed() {
  const box = document.getElementById("feed");
  box.innerHTML = '<div class="empty">загрузка...</div>';

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

  box.innerHTML = posts.map(p => `
    <article class="post">
      <div class="post-head">
        <img class="avatar" src="${avatar(p.photo_url)}">
        <div>
          <div class="name">${esc(p.first_name)} ${esc(p.last_name || "")}</div>
          <div class="username">${p.username ? "@" + esc(p.username) : "Telegram user"}</div>
        </div>
      </div>
      <img class="post-image" src="/uploads/${esc(p.image_path)}" loading="lazy">
      <div class="post-body">
        ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ""}
        <div class="meta">
          <button class="like ${p.liked ? "liked" : ""}" onclick="likePost(${p.id}, this)">
            ${p.liked ? "♥" : "♡"} ${p.likes}
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

async function likePost(id, btn) {
  const res = await api(`/api/posts/${id}/like`, { method: "POST" });
  if (!res.ok) return;
  const data = await res.json();
  btn.classList.toggle("liked", data.liked);
  btn.innerHTML = `${data.liked ? "♥" : "♡"} ${data.likes}`;
}

const imageInput = document.getElementById("image");
imageInput.onchange = () => {
  const file = imageInput.files[0];
  const preview = document.getElementById("preview");
  if (!file) {
    preview.textContent = "＋ Выбрать фото";
    return;
  }
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="preview">`;
};

document.getElementById("post-form").onsubmit = async e => {
  e.preventDefault();
  const error = document.getElementById("form-error");
  error.textContent = "";

  const file = imageInput.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append("file", file);
  fd.append("caption", document.getElementById("caption").value);

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Публикация...";

  const res = await api("/api/posts", { method: "POST", body: fd });
  if (!res.ok) {
    error.textContent = await res.text();
  } else {
    e.target.reset();
    document.getElementById("preview").textContent = "＋ Выбрать фото";
    showView("feed-view");
  }

  btn.disabled = false;
  btn.textContent = "Опубликовать";
};

async function loadProfile() {
  const box = document.getElementById("profile");
  box.innerHTML = '<div class="empty">загрузка...</div>';

  const meRes = await api("/api/me");
  if (!meRes.ok) {
    box.innerHTML = `<div class="empty">Профиль недоступен.<br>${esc(await meRes.text())}</div>`;
    return;
  }
  const me = await meRes.json();

  const res = await api(`/api/users/${me.id}`);
  if (!res.ok) {
    box.innerHTML = '<div class="empty">Ошибка профиля.</div>';
    return;
  }
  const data = await res.json();
  const u = data.user;

  box.innerHTML = `
    <div class="profile-head">
      <img class="profile-avatar" src="${avatar(u.photo_url)}">
      <div>
        <div class="profile-name">${esc(u.first_name)} ${esc(u.last_name || "")}</div>
        <div class="profile-stats">${u.username ? "@" + esc(u.username) : ""} · ${data.posts.length} постов</div>
      </div>
    </div>
    <div class="grid">
      ${data.posts.map(p => `<img src="/uploads/${esc(p.image_path)}" loading="lazy">`).join("")}
    </div>
  `;
}

loadFeed();
