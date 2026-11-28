import db = require('../../models');
import envConfigModule = require('../../config/env.config');
const { getEnvConfig } = envConfigModule;
import syncWorker = require('../banking/sync.worker');
import eventBus = require('../events/eventBus.service');
import sentryService = require('../infrastructure/sentry.service');

// ============================================================================
// RABBITMQ BANK SYNC CONSUMER & QUEUE SERVICE
// Subscribes `budget_app.bank_sync_jobs` (priority queue) to domain events on
// the `budget_app.events` topic exchange:
//   - `user.logged_in` (PRIORITY_HIGH = 10)
//   - `plaid.webhook.sync_updates_available` (PRIORITY_WEBHOOK = 5)
//   - `bank.enrollment.created` (PRIORITY_HIGH = 10)
//   - `bank.sync.requested` (PRIORITY_NORMAL = 1)
// Emits `bank.sync.completed` onto the event bus upon completion without any
// direct coupling to the push notification service.
// ============================================================================

const SYNC_QUEUE_NAME = 'budget_app.bank_sync_jobs';
const PRIORITY_HIGH = 10; // Triggered immediately upon user login or new bank enrollment
const PRIORITY_WEBHOOK = 5; // Triggered by Plaid webhooks (SYNC_UPDATES_AVAILABLE, etc.)
const PRIORITY_NORMAL = 1; // Triggered by manual/explicit sync requests

const SUBSCRIBED_ROUTING_KEYS = [
  eventBus.DomainEvents.USER_LOGGED_IN,
  eventBus.DomainEvents.PLAID_SYNC_UPDATES_AVAILABLE,
  eventBus.DomainEvents.BANK_ENROLLMENT_CREATED,
  eventBus.DomainEvents.BANK_SYNC_REQUESTED,
];

// Publish a `bank.sync.requested` domain event onto RabbitMQ
async function enqueueUserSyncJob(userId, options: Record<string, any> = {}) {
  const source = options.source || 'manual';
  const priority =
    typeof options.priority === 'number'
      ? options.priority
      : source === 'login' || source === 'enrollment'
        ? PRIORITY_HIGH
        : source === 'plaid_webhook'
          ? PRIORITY_WEBHOOK
          : PRIORITY_NORMAL;

  return await eventBus.publishEvent(
    eventBus.DomainEvents.BANK_SYNC_REQUESTED,
    {
      userId,
      enrollmentId: options.enrollmentId || null,
      source,
    },
    { priority }
  );
}

// Handle a single bank sync domain event consumed from RabbitMQ
async function handleSyncEvent(envelope) {
  const payload = envelope?.payload || {};
  const userId = payload.userId;
  const enrollmentId = payload.enrollmentId || null;
  const source = payload.source || envelope.type || 'event';

  if (!userId) {
    return {
      eventId: envelope?.id,
      status: 'ignored',
      syncedCount: 0,
    };
  }

  let syncedCount = 0;

  if (enrollmentId) {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId, userId },
    });
    if (enrollment) {
      await syncWorker.syncEnrollmentData(enrollment, userId);
      syncedCount = 1;
    }
  } else {
    const synced = await syncWorker.syncAllUserEnrollments(userId);
    syncedCount = Array.isArray(synced) ? synced.length : 0;
  }

  // Emit `bank.sync.completed` domain event so downstream consumers (e.g. Push) react independently
  if (syncedCount > 0) {
    try {
      await eventBus.publishEvent(eventBus.DomainEvents.BANK_SYNC_COMPLETED, {
        userId,
        enrollmentId,
        source,
        syncedCount,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      sentryService.captureException(err, {
        service: 'queue.service',
        action: 'publishBankSyncCompleted',
        userId,
        source,
      });
    }
  }

  return {
    eventId: envelope?.id,
    userId,
    enrollmentId,
    source,
    status: 'completed',
    syncedCount,
  };
}

// Start the active RabbitMQ consumer for `budget_app.bank_sync_jobs`
async function startSyncConsumer() {
  return await eventBus.subscribeToEvents(
    SYNC_QUEUE_NAME,
    SUBSCRIBED_ROUTING_KEYS,
    async (envelope) => {
      await handleSyncEvent(envelope);
    },
    {
      prefetch: 5,
      arguments: { 'x-max-priority': PRIORITY_HIGH },
    }
  );
}

function getQueueConfig() {
  const { rabbitmqUrl } = getEnvConfig();
  return {
    rabbitmqUrl,
    exchangeName: eventBus.EVENTS_EXCHANGE,
    queueName: SYNC_QUEUE_NAME,
    routingKeys: [...SUBSCRIBED_ROUTING_KEYS],
    maxPriority: PRIORITY_HIGH,
  };
}

export = {
  SYNC_QUEUE_NAME,
  PRIORITY_HIGH,
  PRIORITY_WEBHOOK,
  PRIORITY_NORMAL,
  SUBSCRIBED_ROUTING_KEYS,
  enqueueUserSyncJob,
  handleSyncEvent,
  startSyncConsumer,
  getQueueConfig,
};
