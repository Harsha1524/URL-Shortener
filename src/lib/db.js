// PostgreSQL connection pool. A pool keeps a few connections open and reuses
// them, instead of opening a new TCP connection for every query (slow).
const { Pool } = require('pg');
const config = require('../config');

// Hosted databases (Neon, Render, etc.) require SSL; local Docker doesn't.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(config.databaseUrl);

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,                       // at most 10 concurrent connections from this process
  idleTimeoutMillis: 30000,      // close idle connections (serverless DBs drop them anyway)
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

// Small wrapper that also counts queries, so we can SEE the cache saving DB reads.
let queryCount = 0;
async function query(text, params) {
  queryCount++;
  return pool.query(text, params);
}

module.exports = { pool, query, getQueryCount: () => queryCount };
