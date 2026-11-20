const crypto = require('crypto');
const db = require('../models');
const { getEnvConfig } = require('../config/env.config');
const sentryService = require('../services/infrastructure/sentry.service');

// ============================================================================
// WEB PUSH SERVICE (RFC 8291 aes128gcm + RFC 8292 VAPID ES256)
// Uses Node.js built-in crypto and Fetch API (zero third-party push packages)
// to persist W3C PushSubscription records in PostgreSQL and deliver encrypted
// Web Push messages with automatic 404/410 self-healing cleanup.
// ============================================================================

const DEFAULT_VAPID_SUBJECT = 'mailto:support@budgetapp.local';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const RECORD_SIZE = 4096;

let ephemeralVapidKeys = null;
let customFetchImpl = null;

function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  if (!str || typeof str !== 'string') {
    throw new Error('Invalid base64url string');
  }
  const normalized = str.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Malformed base64url characters');
  }
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

// Generate an RFC 8292 P-256 VAPID keypair (65-byte uncompressed public key, 32-byte private key)
function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(ecdh.getPrivateKey()),
  };
}

// Resolve VAPID credentials from env (or auto-generate ephemeral dev/test keys outside production)
function getVapidConfig() {
  const envConfig = getEnvConfig();
  const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT).trim();

  if (envPublic && envPrivate) {
    return {
      configured: true,
      ephemeral: false,
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
    };
  }

  if (envConfig.isProduction) {
    return {
      configured: false,
      ephemeral: false,
      publicKey: null,
      privateKey: null,
      subject,
    };
  }

  if (!ephemeralVapidKeys) {
    ephemeralVapidKeys = generateVapidKeys();
  }

  return {
    configured: true,
    ephemeral: true,
    publicKey: ephemeralVapidKeys.publicKey,
    privateKey: ephemeralVapidKeys.privateKey,
    subject,
  };
}

function getVapidPublicKey() {
  return getVapidConfig().publicKey;
}

function resetEphemeralVapidKeys() {
  ephemeralVapidKeys = null;
}

function setFetchImpl(fn) {
  customFetchImpl = fn;
}

// Validate a standard MDN PushSubscription.toJSON() payload
function validatePushSubscriptionPayload(subscription) {
  if (!subscription || typeof subscription !== 'object') {
    return { error: 'PushSubscription object is required' };
  }

  const endpoint = typeof subscription.endpoint === 'string' ? subscription.endpoint.trim() : '';
  if (!endpoint) {
    return { error: 'PushSubscription endpoint is required' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return { error: 'PushSubscription endpoint must be a valid URL' };
  }

  const envConfig = getEnvConfig();
  const isHttpLocal =
    !envConfig.isProduction &&
    parsedUrl.protocol === 'http:' &&
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');

  if (parsedUrl.protocol !== 'https:' && !isHttpLocal) {
    return { error: 'PushSubscription endpoint must use HTTPS' };
  }

  const keys = subscription.keys;
  if (!keys || typeof keys !== 'object') {
    return { error: 'PushSubscription keys (p256dh and auth) are required' };
  }

  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

  if (!p256dh || !auth) {
    return { error: 'Both p256dh and auth keys are required' };
  }

  let p256dhBuf;
  let authBuf;
  try {
    p256dhBuf = fromBase64Url(p256dh);
    authBuf = fromBase64Url(auth);
  } catch {
    return { error: 'Invalid base64url encoding in PushSubscription keys' };
  }

  // Uncompressed P-256 public key is 65 bytes starting with 0x04
  if (p256dhBuf.length !== 65 || p256dhBuf[0] !== 0x04) {
    return { error: 'Invalid p256dh public key (expected 65-byte uncompressed P-256 point)' };
  }

  // Web Push auth secret must be 16 bytes
  if (authBuf.length !== 16) {
    return { error: 'Invalid auth secret (expected 16 bytes)' };
  }

  let expirationTime = null;
  if (subscription.expirationTime !== undefined && subscription.expirationTime !== null) {
    const parsedExp = Number(subscription.expirationTime);
    if (!Number.isFinite(parsedExp) || parsedExp < 0) {
      return { error: 'Invalid expirationTime' };
    }
    expirationTime = Math.floor(parsedExp);
  }

  return {
    endpoint,
    p256dh,
    auth,
    expirationTime,
  };
}

// Create an RFC 8292 ES256 VAPID Authorization header for a push endpoint
function createVapidAuthHeader(endpoint, vapidConfig = getVapidConfig()) {
  if (!vapidConfig || !vapidConfig.publicKey || !vapidConfig.privateKey) {
    throw new Error('VAPID keys are not configured');
  }

  const audience = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours
  const header = toBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = toBase64Url(
    JSON.stringify({
      aud: audience,
      exp,
      sub: vapidConfig.subject || DEFAULT_VAPID_SUBJECT,
    })
  );

  const publicKeyBuf = fromBase64Url(vapidConfig.publicKey);
  const privateKeyBuf = fromBase64Url(vapidConfig.privateKey);

  if (publicKeyBuf.length !== 65 || publicKeyBuf[0] !== 0x04) {
    throw new Error('Invalid VAPID public key');
  }
  if (privateKeyBuf.length !== 32) {
    throw new Error('Invalid VAPID private key');
  }

  const privateKeyObj = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(publicKeyBuf.subarray(1, 33)),
      y: toBase64Url(publicKeyBuf.subarray(33, 65)),
      d: toBase64Url(privateKeyBuf),
    },
    format: 'jwk',
  });

  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKeyObj,
    dsaEncoding: 'ieee-p1363',
  });

  const jwt = `${signingInput}.${toBase64Url(signature)}`;
  return `vapid t=${jwt}, k=${vapidConfig.publicKey}`;
}

// Encrypt a Web Push payload according to RFC 8291 & RFC 8188 (Content-Encoding: aes128gcm)
function encryptPayload(payloadInput, p256dhBase64Url, authBase64Url) {
  const plaintext = Buffer.isBuffer(payloadInput)
    ? payloadInput
    : Buffer.from(
        typeof payloadInput === 'string' ? payloadInput : JSON.stringify(payloadInput),
        'utf8'
      );

  const userPublicKey = fromBase64Url(p256dhBase64Url);
  const userAuth = fromBase64Url(authBase64Url);

  const serverEcdh = crypto.createECDH('prime256v1');
  serverEcdh.generateKeys();
  const serverPublicKey = serverEcdh.getPublicKey();
  const sharedSecret = serverEcdh.computeSecret(userPublicKey);

  // RFC 8291 Section 3.3: IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0" || ua_public || as_public, L=32)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKey,
    serverPublicKey,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, userAuth, keyInfo, 32));

  // RFC 8188 Section 2.2 & 2.3: derive 16-byte CEK and 12-byte nonce using a random 16-byte salt
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)
  );

  // RFC 8188 Section 2: single final record delimited by 0x02
  const paddedPlaintext = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(paddedPlaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 Section 2.1 header: salt (16) || rs (4, uint32BE) || idlen (1) || keyid (65)
  const recordSizeBuf = Buffer.alloc(4);
  recordSizeBuf.writeUInt32BE(RECORD_SIZE, 0);

  return Buffer.concat([
    salt,
    recordSizeBuf,
    Buffer.from([serverPublicKey.length]),
    serverPublicKey,
    ciphertext,
  ]);
}

// ============================================================================
// POSTGRESQL PUSH SUBSCRIPTION CRUD & SELF-HEALING CLEANUP
// ============================================================================

async function saveSubscription(userId, subscriptionPayload, userAgent = null) {
  const validated = validatePushSubscriptionPayload(subscriptionPayload);
  if (validated.error) {
    const err = new Error(validated.error);
    err.status = 400;
    throw err;
  }

  const cleanUserAgent =
    typeof userAgent === 'string' && userAgent.trim() ? userAgent.trim().slice(0, 512) : null;

  const [record] = await db.PushSubscription.upsert(
    {
      userId,
      endpoint: validated.endpoint,
      p256dh: validated.p256dh,
      auth: validated.auth,
      expirationTime: validated.expirationTime,
      userAgent: cleanUserAgent,
    },
    {
      conflictFields: ['endpoint'],
      returning: true,
    }
  );

  // Re-fetch cleanly if dialect returns array without full fields
  const persisted =
    record && record.id
      ? record
      : await db.PushSubscription.findOne({ where: { endpoint: validated.endpoint } });

  return db.PushSubscription.toPublicSubscription(persisted);
}

async function removeSubscription(userId, endpoint) {
  if (!endpoint || typeof endpoint !== 'string') {
    return 0;
  }
  return await db.PushSubscription.destroy({
    where: {
      userId,
      endpoint: endpoint.trim(),
    },
  });
}

async function listUserSubscriptions(userId) {
  const rows = await db.PushSubscription.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
  });
  return rows.map((row) => db.PushSubscription.toPublicSubscription(row));
}

// Self-healing cleanup: remove stale/revoked PushSubscription rows reported as 404/410 Gone
async function pruneStaleSubscriptionByEndpoint(endpoint) {
  if (!endpoint) {
    return 0;
  }
  return await db.PushSubscription.destroy({
    where: { endpoint },
  });
}

// Deliver a single encrypted Web Push payload to one stored PushSubscription
async function sendToSubscription(subscription, notificationPayload, options = {}) {
  const vapidConfig = getVapidConfig();
  if (!vapidConfig.configured) {
    return {
      endpoint: subscription.endpoint,
      status: 'failed',
      statusCode: 0,
      error: 'VAPID keys are not configured',
    };
  }

  const fetchFn = customFetchImpl || global.fetch;
  const ttl = Number.isFinite(options.ttl)
    ? Math.max(0, Math.floor(options.ttl))
    : DEFAULT_TTL_SECONDS;
  const urgency = options.urgency || 'normal';

  let encryptedBody;
  let authHeader;
  try {
    encryptedBody = encryptPayload(notificationPayload, subscription.p256dh, subscription.auth);
    authHeader = createVapidAuthHeader(subscription.endpoint, vapidConfig);
  } catch (err) {
    sentryService.captureException(err, {
      service: 'push.service',
      action: 'encryptOrSign',
      endpoint: subscription.endpoint,
    });
    return {
      endpoint: subscription.endpoint,
      status: 'failed',
      statusCode: 0,
      error: err.message,
    };
  }

  let response;
  try {
    response = await fetchFn(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(encryptedBody.length),
        TTL: String(ttl),
        Urgency: urgency,
      },
      body: encryptedBody,
    });
  } catch (err) {
    return {
      endpoint: subscription.endpoint,
      status: 'retryable',
      statusCode: 0,
      error: err?.message || 'Push service network error',
    };
  }

  const statusCode = response.status;

  // 2xx: Delivered successfully
  if (statusCode >= 200 && statusCode < 300) {
    try {
      if (typeof subscription.update === 'function') {
        await subscription.update({ lastUsedAt: new Date() });
      } else if (subscription.id) {
        await db.PushSubscription.update(
          { lastUsedAt: new Date() },
          { where: { id: subscription.id } }
        );
      }
    } catch {
      // Non-fatal metadata update failure
    }
    return {
      endpoint: subscription.endpoint,
      status: 'delivered',
      statusCode,
    };
  }

  // 404 Not Found / 410 Gone: Subscription expired or revoked — self-heal PostgreSQL immediately
  if (statusCode === 404 || statusCode === 410) {
    await pruneStaleSubscriptionByEndpoint(subscription.endpoint);
    return {
      endpoint: subscription.endpoint,
      status: 'pruned',
      statusCode,
    };
  }

  // 429 Too Many Requests or 5xx: Transient failure eligible for RabbitMQ retry / backoff
  if (statusCode === 429 || statusCode >= 500) {
    return {
      endpoint: subscription.endpoint,
      status: 'retryable',
      statusCode,
      error: `Transient push service error (${statusCode})`,
    };
  }

  // Other 4xx: Permanent failure (e.g., invalid VAPID or payload too large)
  return {
    endpoint: subscription.endpoint,
    status: 'failed',
    statusCode,
    error: `Push service rejected request (${statusCode})`,
  };
}

module.exports = {
  DEFAULT_VAPID_SUBJECT,
  DEFAULT_TTL_SECONDS,
  toBase64Url,
  fromBase64Url,
  generateVapidKeys,
  getVapidConfig,
  getVapidPublicKey,
  resetEphemeralVapidKeys,
  setFetchImpl,
  validatePushSubscriptionPayload,
  createVapidAuthHeader,
  encryptPayload,
  saveSubscription,
  removeSubscription,
  listUserSubscriptions,
  pruneStaleSubscriptionByEndpoint,
  sendToSubscription,
};
