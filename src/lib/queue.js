// Job queue for click analytics, backed by Redis (BullMQ).
// The API server is the PRODUCER (adds jobs); the worker is the CONSUMER.
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const config = require('../config');

const QUEUE_NAME = 'clicks';

// The producer uses a fail-fast connection too: if Redis is down, adding a job
// errors immediately instead of making the redirect wait.
const producerConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 2000,
});
producerConnection.on('error', () => {}); // already logged by the main client

const clickQueue = new Queue(QUEUE_NAME, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: 3,                                   // retry failed jobs up to 3 times
    backoff: { type: 'exponential', delay: 1000 }, // wait 1s, 2s, 4s between retries
    removeOnComplete: 500,                         // keep only the last 500 finished jobs
    removeOnFail: 1000,
  },
});

// The worker needs a connection that waits patiently (BullMQ requires maxRetriesPerRequest: null).
const workerConnectionOptions = { maxRetriesPerRequest: null };

module.exports = { clickQueue, QUEUE_NAME, workerConnectionOptions };
