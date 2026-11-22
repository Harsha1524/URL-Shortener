// Creates the tables by running db/schema.sql against DATABASE_URL.
// Safe to run multiple times (uses IF NOT EXISTS).
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/lib/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration complete: tables "urls" and "clicks" are ready.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
