// Health, Config, and Environment (Development vs. Production) API tests
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Health & Config API', () => {
  let app;

  before(async () => {
    process.env.NODE_ENV = 'test';
    app = require('../app');
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PLAID_ENV = 'sandbox';
  });

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
    });
  });

  describe('GET /api/config', () => {
    it('returns plaid and environment config (allowing sandbox or development in localhost dev)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.PLAID_ENV = 'development';

      const res = await request(app).get('/api/config');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.environment, 'development');
      assert.strictEqual(res.body.plaidEnvironment, 'development');
      assert.deepStrictEqual(res.body.allowedPlaidEnvironments, ['sandbox', 'development']);
      assert.strictEqual(res.body.storageProvider, 'minio');
    });

    it('includes authSandbox in sandbox mode', async () => {
      process.env.PLAID_ENV = 'sandbox';
      const res = await request(app).get('/api/config');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.authSandbox);
      assert.strictEqual(res.body.authSandbox.phone, '+15551234567');
      assert.strictEqual(res.body.authSandbox.otp, '123456');
    });
  });
});
