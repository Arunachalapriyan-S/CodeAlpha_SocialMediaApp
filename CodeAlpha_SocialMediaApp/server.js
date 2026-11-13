const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/* ---------- Database ---------- */
const db = new Database(path.join(__dirname, 'social.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);
`);

/* ---------- App + auth ---------- */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });
const me = u => ({ id: u.id, username: u.username, name: u.name, email: u.email, bio: u.bio });

function userFromReq(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const { id } = jwt.verify(h.slice(7), SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  } catch { return null; }
}
const optionalAuth = (req, res, next) => { req.user = userFromReq(req); next(); };
const auth = (req, res, next) => {
  req.user = userFromReq(req);
  if (!req.user) return res.status(401).json({ error: 'Log in to continue.' });
  next();
};

/* ---------- Helpers ---------- */
function queryPosts(where, params, viewerId) {
  return db.prepare(`
    SELECT p.id, p.content, p.created_at, u.username, u.name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id
    ${where}
    ORDER BY p.id DESC LIMIT 50
  `).all({ ...params, viewer: viewerId || 0 }).map(r => ({ ...r, liked: !!r.liked }));
}
const clean = (v, max) => String(v || '').trim().slice(0, max);

/* ---------- Auth routes ---------- */
app.post('/api/register', (req, res) => {
  const username = clean(req.body.username, 20).toLowerCase();
  const name = clean(req.body.name, 40);
  const email = clean(req.body.email, 100).toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or underscores.' });
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'That username is taken.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const info = db.prepare('INSERT INTO users (username, name, email, password_hash) VALUES (?,?,?,?)')
    .run(username, name, email, bcrypt.hashSync(password, 10));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(user), user: me(user) });
});

app.post('/api/login', (req, res) => {
  const id = clean(req.body.login, 100).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(id, id);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash))
    return res.status(401).json({ error: 'Email, username or password is incorrect.' });
  res.json({ token: sign(user), user: me(user) });
});

app.get('/api/me', auth, (req, res) => res.json(me(req.user)));

app.put('/api/me', auth, (req, res) => {
  const name = clean(req.body.name, 40);
  const bio = clean(req.body.bio, 160);
  if (!name) return res.status(400).json({ error: 'Name can’t be empty.' });
  db.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.id);
  res.json(me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

/* ---------- Users, profiles, follows ---------- */
app.get('/api/users', (req, res) => {
  const q = clean(req.query.q, 30).toLowerCase();
  res.json(db.prepare(`SELECT username, name, bio FROM users
    WHERE username LIKE @q OR LOWER(name) LIKE @q ORDER BY username LIMIT 20`).all({ q: `%${q}%` }));
});

app.get('/api/users/:username', optionalAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const count = (sql) => db.prepare(sql).get(u.id).n;
  res.json({
    username: u.username, name: u.name, bio: u.bio, created_at: u.created_at,
    followers: count('SELECT COUNT(*) n FROM follows WHERE following_id = ?'),
    following: count('SELECT COUNT(*) n FROM follows WHERE follower_id = ?'),
    posts: count('SELECT COUNT(*) n FROM posts WHERE user_id = ?'),
    is_me: !!req.user && req.user.id === u.id,
    is_following: !!req.user && !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, u.id),
  });
});

app.get('/api/users/:username/posts', optionalAuth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json(queryPosts('WHERE p.user_id = @uid', { uid: u.id }, req.user && req.user.id));
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You can’t follow yourself.' });
  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, u.id);
  if (existing) db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, u.id);
  else db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?,?)').run(req.user.id, u.id);
  res.json({ following: !existing });
});

/* ---------- Posts ---------- */
app.get('/api/feed', auth, (req, res) => {
  res.json(queryPosts(
    `WHERE p.user_id = @viewer OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = @viewer)`,
    {}, req.user.id));
});

app.get('/api/posts', optionalAuth, (req, res) => res.json(queryPosts('', {}, req.user && req.user.id)));

app.get('/api/posts/:id', optionalAuth, (req, res) => {
  const [post] = queryPosts('WHERE p.id = @id', { id: req.params.id }, req.user && req.user.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  res.json(post);
});

app.post('/api/posts', auth, (req, res) => {
  const content = clean(req.body.content, 280);
  if (!content) return res.status(400).json({ error: 'Write something before posting.' });
  const info = db.prepare('INSERT INTO posts (user_id, content) VALUES (?,?)').run(req.user.id, content);
  res.status(201).json(queryPosts('WHERE p.id = @id', { id: info.lastInsertRowid }, req.user.id)[0]);
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Post not found, or it isn’t yours.' });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  const had = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.id);
  if (had) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, req.params.id);
  else db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?,?)').run(req.user.id, req.params.id);
  const n = db.prepare('SELECT COUNT(*) n FROM likes WHERE post_id = ?').get(req.params.id).n;
  res.json({ liked: !had, like_count: n });
});

/* ---------- Comments ---------- */
app.get('/api/posts/:id/comments', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username, u.name
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = clean(req.body.content, 200);
  if (!content) return res.status(400).json({ error: 'Write a comment first.' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?,?,?)').run(req.params.id, req.user.id, content);
  res.status(201).json({ ok: true });
});

app.delete('/api/comments/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Comment not found, or it isn’t yours.' });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Social app running at http://localhost:${PORT}`));
