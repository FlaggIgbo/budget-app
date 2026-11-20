const crypto = require('crypto');
const { createClient } = require('redis');
const db = require('../../models');
const queueService = require('../jobs/queue.service');

// ============================================================================
// REDIS SESSION SERVICE
// Stores auth session tokens in Redis under `session:{token}` with a 1-hour TTL
// (3,600 seconds) and enqueues a high-priority RabbitMQ sync job on login.
// ============================================================================

const SESSION_PREFIX = 'session:';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60; // 1 hour (3,600 seconds)

let redisClient = null;
const memoryFallbackStore = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSessionKey(token) {
  return SESSION_PREFIX + token;
}

function getSessionTtlSeconds() {
  return parseInt(process.env.SESSION_TTL_SECONDS || String(DEFAULT_SESSION_TTL_SECONDS), 10);
}

// Get or connect to Redis client (falls back to in-memory store in test environment if not mocked)
async function getClient() {
  if (redisClient) {
    return redisClient;
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      set: async (key, value, options) => {
        const ttl = options?.EX || getSessionTtlSeconds();
        memoryFallbackStore.set(key, {
          value,
          ttl,
          expiresAt: Date.now() + ttl * 1000,
        });
      },
      get: async (key) => {
        const entry = memoryFallbackStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          memoryFallbackStore.delete(key);
          return null;
        }
        return entry.value;
      },
      del: async (key) => {
        memoryFallbackStore.delete(key);
      },
    };
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = createClient({ url });

  client.on('error', (err) => {
    console.error('Redis session error:', err.message);
  });

  await client.connect();
  redisClient = client;
  return redisClient;
}

// Allow overriding Redis client in tests
function setClient(customClient) {
  redisClient = customClient;
}

// Issue a new 1-hour session token in Redis for an existing User record
// and enqueue a prioritized RabbitMQ balance/transaction sync job
async function issueSessionForUser(user) {
  if (!user || !user.id) {
    throw new Error('Valid user record is required to issue a session');
  }

  const token = generateToken();
  const ttlSeconds = getSessionTtlSeconds();
  const client = await getClient();

  await client.set(getSessionKey(token), JSON.stringify({ userId: user.id }), {
    EX: ttlSeconds,
  });

  // Trigger prioritized RabbitMQ balance/transaction sync job upon successful login
  try {
    await queueService.enqueueUserSyncJob(user.id, {
      source: 'login',
      priority: queueService.PRIORITY_HIGH,
    });
  } catch {
    // Allow login to succeed even if RabbitMQ is unreachable
  }

  return {
    token,
    ttlSeconds,
    user: db.User.toPublicUser(user),
  };
}

// Issue a session for an existing user identified by phone number
async function issueSession(phoneInput) {
  const phone = typeof phoneInput === 'string' ? phoneInput : phoneInput?.phone;
  if (!phone) {
    throw new Error('Phone number is required to issue a session');
  }

  const user = await db.User.findOne({ where: { phone } });
  if (!user) {
    throw new Error('User account does not exist for this phone number');
  }

  return await issueSessionForUser(user);
}

// Look up a session token in Redis and verify the user still exists
async function verifySessionToken(token) {
  if (!token) {
    return { error: 'Not authenticated', status: 401 };
  }

  const client = await getClient();
  const rawSession = await client.get(getSessionKey(token));
  if (!rawSession) {
    return { error: 'Invalid or expired session', status: 401 };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawSession);
  } catch {
    parsed = { userId: rawSession };
  }

  if (!parsed || !parsed.userId) {
    await client.del(getSessionKey(token));
    return { error: 'Invalid session', status: 401 };
  }

  const user = await db.User.findByPk(parsed.userId, {
    attributes: [
      'id',
      'firstName',
      'lastName',
      'phone',
      'email',
      'passkeyCredentialId',
      'passkeyCreatedAt',
    ],
  });

  if (!user) {
    await client.del(getSessionKey(token));
    return { error: 'Invalid session', status: 401 };
  }

  return {
    user,
    session: {
      token,
      userId: user.id,
    },
  };
}

// Delete a session token from Redis on logout
async function revokeSession(token) {
  if (token) {
    const client = await getClient();
    await client.del(getSessionKey(token));
  }
}

module.exports = {
  SESSION_PREFIX,
  DEFAULT_SESSION_TTL_SECONDS,
  generateToken,
  getSessionKey,
  getSessionTtlSeconds,
  getClient,
  setClient,
  issueSessionForUser,
  issueSession,
  verifySessionToken,
  revokeSession,
};
