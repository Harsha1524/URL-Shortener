// Cache-aside ("lazy loading") pattern:
//   1. look in Redis
//   2. on a miss, read from Postgres
//   3. write the result into Redis with a TTL so the next read is a hit
//
// Every Redis call is wrapped in try/catch: the cache is an OPTIMISATION.
// If Redis is down we treat it as a miss and Postgres answers instead.
const redis = require('../lib/redis');
const config = require('../config');

const NOT_FOUND = '__NOT_FOUND__'; // sentinel for "code doesn't exist" (negative caching)
const key = (code) => `url:${code}`;

const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch (err) {
    console.warn('[cache] Redis unavailable, skipping cache:', err.message);
    return fallback;
  }
};

async function get(code) {
  const value = await safe(() => redis.get(key(code)), undefined);
  if (value === undefined) return { hit: false, unavailable: true };
  if (value === null) {
    safe(() => redis.incr('metrics:cache_misses'));
    return { hit: false };
  }
  safe(() => redis.incr('metrics:cache_hits'));
  return { hit: true, value: value === NOT_FOUND ? null : JSON.parse(value) };
}

// ttlSeconds lets callers shorten the TTL, e.g. for a link that expires soon.
async function set(code, record, ttlSeconds = config.cacheTtl) {
  const ttl = Math.max(1, Math.min(ttlSeconds, config.cacheTtl));
  await safe(() => redis.set(key(code), JSON.stringify(record), 'EX', ttl));
}

async function setNotFound(code) {
  // Short TTL: if someone spams a fake code we don't hit the DB every time,
  // but we also don't remember "not found" for long.
  await safe(() => redis.set(key(code), NOT_FOUND, 'EX', config.negativeCacheTtl));
}

async function stats() {
  const [hits, misses] = await safe(() => redis.mget('metrics:cache_hits', 'metrics:cache_misses'), [0, 0]);
  const h = Number(hits || 0);
  const m = Number(misses || 0);
  return { hits: h, misses: m, hitRate: h + m === 0 ? 0 : +(h / (h + m)).toFixed(3) };
}

module.exports = { get, set, setNotFound, stats };
