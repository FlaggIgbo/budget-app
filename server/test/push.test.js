// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), PostgreSQL PushSubscription CRUD,
// RabbitMQ push queue retries/DLQ, Redis deduplication, and 404/410 self-healing tests
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const db = require('../models');
const { pushService, pushWorker, pushQueue } = require('../push_service');
const pushController = require('../controllers/push_service.controller');
const sentryService = require('../services/infrastructure/sentry.service');

// Helper: Generate a realistic browser PushSubscription.toJSON() + its private ECDH key
function createMockBrowserPushSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/sub_1') {
  const clientEcdh = crypto.createECDH('prime256v1');
  clientEcdh.generateKeys();
  const authSecret = crypto.randomBytes(16);

  return {
    clientEcdh,
    authSecret,
    json: {
      endpoint,
      expirationTime: null,
      keys: {
        p256dh: pushService.toBase64Url(clientEcdh.getPublicKey()),
        auth: pushService.toBase64Url(authSecret),
      },
    },
  };
}

// Helper: Decrypt an RFC 8291 / RFC 8188 aes128gcm ciphertext using the subscriber's private key
function decryptAes128GcmPayload(encryptedBuf, clientEcdh, authSecret) {
  const salt = encryptedBuf.subarray(0, 16);
  const recordSize = encryptedBuf.readUInt32BE(16);
  assert.strictEqual(recordSize, 4096);
  const idLen = encryptedBuf[20];
  assert.strictEqual(idLen, 65);

  const serverPublicKey = encryptedBuf.subarray(21, 21 + idLen);
  const ciphertextAndTag = encryptedBuf.subarray(21 + idLen);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);
  const authTag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);

  const sharedSecret = clientEcdh.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    clientEcdh.getPublicKey(),
    serverPublicKey,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)
  );

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(authTag);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Strip trailing RFC 8188 0x02 delimiter
  assert.strictEqual(padded[padded.length - 1], 0x02);
  return padded.subarray(0, padded.length - 1).toString('utf8');
}

describe('Web Push Cryptography (RFC 8291 aes128gcm & RFC 8292 VAPID ES256)', () => {
  it('generates valid VAPID P-256 keys and signs ES256 Authorization JWTs verifiable by public key', () => {
    const keys = pushService.generateVapidKeys();
    const pubBuf = pushService.fromBase64Url(keys.publicKey);
    const privBuf = pushService.fromBase64Url(keys.privateKey);
    assert.strictEqual(pubBuf.length, 65);
    assert.strictEqual(pubBuf[0], 0x04);
    assert.strictEqual(privBuf.length, 32);

    const endpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint';
    const header = pushService.createVapidAuthHeader(endpoint, {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'mailto:alerts@budgetapp.local',
    });

    assert.ok(header.startsWith('vapid t='));
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(match, 'expected vapid t=<jwt>, k=<pubkey> format');
    assert.strictEqual(match[2], keys.publicKey);

    const [encodedHeader, encodedPayload, encodedSig] = match[1].split('.');
    const parsedHeader = JSON.parse(pushService.fromBase64Url(encodedHeader).toString('utf8'));
    const parsedPayload = JSON.parse(pushService.fromBase64Url(encodedPayload).toString('utf8'));
    assert.strictEqual(parsedHeader.alg, 'ES256');
    assert.strictEqual(parsedHeader.typ, 'JWT');
    assert.strictEqual(parsedPayload.aud, 'https://fcm.googleapis.com');
    assert.strictEqual(parsedPayload.sub, 'mailto:alerts@budgetapp.local');

    const publicKeyObj = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pushService.toBase64Url(pubBuf.subarray(1, 33)),
        y: pushService.toBase64Url(pubBuf.subarray(33, 65)),
      },
      format: 'jwk',
    });

    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      { key: publicKeyObj, dsaEncoding: 'ieee-p1363' },
      pushService.fromBase64Url(encodedSig)
    );
    assert.strictEqual(verified, true);
  });

  it('encrypts notification payloads per RFC 8291 aes128gcm so the subscriber decrypts exact JSON', () => {
    const mockSub = createMockBrowserPushSubscription();
    const notification = {
      title: 'Bank accounts synced',
      body: 'Updated balances across 2 banks.',
      url: '/dashboard',
    };

    const encrypted = pushService.encryptPayload(
      notification,
      mockSub.json.keys.p256dh,
      mockSub.json.keys.auth
    );

    const decryptedText = decryptAes128GcmPayload(
      encrypted,
      mockSub.clientEcdh,
      mockSub.authSecret
    );
    assert.deepStrictEqual(JSON.parse(decryptedText), notification);
  });

  it('validates MDN PushSubscription.toJSON() payloads strictly', () => {
    const valid = createMockBrowserPushSubscription();
    assert.strictEqual(pushService.validatePushSubscriptionPayload(valid.json).error, undefined);

    assert.ok(pushService.validatePushSubscriptionPayload(null).error);
    assert.ok(
      pushService.validatePushSubscriptionPayload({ endpoint: 'http://insecure.example/push' })
        .error
    );
    assert.ok(
      pushService.validatePushSubscriptionPayload({
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'short', auth: valid.json.keys.auth },
      }).error
    );
    assert.ok(
      pushService.validatePushSubscriptionPayload({
        endpoint: 'https://push.example/1',
        keys: { p256dh: valid.json.keys.p256dh, auth: 'short' },
      }).error
    );
  });
});

describe('PostgreSQL PushSubscription Storage, RabbitMQ Push Queue & Self-Healing Cleanup', () => {
  const originalUpsert = db.PushSubscription.upsert;
  const originalFindOne = db.PushSubscription.findOne;
  const originalFindAll = db.PushSubscription.findAll;
  const originalDestroy = db.PushSubscription.destroy;
  const originalUpdate = db.PushSubscription.update;

  let subsByEndpoint;

  function makeSubRecord(data) {
    const record = {
      id: data.id || crypto.randomUUID(),
      userId: data.userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      expirationTime: data.expirationTime ?? null,
      userAgent: data.userAgent ?? null,
      lastUsedAt: data.lastUsedAt ?? null,
      createdAt: data.createdAt || new Date(),
      update: async (patch) => {
        Object.assign(record, patch);
        return record;
      },
    };
    return record;
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    subsByEndpoint = new Map();
    pushQueue.clearPendingPushJobs();
    pushWorker.clearMemoryDedupeStore();
    pushWorker.setClient(null);
    pushService.setFetchImpl(null);
    sentryService.clearCapturedEvents();

    db.PushSubscription.upsert = async (data) => {
      const existing = subsByEndpoint.get(data.endpoint);
      if (existing) {
        Object.assign(existing, data);
        return [existing, false];
      }
      const created = makeSubRecord(data);
      subsByEndpoint.set(created.endpoint, created);
      return [created, true];
    };

    db.PushSubscription.findOne = async ({ where }) => {
      if (where.endpoint) {
        return subsByEndpoint.get(where.endpoint) || null;
      }
      return null;
    };

    db.PushSubscription.findAll = async ({ where = {} } = {}) => {
      const results = [];
      for (const sub of subsByEndpoint.values()) {
        if (where.userId && sub.userId !== where.userId) {
          continue;
        }
        if (where.endpoint) {
          if (Array.isArray(where.endpoint)) {
            if (!where.endpoint.includes(sub.endpoint)) continue;
          } else if (sub.endpoint !== where.endpoint) {
            continue;
          }
        }
        results.push(sub);
      }
      return results;
    };

    db.PushSubscription.destroy = async ({ where = {} } = {}) => {
      let deleted = 0;
      for (const [ep, sub] of Array.from(subsByEndpoint.entries())) {
        const matchUser = !where.userId || sub.userId === where.userId;
        const matchEndpoint = !where.endpoint || sub.endpoint === where.endpoint;
        if (matchUser && matchEndpoint) {
          subsByEndpoint.delete(ep);
          deleted += 1;
        }
      }
      return deleted;
    };

    db.PushSubscription.update = async (patch, { where = {} } = {}) => {
      let updated = 0;
      for (const sub of subsByEndpoint.values()) {
        if (where.id && sub.id === where.id) {
          Object.assign(sub, patch);
          updated += 1;
        }
      }
      return [updated];
    };
  });

  afterEach(() => {
    db.PushSubscription.upsert = originalUpsert;
    db.PushSubscription.findOne = originalFindOne;
    db.PushSubscription.findAll = originalFindAll;
    db.PushSubscription.destroy = originalDestroy;
    db.PushSubscription.update = originalUpdate;
    pushService.setFetchImpl(null);
    pushWorker.setClient(null);
    pushQueue.clearPendingPushJobs();
  });

  it('stores PushSubscriptions in PostgreSQL, hides encryption secrets in public output, and self-heals 404/410 Gone endpoints', async () => {
    const userId = 'usr_push_1';
    const healthyDevice = createMockBrowserPushSubscription(
      'https://fcm.googleapis.com/fcm/send/healthy'
    );
    const staleDevice = createMockBrowserPushSubscription(
      'https://fcm.googleapis.com/fcm/send/stale-410'
    );

    const saved = await pushService.saveSubscription(userId, healthyDevice.json, 'Chrome PWA');
    assert.strictEqual(saved.endpoint, healthyDevice.json.endpoint);
    assert.strictEqual(saved.p256dh, undefined, 'must never expose p256dh in public response');
    assert.strictEqual(saved.auth, undefined, 'must never expose auth in public response');

    await pushService.saveSubscription(userId, staleDevice.json, 'Old Safari');
    assert.strictEqual((await pushService.listUserSubscriptions(userId)).length, 2);

    const fetchCalls = [];
    pushService.setFetchImpl(async (url, init) => {
      fetchCalls.push({ url, init });
      if (url.includes('stale-410')) {
        return { status: 410 };
      }
      return { status: 201 };
    });

    await pushQueue.enqueuePushNotificationJob(userId, {
      title: 'Bank synced',
      body: '2 accounts refreshed',
      url: '/dashboard',
    });

    const result = await pushQueue.processNextPushJob();
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.deliveredCount, 1);
    assert.strictEqual(result.prunedCount, 1);
    assert.strictEqual(fetchCalls.length, 2);

    // Self-healing verification: stale 410 device was automatically removed from PostgreSQL
    const remaining = await pushService.listUserSubscriptions(userId);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].endpoint, healthyDevice.json.endpoint);
    assert.ok(remaining[0].lastUsedAt, 'healthy subscription should record lastUsedAt');

    // Verify wire payload was valid RFC 8291 aes128gcm encrypted JSON
    const healthyCall = fetchCalls.find((c) => c.url === healthyDevice.json.endpoint);
    assert.strictEqual(healthyCall.init.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(healthyCall.init.headers.Authorization.startsWith('vapid t='));
    const decrypted = JSON.parse(
      decryptAes128GcmPayload(
        healthyCall.init.body,
        healthyDevice.clientEcdh,
        healthyDevice.authSecret
      )
    );
    assert.strictEqual(decrypted.title, 'Bank synced');
    assert.strictEqual(decrypted.url, '/dashboard');
  });

  it('retries transient 429/503 push failures and routes exhausted jobs to RabbitMQ DLQ', async () => {
    const userId = 'usr_push_retry';
    const device = createMockBrowserPushSubscription(
      'https://updates.push.services.mozilla.com/wpush/v2/sub_retry'
    );
    await pushService.saveSubscription(userId, device.json, 'Firefox');

    pushService.setFetchImpl(async () => ({ status: 503 }));

    await pushQueue.enqueuePushNotificationJob(
      userId,
      { title: 'Alert', body: 'Temporary outage test' },
      { maxRetries: 2 }
    );

    const attempt0 = await pushQueue.processNextPushJob();
    assert.strictEqual(attempt0.status, 'requeued');
    assert.strictEqual(attempt0.nextAttempt, 1);
    assert.strictEqual(pushQueue.getPendingPushJobs().length, 1);

    const attempt1 = await pushQueue.processNextPushJob();
    assert.strictEqual(attempt1.status, 'requeued');
    assert.strictEqual(attempt1.nextAttempt, 2);

    const attempt2 = await pushQueue.processNextPushJob();
    assert.strictEqual(attempt2.status, 'dead_lettered');
    assert.strictEqual(pushQueue.getPendingPushJobs().length, 0);
    assert.strictEqual(pushQueue.getDeadLetterPushJobs().length, 1);
    assert.strictEqual(pushQueue.getDeadLetterPushJobs()[0].queue, pushQueue.PUSH_DLQ_NAME);
    assert.strictEqual(sentryService.getCapturedEvents().length, 1);
  });

  it('deduplicates duplicate notification events via Redis TTL key', async () => {
    const userId = 'usr_push_dedupe';
    const device = createMockBrowserPushSubscription('https://fcm.googleapis.com/fcm/send/dedupe');
    await pushService.saveSubscription(userId, device.json);

    let sendCount = 0;
    pushService.setFetchImpl(async () => {
      sendCount += 1;
      return { status: 201 };
    });

    await pushQueue.enqueuePushNotificationJob(
      userId,
      { title: 'Sync complete', body: 'Done' },
      { dedupeKey: 'sync:daily:2026-11-20' }
    );
    await pushQueue.enqueuePushNotificationJob(
      userId,
      { title: 'Sync complete', body: 'Done' },
      { dedupeKey: 'sync:daily:2026-11-20' }
    );

    const first = await pushQueue.processNextPushJob();
    const second = await pushQueue.processNextPushJob();

    assert.strictEqual(first.status, 'completed');
    assert.strictEqual(first.deliveredCount, 1);
    assert.strictEqual(second.status, 'deduplicated');
    assert.strictEqual(sendCount, 1);
  });

  it('handles subscribe, list, test, and unsubscribe through push.controller', async () => {
    const userId = 'usr_push_ctrl';
    const device = createMockBrowserPushSubscription('https://fcm.googleapis.com/fcm/send/ctrl');
    pushService.setFetchImpl(async () => ({ status: 201 }));

    const makeRes = () => {
      const out = { statusCode: 200, body: null };
      return {
        status(code) {
          out.statusCode = code;
          return this;
        },
        json(payload) {
          out.body = payload;
          return this;
        },
        out,
      };
    };

    // 1. VAPID public key
    const vapidRes = makeRes();
    pushController.getVapidPublicKey({}, vapidRes);
    assert.strictEqual(vapidRes.out.body.configured, true);
    assert.ok(vapidRes.out.body.vapidPublicKey);

    // 2. Subscribe
    const subRes = makeRes();
    await pushController.subscribe(
      { user: { id: userId }, body: device.json, get: () => 'TestBrowser/1.0' },
      subRes,
      (err) => {
        throw err;
      }
    );
    assert.strictEqual(subRes.out.statusCode, 201);
    assert.strictEqual(subRes.out.body.count, 1);

    // 3. Test notification via RabbitMQ
    const testRes = makeRes();
    await pushController.sendTestNotification({ user: { id: userId } }, testRes, (err) => {
      throw err;
    });
    assert.strictEqual(testRes.out.body.ok, true);
    assert.strictEqual(testRes.out.body.delivery.deliveredCount, 1);

    // 4. Unsubscribe
    const unsubRes = makeRes();
    await pushController.unsubscribe(
      { user: { id: userId }, body: { endpoint: device.json.endpoint } },
      unsubRes,
      (err) => {
        throw err;
      }
    );
    assert.strictEqual(unsubRes.out.body.ok, true);
    assert.strictEqual(unsubRes.out.body.removed, true);
    assert.strictEqual(unsubRes.out.body.count, 0);
  });
});
