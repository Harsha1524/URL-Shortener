# Learn this project by running it

Eight lessons. Each one follows the same loop: **Run → Observe → Understand → Experiment.**
Do them in order; each builds on the last. Keep three terminals open:

- **T1** – API server  · **T2** – worker  · **T3** – your commands

> **Windows note:** in PowerShell, type `curl.exe` (not `curl`, which is an alias for something else).
> JSON quoting is easiest in Git Bash or WSL. Every command below is written for bash.

---

## Lesson 0 — The big picture (read first)

A URL shortener does two things:

1. **Write path (rare):** `POST /api/shorten` → store the long URL, return a short code.
2. **Read path (very frequent):** `GET /q0V` → look up the long URL, send a redirect.

Real systems see maybe **100 reads for every write**, and a few "hot" links get most of the traffic.
Every design choice here follows from that:

| Problem | Solution in this project | File |
|---|---|---|
| Need short, unique codes | Base62-encode the DB id | `src/lib/base62.js` |
| Reads hammer the DB | Cache code→URL in Redis | `src/services/cache.js` |
| One client can flood us | Per-IP rate limit in Redis | `src/middleware/rateLimiter.js` |
| Tracking clicks slows redirects | Push clicks to a queue, process later | `src/routes/redirect.js`, `src/worker.js` |

Redis plays **three roles** here: cache, rate-limit counter store, and job queue.

---

## Lesson 1 — Infrastructure: Postgres & Redis

### Run
```bash
docker compose up -d
docker compose ps            # both should say "healthy"
cp .env.example .env
npm install
npm run migrate
```

### Observe
```bash
docker compose exec postgres psql -U shortener -c '\d urls'
docker compose exec redis redis-cli ping      # → PONG
```

### Understand
- `docker-compose.yml` runs Postgres and Redis in containers so you don't install them.
- `db/schema.sql`: `urls` has `id BIGSERIAL` (auto-increment) and `short_code UNIQUE`.
  **UNIQUE automatically creates an index**, which is what makes `WHERE short_code = $1` fast.
- `clicks` has an index on `(url_id, clicked_at)` because stats queries filter by URL then by time.
- `src/lib/db.js` uses a **connection pool**: opening a Postgres connection costs a TCP + auth
  handshake; a pool keeps ~10 open and reuses them.

### Experiment
- Run `npm run migrate` twice. Why doesn't it fail the second time? (Look for `IF NOT EXISTS`.)

---

## Lesson 2 — Shortening & Base62

### Run
T1: `npm start`
T3:
```bash
curl -s -X POST localhost:3000/api/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.iitm.ac.in"}'
```
You get something like `{"shortCode":"q0V", "shortUrl":"http://localhost:3000/q0V", ...}`.

### Observe
```bash
docker compose exec postgres psql -U shortener -c 'SELECT id, short_code, long_url FROM urls;'
node -e "const b=require('./src/lib/base62'); console.log(b.encode(1+100000), b.decode('q0V'))"
```

### Understand — read `src/lib/base62.js` and `createShortUrl` in `src/services/urlService.js`
- Base62 is ordinary base conversion with 62 "digits" (`0-9a-zA-Z`), all URL-safe.
  Keep dividing by 62, the remainders are the digits.
- `id 1 + offset 100000 = 100001` → `"q0V"`. Capacity: 62⁶ ≈ 56.8 billion, 62⁷ ≈ 3.5 trillion.
- **Why derive the code from the id instead of random strings?** The id is unique, so the code is
  unique → **no collision check, no retry loop**. Random codes need "generate → check DB → retry".
- `SELECT nextval('urls_id_seq')` grabs the next id first, so we can compute the code and insert
  in one statement.
- After insert, we **warm the cache** (a new link is about to be shared and clicked).
- **Trade-off:** sequential codes are guessable (`q0V`, `q0W`, ...). Someone could enumerate all
  links. Fixes: shuffle the alphabet, use a reversible bit-permutation of the id, or random codes.

### Experiment
- Send an invalid URL (`"ftp://x"`, `"hello"`, empty body). Find the code that rejects each one.
- Create 3 links and look at the codes. What pattern do you see?

---

## Lesson 3 — The redirect hot path & caching

### Run
```bash
curl -i localhost:3000/q0V          # look at Location and X-Cache headers
```
Open `http://localhost:3000/q0V` in a browser too.

### Observe — watch Redis live
T3 (new tab): `docker compose exec redis redis-cli MONITOR`  — every Redis command scrolls past.
Then:
```bash
docker compose exec redis redis-cli DEL url:q0V   # evict from cache
curl -s -o /dev/null -D - localhost:3000/q0V | grep X-Cache   # MISS (went to DB)
curl -s -o /dev/null -D - localhost:3000/q0V | grep X-Cache   # HIT
docker compose exec redis redis-cli TTL url:q0V   # seconds until expiry
curl -s localhost:3000/api/metrics
```

### Understand — read `resolve()` in `urlService.js` and `src/services/cache.js`
**Cache-aside pattern:**
```
GET url:q0V from Redis ── hit ──► redirect
        │ miss
        ▼
SELECT from Postgres ──► SET url:q0V in Redis (TTL 1h) ──► redirect
```
- **TTL** (time-to-live): Redis deletes the key automatically. Keeps memory bounded and means
  stale data eventually disappears. Hot links keep getting re-cached; cold ones fall out.
- **Negative caching:** a fake code (`/zzzzzz`) caches `__NOT_FOUND__` for 60s, so a bot spamming
  fake codes can't force a DB query every time.
- **302 vs 301:** 301 = "permanent", the browser caches it and **never asks us again** → we lose
  click tracking. 302 = "temporary", every click comes through us.
- Why cache *this* data so safely? Code→URL mappings **never change** after creation, so there's
  no cache-invalidation problem. (If you add "edit link", you must `DEL` the key on update.)

### Experiment — the resume claim, "cutting DB reads for hot URLs"
In `.env` set `RATE_LIMIT_REDIRECT_MAX=10000`, restart T1, then:
```bash
npm run loadtest -- q0V 200
```
Look at **"DB queries made by server during test: 0"**. 200 requests, zero DB reads.
Now `docker compose exec redis redis-cli DEL url:q0V` and run it again — exactly 1 DB query
(the first miss), then 199 hits.

---

## Lesson 4 — Rate limiting

### Run
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/api/shorten \
    -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
done; echo
```
You'll see `201 ... 201 429 429` (limit is 10/min for shortening).

### Observe
```bash
curl -i -X POST localhost:3000/api/shorten -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' | grep -iE 'x-ratelimit|retry-after'
docker compose exec redis redis-cli KEYS 'ratelimit:*'
docker compose exec redis redis-cli GET <one of those keys>
```

### Understand — read `src/middleware/rateLimiter.js`
**Fixed window:** Key = `ratelimit:<route>:<ip>`. The first request in a window creates the
counter and starts a 60s timer (`EXPIRE`); each later request does `INCR`. When the timer runs
out, Redis deletes the key and the count starts again.
If count > max → **429 Too Many Requests** + `Retry-After` header.

The counting is a tiny **Lua script** (see `rateLimitHit` in `src/lib/redis.js`):
```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
```

- **Why Redis and not a JS object?** With 3 API servers behind a load balancer, each would have
  its own counter and a client would get 3× the limit. Redis is shared by all servers.
- **Why a Lua script?** Redis runs the whole script **atomically**: no other command can run in
  the middle. Without it, two requests could both see "count == 1", or the app could crash
  between INCR and EXPIRE and leave a counter that never expires (blocking that IP forever).
  It's also one network round trip instead of three.
- **Fail closed vs fail open:** if Redis is down, `/api/shorten` returns **503** (fail closed),
  because creating links is the abusable action and the limit must not silently disappear.
  Redirects **fail open** and keep working, because they're the core product.
  Look for `failClosed` in `routes/api.js` and `routes/redirect.js`.
- Different limits for different routes: writes (10/min) are more expensive than reads (100/min).

**Known weakness of fixed window:** a client can send 10 requests at 0:59 and 10 more at 1:00 —
20 requests in 2 seconds. Better algorithms:
| Algorithm | Idea | Cost |
|---|---|---|
| Fixed window | count per bucket | 1 key, tiny |
| Sliding window log | store every timestamp in a sorted set (ZADD/ZREMRANGEBYSCORE) | exact, more memory |
| Sliding window counter | weighted mix of current + previous bucket | near-exact, cheap |
| Token bucket | tokens refill at a steady rate; each request spends one | allows controlled bursts |

### Experiment
- Implement a **sliding-window log** limiter using a Redis sorted set. (Great interview talking point.)
- Stop Redis (`docker compose stop redis`), hit an endpoint, read T1's logs. Restart it after.

---

## Lesson 5 — Async click analytics with a job queue

### Run
Start the worker in T2: `npm run worker`. Click your link a few times, then:
```bash
curl -s localhost:3000/api/urls/q0V/stats
curl -s -H 'Referer: https://linkedin.com' -o /dev/null localhost:3000/q0V
curl -s localhost:3000/api/urls/q0V/stats    # topReferers now includes linkedin
```

### Observe — the key experiment
1. **Stop the worker** (Ctrl+C in T2).
2. Click the link 5 times: `for i in 1 2 3 4 5; do curl -s -o /dev/null localhost:3000/q0V; done`
3. Redirects still work instantly. Check `curl -s localhost:3000/api/metrics` → `clickQueue.waiting: 5`.
4. Stats still show the old count — the clicks are **waiting in Redis**, not lost.
5. Restart the worker. Watch T2 process 5 jobs. `waiting` goes back to 0, stats update.

That is **"decoupling tracking from the redirect path"** in action.

### Understand — read `src/routes/redirect.js`, `src/lib/queue.js`, `src/worker.js`
```
redirect handler:  res.redirect(302) ──► (response already sent) ──► queue.add('click', {...})
worker process:    take job ──► BEGIN; INSERT clicks; UPDATE click_count+1; COMMIT
```
- **Producer / consumer:** API server produces jobs, worker consumes. Separate processes, so you
  can scale them independently (e.g. 2 API servers, 5 workers).
- The redirect **doesn't await** the analytics write; the user's latency = cache lookup only.
- **Retries:** `attempts: 3` with exponential backoff (1s, 2s, 4s). If Postgres blips, the job retries.
- **Transaction** in the worker: the click row and the counter update both happen or neither does.
- `click_count` is **denormalised** — we could `COUNT(*)` the clicks table, but that gets slow at
  millions of rows. The counter makes "total clicks" O(1).
- `concurrency: 5`: one worker process handles 5 jobs in parallel.

**Trade-offs to be able to discuss:**
- **Eventual consistency:** stats lag a little behind reality.
- **At-least-once delivery:** if the worker crashes after COMMIT but before acking, the job reruns
  → a click could be counted twice. Fix: give each click an id and make the insert idempotent
  (`ON CONFLICT DO NOTHING`).
- At very high scale you'd batch: worker inserts 500 clicks per query instead of 1.

### Experiment
- In `worker.js`, add `if (Math.random() < 0.5) throw new Error('flaky')` at the top of
  `processClick`. Click a few times and watch retries and `failed` counts in `/api/metrics`. Remove it after.

---

## Lesson 6 — Resilience: what happens when Redis dies?

Redis plays three roles here, so losing it is the most interesting failure to study.

### Run
With the server running and a short link created (say `q0V`):
```bash
docker compose stop redis
curl -s -o /dev/null -w "%{http_code} in %{time_total}s\n" -D - localhost:3000/q0V | grep -iE 'x-cache|^[0-9]'
curl -s -X POST localhost:3000/api/shorten -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -s localhost:3000/health
docker compose start redis
```

### Observe
| Request | Result | Why |
|---|---|---|
| Redirect | **302 in a few ms**, `X-Cache: BYPASS` | Cache error → treated as a miss → Postgres answers |
| Shorten | **503** | Rate limiter fails closed |
| `/health` | `"redis":"down"` | The app reports it honestly |
| Click analytics | That click is lost | The job couldn't be queued; the redirect still happened |

Start Redis again and everything recovers by itself. No restart needed.

### Understand: open `src/lib/redis.js` and `src/services/cache.js`
- By default, ioredis **queues** commands while disconnected and retries them, so every request
  would **hang** waiting for Redis. That's the wrong behaviour for a cache. We set:
  - `enableOfflineQueue: false`: reject commands immediately when disconnected
  - `maxRetriesPerRequest: 1`: don't retry forever
  - `retryStrategy`: keep reconnecting in the background
- `cache.js` wraps every Redis call in `safe()`. Errors become cache misses. **The cache is an
  optimisation, never a dependency.** Postgres is the source of truth.
- In `docker-compose.yml`, Redis runs with `--maxmemory-policy noeviction` (never silently delete
  keys when memory is full: queue data must not vanish) and `--appendonly yes` (persist to disk
  so queued jobs survive a restart).

### Experiment
- Comment out `enableOfflineQueue: false` in `redis.js`, restart, stop Redis, and time a
  redirect. Then put it back.

---

## Lesson 7 — Tests and the public demo

```bash
npm test
```
`test/base62.test.js` and `test/validate.test.js` are **unit tests**: they test pure functions
with no database or Redis, so they run in milliseconds. That's why URL validation lives in its
own file (`src/lib/validate.js`) instead of inside the service that talks to Postgres.

The public demo adds a few things you should be able to explain:
- **`public/index.html`**: the web page. It calls the same JSON API as curl.
- **Link expiry** (`LINK_TTL_DAYS`): the `expires_at` column, filtered in the redirect query.
  The cache TTL is capped at the time remaining, so a cached link can't outlive its expiry.
- **Abuse limits**: rate limit, expiry, no `user:pass@` URLs, no shortening of our own links
  (that would create redirect loops).
- **`RUN_WORKER_IN_PROCESS`**: free hosting gives one process, so the worker runs inside the API
  process. The code is identical (`src/clickWorker.js`); only *where* it runs changes.
- **`trust proxy`**: on Render, requests arrive through a proxy, so the client's real IP is in the
  `X-Forwarded-For` header. Without this setting, every visitor would share one rate limit.

See **DEPLOY.md** to put it online.

---

## Lesson 8 — Putting it together (the request lifecycle)

Trace one `GET /q0V` through the code with your finger:

1. `app.js` — JSON parser, logger, route matching (`/api` routes first, `/:code` last)
2. `redirect.js` — `rateLimiter({name:'redirect'})` → Redis INCR
3. `base62.isValidCode` — reject junk before touching any database
4. `urlService.resolve` → `cache.get` → (miss) Postgres → `cache.set`
5. `res.redirect(302, longUrl)` — user is done here, ~2 ms
6. `clickQueue.add` → Redis list
7. `worker.js` picks it up → Postgres transaction

And `server.js` / `worker.js` **graceful shutdown**: on Ctrl+C they stop taking new work, finish
in-flight requests/jobs, and close DB/Redis connections cleanly.

---

## Interview questions you should now be able to answer

1. Why Base62 and not Base64? *(Base64 has `+` and `/`, which aren't URL-safe.)*
2. How many URLs can 7 characters hold? What happens when you run out?
3. Counter-based vs random vs hash-based codes — trade-offs? How would you generate ids across multiple DB shards?
4. Why 302 instead of 301?
5. What's cache-aside? What other caching patterns exist (write-through, write-back)?
6. What if a hot key expires and 10,000 requests miss at once? *(Cache stampede → use a lock or early refresh.)*
7. Why store rate-limit counters in Redis? Fixed window's weakness? Token bucket vs sliding window?
8. What happens to clicks if the worker is down? If Redis is down? Why does your shorten endpoint fail closed but redirects fail open?
9. At-least-once vs exactly-once delivery — how do you avoid double counting?
10. How would you scale this to 10k redirects/second? *(Multiple stateless API servers, Redis replicas/cluster, Postgres read replicas, batch analytics writes, CDN in front.)*

## Ideas to extend it (and strengthen the resume line)

- Custom aliases (`/iitm-fest`) with a uniqueness check
- Link expiry (`expires_at` column + match TTL in Redis)
- Sliding-window or token-bucket limiter as a Lua script
- Batch inserts in the worker; idempotent click ids
- A small React dashboard for stats
- Tests with Jest + Supertest; a Dockerfile for the app itself
