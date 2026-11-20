const { createClient } = require('redis');
const db = require('../models');
const pushService = require('./push.service');
const sentryService = require('../services/infrastructure/sentry.service');

// ============================================================================
// PUSH NOTIFICATION WORKER
// Consumes jobs from the RabbitMQ `budget_app.push_notifications` queue,
// optionally deduplicates/throttles via Redis TTL keys, queries PostgreSQL
// `push_subscriptions` for all active user devices, delivers encrypted Web Push
// notifications, and triggers self-healing cleanup on 404/410 Gone responses.
// ============================================================================

const DEDUPE_PREFIX = 'push:dedupe:';
const DEFAULT_DEDUPE_TTL_SECONDS = 5 * 60; // 5 minutes

let redisClient = null;
const memoryDedupeStore = new Map();

async function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      set: async (key, value, options) => {
        if (options?.NX && memoryDedupeStore.has(key)) {
          const existing = memoryDedupeStore.get(key);
          if (Date.now() <= existing.expiresAt) {
            return null;
          }
          memoryDedupeStore.delete(key);
        }
        const ttl = options?.EX || DEFAULT_DEDUPE_TTL_SECONDS;
        memoryDedupeStore.set(key, {
          value,
          expiresAt: Date.now() + ttl * 1000,
        });
        return 'OK';
      },
      get: async (key) => {
        const entry = memoryDedupeStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          memoryDedupeStore.delete(key);
          return null;
        }
        return entry.value;
      },
      del: async (key) => {
        memoryDedupeStore.delete(key);
      },
    };
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = createClient({ url });
  client.on('error', (err) => {
    console.error('Redis push dedupe error:', err.message);
  });
  await client.connect();
  redisClient = client;
  return redisClient;
}

function setClient(customClient) {
  redisClient = customClient;
}

function clearMemoryDedupeStore() {
  memoryDedupeStore.clear();
}

// Acquire a Redis dedupe lock for (userId, dedupeKey) so duplicate events don't spam devices
async function claimDedupeKey(userId, dedupeKey, ttlSeconds = DEFAULT_DEDUPE_TTL_SECONDS) {
  if (!dedupeKey) {
    return true;
  }

  try {
    const client = await getRedisClient();
    const key = `${DEDUPE_PREFIX}${userId}:${dedupeKey}`;
    const result = await client.set(key, '1', { NX: true, EX: ttlSeconds });
    return result === 'OK' || result === true;
  } catch (err) {
    // Fail open if Redis is unavailable so notifications still deliver
    sentryService.captureException(err, {
      service: 'push.worker',
      action: 'claimDedupeKey',
      userId,
      dedupeKey,
    });
    return true;
  }
}

// Process a single push notification job across all stored PostgreSQL devices for the user
async function processPushJob(job) {
  const { userId, notification, dedupeKey, dedupeTtlSeconds, targetEndpoints, attempt = 0 } = job;

  // Only enforce dedupe on the first delivery attempt (retries for transient failures must proceed)
  if (attempt === 0 && dedupeKey) {
    const claimed = await claimDedupeKey(userId, dedupeKey, dedupeTtlSeconds);
    if (!claimed) {
      return {
        ...job,
        status: 'deduplicated',
        deliveredCount: 0,
        prunedCount: 0,
        retryableEndpoints: [],
        failedEndpoints: [],
      };
    }
  }

  const where = { userId };
  if (Array.isArray(targetEndpoints) && targetEndpoints.length > 0) {
    where.endpoint = targetEndpoints;
  }

  const subscriptions = await db.PushSubscription.findAll({ where });

  if (subscriptions.length === 0) {
    return {
      ...job,
      status: 'no_subscriptions',
      deliveredCount: 0,
      prunedCount: 0,
      retryableEndpoints: [],
      failedEndpoints: [],
    };
  }

  const payload = {
    title: notification.title || 'Budget App',
    body: notification.body || '',
    url: notification.url || '/dashboard',
    tag: notification.tag || 'budget-app-notification',
    icon: notification.icon || '/icons/icon-192x192.png',
    badge: notification.badge || '/icons/icon-192x192.png',
    data: {
      url: notification.url || '/dashboard',
      ...(notification.data || {}),
    },
    sentAt: new Date().toISOString(),
  };

  let deliveredCount = 0;
  let prunedCount = 0;
  const retryableEndpoints = [];
  const failedEndpoints = [];

  for (let i = 0; i < subscriptions.length; i++) {
    const sub = subscriptions[i];
    const delivery = await pushService.sendToSubscription(sub, payload, {
      ttl: job.ttl,
      urgency: job.urgency,
    });

    if (delivery.status === 'delivered') {
      deliveredCount += 1;
    } else if (delivery.status === 'pruned') {
      prunedCount += 1;
    } else if (delivery.status === 'retryable') {
      retryableEndpoints.push({
        endpoint: sub.endpoint,
        statusCode: delivery.statusCode,
        error: delivery.error,
      });
    } else {
      failedEndpoints.push({
        endpoint: sub.endpoint,
        statusCode: delivery.statusCode,
        error: delivery.error,
      });
    }
  }

  return {
    ...job,
    status: retryableEndpoints.length > 0 ? 'retry_needed' : 'completed',
    deliveredCount,
    prunedCount,
    retryableEndpoints,
    failedEndpoints,
  };
}

module.exports = {
  DEDUPE_PREFIX,
  DEFAULT_DEDUPE_TTL_SECONDS,
  setClient,
  clearMemoryDedupeStore,
  claimDedupeKey,
  processPushJob,
};
