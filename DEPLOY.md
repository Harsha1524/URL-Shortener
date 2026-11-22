# Put it online (free) and link it from your portfolio

You'll end up with a live URL like `https://url-shortener-xxxx.onrender.com` that anyone can open and use.

| Piece | Where it runs | Cost |
|---|---|---|
| Web app (API + click worker + demo page) | Render free web service | Free |
| Redis (cache, rate limits, queue) | Render free Key Value | Free |
| PostgreSQL | Neon free plan (doesn't expire; Render's free Postgres expires after 30 days) | Free |

About 20 minutes. You need a GitHub account.

---

## Step 1: Push the code to GitHub

1. On github.com click **New repository** and name it `url-shortener`. Make it **Public** (recruiters can read the code). Don't add a README; the project has one.
2. In the VS Code terminal (Git Bash), inside the project folder:
   ```bash
   git init
   git add .
   git commit -m "URL shortener with Redis caching, rate limiting and async analytics"
   git branch -M main
   git remote add origin https://github.com/<your-username>/url-shortener.git
   git push -u origin main
   ```
   `.gitignore` already keeps `.env` and `node_modules` out of the repo.

## Step 2: Create the database on Neon

1. Sign up at **neon.com** (GitHub login is fine).
2. Create a project. Name: `url-shortener`. Region: **AWS Asia Pacific (Singapore)**, the same region as the app.
3. On the project dashboard click **Connect** and copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it private: it's the database password.

You don't need to create tables. The app runs `npm run migrate` every time it starts.

## Step 3: Deploy on Render

1. Sign up at **render.com** with GitHub.
2. Click **New → Blueprint**, pick your `url-shortener` repo, and click **Connect**.
   Render reads `render.yaml` and plans two services: the web app and the Redis store.
3. It asks for the values marked `sync: false`:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from Step 2 |
   | `AUTHOR_NAME` | `Harsha` |
   | `AUTHOR_URL` | your portfolio or LinkedIn URL |
   | `SOURCE_URL` | `https://github.com/<your-username>/url-shortener` |
4. Click **Apply**. The first build takes 2–4 minutes. Watch the **Logs** tab for:
   ```
   Migration complete...
   Click worker running inside the API process
   API listening on port 10000 ...
   ```
5. Open the URL Render shows at the top of the service page. Shorten a link, click it, and watch the analytics update.

`BASE_URL` is filled in automatically from Render's `RENDER_EXTERNAL_URL`, so short links use your real domain.

## Step 4: Add it to your portfolio

Link the project card to the live demo, and put the GitHub link next to it:

```html
<a href="https://url-shortener-xxxx.onrender.com" target="_blank" rel="noopener">Live demo</a>
<a href="https://github.com/<your-username>/url-shortener" target="_blank" rel="noopener">Code</a>
```

Suggested card text:
> **URL Shortener**: Node.js/Express + PostgreSQL. Base62 codes, Redis cache-aside on the redirect path, Lua-script rate limiting, and async click analytics via a BullMQ queue. Falls back to Postgres when Redis is down.

## Things to know about the free tier

- **It sleeps.** After 15 minutes without traffic the server stops, and the next visitor waits about 30–60 seconds for it to wake. The demo page says so. If you want it awake when recruiters are likely to look, a free uptime monitor (e.g. UptimeRobot) can ping `/health` every 10 minutes. One always-on service fits inside Render's 750 free hours a month.
- **Free Redis is in-memory only.** A restart clears the cache, rate-limit counters and any waiting click jobs. Links and click history are safe in Postgres. That's how a cache is supposed to behave, and it's a good interview talking point.
- **Neon pauses when idle.** The first query after a quiet spell takes a few hundred milliseconds more.
- **Public shorteners attract abuse.** The demo limits it: 10 new links per minute per IP, links expire after 7 days, no `user:pass@` URLs. Don't remove these.

## Updating

Every `git push` to `main` redeploys automatically.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails on `npm ci` | Commit `package-lock.json` (it must be in the repo) |
| Logs show `Migration failed: ... password authentication` | Re-copy the Neon string into `DATABASE_URL` (Render → service → Environment) |
| Logs show `[redis] ... ENOTFOUND` | The web service and Key Value must be in the same region (both `singapore` in `render.yaml`) |
| Every visitor seems to share one rate limit | Keep `TRUST_PROXY=true` so the app reads the real client IP |
| Short links point at `localhost` | Remove any `BASE_URL` you set manually; Render provides the real one |
