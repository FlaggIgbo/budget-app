const { getEnvConfig } = require('../config/env.config');
const pushWorker = require('./push.worker');
const sentryService = require('../services/infrastructure/sentry.service');

// ============================================================================
// PUSH MICROSERVICE RABBITMQ QUEUE (`budget_app.push_notifications`)
// Manages asynchronous Web Push delivery jobs, exponential retry backoff on
// transient 429/5xx errors, and Dead-Letter Queue (`budget_app.push_notifications.dlq`).
// ============================================================================

const PUSH_QUEUE_NAME = 'budget_app.push_notifications';
const PUSH_DLQ_NAME = 'budget_app.push_notifications.dlq';
const PUSH_MAX_RETRIES = 3;

const pendingPushJobs = [];
const deadLetterPushJobs = [];
let customPushPublisher = null;

function setPushPublisher(publisher) {
  customPushPublisher = publisher;
}

// Enqueue a Web Push notification delivery job in RabbitMQ (`budget_app.push_notifications`)
async function enqueuePushNotificationJob(userId, notification, options = {}) {
  const attempt = Number.isInteger(options.attempt) ? options.attempt : 0;
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : PUSH_MAX_RETRIES;

  const job = {
    id: options.id || `push_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queue: PUSH_QUEUE_NAME,
    userId,
    source: options.source || 'system',
    notification: {
      title: notification?.title || 'Budget App',
      body: notification?.body || '',
      url: notification?.url || '/dashboard',
      tag: notification?.tag || 'budget-app-notification',
      icon: notification?.icon || '/icons/icon-192x192.png',
      data: notification?.data || {},
    },
    dedupeKey: options.dedupeKey || null,
    dedupeTtlSeconds: options.dedupeTtlSeconds,
    ttl: options.ttl,
    urgency: options.urgency || 'normal',
    targetEndpoints: Array.isArray(options.targetEndpoints) ? options.targetEndpoints : null,
    attempt,
    maxRetries,
    enqueuedAt: new Date().toISOString(),
  };

  try {
    if (customPushPublisher && typeof customPushPublisher.publish === 'function') {
      await customPushPublisher.publish(PUSH_QUEUE_NAME, job, { persistent: true });
    } else {
      // TODO: Connect to RabbitMQ via amqplib (`amqp.connect(getEnvConfig().rabbitmqUrl)`),
      // assert durable queue `PUSH_QUEUE_NAME` bound to dead-letter exchange / `PUSH_DLQ_NAME`,
      // and publish `Buffer.from(JSON.stringify(job))` with `{ persistent: true }`.
      pendingPushJobs.push(job);
    }

    return job;
  } catch (err) {
    sentryService.captureException(err, {
      service: 'push_service.queue',
      action: 'enqueuePushNotificationJob',
      userId,
      source: job.source,
    });
    throw err;
  }
}

// Process the next pending Web Push notification job via Push Worker (with retry & DLQ handling)
async function processNextPushJob() {
  if (pendingPushJobs.length === 0) {
    return null;
  }

  const job = pendingPushJobs.shift();
  try {
    const result = await pushWorker.processPushJob(job);

    if (result.status === 'retry_needed' && result.retryableEndpoints.length > 0) {
      const nextAttempt = (job.attempt || 0) + 1;
      const retryEndpoints = result.retryableEndpoints.map((entry) => entry.endpoint);
      const maxRetries = Number.isInteger(job.maxRetries) ? job.maxRetries : PUSH_MAX_RETRIES;

      if (nextAttempt <= maxRetries) {
        const retryJob = {
          ...job,
          attempt: nextAttempt,
          targetEndpoints: retryEndpoints,
          backoffMs: Math.min(60000, 1000 * 2 ** (nextAttempt - 1)),
          requeuedAt: new Date().toISOString(),
        };
        pendingPushJobs.push(retryJob);
        return {
          ...result,
          status: 'requeued',
          nextAttempt,
        };
      }

      // Retries exhausted — move to dead-letter queue for inspection
      const dlqRecord = {
        ...job,
        queue: PUSH_DLQ_NAME,
        failedAt: new Date().toISOString(),
        retryableEndpoints: result.retryableEndpoints,
      };
      deadLetterPushJobs.push(dlqRecord);
      sentryService.captureException(
        new Error(`Push job ${job.id} exhausted ${maxRetries} retries and moved to DLQ`),
        {
          service: 'push_service.queue',
          action: 'processNextPushJob',
          jobId: job.id,
          userId: job.userId,
        }
      );
      return {
        ...result,
        status: 'dead_lettered',
      };
    }

    return result;
  } catch (err) {
    sentryService.captureException(err, {
      service: 'push_service.queue',
      action: 'processNextPushJob',
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

function getPendingPushJobs() {
  return [...pendingPushJobs];
}

function getDeadLetterPushJobs() {
  return [...deadLetterPushJobs];
}

function clearPendingPushJobs() {
  pendingPushJobs.length = 0;
  deadLetterPushJobs.length = 0;
}

function getPushQueueConfig() {
  const { rabbitmqUrl } = getEnvConfig();
  return {
    rabbitmqUrl,
    pushQueueName: PUSH_QUEUE_NAME,
    pushDlqName: PUSH_DLQ_NAME,
    pushMaxRetries: PUSH_MAX_RETRIES,
  };
}

module.exports = {
  PUSH_QUEUE_NAME,
  PUSH_DLQ_NAME,
  PUSH_MAX_RETRIES,
  setPushPublisher,
  enqueuePushNotificationJob,
  processNextPushJob,
  getPendingPushJobs,
  getDeadLetterPushJobs,
  clearPendingPushJobs,
  getPushQueueConfig,
};
