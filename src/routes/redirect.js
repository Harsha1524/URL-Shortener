// GET /:code  — the hot path. Look up the URL (cache first), redirect,
// and hand click tracking to the queue so the user never waits on analytics.
const express = require('express');
const urlService = require('../services/urlService');
const rateLimiter = require('../middleware/rateLimiter');
const { clickQueue } = require('../lib/queue');
const base62 = require('../lib/base62');
const config = require('../config');

const router = express.Router();

router.get(
  '/:code',
  rateLimiter({ name: 'redirect', max: config.rateLimit.redirectMax, failClosed: false }),
  async (req, res) => {
    const { code } = req.params;
    if (!base62.isValidCode(code)) return res.status(404).json({ error: 'not found' });

    const { record, source } = await urlService.resolve(code);
    if (!record) return res.status(404).json({ error: 'link not found or expired' });

    // Debug header so you can see where the answer came from:
    // HIT = Redis, MISS = Postgres, BYPASS = Redis down so Postgres answered.
    res.set('X-Cache', source === 'cache' ? 'HIT' : source === 'db-fallback' ? 'BYPASS' : 'MISS');

    // 302 (temporary), not 301 (permanent): browsers cache 301s and would skip
    // our server next time — we'd lose the click.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, record.longUrl);

    // Fire-and-forget: the response is already sent. If enqueueing fails (Redis
    // down) we lose that click's analytics, but the user's redirect is unaffected.
    clickQueue
      .add('click', {
        urlId: record.id,
        clickedAt: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.get('user-agent') || null,
        referer: req.get('referer') || null,
      })
      .catch((err) => console.error('[redirect] failed to enqueue click:', err.message));
  }
);

module.exports = router;
