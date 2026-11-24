import envConfigModule = require('../../config/env.config');
const { getEnvConfig } = envConfigModule;
import syncWorker = require('../banking/sync.worker');
import sentryService = require('../infrastructure/sentry.service');
import pushQueue = require('../../push_service/push.queue');

// ============================================================================
// RABBITMQ BALANCE & TRANSACTION SYNC QUEUE SERVICE
// Processes bank balance & transaction sync jobs from two sources:
//   1. High-priority login trigger (PRIORITY_HIGH = 10) when a user logs in
//   2. Normal-priority daily CRON job (PRIORITY_NORMAL = 1) once a day
// Dispatches follow-up notifications to the Push Notification microservice queue.
// ============================================================================

const SYNC_QUEUE_NAME = 'budget_app.bank_sync_jobs';
const PRIORITY_HIGH = 10; // Triggered immediately upon user login
const PRIORITY_NORMAL = 1; // Triggered by the once-a-day CRON scheduler

// In-memory priority queue buffer (keeps jobs ordered by priority desc, then FIFO)
const pendingJobs = [];
let customPublisher = null;

function setQueuePublisher(publisher) {
  customPublisher = publisher;
}

// Enqueue a balance & transaction sync job for a user in RabbitMQ
async function enqueueUserSyncJob(userId, options: Record<string, any> = {}) {
  const priority =
    typeof options.priority === 'number'
      ? options.priority
      : options.source === 'login'
        ? PRIORITY_HIGH
        : PRIORITY_NORMAL;
  const source = options.source || 'manual';

  const job = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queue: SYNC_QUEUE_NAME,
    userId,
    source,
    priority,
    enqueuedAt: new Date().toISOString(),
  };

  try {
    if (customPublisher && typeof customPublisher.publish === 'function') {
      await customPublisher.publish(SYNC_QUEUE_NAME, job, { priority, persistent: true });
    } else {
      // TODO: Connect to RabbitMQ via amqplib (`amqp.connect(getEnvConfig().rabbitmqUrl)`),
      // assert priority queue `channel.assertQueue(SYNC_QUEUE_NAME, { durable: true, arguments: { 'x-max-priority': 10 } })`,
      // and publish `Buffer.from(JSON.stringify(job))` with `{ persistent: true, priority }`.
      pendingJobs.push(job);
      pendingJobs.sort((a, b) => b.priority - a.priority);
    }

    return job;
  } catch (err) {
    sentryService.captureException(err, {
      service: 'queue.service',
      action: 'enqueueUserSyncJob',
      userId,
      source,
    });
    throw err;
  }
}

// Process the highest-priority pending sync job via the Sync Worker
async function processNextSyncJob() {
  if (pendingJobs.length === 0) {
    return null;
  }

  const job = pendingJobs.shift();
  try {
    const synced = await syncWorker.syncAllUserEnrollments(job.userId);
    const syncedCount = Array.isArray(synced) ? synced.length : 0;

    // Enqueue a push notification into the push microservice queue when bank accounts finish syncing
    if (syncedCount > 0) {
      try {
        const dayKey = new Date().toISOString().slice(0, 10);
        await pushQueue.enqueuePushNotificationJob(
          job.userId,
          {
            title: 'Bank accounts synced',
            body: `Updated balances and transactions across ${syncedCount} connected ${syncedCount === 1 ? 'bank' : 'banks'}.`,
            url: '/dashboard',
            tag: 'budget-app-bank-sync',
          },
          {
            source: `sync:${job.source}`,
            dedupeKey: `sync:${job.source}:${dayKey}`,
          }
        );
      } catch {
        // Non-fatal: bank sync still succeeded even if push enqueue failed
      }
    }

    return {
      ...job,
      status: 'completed',
      syncedCount,
    };
  } catch (err) {
    sentryService.captureException(err, {
      service: 'queue.service',
      action: 'processNextSyncJob',
      jobId: job.id,
      userId: job.userId,
    });
    return {
      ...job,
      status: 'failed',
      error: err.message,
    };
  }
}

function getPendingJobs() {
  return [...pendingJobs];
}

function clearPendingJobs() {
  pendingJobs.length = 0;
}

function getQueueConfig() {
  const { rabbitmqUrl } = getEnvConfig();
  return {
    rabbitmqUrl,
    queueName: SYNC_QUEUE_NAME,
    maxPriority: PRIORITY_HIGH,
  };
}

export = {
  SYNC_QUEUE_NAME,
  PRIORITY_HIGH,
  PRIORITY_NORMAL,
  setQueuePublisher,
  enqueueUserSyncJob,
  processNextSyncJob,
  getPendingJobs,
  clearPendingJobs,
  getQueueConfig,
};
