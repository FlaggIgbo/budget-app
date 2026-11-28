import envConfigModule = require('../config/env.config');
const { getEnvConfig } = envConfigModule;
import pushWorker = require('./push.worker');
import eventBus = require('../services/events/eventBus.service');
import sentryService = require('../services/infrastructure/sentry.service');

// ============================================================================
// PUSH MICROSERVICE RABBITMQ CONSUMER & QUEUE (`budget_app.push_notifications`)
// Subscribes to domain events on `budget_app.events`:
//   - `bank.sync.completed` -> sends bank sync push notification
//   - `plaid.webhook.item_error` -> sends bank reconnection alert
//   - `push.notification.requested` -> delivers explicit push notifications
// Manages retries via RabbitMQ re-publishing and routes exhausted messages to
// the Dead-Letter Queue (`budget_app.push_notifications.dlq`).
// ============================================================================

const PUSH_QUEUE_NAME = 'budget_app.push_notifications';
const PUSH_DLQ_NAME = 'budget_app.push_notifications.dlq';
const PUSH_MAX_RETRIES = 3;

const SUBSCRIBED_ROUTING_KEYS = [
  eventBus.DomainEvents.BANK_SYNC_COMPLETED,
  eventBus.DomainEvents.PLAID_ITEM_ERROR,
  eventBus.DomainEvents.PUSH_NOTIFICATION_REQUESTED,
];

// Publish a `push.notification.requested` domain event onto RabbitMQ
async function enqueuePushNotificationJob(userId, notification, options: Record<string, any> = {}) {
  const attempt = Number.isInteger(options.attempt) ? options.attempt : 0;
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : PUSH_MAX_RETRIES;

  const payload = {
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
  };

  return await eventBus.publishEvent(eventBus.DomainEvents.PUSH_NOTIFICATION_REQUESTED, payload, {
    id: options.id,
  });
}

// Translate any subscribed domain event envelope into a push job payload
function mapEventToPushJob(envelope) {
  const payload = envelope?.payload || {};

  if (envelope?.type === eventBus.DomainEvents.BANK_SYNC_COMPLETED) {
    const syncedCount = Number(payload.syncedCount) || 0;
    if (!payload.userId || syncedCount <= 0) {
      return null;
    }
    const dayKey = new Date().toISOString().slice(0, 10);
    const source = payload.source || 'sync';
    return {
      id: envelope.id,
      queue: PUSH_QUEUE_NAME,
      userId: payload.userId,
      source: `sync:${source}`,
      notification: {
        title: 'Bank accounts synced',
        body: `Updated balances and transactions across ${syncedCount} connected ${syncedCount === 1 ? 'bank' : 'banks'}.`,
        url: '/dashboard',
        tag: 'budget-app-bank-sync',
        icon: '/icons/icon-192x192.png',
        data: { enrollmentId: payload.enrollmentId || null },
      },
      dedupeKey: `sync:${source}:${dayKey}`,
      attempt: Number.isInteger(payload.attempt) ? payload.attempt : 0,
      maxRetries: Number.isInteger(payload.maxRetries) ? payload.maxRetries : PUSH_MAX_RETRIES,
      targetEndpoints: Array.isArray(payload.targetEndpoints) ? payload.targetEndpoints : null,
      urgency: 'normal',
    };
  }

  if (envelope?.type === eventBus.DomainEvents.PLAID_ITEM_ERROR) {
    if (!payload.userId) {
      return null;
    }
    const institutionLabel = payload.institutionName || 'a connected bank';
    const dayKey = new Date().toISOString().slice(0, 10);
    return {
      id: envelope.id,
      queue: PUSH_QUEUE_NAME,
      userId: payload.userId,
      source: `plaid:${payload.webhookCode || 'item_error'}`,
      notification: {
        title: 'Bank connection needs attention',
        body: `Please reconnect ${institutionLabel} to keep your balances and transactions up to date.`,
        url: '/bank-accounts',
        tag: `budget-app-bank-error-${payload.enrollmentId || 'item'}`,
        icon: '/icons/icon-192x192.png',
        data: {
          enrollmentId: payload.enrollmentId || null,
          webhookCode: payload.webhookCode || null,
        },
      },
      dedupeKey: `plaid_error:${payload.enrollmentId || 'item'}:${dayKey}`,
      attempt: Number.isInteger(payload.attempt) ? payload.attempt : 0,
      maxRetries: Number.isInteger(payload.maxRetries) ? payload.maxRetries : PUSH_MAX_RETRIES,
      targetEndpoints: Array.isArray(payload.targetEndpoints) ? payload.targetEndpoints : null,
      urgency: 'high',
    };
  }

  // Default: `push.notification.requested` (or retry message)
  if (!payload.userId) {
    return null;
  }

  return {
    id: envelope.id,
    queue: PUSH_QUEUE_NAME,
    userId: payload.userId,
    source: payload.source || 'system',
    notification: {
      title: payload.notification?.title || 'Budget App',
      body: payload.notification?.body || '',
      url: payload.notification?.url || '/dashboard',
      tag: payload.notification?.tag || 'budget-app-notification',
      icon: payload.notification?.icon || '/icons/icon-192x192.png',
      data: payload.notification?.data || {},
    },
    dedupeKey: payload.dedupeKey || null,
    dedupeTtlSeconds: payload.dedupeTtlSeconds,
    ttl: payload.ttl,
    urgency: payload.urgency || 'normal',
    targetEndpoints: Array.isArray(payload.targetEndpoints) ? payload.targetEndpoints : null,
    attempt: Number.isInteger(payload.attempt) ? payload.attempt : 0,
    maxRetries: Number.isInteger(payload.maxRetries) ? payload.maxRetries : PUSH_MAX_RETRIES,
  };
}

// Process a single push event consumed from RabbitMQ, handling retries and DLQ routing
async function handlePushEvent(envelope, ch) {
  const job = mapEventToPushJob(envelope);
  if (!job) {
    return { status: 'ignored' };
  }

  const result = await pushWorker.processPushJob(job);

  if (result.status === 'retry_needed' && result.retryableEndpoints.length > 0) {
    const nextAttempt = (job.attempt || 0) + 1;
    const retryEndpoints = result.retryableEndpoints.map((entry) => entry.endpoint);
    const maxRetries = Number.isInteger(job.maxRetries) ? job.maxRetries : PUSH_MAX_RETRIES;

    if (nextAttempt <= maxRetries) {
      const retryEnvelope = {
        id: job.id,
        type: eventBus.DomainEvents.PUSH_NOTIFICATION_REQUESTED,
        occurredAt: new Date().toISOString(),
        payload: {
          ...job,
          attempt: nextAttempt,
          targetEndpoints: retryEndpoints,
          backoffMs: Math.min(60000, 1000 * 2 ** (nextAttempt - 1)),
          requeuedAt: new Date().toISOString(),
        },
      };

      ch.sendToQueue(PUSH_QUEUE_NAME, Buffer.from(JSON.stringify(retryEnvelope)), {
        persistent: true,
        contentType: 'application/json',
        messageId: job.id,
      });

      return {
        ...result,
        status: 'requeued',
        nextAttempt,
      };
    }

    // Retries exhausted — route to RabbitMQ Dead-Letter Queue
    const dlqRecord = {
      ...job,
      queue: PUSH_DLQ_NAME,
      failedAt: new Date().toISOString(),
      retryableEndpoints: result.retryableEndpoints,
    };
    ch.sendToQueue(PUSH_DLQ_NAME, Buffer.from(JSON.stringify(dlqRecord)), {
      persistent: true,
      contentType: 'application/json',
      messageId: job.id,
    });

    sentryService.captureException(
      new Error(`Push job ${job.id} exhausted ${maxRetries} retries and moved to DLQ`),
      {
        service: 'push_service.queue',
        action: 'handlePushEvent',
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
}

// Start the active RabbitMQ consumer for `budget_app.push_notifications`
async function startPushConsumer() {
  const ch = await eventBus.getChannel();
  await ch.assertQueue(PUSH_DLQ_NAME, { durable: true });

  return await eventBus.subscribeToEvents(
    PUSH_QUEUE_NAME,
    SUBSCRIBED_ROUTING_KEYS,
    async (envelope, _msg, activeChannel) => {
      await handlePushEvent(envelope, activeChannel);
    },
    { prefetch: 10 }
  );
}

function getPushQueueConfig() {
  const { rabbitmqUrl } = getEnvConfig();
  return {
    rabbitmqUrl,
    exchangeName: eventBus.EVENTS_EXCHANGE,
    pushQueueName: PUSH_QUEUE_NAME,
    pushDlqName: PUSH_DLQ_NAME,
    routingKeys: [...SUBSCRIBED_ROUTING_KEYS],
    pushMaxRetries: PUSH_MAX_RETRIES,
  };
}

export = {
  PUSH_QUEUE_NAME,
  PUSH_DLQ_NAME,
  PUSH_MAX_RETRIES,
  SUBSCRIBED_ROUTING_KEYS,
  enqueuePushNotificationJob,
  mapEventToPushJob,
  handlePushEvent,
  startPushConsumer,
  getPushQueueConfig,
};
