// JSON API: create short links, view stats, view metrics.
const express = require('express');
const urlService = require('../services/urlService');
const cache = require('../services/cache');
const rateLimiter = require('../middleware/rateLimiter');
const { validateUrl } = require('../lib/validate');
const { clickQueue } = require('../lib/queue');
const db = require('../lib/db');
const base62 = require('../lib/base62');
const config = require('../config');

const router = express.Router();
const ownHost = new URL(config.baseUrl).host;

// POST /api/shorten   body: { "url": "https://..." }
router.post(
  '/shorten',
  rateLimiter({ name: 'shorten', max: config.rateLimit.shortenMax, failClosed: true }),
  async (req, res) => {
    const { url, error } = validateUrl(req.body && req.body.url, { ownHost });
    if (error) return res.status(400).json({ error });

    const row = await urlService.createShortUrl(url);
    res.status(201).json({
      shortCode: row.short_code,
      shortUrl: `${config.baseUrl}/${row.short_code}`,
      longUrl: row.long_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  }
);

// GET /api/urls/:code/stats
router.get('/urls/:code/stats', async (req, res) => {
  const { code } = req.params;
  if (!base62.isValidCode(code)) return res.status(400).json({ error: 'invalid code' });
  const stats = await urlService.getStats(code);
  if (!stats) return res.status(404).json({ error: 'not found' });
  res.json(stats);
});

// GET /api/info — settings the demo page displays
router.get('/info', (req, res) => {
  res.json({
    linkTtlDays: config.linkTtlDays,
    shortenLimitPerMinute: config.rateLimit.shortenMax,
    sourceUrl: process.env.SOURCE_URL || null,
    authorName: process.env.AUTHOR_NAME || null,
    authorUrl: process.env.AUTHOR_URL || null,
  });
});

// GET /api/metrics  — for learning: watch cache hits and queue depth change
router.get('/metrics', async (req, res) => {
  const [cacheStats, queueCounts] = await Promise.all([
    cache.stats(),
    clickQueue
      .getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
      .catch(() => null), // Redis down -> no queue numbers
  ]);
  res.json({
    cache: cacheStats,
    dbQueriesThisProcess: db.getQueryCount(),
    clickQueue: queueCounts,
  });
});

module.exports = router;
