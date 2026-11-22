// Background worker: consumes click jobs from the queue and writes them to Postgres.
// Run it as a SEPARATE process:  npm run worker
//
// Why separate? Writing analytics is slower than serving a redirect and isn't
// needed to answer the user. If this worker is down or slow, redirects keep
// working — jobs just wait in Redis until the worker catches up.
// (On free hosting with one process, set RUN_WORKER_IN_PROCESS=true instead.)
const { startClickWorker } = require('./clickWorker');
const db = require('./lib/db');

const worker = startClickWorker();

async function shutdown() {
  console.log('Worker shutting down (finishing active jobs)...');
  await worker.close();
  await db.pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
