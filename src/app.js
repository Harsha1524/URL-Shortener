// Builds the Express app (kept separate from server.js so it's easy to test).
const path = require('path');
const express = require('express');
const apiRoutes = require('./routes/api');
const redirectRoutes = require('./routes/redirect');
const db = require('./lib/db');
const redis = require('./lib/redis');
const config = require('./config');

const app = express();
app.disable('x-powered-by');

// Behind a proxy/load balancer (Render, Nginx...), this makes req.ip the real
// client IP from X-Forwarded-For. Needed for per-IP rate limiting to be correct.
app.set('trust proxy', config.trustProxy);
app.use(express.json({ limit: '10kb' }));

// Tiny request logger: method, path, status, time taken
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const cache = res.get('X-Cache') ? ` cache=${res.get('X-Cache')}` : '';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms${cache}`);
  });
  next();
});

// Health check: is each dependency reachable?
app.get('/health', async (req, res) => {
  const result = { status: 'ok', postgres: 'up', redis: redis.status === 'ready' ? 'up' : 'down' };
  try {
    await db.query('SELECT 1');
  } catch {
    result.postgres = 'down';
    result.status = 'error';
  }
  res.status(result.status === 'ok' ? 200 : 503).json(result);
});

// The demo web page (public/index.html) and its assets
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);
app.use('/', redirectRoutes); // must be last: "/:code" matches almost anything

// Express 5 forwards errors from async handlers here automatically.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
  console.error('[error]', err);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
