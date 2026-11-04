// Auth API tests
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Auth API', () => {
  let app;
  let db;
  let emailService;
  let otpService;
  let sentEmails = [];
  let fakeRedisStore = new Map();

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TELLER_ENVIRONMENT = 'sandbox';
    app = require('../app');
    db = require('../models');
    emailService = require('../services/email.service');
    otpService = require('../services/otp.service');

    // Mock email sender
    emailService.setTransporter({
      sendMail: async (mailOptions) => {
        sentEmails.push(mailOptions);
        return { messageId: 'test-message-id' };
      },
    });

    // Mock Redis client with TTL tracking
    otpService.setClient({
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
    });

    await db.sequelize.sync({ force: true });
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.TELLER_ENVIRONMENT = 'sandbox';
    sentEmails = [];
    fakeRedisStore.clear();
  });

  describe('POST /api/otp/request', () => {
    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/otp/request').send({});
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.toLowerCase().includes('email'));
    });

    it('returns 400 when email is invalid', async () => {
      const res = await request(app).post('/api/otp/request').send({ email: 'not-an-email' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 with valid email in sandbox', async () => {
      const res = await request(app).post('/api/otp/request').send({ email: 'test@example.com' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });

    it('generates, stores in Redis with 5-min TTL, and emails 6-digit OTP in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'produser@example.com';
      const res = await request(app).post('/api/otp/request').send({ email });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);

      const redisEntry = fakeRedisStore.get(otpService.getOtpKey(email));
      assert.ok(redisEntry, 'expected OTP stored in Redis');
      assert.strictEqual(redisEntry.value.length, 6);
      assert.strictEqual(redisEntry.ttl, 300, 'expected 300-second (5-minute) TTL');

      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, email);
      assert.ok(sentEmails[0].text.includes(redisEntry.value));
    });
  });

  describe('POST /api/otp/verify', () => {
    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ otp: '123456' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when otp is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ email: 'test@example.com' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 and sets cookie with sandbox credentials', async () => {
      const res = await request(app)
        .post('/api/otp/verify')
        .send({ email: 'test@example.com', otp: '123456' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.ok(res.body.user?.id);
      assert.strictEqual(res.body.user?.email, 'test@example.com');
      const setCookie = res.headers['set-cookie'];
      let cookies = [];
      if (Array.isArray(setCookie)) {
        cookies = setCookie;
      } else if (setCookie) {
        cookies = [setCookie];
      }
      assert.ok(
        cookies.some((c) => c.includes('session')),
        'expected session cookie'
      );
    });

    it('verifies stored OTP from Redis in production and deletes key upon match', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'verifyprod@example.com';
      await request(app).post('/api/otp/request').send({ email });
      const code = await otpService.getOtp(email);
      assert.ok(code);

      const res = await request(app).post('/api/otp/verify').send({ email, otp: code });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.user?.email, email);

      const remaining = await otpService.getOtp(email);
      assert.strictEqual(remaining, null, 'expected OTP key to be deleted after verification');
    });

    it('rejects missing or expired OTP when Redis key has expired', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'expired@example.com';
      const res = await request(app).post('/api/otp/verify').send({ email, otp: '654321' });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error?.toLowerCase().includes('invalid or expired'));
    });
  });

  describe('POST /otp/request & POST /otp/verify (design flow)', () => {
    it('generates 6-digit code, SETs otp:{email} with TTL in Redis, sends via Nodemailer, then GET/DELs and issues session', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'designflow@example.com';
      const reqRes = await request(app).post('/otp/request').send({ email });
      assert.strictEqual(reqRes.status, 200);
      assert.strictEqual(reqRes.body.ok, true);

      const redisKey = `otp:${email}`;
      const redisEntry = fakeRedisStore.get(redisKey);
      assert.ok(redisEntry, 'expected code stored under otp:{email}');
      assert.match(redisEntry.value, /^\d{6}$/);
      assert.strictEqual(redisEntry.ttl, 300);

      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, email);
      assert.ok(sentEmails[0].text.includes(redisEntry.value));

      const verifyRes = await request(app)
        .post('/otp/verify')
        .send({ email, code: redisEntry.value });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.body.ok, true);
      assert.strictEqual(verifyRes.body.user?.email, email);
      assert.strictEqual(
        fakeRedisStore.has(redisKey),
        false,
        'expected DEL from Redis after verify'
      );
    });
  });
});
