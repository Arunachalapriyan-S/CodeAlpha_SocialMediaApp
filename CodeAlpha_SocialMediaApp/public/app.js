const app = document.getElementById('app');
const navEl = document.getElementById('nav');
const toastEl = document.getElementById('toast');

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
let token = localStorage.getItem('token');
let user = read('user', null);
let nextHash = '#/';

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) logout(false);
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}

function setSession(d) {
  token = d.token; user = d.user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  renderNav();
}
function logout(go = true) {
  token = null; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  renderNav();
  if (go) { toast('Logged out'); location.hash = '#/'; route(); }
}

function timeAgo(s) {
  const secs = Math.max(0, (Date.now() - new Date(s.replace(' ', 'T') + 'Z')) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h';
  return Math.floor(secs / 86400) + 'd';
}
const avatar = (username, name, big) => {
  let h = 0; for (const c of username) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<div class="avatar${big ? ' big' : ''}" style="background:hsl(${h} 45% 40%)" aria-hidden="true">${esc(name[0].toUpperCase())}</div>`;
};

function renderNav() {
  navEl.innerHTML = user
    ? `<a href="#/">Home</a><a href="#/explore">Explore</a><a href="#/u/${esc(user.username)}">Profile</a><a href="#/" data-logout>Log out</a>`
    : `<a href="#/explore">Explore</a><a href="#/login">Log in</a><a href="#/register">Sign up</a>`;
}

/* ---------- shared pieces ---------- */
function postHtml(p, detail) {
  const mine = user && user.username === p.username;
  return `
  <article class="box post" data-post="${p.id}">
    ${avatar(p.username, p.name)}
    <div>
      <div class="head">
        <a class="who" href="#/u/${esc(p.username)}">${esc(p.name)}</a>
        <span class="muted">@${esc(p.username)} · ${timeAgo(p.created_at)}</span>
      </div>
      <p class="text">${esc(p.content)}</p>
      <div class="actions">
        <button class="act${p.liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${p.liked}" aria-label="Like">${p.liked ? '♥' : '♡'} <span>${p.like_count}</span></button>
        ${detail ? `<span class="muted">${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}</span>`
                 : `<a class="act" href="#/post/${p.id}">Comments (${p.comment_count})</a>`}
        ${mine ? `<button class="link" data-del-post="${p.id}">Delete</button>` : ''}
      </div>
    </div>
  </article>`;
}
const postsHtml = (posts, emptyMsg) => posts.length ? posts.map(p => postHtml(p)).join('') : `<p class="empty">${emptyMsg}</p>`;

function composeHtml() {
  return `
  <form class="box compose" id="compose" novalidate>
    <label for="content" class="muted" style="margin:0 0 .3rem">What’s on your mind?</label>
    <textarea id="content" rows="3" maxlength="280"></textarea>
    <p class="error" id="err"></p>
    <div class="row"><span class="count" id="count">0 / 280</span><button class="btn" type="submit">Post</button></div>
  </form>`;
}
function bindCompose(after) {
  const ta = document.getElementById('content'), cnt = document.getElementById('count');
  ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length} / 280`; });
  document.getElementById('compose').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/posts', { method: 'POST', body: { content: ta.value } }); ta.value = ''; after(); }
    catch (ex) { document.getElementById('err').textContent = ex.message; }
  });
}
const tabs = active => `<div class="tabs">
  ${user ? `<a class="tab" href="#/" ${active === 'home' ? 'aria-current="page"' : ''}>Following</a>` : ''}
  <a class="tab" href="#/explore" ${active === 'explore' ? 'aria-current="page"' : ''}>Everyone</a></div>`;

/* ---------- views ---------- */
async function homeView() {
  if (!user) return exploreView();
  const posts = await api('/feed');
  app.innerHTML = tabs('home') + composeHtml() +
    postsHtml(posts, 'Nothing here yet. Post something, or follow people from <a href="#/explore">Explore</a> to fill your feed.');
  bindCompose(homeView);
}

async function exploreView() {
  const posts = await api('/posts');
  app.innerHTML = tabs('explore') + `
    <div class="box">
      <label for="people" class="muted" style="margin:0 0 .3rem">Find people</label>
      <input id="people" type="search" placeholder="Search by name or username">
      <div id="results"></div>
    </div>` + (user ? composeHtml() : '') + postsHtml(posts, 'No posts yet. Be the first to post.');
  if (user) bindCompose(exploreView);
  const input = document.getElementById('people'), out = document.getElementById('results');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { out.innerHTML = ''; return; }
      const people = await api('/users?q=' + encodeURIComponent(q)).catch(() => []);
      out.innerHTML = people.length ? people.map(p => `
        <div class="person">${avatar(p.username, p.name)}
          <div><a class="who" href="#/u/${esc(p.username)}"><strong>${esc(p.name)}</strong></a>
          <div class="muted">@${esc(p.username)}${p.bio ? ' · ' + esc(p.bio) : ''}</div></div></div>`).join('')
        : '<p class="empty">No one found with that name.</p>';
    }, 250);
  });
}

async function profileView(username) {
  const [u, posts] = await Promise.all([api('/users/' + encodeURIComponent(username)), api(`/users/${encodeURIComponent(username)}/posts`)]);
  app.innerHTML = `
    <section class="box profile">
      ${avatar(u.username, u.name, true)}
      <div>
        <h1>${esc(u.name)}</h1>
        <div class="muted">@${esc(u.username)}</div>
        ${u.bio ? `<p style="margin:.4rem 0 0">${esc(u.bio)}</p>` : ''}
        <div class="stats"><span><strong>${u.posts}</strong> posts</span><span><strong>${u.followers}</strong> followers</span><span><strong>${u.following}</strong> following</span></div>
      </div>
      ${u.is_me ? '' : `<button class="btn ${u.is_following ? 'ghost' : ''}" data-follow="${esc(u.username)}">${u.is_following ? 'Following' : 'Follow'}</button>`}
    </section>
    ${u.is_me ? `
    <details class="box"><summary>Edit profile</summary>
      <form id="edit" novalidate>
        <label for="ename">Name</label><input id="ename" maxlength="40" value="${esc(u.name)}">
        <label for="ebio">Bio</label><textarea id="ebio" rows="2" maxlength="160">${esc(u.bio)}</textarea>
        <p class="error" id="err"></p>
        <button class="btn" type="submit">Save profile</button>
      </form>
    </details>` : ''}
    ${postsHtml(posts, u.is_me ? 'You haven’t posted yet. Share something from Home.' : 'No posts yet.')}`;
  const form = document.getElementById('edit');
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const m = await api('/me', { method: 'PUT', body: { name: document.getElementById('ename').value, bio: document.getElementById('ebio').value } });
      user = { ...user, ...m }; localStorage.setItem('user', JSON.stringify(user));
      toast('Profile saved'); profileView(username);
    } catch (ex) { document.getElementById('err').textContent = ex.message; }
  });
}

async function postView(id) {
  const [post, comments] = await Promise.all([api('/posts/' + id), api(`/posts/${id}/comments`)]);
  app.innerHTML = `
    <p><a href="javascript:history.back()">← Back</a></p>
    ${postHtml(post, true)}
    <h2>Comments</h2>
    ${user ? `<form class="box" id="cform" novalidate>
      <label for="ctext" class="muted" style="margin:0 0 .3rem">Add a comment</label>
      <input id="ctext" maxlength="200">
      <p class="error" id="err"></p>
      <button class="btn" type="submit">Comment</button></form>`
      : '<p class="muted"><a href="#/login">Log in</a> to comment.</p>'}
    ${comments.length ? comments.map(c => `
      <div class="box post">${avatar(c.username, c.name)}
        <div><div class="head"><a class="who" href="#/u/${esc(c.username)}">${esc(c.name)}</a>
          <span class="muted">@${esc(c.username)} · ${timeAgo(c.created_at)}</span></div>
          <p class="text">${esc(c.content)}</p>
          ${user && user.username === c.username ? `<button class="link" data-del-comment="${c.id}">Delete</button>` : ''}
        </div></div>`).join('') : '<p class="empty">No comments yet.</p>'}`;
  const f = document.getElementById('cform');
  if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api(`/posts/${id}/comments`, { method: 'POST', body: { content: document.getElementById('ctext').value } }); postView(id); }
    catch (ex) { document.getElementById('err').textContent = ex.message; }
  });
}

function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `
    <h1>${reg ? 'Create your account' : 'Log in'}</h1>
    <div class="panel">
      <form id="auth" novalidate>
        ${reg ? '<label for="name">Name</label><input id="name" autocomplete="name" maxlength="40"><label for="username">Username</label><input id="username" autocomplete="username" maxlength="20">' : ''}
        <label for="email">${reg ? 'Email' : 'Email or username'}</label><input id="email" ${reg ? 'type="email"' : ''} autocomplete="${reg ? 'email' : 'username'}">
        <label for="password">Password</label><input id="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">
        <p class="error" id="err"></p>
        <button class="btn" type="submit">${reg ? 'Sign up' : 'Log in'}</button>
      </form>
      <p>${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
    </div>`;
  document.getElementById('auth').addEventListener('submit', async e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value;
    try {
      const body = reg
        ? { name: v('name'), username: v('username'), email: v('email'), password: v('password') }
        : { login: v('email'), password: v('password') };
      setSession(await api(reg ? '/register' : '/login', { method: 'POST', body }));
      toast(reg ? 'Account created' : 'Welcome back');
      const go = nextHash; nextHash = '#/'; location.hash = go; route();
    } catch (ex) { document.getElementById('err').textContent = ex.message; }
  });
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-like],[data-follow],[data-del-post],[data-del-comment],[data-logout]');
  if (!t) return;
  const d = t.dataset;
  try {
    if ('logout' in d) { e.preventDefault(); logout(); return; }
    if (!user) { nextHash = location.hash || '#/'; toast('Log in to do that'); location.hash = '#/login'; return; }
    if (d.like) {
      const r = await api(`/posts/${d.like}/like`, { method: 'POST' });
      t.classList.toggle('on', r.liked);
      t.setAttribute('aria-pressed', r.liked);
      t.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.like_count}</span>`;
    } else if (d.follow) {
      await api(`/users/${d.follow}/follow`, { method: 'POST' });
      profileView(d.follow);
    } else if (d.delPost) {
      if (!confirm('Delete this post? This can’t be undone.')) return;
      await api('/posts/' + d.delPost, { method: 'DELETE' });
      toast('Post deleted');
      location.hash.startsWith('#/post/') ? (location.hash = '#/') : route();
    } else if (d.delComment) {
      await api('/comments/' + d.delComment, { method: 'DELETE' });
      route();
    }
  } catch (ex) { toast(ex.message); }
});

const routes = [
  [/^#\/u\/([\w]+)$/, profileView],
  [/^#\/post\/(\d+)$/, postView],
  [/^#\/explore$/, exploreView],
  [/^#\/login$/, () => authView('login')],
  [/^#\/register$/, () => authView('register')],
];
async function route() {
  const h = location.hash || '#/';
  try {
    for (const [re, fn] of routes) { const m = h.match(re); if (m) { await fn(...m.slice(1)); window.scrollTo(0, 0); return; } }
    await homeView();
  } catch (e) {
    app.innerHTML = `<p class="empty">${esc(e.message)} <a href="#/">Back home</a></p>`;
  }
}
window.addEventListener('hashchange', route);
renderNav();
route();
