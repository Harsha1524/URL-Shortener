# URL Shortener: caching, rate limiting & async analytics

Node.js / Express · PostgreSQL · Redis · BullMQ

**Live demo:** _add your Render URL here_

- **Base62 short codes** generated from the database id (no collisions, no retries)
- **Redis cache-aside** on the redirect path, with negative caching for unknown codes
- **Per-IP rate limiting** via an atomic Redis Lua script, with `X-RateLimit-*` / `Retry-After` headers
- **Async click analytics**: redirects enqueue a job; a worker writes clicks to Postgres in a transaction
- **Graceful degradation**: if Redis is down, redirects fall back to Postgres; link creation fails closed
- **Public-demo safeguards**: link expiry, URL validation (no embedded credentials, no self-links)
- Unit tests with the built-in `node --test`

```
            ┌──────────── API server (src/server.js) ─────────────┐
 client ──► │ rate limiter ─► route ─► cache (Redis) ─► Postgres  │
            │                     └─► enqueue click job (Redis)   │
            └─────────────────────────────────────────────────────┘
                                         │
                                         ▼
                         Worker (src/worker.js) ─► Postgres (clicks)
```

## Run locally

Requires Node 20+ and Docker.

```bash
docker compose up -d        # Postgres + Redis
cp .env.example .env
npm install
npm run migrate             # create tables
npm start                   # terminal 1: API + demo page on http://localhost:3000
npm run worker              # terminal 2: click-analytics worker
npm test                    # unit tests
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/` | Demo web page |
| POST | `/api/shorten` | Body `{"url":"https://..."}` → `201` with `shortUrl` |
| GET | `/:code` | `302` redirect; header `X-Cache: HIT / MISS / BYPASS` |
| GET | `/api/urls/:code/stats` | Total clicks, last 7 days, top referrers |
| GET | `/api/metrics` | Cache hit rate, DB query count, queue depth |
| GET | `/health` | Postgres and Redis status |

Status codes: `201` created · `302` redirect · `400` invalid URL / malformed JSON · `404` unknown or expired code · `429` rate limited · `503` limiter unavailable.

## Project layout

```
db/schema.sql                 tables + indexes
public/index.html             demo web page
src/config.js                 env-driven settings
src/lib/base62.js             encode/decode
src/lib/validate.js           URL validation (pure, unit-tested)
src/lib/db.js                 Postgres pool (SSL for hosted DBs)
src/lib/redis.js              fail-fast Redis client + rate-limit Lua script
src/lib/queue.js              BullMQ queue (producer side)
src/services/cache.js         cache-aside helpers; Redis errors become cache misses
src/services/urlService.js    create / resolve / stats logic
src/middleware/rateLimiter.js fixed-window limiter, fail-open or fail-closed
src/routes/api.js             JSON API
src/routes/redirect.js        GET /:code hot path
src/clickWorker.js            queue consumer logic
src/worker.js                 runs the worker as its own process
src/app.js, src/server.js     Express app + entry point
scripts/migrate.js            runs schema.sql
scripts/loadtest.js           hammer one code, watch the cache work
test/                         unit tests
render.yaml                   one-click Render deployment
```

## Known limitations (by design, for a demo)

- Fixed-window limiting allows bursts at window edges; sliding window or token bucket would fix that.
- Sequential ids make codes guessable; a reversible id permutation would hide the order.
- Click jobs are at-least-once: a retry after a committed write can double-count. An event id + dedup would fix it.
- A click is lost if Redis is down at the moment of the redirect.

**LEARN.md** is a hands-on walkthrough · **DEPLOY.md** puts it online for free.
