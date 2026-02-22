/**
 * Health and config API tests.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Health & Config API', () => {
  let app;

  before(async () => {
    process.env.NODE_ENV = 'test';
    app = require('../app');
  });

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
    });
  });

  describe('GET /api/config', () => {
    it('returns teller config', async () => {
      const res = await request(app).get('/api/config');
      assert.strictEqual(res.status, 200);
      assert.ok('tellerApplicationId' in res.body);
      assert.ok('tellerEnvironment' in res.body);
    });

    it('includes authSandbox in sandbox mode', async () => {
      process.env.TELLER_ENVIRONMENT = 'sandbox';
      const res = await request(app).get('/api/config');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.authSandbox);
      assert.strictEqual(res.body.authSandbox.phone, '555-555-5555');
      assert.strictEqual(res.body.authSandbox.otp, '123456');
    });
  });
});
