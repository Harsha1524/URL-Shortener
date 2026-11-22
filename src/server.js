// Entry point for the API server.
const app = require('./app');
const config = require('./config');
const db = require('./lib/db');
const redis = require('./lib/redis');
const { clickQueue } = require('./lib/queue');

// Free hosting usually gives one process, so optionally run the worker here too.
let worker = null;
if (config.runWorkerInProcess) {
  worker = require('./clickWorker').startClickWorker();
  console.log('Click worker running inside the API process');
}

const server = app.listen(config.port, () => {
  console.log(`API listening on port ${config.port} (${config.baseUrl})`);
});

// Graceful shutdown: stop accepting requests, finish in-flight ones, close connections.
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  setTimeout(() => process.exit(1), 10000).unref(); // force-exit if stuck
  server.close(async () => {
    await Promise.allSettled([worker && worker.close(), clickQueue.close(), redis.quit(), db.pool.end()]);
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
