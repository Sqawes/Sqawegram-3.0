const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";

const headers = {
  "X-Telegram-Init-Data": initData
};


function api(path, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    ...headers
  };

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
  return url
    ? esc(url)
    : "/static/default-avatar.svg";
}


function isOnline(lastSeen) {
  if (!lastSeen) {
    return false;
  }

  const timestamp = new Date(
    lastSeen.replace(" ", "T") + "Z"
  ).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp < 2 * 60 * 1000;
}


function onlineText(lastSeen) {
  if (isOnline(lastSeen)) {
    return '<div class="online-status online">● В сети</div>';
  }

  return '<div class="online-status offline">○ Был(а) недавно</div>';
}


function showView(viewId) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.remove("active");
  });

  const target = document.getElementById(viewId);

  if (!target) {
    return;
  }

  target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === viewId
    );
  });

  if (viewId === "feed-view") {
    loadFeed();
  }

  if (viewId === "friends-view") {
    loadFriends();
  }

  if (viewId === "profile-view") {
    loadProfile();
  }
}


document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});


const refreshButton =
  document.getElementById("refresh-btn");

if (refreshButton) {
  refreshButton.addEventListener(
    "click",
    loadFeed
  );
}


const refreshFriendsButton =
  document.getElementById("refresh-friends-btn");

if (refreshFriendsButton) {
  refreshFriendsButton.addEventListener(
    "click",
    loadFriends
  );
}


async function loadFeed() {
  const box =
    document.getElementById("feed");

  if (!box) {
    return;
  }

  box.innerHTML =
    '<div class="empty">загрузка...</div>';

  try {
    const res =
      await api("/api/feed");

    if (!res.ok) {
      box.innerHTML = `
        <div class="empty">
          Не удалось загрузить ленту.<br>
          ${esc(await res.text())}
        </div>
      `;

      return;
    }

    const posts =
      await res.json();

    if (!posts.length) {
      box.innerHTML = `
        <div class="empty">
          Здесь пока пусто.<br>
          Будь первым.
        </div>
      `;

      return;
    }

    const userCache = new Map();

    async function getProfileData(userId) {
      if (userCache.has(userId)) {
        return userCache.get(userId);
      }

      const data =
        await getUserProfile(userId);

      userCache.set(userId, data);

      return data;
    }

    const renderedPosts = [];

    for (const post of posts) {
      const profile =
        await getProfileData(post.user_id);

      let friendButton = "";

      if (profile) {
        friendButton =
          getMiniFriendButton(
            post.user_id,
            profile.friend_status
          );
      }

      renderedPosts.push(`
        <article class="post">

          <div class="post-head">

            <img
              class="avatar profile-click"
              src="${avatar(post.photo_url)}"
              onclick="openProfile(${post.user_id})"
            >

            <div
              class="profile-click"
              onclick="openProfile(${post.user_id})"
            >

              <div class="name">
                ${esc(post.first_name)}
                ${esc(post.last_name || "")}
              </div>

              <div class="username">
                ${
                  post.username
                    ? "@" + esc(post.username)
                    : "Telegram user"
                }
              </div>

            </div>

            <div class="feed-friend-button">
              ${friendButton}
            </div>

          </div>


          <img
            class="post-image"
            src="/uploads/${esc(post.image_path)}"
            loading="lazy"
          >


          <div class="post-body">

            ${
              post.caption
                ? `
                  <p class="caption">
                    ${esc(post.caption)}
                  </p>
                `
                : ""
            }

            <div class="meta">

              <button
                class="like ${post.liked ? "liked" : ""}"
                onclick="likePost(${post.id}, this)"
              >
                ${post.liked ? "♥" : "♡"} ${post.likes}
              </button>

            </div>

          </div>

        </article>
      `);
    }

    box.innerHTML =
      renderedPosts.join("");

  } catch (error) {
    box.innerHTML = `
      <div class="empty">
        Ошибка загрузки ленты.
      </div>
    `;
  }
}


async function getUserProfile(userId) {
  const res =
    await api(`/api/users/${userId}`);

  if (!res.ok) {
    return null;
  }

  return await res.json();
}


function getMiniFriendButton(userId, status) {
  if (status === "self") {
    return "";
  }

  if (status === "friends") {
    return `
      <button
        class="friend-mini"
        disabled
      >
        ✓ Друзья
      </button>
    `;
  }

  if (status === "pending") {
    return `
      <button
        class="friend-mini"
        disabled
      >
        Запрос отправлен
      </button>
    `;
  }

  if (status === "incoming") {
    return `
      <button
        class="friend-mini"
        onclick="acceptFriendRequest(${userId})"
      >
        Принять
      </button>
    `;
  }

  return `
    <button
      class="friend-mini"
      onclick="sendFriendRequest(${userId})"
    >
      Добавить
    </button>
  `;
}


async function likePost(postId, button) {
  const res =
    await api(
      `/api/posts/${postId}/like`,
      {
        method: "POST"
      }
    );

  if (!res.ok) {
    return;
  }

  const data =
    await res.json();

  button.classList.toggle(
    "liked",
    data.liked
  );

  button.innerHTML =
    `${data.liked ? "♥" : "♡"} ${data.likes}`;
}


const imageInput =
  document.getElementById("image");

if (imageInput) {
  imageInput.addEventListener(
    "change",
    () => {
      const file =
        imageInput.files[0];

      const preview =
        document.getElementById("preview");

      if (!preview) {
        return;
      }

      if (!file) {
        preview.textContent =
          "＋ Выбрать фото";

        return;
      }

      const url =
        URL.createObjectURL(file);

      preview.innerHTML =
        `<img src="${url}" alt="preview">`;
    }
  );
}


const postForm =
  document.getElementById("post-form");

if (postForm) {
  postForm.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const error =
        document.getElementById("form-error");

      if (error) {
        error.textContent = "";
      }

      const file =
        document.getElementById("image")?.files[0];

      if (!file) {
        return;
      }

      const formData =
        new FormData();

      formData.append(
        "file",
        file
      );

      formData.append(
        "caption",
        document.getElementById("caption")?.value || ""
      );

      const button =
        postForm.querySelector(
          'button[type="submit"]'
        );

      if (button) {
        button.disabled = true;
        button.textContent =
          "Публикация...";
      }

      const res =
        await api(
          "/api/posts",
          {
            method: "POST",
            body: formData
          }
        );

      if (!res.ok) {
        if (error) {
          error.textContent =
            await res.text();
        }
      } else {
        postForm.reset();

        const preview =
          document.getElementById("preview");

        if (preview) {
          preview.textContent =
            "＋ Выбрать фото";
        }

        showView("feed-view");
      }

      if (button) {
        button.disabled = false;
        button.textContent =
          "Опубликовать";
      }
    }
  );
}


function friendButtonForProfile(userId, status) {
  if (status === "self") {
    return "";
  }

  if (status === "friends") {
    return `
      <button
        class="primary"
        disabled
      >
        ✓ Уже друзья
      </button>
    `;
  }

  if (status === "pending") {
    return `
      <button
        class="primary"
        disabled
      >
        Запрос отправлен
      </button>
    `;
  }

  if (status === "incoming") {
    return `
      <div class="friend-actions">

        <button
          class="primary"
          onclick="acceptFriendRequest(${userId})"
        >
          Принять
        </button>

        <button
          class="ghost"
          onclick="declineFriendRequest(${userId})"
        >
          Отклонить
        </button>

      </div>
    `;
  }

  return `
    <button
      class="primary"
      onclick="sendFriendRequest(${userId})"
    >
      Добавить в друзья
    </button>
  `;
}


async function openProfile(userId) {
  const data =
    await getUserProfile(userId);

  if (!data) {
    alert(
      "Не удалось загрузить профиль"
    );

    return;
  }

  const profile =
    document.getElementById("profile");

  if (!profile) {
    return;
  }

  const user =
    data.user;

  profile.innerHTML = `
    <div class="profile-back">

      <button
        class="ghost"
        type="button"
        onclick="showView('feed-view')"
      >
        ← Назад
      </button>

    </div>


    <div class="profile-head">

      <img
        class="profile-avatar"
        src="${avatar(user.photo_url)}"
      >

      <div>

        <div class="profile-name">
          ${esc(user.first_name)}
          ${esc(user.last_name || "")}
        </div>

        <div class="profile-stats">
          ${
            user.username
              ? "@" + esc(user.username)
              : "Telegram user"
          }
        </div>

        <div class="profile-stats">
          ${data.friend_count} друзей · ${data.posts.length} постов
        </div>

        ${onlineText(user.last_seen)}

      </div>

    </div>


    <div class="friend-button">
      ${friendButtonForProfile(
        user.id,
        data.friend_status
      )}
    </div>


    <div class="grid">

      ${
        data.posts.length
          ? data.posts.map(post => `
              <img
                src="/uploads/${esc(post.image_path)}"
                loading="lazy"
              >
            `).join("")
          : `
            <div class="empty">
              Пока нет публикаций.
            </div>
          `
      }

    </div>
  `;

  showView("profile-view");
}


async function sendFriendRequest(userId) {
  const res =
    await api(
      `/api/friends/${userId}/request`,
      {
        method: "POST"
      }
    );

  if (!res.ok) {
    alert(
      "Не удалось отправить запрос"
    );

    return;
  }

  await loadFeed();
}


async function acceptFriendRequest(userId) {
  const res =
    await api(
      `/api/friends/${userId}/accept`,
      {
        method: "POST"
      }
    );

  if (!res.ok) {
    alert(
      "Не удалось принять запрос"
    );

    return;
  }

  await openProfile(userId);
}


async function declineFriendRequest(userId) {
  const res =
    await api(
      `/api/friends/${userId}/decline`,
      {
        method: "POST"
      }
    );

  if (!res.ok) {
    alert(
      "Не удалось отклонить запрос"
    );

    return;
  }

  await loadFriends();
}


async function loadFriends() {
  const box =
    document.getElementById("friends");

  if (!box) {
    return;
  }

  box.innerHTML =
    '<div class="empty">загрузка...</div>';

  const res =
    await api("/api/friends");

  if (!res.ok) {
    box.innerHTML = `
      <div class="empty">
        Не удалось загрузить друзей.<br>
        ${esc(await res.text())}
      </div>
    `;

    return;
  }

  const friends =
    await res.json();

  if (!friends.length) {
    box.innerHTML = `
      <div class="empty">
        У тебя пока нет друзей.
      </div>
    `;

    return;
  }

  box.innerHTML = friends.map(user => `
    <div
      class="friend-card"
      onclick="openProfile(${user.id})"
    >

      <img
        class="avatar"
        src="${avatar(user.photo_url)}"
      >

      <div class="friend-info">

        <div class="name">
          ${esc(user.first_name)}
          ${esc(user.last_name || "")}
        </div>

        <div class="username">
          ${
            user.username
              ? "@" + esc(user.username)
              : "Telegram user"
          }
        </div>

        ${onlineText(user.last_seen)}

      </div>

    </div>
  `).join("");
}


async function loadProfile() {
  const box =
    document.getElementById("profile");

  if (!box) {
    return;
  }

  box.innerHTML =
    '<div class="empty">загрузка...</div>';

  const meRes =
    await api("/api/me");

  if (!meRes.ok) {
    box.innerHTML = `
      <div class="empty">
        Профиль недоступен.<br>
        ${esc(await meRes.text())}
      </div>
    `;

    return;
  }

  const me =
    await meRes.json();

  const data =
    await getUserProfile(me.id);

  if (!data) {
    box.innerHTML =
      '<div class="empty">Ошибка профиля.</div>';

    return;
  }

  const user =
    data.user;

  box.innerHTML = `
    <div class="profile-head">

      <img
        class="profile-avatar"
        src="${avatar(user.photo_url)}"
      >

      <div>

        <div class="profile-name">
          ${esc(user.first_name)}
          ${esc(user.last_name || "")}
        </div>

        <div class="profile-stats">
          ${
            user.username
              ? "@" + esc(user.username)
              : ""
          }
        </div>

        <div class="profile-stats">
          ${data.friend_count} друзей · ${data.posts.length} постов
        </div>

        ${onlineText(user.last_seen)}

      </div>

    </div>


    <div class="grid">

      ${
        data.posts.length
          ? data.posts.map(post => `
              <img
                src="/uploads/${esc(post.image_path)}"
                loading="lazy"
              >
            `).join("")
          : `
            <div class="empty">
              У тебя пока нет публикаций.
            </div>
          `
      }

    </div>
  `;
}


loadFeed();