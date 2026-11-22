// Business logic: creating short URLs and resolving them.
const db = require('../lib/db');
const cache = require('./cache');
const base62 = require('../lib/base62');
const config = require('../config');

const secondsUntil = (date) => Math.floor((new Date(date).getTime() - Date.now()) / 1000);

async function createShortUrl(longUrl) {
  // Step 1: reserve the next id from the sequence BEFORE inserting.
  // That lets us compute the short code and insert in ONE statement.
  const { rows: seq } = await db.query("SELECT nextval('urls_id_seq') AS id");
  const id = seq[0].id; // string, because BIGINT can exceed JS Number range

  // Step 2: id -> Base62. The offset just makes codes look less trivial ("q0U" not "1").
  const shortCode = base62.encode(BigInt(id) + BigInt(config.idOffset));

  // Optional expiry (used for the public demo to limit abuse).
  const expiresAt =
    config.linkTtlDays > 0 ? new Date(Date.now() + config.linkTtlDays * 86400 * 1000) : null;

  const { rows } = await db.query(
    `INSERT INTO urls (id, short_code, long_url, expires_at) VALUES ($1, $2, $3, $4)
     RETURNING id, short_code, long_url, created_at, expires_at`,
    [id, shortCode, longUrl, expiresAt]
  );
  const row = rows[0];

  // Step 3: warm the cache — a freshly created link is very likely to be clicked soon.
  // The cache entry must never outlive the link itself.
  const ttl = row.expires_at ? secondsUntil(row.expires_at) : config.cacheTtl;
  await cache.set(shortCode, { id: row.id, longUrl: row.long_url }, ttl);

  return row;
}

// Hot path: called on every redirect. Must be fast.
async function resolve(code) {
  const cached = await cache.get(code);
  if (cached.hit) return { record: cached.value, source: 'cache' };

  const { rows } = await db.query(
    `SELECT id, long_url, expires_at FROM urls
      WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [code]
  );
  if (rows.length === 0) {
    await cache.setNotFound(code);
    return { record: null, source: 'db' };
  }
  const record = { id: rows[0].id, longUrl: rows[0].long_url };
  const ttl = rows[0].expires_at ? secondsUntil(rows[0].expires_at) : config.cacheTtl;
  await cache.set(code, record, ttl);
  return { record, source: cached.unavailable ? 'db-fallback' : 'db' };
}

async function getStats(code) {
  const { rows } = await db.query(
    `SELECT id, short_code, long_url, click_count, created_at, expires_at
       FROM urls WHERE short_code = $1`,
    [code]
  );
  if (rows.length === 0) return null;
  const url = rows[0];

  const [daily, referers] = await Promise.all([
    db.query(
      `SELECT to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS clicks
         FROM clicks WHERE url_id = $1 AND clicked_at > now() - interval '7 days'
        GROUP BY 1 ORDER BY 1`,
      [url.id]
    ),
    db.query(
      `SELECT COALESCE(referer, '(direct)') AS referer, COUNT(*)::int AS clicks
         FROM clicks WHERE url_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [url.id]
    ),
  ]);

  return {
    shortCode: url.short_code,
    longUrl: url.long_url,
    totalClicks: Number(url.click_count),
    createdAt: url.created_at,
    expiresAt: url.expires_at,
    last7Days: daily.rows,
    topReferers: referers.rows,
  };
}

module.exports = { createShortUrl, resolve, getStats };
