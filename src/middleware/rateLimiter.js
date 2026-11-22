// Fixed-window rate limiter stored in Redis.
//
// Key:   ratelimit:<name>:<ip>
// Value: how many requests this IP made in the current window.
//
// The counting runs as a small Lua script inside Redis (defined in lib/redis.js):
//   INCR the counter; if it's the first request, set EXPIRE; return count + TTL.
// Redis runs a Lua script atomically — no other command can run in between —
// so there's no race and no chance of a counter that never expires.
//
// Because the counter lives in Redis (not in Node's memory), the limit holds
// even if you run several API server instances behind a load balancer.
const redis = require('../lib/redis');
const config = require('../config');

/**
 * @param {object} opts
 * @param {string} opts.name        bucket name, e.g. 'shorten'
 * @param {number} opts.max         requests allowed per window
 * @param {boolean} opts.failClosed if Redis is down: true = reject (503), false = allow
 */
function rateLimiter({ name, max, windowSeconds = config.rateLimit.windowSeconds, failClosed = false }) {
  return async function (req, res, next) {
    const ip = req.ip || 'unknown';
    const key = `ratelimit:${name}:${ip}`;

    let count, ttl;
    try {
      [count, ttl] = await redis.rateLimitHit(key, windowSeconds);
    } catch (err) {
      if (failClosed) {
        // Creating links is the abusable action: without a working limiter we refuse.
        console.error(`[rateLimiter:${name}] Redis down, rejecting request`);
        return res.status(503).json({ error: 'Service temporarily unavailable, try again shortly' });
      }
      // Redirects are the core product: keep serving them even without a limiter.
      console.error(`[rateLimiter:${name}] Redis down, allowing request`);
      return next();
    }

    const remaining = Math.max(0, max - count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.max(0, ttl))); // seconds until the window resets

    if (count > max) {
      const retryAfter = Math.max(1, ttl);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests', retryAfterSeconds: retryAfter });
    }
    next();
  };
}

module.exports = rateLimiter;
