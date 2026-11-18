// Auth, Redis 1-Hour Session Store, RabbitMQ Login Priority Queue, & Profile Email Linking tests
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Auth API (Phone OTP, Redis 1h Sessions, RabbitMQ Login Priority & Profile Email)', () => {
  let app;
  let db;
  let emailService;
  let smsService;
  let otpService;
  let sessionService;
  let queueService;
  let bankService;
  let sentEmails = [];
  let sentSmsMessages = [];
  let fakeRedisStore = new Map();

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PLAID_ENV = 'sandbox';
    app = require('../app');
    db = require('../models');
    emailService = require('../services/email.service');
    smsService = require('../services/sms.service');
    otpService = require('../services/otp.service');
    sessionService = require('../services/session.service');
    queueService = require('../services/queue.service');
    bankService = require('../services/bank.service');

    // Mock email sender (used for profile email OTP verification)
    emailService.setTransporter({
      sendMail: async (mailOptions) => {
        sentEmails.push(mailOptions);
        return { messageId: 'test-message-id' };
      },
    });

    // Mock Twilio SMS sender (used for phone login OTP)
    smsService.setSmsSender({
      sendSms: async (smsOptions) => {
        sentSmsMessages.push(smsOptions);
        return { sid: 'SM_TEST_123' };
      },
    });

    // Shared mock Redis client for both 5-min OTP codes and 1-hour (3600s) Auth Sessions
    const mockRedisClient = {
      set: async (key, value, options) => {
        fakeRedisStore.set(key, { value, ttl: options?.EX || null });
      },
      get: async (key) => {
        const entry = fakeRedisStore.get(key);
        return entry ? entry.value : null;
      },
      del: async (key) => {
        fakeRedisStore.delete(key);
      },
    };

    otpService.setClient(mockRedisClient);
    sessionService.setClient(mockRedisClient);

    await db.sequelize.sync({ force: true });
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PLAID_ENV = 'sandbox';
    sentEmails = [];
    sentSmsMessages = [];
    fakeRedisStore.clear();
    queueService.clearPendingJobs();
  });

  describe('POST /api/otp/request (Phone-only Login)', () => {
    it('returns 400 when phone is missing', async () => {
      const res = await request(app).post('/api/otp/request').send({});
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.toLowerCase().includes('phone'));
    });

    it('returns 400 when phone is invalid', async () => {
      const res = await request(app).post('/api/otp/request').send({ phone: '123' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 with valid phone in sandbox', async () => {
      const res = await request(app).post('/api/otp/request').send({ phone: '+15551234567' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });

    it('generates, stores in Redis with 5-min TTL, and sends SMS 6-digit OTP in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const phone = '+15552223333';
      const res = await request(app).post('/api/otp/request').send({ phone });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);

      const redisEntry = fakeRedisStore.get(otpService.getOtpKey(phone));
      assert.ok(redisEntry, 'expected OTP stored in Redis');
      assert.strictEqual(redisEntry.value.length, 6);
      assert.strictEqual(redisEntry.ttl, 300, 'expected 300-second (5-minute) TTL');

      assert.strictEqual(sentSmsMessages.length, 1);
      assert.strictEqual(sentSmsMessages[0].to, phone);
      assert.ok(sentSmsMessages[0].body.includes(redisEntry.value));
    });
  });

  describe('POST /api/otp/verify (Redis 1-Hour Session & High-Priority Login Sync Job)', () => {
    it('returns 400 when phone is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ otp: '123456' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when otp is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ phone: '+15551234567' });
      assert.strictEqual(res.status, 400);
    });

    it('stores session token in Redis with 1-hour (3600s) TTL and enqueues a high-priority RabbitMQ sync job on login', async () => {
      const res = await request(app)
        .post('/api/otp/verify')
        .send({ phone: '+15551234567', otp: '123456' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.ok(res.body.user?.id);
      assert.strictEqual(res.body.user?.phone, '+15551234567');

      // Verify session is stored in Redis with 1-hour (3600s) TTL
      const sessionEntries = Array.from(fakeRedisStore.entries()).filter(([k]) =>
        k.startsWith('session:')
      );
      assert.strictEqual(sessionEntries.length, 1, 'expected 1 session stored in Redis');
      const [, sessionRecord] = sessionEntries[0];
      assert.strictEqual(sessionRecord.ttl, 3600, 'expected 1-hour (3600s) TTL in Redis');

      // Verify prioritized RabbitMQ sync job was enqueued on login
      const jobs = queueService.getPendingJobs();
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0].userId, res.body.user.id);
      assert.strictEqual(jobs[0].source, 'login');
      assert.strictEqual(jobs[0].priority, queueService.PRIORITY_HIGH);
    });

    it('verifies stored SMS OTP from Redis in production and deletes OTP key upon match', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const phone = '+15554445555';
      await request(app).post('/api/otp/request').send({ phone });
      const code = await otpService.getOtp(phone);
      assert.ok(code);

      const res = await request(app).post('/api/otp/verify').send({ phone, otp: code });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.user?.phone, phone);

      const remaining = await otpService.getOtp(phone);
      assert.strictEqual(remaining, null, 'expected OTP key to be deleted after verification');
    });

    it('rejects missing or expired OTP when Redis key has expired', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const phone = '+15556667777';
      const res = await request(app).post('/api/otp/verify').send({ phone, otp: '654321' });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error?.toLowerCase().includes('invalid or expired'));
    });
  });

  describe('Profile Email Linking & Personal Finance Summary Stub', () => {
    it('allows phone-authenticated user to verify and add an email to their profile and call summary stub', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const rawPhone = '(555) 234-5678';
      const normalizedPhone = '+15552345678';

      // Step 1: Request & verify phone login OTP
      await request(app).post('/api/otp/request').send({ phone: rawPhone });
      const phoneOtp = await otpService.getOtp(normalizedPhone);

      const verifyRes = await request(app)
        .post('/api/otp/verify')
        .send({ phone: rawPhone, code: phoneOtp });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.body.user?.phone, normalizedPhone);
      assert.strictEqual(verifyRes.body.user?.email, null);
      const cookie = verifyRes.headers['set-cookie'];
      const userId = verifyRes.body.user.id;

      // Step 2: Request OTP to link an email address on the Profile page
      const newEmail = 'summary@example.com';
      const linkReq = await request(app)
        .post('/api/profile/contact/request-otp')
        .set('Cookie', cookie)
        .send({ email: newEmail });
      assert.strictEqual(linkReq.status, 200);
      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, newEmail);

      // Step 3: Attempt to verify with wrong OTP -> should fail with 401 and NOT update DB
      const badVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ email: newEmail, code: '000000' });
      assert.strictEqual(badVerify.status, 401);

      const profileBefore = await request(app).get('/api/profile').set('Cookie', cookie);
      assert.strictEqual(profileBefore.body.email, null);

      // Step 4: Verify with valid OTP -> upserts email into DB
      const emailOtp = await otpService.getOtp(newEmail);
      const goodVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ email: newEmail, code: emailOtp });
      assert.strictEqual(goodVerify.status, 200);
      assert.strictEqual(goodVerify.body.user?.email, newEmail);
      assert.strictEqual(goodVerify.body.user?.phone, normalizedPhone);

      // Step 5: Verify personal finance summary email stub resolves with the linked email
      const summaryResult = await bankService.sendFinanceSummaryToUserEmail(userId);
      assert.strictEqual(summaryResult.todo, true);
      assert.strictEqual(summaryResult.to, newEmail);
    });
  });
});
