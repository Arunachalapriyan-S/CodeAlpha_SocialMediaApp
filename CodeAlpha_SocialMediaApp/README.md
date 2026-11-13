# CodeAlpha_SocialMediaApp

Mini social media app (**murmur**) built for **CodeAlpha Full Stack Development – Task 2**.

**Stack:** HTML, CSS, JavaScript (frontend) · Express.js (backend) · SQLite (database)

## Features
- Registration and login (bcrypt-hashed passwords, JWT sessions)
- User profiles: name, bio, post count, followers and following; edit your own profile
- Posts (280 characters) and comments (200 characters); delete your own
- Likes (toggle) with live counts
- Follow / unfollow; Home shows posts from people you follow plus your own
- Explore: all posts and people search
- Database tables: `users`, `posts`, `comments`, `likes`, `follows`

## Run it
```bash
npm install
npm start
```
Open http://localhost:3000. `social.db` is created on first run.
To see the feed work, create two accounts (use a private window for the second), follow one from the other, and post.

Set `JWT_SECRET` in production: `JWT_SECRET=your-long-random-string npm start`

## API
| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /api/register, /api/login | – | Create account, log in |
| GET / PUT | /api/me | Bearer | Current user / edit profile |
| GET | /api/users?q= | – | Search people |
| GET | /api/users/:username | optional | Profile with counts |
| GET | /api/users/:username/posts | optional | A user's posts |
| POST | /api/users/:username/follow | Bearer | Follow / unfollow |
| GET | /api/feed | Bearer | Posts from you and people you follow |
| GET | /api/posts, /api/posts/:id | optional | All posts, one post |
| POST / DELETE | /api/posts, /api/posts/:id | Bearer | Create / delete post |
| POST | /api/posts/:id/like | Bearer | Like / unlike |
| GET / POST | /api/posts/:id/comments | – / Bearer | List / add comments |
| DELETE | /api/comments/:id | Bearer | Delete your comment |
