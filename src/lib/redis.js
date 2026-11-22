// Shared Redis client for caching and rate limiting.
//
// It is configured to FAIL FAST. By default ioredis queues commands while
// disconnected and retries them — so if Redis dies, every request would hang
// waiting. For a cache that's the wrong trade-off: we'd rather get an error
// immediately and fall back to Postgres.
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,      // give up on a command after 1 retry
  enableOfflineQueue: false,    // don't queue commands while disconnected — reject them
  connectTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 250, 2000), // keep trying to reconnect in the background
});

redis.on('error', (err) => console.error('[redis]', err.message));

// Rate-limit script, run atomically inside Redis (see middleware/rateLimiter.js).
redis.defineCommand('rateLimitHit', {
  numberOfKeys: 1,
  lua: `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('TTL', KEYS[1])
    return { count, ttl }
  `,
});

module.exports = redis;
