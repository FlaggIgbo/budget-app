// Auth, Signup Email OTP, Redis 1-Hour Sessions, RabbitMQ Login Priority, Profile Contact Changes & Password Stubs tests
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

describe('Auth API (Phone OTP, Signup Flow, Redis 1h Sessions, Profile Changes & Password Stubs)', () => {
  let app;
  let db;
  let emailService;
  let smsService;
  let otpService;
  let sessionService;
  let passwordService;
  let queueService;
  let bankService;
  let sentEmails = [];
  let sentSmsMessages = [];
  let fakeRedisStore = new Map();

  before(async () => {
    delete process.env.ENV;
    delete process.env.env;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'test';
    process.env.PLAID_ENV = 'sandbox';
    app = require('../app');
    db = require('../models');
    emailService = require('../services/email.service');
    smsService = require('../services/sms.service');
    otpService = require('../services/otp.service');
    sessionService = require('../services/session.service');
    passwordService = require('../services/password.service');
    queueService = require('../services/queue.service');
    bankService = require('../services/bank.service');

    // Mock email sender (used for signup email OTP & profile email change OTP)
    emailService.setTransporter({
      sendMail: async (mailOptions) => {
        sentEmails.push(mailOptions);
        return { messageId: 'test-message-id' };
      },
    });

    // Mock Twilio SMS sender (used for phone login OTP & profile phone change OTP)
    smsService.setSmsSender({
      sendSms: async (smsOptions) => {
        sentSmsMessages.push(smsOptions);
        return { sid: 'SM_TEST_123' };
      },
    });

    // Shared mock Redis client for 5-min OTP codes, 15-min signup tokens, and 1-hour Auth Sessions
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
    delete process.env.ENV;
    delete process.env.env;
    delete process.env.VERCEL_ENV;
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

  describe('POST /api/otp/verify & New Account Signup Flow', () => {
    it('returns 400 when phone is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ otp: '123456' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 400 when otp is missing', async () => {
      const res = await request(app).post('/api/otp/verify').send({ phone: '+15551234567' });
      assert.strictEqual(res.status, 400);
    });

    it('returns requiresSignup: true and signupToken without creating user when phone has no account', async () => {
      const newPhone = '+15559990001';
      const res = await request(app)
        .post('/api/otp/verify')
        .send({ phone: newPhone, otp: '123456' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.requiresSignup, true);
      assert.strictEqual(res.body.phone, newPhone);
      assert.ok(res.body.signupToken, 'expected signupToken for uncreated phone');
      assert.strictEqual(res.headers['set-cookie'], undefined, 'should not set session cookie yet');

      const dbUser = await db.User.findOne({ where: { phone: newPhone } });
      assert.strictEqual(dbUser, null, 'user must not be created until signup email OTP succeeds');
    });

    it('completes new-user signup after email OTP verification, creates user in DB, and issues 1h Redis session', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const phone = '+15554445555';
      const email = 'newuser@example.com';

      // Step 1: Request & verify phone OTP -> requiresSignup: true
      await request(app).post('/api/otp/request').send({ phone });
      const phoneCode = await otpService.getOtp(phone);
      assert.ok(phoneCode);

      const verifyRes = await request(app).post('/api/otp/verify').send({ phone, otp: phoneCode });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.body.requiresSignup, true);
      const signupToken = verifyRes.body.signupToken;
      assert.ok(signupToken);

      // Verify phone OTP was deleted after match
      assert.strictEqual(await otpService.getOtp(phone), null);

      // Step 2: Request email OTP on signup page
      const emailOtpReq = await request(app)
        .post('/api/auth/signup/request-email-otp')
        .send({ signupToken, email });
      assert.strictEqual(emailOtpReq.status, 200);
      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, email);

      // Step 3: Wrong email OTP must be rejected (401) and NOT create user in DB
      const badSignup = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        firstName: 'Jordan',
        lastName: 'Lee',
        email,
        code: '000000',
      });
      assert.strictEqual(badSignup.status, 401);
      assert.strictEqual(await db.User.findOne({ where: { phone } }), null);

      // Step 4: Missing first/last name returns 400
      const emailCode = await otpService.getOtp(email, 'signup');
      assert.ok(emailCode);

      const missingName = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        firstName: '',
        lastName: 'Lee',
        email,
        code: emailCode,
      });
      assert.strictEqual(missingName.status, 400);

      // Step 5: Valid email OTP + name creates user and issues 1h session + high-priority sync job
      const completeRes = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        firstName: 'Jordan',
        lastName: 'Lee',
        email,
        code: emailCode,
      });
      assert.strictEqual(completeRes.status, 201);
      assert.strictEqual(completeRes.body.ok, true);
      assert.strictEqual(completeRes.body.user?.firstName, 'Jordan');
      assert.strictEqual(completeRes.body.user?.lastName, 'Lee');
      assert.strictEqual(completeRes.body.user?.phone, phone);
      assert.strictEqual(completeRes.body.user?.email, email);
      assert.strictEqual(completeRes.body.user?.password, undefined);
      assert.ok(completeRes.headers['set-cookie']);

      // Confirm persisted in users table with nullable password column
      const persisted = await db.User.findOne({ where: { phone } });
      assert.ok(persisted);
      assert.strictEqual(persisted.firstName, 'Jordan');
      assert.strictEqual(persisted.lastName, 'Lee');
      assert.strictEqual(persisted.email, email);
      assert.strictEqual(persisted.password, null);

      // Confirm signup token and email OTP were consumed
      assert.strictEqual(await otpService.getPendingSignup(signupToken), null);
      assert.strictEqual(await otpService.getOtp(email, 'signup'), null);

      // Verify 1h session stored in Redis & high-priority sync job enqueued
      const sessionEntries = Array.from(fakeRedisStore.entries()).filter(([k]) =>
        k.startsWith('session:')
      );
      assert.strictEqual(sessionEntries.length, 1);
      assert.strictEqual(sessionEntries[0][1].ttl, 3600);

      const jobs = queueService.getPendingJobs();
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0].userId, persisted.id);
      assert.strictEqual(jobs[0].priority, queueService.PRIORITY_HIGH);
    });

    it('logs existing user directly into dashboard with 1-hour Redis session and high-priority login sync job', async () => {
      const existingUser = await db.User.create({
        firstName: 'Alex',
        lastName: 'Demo',
        phone: '+15551234567',
        email: 'alex@budgetapp.local',
      });

      const res = await request(app)
        .post('/api/otp/verify')
        .send({ phone: '+15551234567', otp: '123456' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.requiresSignup, false);
      assert.strictEqual(res.body.user?.id, existingUser.id);
      assert.strictEqual(res.body.user?.firstName, 'Alex');
      assert.strictEqual(res.body.user?.lastName, 'Demo');
      assert.strictEqual(res.body.user?.phone, '+15551234567');
      assert.strictEqual(res.body.user?.email, 'alex@budgetapp.local');
      assert.strictEqual(res.body.user?.password, undefined);

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
      assert.strictEqual(jobs[0].userId, existingUser.id);
      assert.strictEqual(jobs[0].source, 'login');
      assert.strictEqual(jobs[0].priority, queueService.PRIORITY_HIGH);

      // Verify /api/auth/me returns public user without password
      const cookie = res.headers['set-cookie'];
      const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.user?.email, 'alex@budgetapp.local');
      assert.strictEqual(meRes.body.user?.password, undefined);
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

  describe('Profile Change Email & Change Phone Number (OTP Required)', () => {
    it('allows authenticated user to change email and phone number only after OTP verification', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PLAID_ENV = 'production';

      const initialPhone = '+15552345678';
      const initialEmail = 'initial@example.com';

      const createdUser = await db.User.create({
        firstName: 'Taylor',
        lastName: 'Swift',
        phone: initialPhone,
        email: initialEmail,
      });

      // Log in via phone OTP
      await request(app).post('/api/otp/request').send({ phone: initialPhone });
      const loginCode = await otpService.getOtp(initialPhone);
      const loginRes = await request(app)
        .post('/api/otp/verify')
        .send({ phone: initialPhone, code: loginCode });
      assert.strictEqual(loginRes.status, 200);
      const cookie = loginRes.headers['set-cookie'];

      // Reject changing to the exact same email
      const sameEmailReq = await request(app)
        .post('/api/profile/contact/request-otp')
        .set('Cookie', cookie)
        .send({ type: 'email', email: initialEmail });
      assert.strictEqual(sameEmailReq.status, 400);

      // Step 1: Request OTP to change email address
      const updatedEmail = 'updated@example.com';
      const emailReq = await request(app)
        .post('/api/profile/contact/request-otp')
        .set('Cookie', cookie)
        .send({ type: 'email', email: updatedEmail });
      assert.strictEqual(emailReq.status, 200);
      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, updatedEmail);

      // Step 2: Reject wrong email OTP and do not update DB
      const badEmailVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ type: 'email', email: updatedEmail, code: '000000' });
      assert.strictEqual(badEmailVerify.status, 401);

      const profileBefore = await request(app).get('/api/profile').set('Cookie', cookie);
      assert.strictEqual(profileBefore.body.email, initialEmail);
      assert.strictEqual(profileBefore.body.firstName, 'Taylor');
      assert.strictEqual(profileBefore.body.lastName, 'Swift');

      // Step 3: Verify valid email OTP -> updates DB
      const emailOtp = await otpService.getOtp(updatedEmail, `contact:${createdUser.id}`);
      assert.ok(emailOtp);
      const goodEmailVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ type: 'email', email: updatedEmail, code: emailOtp });
      assert.strictEqual(goodEmailVerify.status, 200);
      assert.strictEqual(goodEmailVerify.body.user?.email, updatedEmail);

      // Step 4: Verify finance summary email stub resolves with the updated email
      const summaryResult = await bankService.sendFinanceSummaryToUserEmail(createdUser.id);
      assert.strictEqual(summaryResult.todo, true);
      assert.strictEqual(summaryResult.to, updatedEmail);

      // Step 5: Request OTP to change phone number
      const updatedPhone = '+15558765432';
      sentSmsMessages = [];
      const phoneReq = await request(app)
        .post('/api/profile/contact/request-otp')
        .set('Cookie', cookie)
        .send({ type: 'phone', phone: updatedPhone });
      assert.strictEqual(phoneReq.status, 200);
      assert.strictEqual(sentSmsMessages.length, 1);
      assert.strictEqual(sentSmsMessages[0].to, updatedPhone);

      // Step 6: Reject wrong phone OTP and do not update DB
      const badPhoneVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ type: 'phone', phone: updatedPhone, code: '000000' });
      assert.strictEqual(badPhoneVerify.status, 401);

      const profileMid = await request(app).get('/api/profile').set('Cookie', cookie);
      assert.strictEqual(profileMid.body.phone, initialPhone);

      // Step 7: Verify valid phone OTP -> updates phone in DB
      const phoneOtp = await otpService.getOtp(updatedPhone, `contact:${createdUser.id}`);
      assert.ok(phoneOtp);
      const goodPhoneVerify = await request(app)
        .post('/api/profile/contact/verify-otp')
        .set('Cookie', cookie)
        .send({ type: 'phone', phone: updatedPhone, code: phoneOtp });
      assert.strictEqual(goodPhoneVerify.status, 200);
      assert.strictEqual(goodPhoneVerify.body.user?.phone, updatedPhone);
      assert.strictEqual(goodPhoneVerify.body.user?.email, updatedEmail);
    });
  });

  describe('Password Authentication Stubs (Future Username/Password Login)', () => {
    it('exposes password service stubs and 501 login-password route stub', async () => {
      const hashRes = await passwordService.hashPassword('MySecret123!');
      assert.strictEqual(hashRes.todo, true);

      const verifyRes = await passwordService.verifyPassword('MySecret123!', 'hash');
      assert.strictEqual(verifyRes.todo, true);

      const resetReqRes = await passwordService.requestPasswordReset('alex@budgetapp.local');
      assert.strictEqual(resetReqRes.todo, true);

      const res = await request(app)
        .post('/api/auth/login-password')
        .send({ email: 'alex@budgetapp.local', password: 'MySecret123!' });
      assert.strictEqual(res.status, 501);
      assert.strictEqual(res.body.todo, true);
    });
  });
});
