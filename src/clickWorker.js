// The click-analytics worker logic, shared by:
//   - src/worker.js            (run as its own process: npm run worker)
//   - src/server.js            (run inside the API process when RUN_WORKER_IN_PROCESS=true)
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const db = require('./lib/db');
const config = require('./config');
const { QUEUE_NAME, workerConnectionOptions } = require('./lib/queue');

async function processClick(job) {
  const { urlId, clickedAt, ip, userAgent, referer } = job.data;
  const client = await db.pool.connect();
  try {
    // Transaction: both writes succeed or neither does.
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO clicks (url_id, clicked_at, ip, user_agent, referer)
       VALUES ($1, $2, $3, $4, $5)`,
      [urlId, clickedAt, ip, userAgent, referer]
    );
    await client.query('UPDATE urls SET click_count = click_count + 1 WHERE id = $1', [urlId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // BullMQ marks the job failed and retries it (attempts: 3)
  } finally {
    client.release();
  }
}

function startClickWorker() {
  const connection = new Redis(config.redisUrl, workerConnectionOptions);
  connection.on('error', (err) => console.error('[worker redis]', err.message));

  const worker = new Worker(QUEUE_NAME, processClick, {
    connection,
    concurrency: 5, // process up to 5 jobs at once
  });

  worker.on('ready', () => console.log(`Worker listening on queue "${QUEUE_NAME}"`));
  worker.on('completed', (job) => console.log(`[worker] job ${job.id} done (url ${job.data.urlId})`));
  worker.on('failed', (job, err) =>
    console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message)
  );
  worker.on('error', (err) => console.error('[worker]', err.message));

  return worker;
}

module.exports = { startClickWorker, processClick };
