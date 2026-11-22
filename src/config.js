// Central place for all settings. Everything comes from environment variables (.env).
require('dotenv').config({ quiet: true });

const int = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : parseInt(v, 10);
};
const bool = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v === 'true';
};

// TRUST_PROXY: "true", "false", or a number of proxy hops in front of the app.
function trustProxy() {
  const v = process.env.TRUST_PROXY;
  if (v === undefined || v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return parseInt(v, 10);
}

module.exports = {
  port: int('PORT', 3000),
  // RENDER_EXTERNAL_URL is set automatically by Render, so BASE_URL can be left empty there.
  baseUrl: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || 'postgres://shortener:shortener@localhost:5432/shortener',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cacheTtl: int('CACHE_TTL_SECONDS', 3600),
  negativeCacheTtl: int('NEGATIVE_CACHE_TTL_SECONDS', 60),
  rateLimit: {
    windowSeconds: int('RATE_LIMIT_WINDOW_SECONDS', 60),
    shortenMax: int('RATE_LIMIT_SHORTEN_MAX', 10),
    redirectMax: int('RATE_LIMIT_REDIRECT_MAX', 100),
  },
  idOffset: int('ID_OFFSET', 100000),
  // 0 = links never expire. For a public demo, expiring links limits abuse.
  linkTtlDays: int('LINK_TTL_DAYS', 0),
  // Free hosting usually allows one process, so the worker can run inside the API process.
  runWorkerInProcess: bool('RUN_WORKER_IN_PROCESS', false),
  trustProxy: trustProxy(),
};
