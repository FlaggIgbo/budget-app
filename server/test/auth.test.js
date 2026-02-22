/**
 * Auth API tests.
 * Run with: npm test (requires DB for full suite)
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Auth API', () => {
  let app;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TELLER_ENVIRONMENT = 'sandbox';
    app = require('../app');
  });

  describe('POST /api/auth/send-otp', () => {
    it('returns 400 when phone is missing', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({});
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.includes('phone'));
    });

    it('returns 400 when phone is too short', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ phone: '123' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 with valid phone in sandbox', async () => {
      const res = await request(app).post('/api/auth/send-otp').send({ phone: '555-555-5555' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    it('returns 400 when phone is missing', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({ otp: '123456' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when otp is missing', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({ phone: '555-555-5555' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 200 and sets cookie with sandbox credentials', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '555-555-5555', otp: '123456' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.ok(res.body.user?.id);
      assert.ok(res.body.user?.phone);
      assert.ok(res.headers['set-cookie']?.some((c) => c.includes('session')));
    });
  });
});
