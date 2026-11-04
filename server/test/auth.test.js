// Auth API tests
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Auth API', () => {
  let app;
  let db;
  let emailService;
  let sentEmails = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TELLER_ENVIRONMENT = 'sandbox';
    app = require('../app');
    db = require('../models');
    emailService = require('../services/email.service');

    emailService.setTransporter({
      sendMail: async (mailOptions) => {
        sentEmails.push(mailOptions);
        return { messageId: 'test-message-id' };
      },
    });

    await db.sequelize.sync({ force: true });
  });

  after(async () => {
    await db.sequelize.close();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.TELLER_ENVIRONMENT = 'sandbox';
    sentEmails = [];
  });

  describe('POST /api/auth/send-otp', () => {
    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({});
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.toLowerCase().includes('email'));
    });

    it('returns 400 when email is invalid', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ email: 'not-an-email' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 with valid email in sandbox', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ email: 'test@example.com' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });

    it('generates, stores, and emails 6-digit OTP in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'produser@example.com';
      const res = await request(app).post('/api/auth/send-otp').send({ email });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);

      const tokenRecord = await db.OtpToken.findOne({ where: { email } });
      assert.ok(tokenRecord, 'expected OTP token stored in database');
      assert.strictEqual(tokenRecord.code.length, 6);
      assert.ok(tokenRecord.expiresAt > new Date(), 'expected future expiration timestamp');

      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, email);
      assert.ok(sentEmails[0].text.includes(tokenRecord.code));
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({ otp: '123456' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when otp is missing', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'test@example.com' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 and sets cookie with sandbox credentials', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
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

    it('verifies stored OTP in production and deletes token upon match', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'verifyprod@example.com';
      await request(app).post('/api/auth/send-otp').send({ email });
      const tokenRecord = await db.OtpToken.findOne({ where: { email } });
      assert.ok(tokenRecord);

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email, otp: tokenRecord.code });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.user?.email, email);

      const remaining = await db.OtpToken.findOne({ where: { email } });
      assert.strictEqual(remaining, null, 'expected OTP token to be deleted after verification');
    });

    it('rejects expired OTP and deletes token', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TELLER_ENVIRONMENT = 'production';

      const email = 'expired@example.com';
      await db.OtpToken.create({
        email,
        code: '654321',
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

      const res = await request(app).post('/api/auth/verify-otp').send({ email, otp: '654321' });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error?.toLowerCase().includes('expired'));

      const remaining = await db.OtpToken.findOne({ where: { email } });
      assert.strictEqual(remaining, null);
    });
  });
});
