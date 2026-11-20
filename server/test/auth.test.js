// Auth, Passkeys (WebAuthn), Signup Email OTP, Redis 1-Hour Sessions, RabbitMQ Login Priority, Profile Contact Changes & Password Stubs tests
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('./helpers/httpClient');

// Minimal CBOR encoder for constructing genuine WebAuthn attestationObjects in tests
function encodeCborHeader(majorType, length) {
  const prefix = majorType << 5;
  if (length < 24) return Buffer.from([prefix | length]);
  if (length < 256) return Buffer.from([prefix | 24, length]);
  if (length < 65536) {
    const b = Buffer.alloc(3);
    b[0] = prefix | 25;
    b.writeUInt16BE(length, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = prefix | 26;
  b.writeUInt32BE(length, 1);
  return b;
}

function encodeCbor(val) {
  if (typeof val === 'number') {
    if (val >= 0) return encodeCborHeader(0, val);
    return encodeCborHeader(1, -1 - val);
  }
  if (Buffer.isBuffer(val)) {
    return Buffer.concat([encodeCborHeader(2, val.length), val]);
  }
  if (typeof val === 'string') {
    const b = Buffer.from(val, 'utf8');
    return Buffer.concat([encodeCborHeader(3, b.length), b]);
  }
  if (val instanceof Map) {
    const chunks = [encodeCborHeader(5, val.size)];
    for (const [k, v] of val.entries()) {
      chunks.push(encodeCbor(k), encodeCbor(v));
    }
    return Buffer.concat(chunks);
  }
  if (val && typeof val === 'object') {
    const entries = Object.entries(val);
    const chunks = [encodeCborHeader(5, entries.length)];
    for (const [k, v] of entries) {
      chunks.push(encodeCbor(k), encodeCbor(v));
    }
    return Buffer.concat(chunks);
  }
  throw new Error(`Unsupported test CBOR value: ${typeof val}`);
}

function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// Create a virtual WebAuthn ES256 authenticator keypair for tests
function createVirtualPasskey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialIdBuf = crypto.randomBytes(32);
  const credentialId = toBase64Url(credentialIdBuf);

  const coseKey = new Map([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);

  return {
    credentialId,
    credentialIdBuf,
    privateKey,
    buildRegistrationCredential(options, origin = 'http://localhost:4200') {
      const rpIdHash = crypto.createHash('sha256').update(options.rp.id).digest();
      const flags = Buffer.from([0x41]); // UP + AT
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(1, 0);
      const aaguid = Buffer.alloc(16, 0);
      const credIdLen = Buffer.alloc(2);
      credIdLen.writeUInt16BE(credentialIdBuf.length, 0);
      const coseBytes = encodeCbor(coseKey);

      const authData = Buffer.concat([
        rpIdHash,
        flags,
        signCount,
        aaguid,
        credIdLen,
        credentialIdBuf,
        coseBytes,
      ]);

      const attestationObject = encodeCbor(
        new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );

      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.challenge,
          origin,
        }),
        'utf8'
      );

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          attestationObject: toBase64Url(attestationObject),
          transports: ['internal'],
        },
      };
    },
    buildAssertionCredential(options, { origin = 'http://localhost:4200', counter = 2 } = {}) {
      const rpIdHash = crypto
        .createHash('sha256')
        .update(options.rpId || 'localhost')
        .digest();
      const flags = Buffer.from([0x05]); // UP + UV
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(counter, 0);
      const authData = Buffer.concat([rpIdHash, flags, signCount]);

      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin,
        }),
        'utf8'
      );

      const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
      const signedData = Buffer.concat([authData, clientDataHash]);
      const signature = crypto.sign('sha256', signedData, privateKey);

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authData),
          signature: toBase64Url(signature),
          userHandle: null,
        },
      };
    },
  };
}

describe('Auth API (Phone OTP, Passkey WebAuthn, Signup Flow, Redis 1h Sessions, Profile & Password Stubs)', () => {
  let app;
  let db;
  let emailService;
  let smsService;
  let otpService;
  let passkeyService;
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
    emailService = require('../services/communications/email.service');
    smsService = require('../services/communications/sms.service');
    otpService = require('../services/authentication/otp.service');
    passkeyService = require('../services/authentication/passkey.service');
    sessionService = require('../services/authentication/session.service');
    passwordService = require('../services/authentication/password.service');
    queueService = require('../services/jobs/queue.service');
    bankService = require('../services/banking/bank.service');

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

    // Shared mock Redis client for 5-min OTP codes, passkey challenges, signup tokens, and 1h Auth Sessions
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
    passkeyService.setClient(mockRedisClient);
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
      const badVerify = await request(app).post('/api/auth/signup/verify-email-otp').send({
        signupToken,
        firstName: 'Jordan',
        lastName: 'Lee',
        email,
        code: '000000',
      });
      assert.strictEqual(badVerify.status, 401);
      assert.strictEqual(await db.User.findOne({ where: { phone } }), null);

      // Step 4: Missing first/last name returns 400
      const emailCode = await otpService.getOtp(email, 'signup');
      assert.ok(emailCode);

      const missingName = await request(app).post('/api/auth/signup/verify-email-otp').send({
        signupToken,
        firstName: '',
        lastName: 'Lee',
        email,
        code: emailCode,
      });
      assert.strictEqual(missingName.status, 400);

      // Step 5: Verify email OTP -> advances to passkey creation step
      const emailVerifiedRes = await request(app).post('/api/auth/signup/verify-email-otp').send({
        signupToken,
        firstName: 'Jordan',
        lastName: 'Lee',
        email,
        code: emailCode,
      });
      assert.strictEqual(emailVerifiedRes.status, 200);
      assert.strictEqual(emailVerifiedRes.body.emailVerified, true);
      assert.strictEqual(await otpService.getOtp(email, 'signup'), null);

      // Step 6: Completing signup without passkey and without skipPasskey is rejected (400)
      const missingPasskeyRes = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
      });
      assert.strictEqual(missingPasskeyRes.status, 400);
      assert.strictEqual(await db.User.findOne({ where: { phone } }), null);

      // Step 7: Fetch WebAuthn passkey creation options & create real signed passkey credential
      const optionsRes = await request(app)
        .post('/api/auth/signup/passkey/options')
        .set('Origin', 'http://localhost:4200')
        .send({ signupToken });
      assert.strictEqual(optionsRes.status, 200);
      assert.strictEqual(optionsRes.body.ok, true);
      assert.ok(optionsRes.body.options?.challenge);
      assert.strictEqual(optionsRes.body.options?.rp?.id, 'localhost');

      const virtualPasskey = createVirtualPasskey();
      const passkeyCredential = virtualPasskey.buildRegistrationCredential(optionsRes.body.options);

      // Step 8: Complete signup with passkey -> creates User in Postgres + issues 1h session + sync job
      const completeRes = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        passkeyCredential,
      });
      assert.strictEqual(completeRes.status, 201);
      assert.strictEqual(completeRes.body.ok, true);
      assert.strictEqual(completeRes.body.user?.firstName, 'Jordan');
      assert.strictEqual(completeRes.body.user?.lastName, 'Lee');
      assert.strictEqual(completeRes.body.user?.phone, phone);
      assert.strictEqual(completeRes.body.user?.email, email);
      assert.strictEqual(completeRes.body.user?.hasPasskey, true);
      assert.strictEqual(completeRes.body.user?.password, undefined);
      assert.strictEqual(completeRes.body.user?.passkeyPublicKey, undefined);
      assert.ok(completeRes.headers['set-cookie']);

      // Confirm persisted in users table with passkey columns and nullable password column
      const persisted = await db.User.findOne({ where: { phone } });
      assert.ok(persisted);
      assert.strictEqual(persisted.firstName, 'Jordan');
      assert.strictEqual(persisted.lastName, 'Lee');
      assert.strictEqual(persisted.email, email);
      assert.strictEqual(persisted.password, null);
      assert.strictEqual(persisted.passkeyCredentialId, virtualPasskey.credentialId);
      assert.ok(persisted.passkeyPublicKey);
      assert.strictEqual(persisted.passkeyAlgorithm, -7);

      // Confirm signup token was consumed
      assert.strictEqual(await otpService.getPendingSignup(signupToken), null);

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

    it('allows skipping passkey creation during signup when skipPasskey is true after an error', async () => {
      const phone = '+15554446666';
      const email = 'skippedpasskey@example.com';

      const verifyRes = await request(app).post('/api/otp/verify').send({ phone, otp: '123456' });
      assert.strictEqual(verifyRes.status, 200);
      const signupToken = verifyRes.body.signupToken;

      const emailVerifyRes = await request(app).post('/api/auth/signup/verify-email-otp').send({
        signupToken,
        firstName: 'Sam',
        lastName: 'Skip',
        email,
        code: '123456',
      });
      assert.strictEqual(emailVerifyRes.status, 200);

      const completeRes = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        skipPasskey: true,
      });
      assert.strictEqual(completeRes.status, 201);
      assert.strictEqual(completeRes.body.user?.hasPasskey, false);

      const persisted = await db.User.findOne({ where: { phone } });
      assert.ok(persisted);
      assert.strictEqual(persisted.passkeyCredentialId, null);
      assert.strictEqual(persisted.passkeyPublicKey, null);
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

  describe('Passkey Login & Profile Passkey Management (WebAuthn)', () => {
    it('looks up account by phone in Postgres users table and authenticates via navigator.credentials.get() assertion', async () => {
      const phone = '+15557778888';
      const email = 'passkeylogin@example.com';

      // Create user with passkey via full signup flow
      const verifyOtpRes = await request(app)
        .post('/api/otp/verify')
        .send({ phone, otp: '123456' });
      const signupToken = verifyOtpRes.body.signupToken;

      await request(app).post('/api/auth/signup/verify-email-otp').send({
        signupToken,
        firstName: 'Morgan',
        lastName: 'Key',
        email,
        code: '123456',
      });

      const regOptsRes = await request(app)
        .post('/api/auth/signup/passkey/options')
        .set('Origin', 'http://localhost:4200')
        .send({ signupToken });
      const virtualPasskey = createVirtualPasskey();
      const regCredential = virtualPasskey.buildRegistrationCredential(regOptsRes.body.options);

      const signupRes = await request(app).post('/api/auth/signup/complete').send({
        signupToken,
        passkeyCredential: regCredential,
      });
      assert.strictEqual(signupRes.status, 201);
      assert.strictEqual(signupRes.body.user?.hasPasskey, true);

      // Clear session/jobs from signup so we verify login independently
      fakeRedisStore.clear();
      queueService.clearPendingJobs();

      // Step 1: Enter phone number -> server finds account with passkey in users table & returns get() options
      const loginOptsRes = await request(app)
        .post('/api/auth/passkey/login/options')
        .set('Origin', 'http://localhost:4200')
        .send({ phone });
      assert.strictEqual(loginOptsRes.status, 200);
      assert.strictEqual(loginOptsRes.body.ok, true);
      assert.strictEqual(loginOptsRes.body.hasPasskey, true);
      assert.strictEqual(
        loginOptsRes.body.options?.allowCredentials?.[0]?.id,
        virtualPasskey.credentialId
      );

      // Step 2: Tampered assertion signature must be rejected (401)
      const badAssertion = virtualPasskey.buildAssertionCredential(loginOptsRes.body.options, {
        counter: 2,
      });
      badAssertion.response.signature = toBase64Url(crypto.randomBytes(64));
      const badLoginRes = await request(app)
        .post('/api/auth/passkey/login/verify')
        .send({ phone, credential: badAssertion });
      assert.strictEqual(badLoginRes.status, 401);

      // Step 3: Request fresh challenge & sign valid assertion -> issues 1h session + high-priority sync job
      const loginOptsRes2 = await request(app)
        .post('/api/auth/passkey/login/options')
        .set('Origin', 'http://localhost:4200')
        .send({ phone });
      const validAssertion = virtualPasskey.buildAssertionCredential(loginOptsRes2.body.options, {
        counter: 2,
      });

      const loginVerifyRes = await request(app)
        .post('/api/auth/passkey/login/verify')
        .send({ phone, credential: validAssertion });
      assert.strictEqual(loginVerifyRes.status, 200);
      assert.strictEqual(loginVerifyRes.body.ok, true);
      assert.strictEqual(loginVerifyRes.body.user?.phone, phone);
      assert.strictEqual(loginVerifyRes.body.user?.hasPasskey, true);
      assert.ok(loginVerifyRes.headers['set-cookie']);

      // Confirm counter incremented in Postgres users table
      const updatedUser = await db.User.findOne({ where: { phone } });
      assert.strictEqual(updatedUser.passkeyCounter, 2);

      // Confirm replayed counter (<= 2) is rejected
      const loginOptsRes3 = await request(app)
        .post('/api/auth/passkey/login/options')
        .set('Origin', 'http://localhost:4200')
        .send({ phone });
      const replayAssertion = virtualPasskey.buildAssertionCredential(loginOptsRes3.body.options, {
        counter: 2,
      });
      const replayRes = await request(app)
        .post('/api/auth/passkey/login/verify')
        .send({ phone, credential: replayAssertion });
      assert.strictEqual(replayRes.status, 401);

      // Confirm phone without passkey returns hasPasskey: false
      const noPasskeyRes = await request(app)
        .post('/api/auth/passkey/login/options')
        .send({ phone: '+15550009999' });
      assert.strictEqual(noPasskeyRes.status, 200);
      assert.strictEqual(noPasskeyRes.body.hasPasskey, false);
    });

    it('allows authenticated user to add a passkey if none exists and delete it on the profile page', async () => {
      const phone = '+15553334444';
      const email = 'profilepasskey@example.com';

      // Create user without a passkey
      await db.User.create({
        firstName: 'Casey',
        lastName: 'Profile',
        phone,
        email,
      });

      // Log in via OTP
      const loginRes = await request(app).post('/api/otp/verify').send({ phone, otp: '123456' });
      assert.strictEqual(loginRes.status, 200);
      const cookie = loginRes.headers['set-cookie'];

      // Profile initially reports hasPasskey: false
      const profileBefore = await request(app).get('/api/profile').set('Cookie', cookie);
      assert.strictEqual(profileBefore.status, 200);
      assert.strictEqual(profileBefore.body.hasPasskey, false);

      // Deleting when no passkey exists returns 404
      const deleteMissing = await request(app).delete('/api/profile/passkey').set('Cookie', cookie);
      assert.strictEqual(deleteMissing.status, 404);

      // Add a passkey from the profile page
      const regOptsRes = await request(app)
        .post('/api/profile/passkey/register/options')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', cookie)
        .send({});
      assert.strictEqual(regOptsRes.status, 200);
      assert.ok(regOptsRes.body.options?.challenge);

      const virtualPasskey = createVirtualPasskey();
      const regCredential = virtualPasskey.buildRegistrationCredential(regOptsRes.body.options);

      const regVerifyRes = await request(app)
        .post('/api/profile/passkey/register/verify')
        .set('Cookie', cookie)
        .send({ credential: regCredential });
      assert.strictEqual(regVerifyRes.status, 200);
      assert.strictEqual(regVerifyRes.body.ok, true);
      assert.strictEqual(regVerifyRes.body.user?.hasPasskey, true);
      assert.ok(regVerifyRes.body.user?.passkeyCreatedAt);

      // Attempting to add another passkey when one already exists returns 409
      const duplicateOpts = await request(app)
        .post('/api/profile/passkey/register/options')
        .set('Cookie', cookie)
        .send({});
      assert.strictEqual(duplicateOpts.status, 409);

      // Verify login options now find the registered passkey
      const loginCheck = await request(app).post('/api/auth/passkey/login/options').send({ phone });
      assert.strictEqual(loginCheck.status, 200);
      assert.strictEqual(loginCheck.body.hasPasskey, true);

      // Delete the passkey from the profile page
      const deleteRes = await request(app).delete('/api/profile/passkey').set('Cookie', cookie);
      assert.strictEqual(deleteRes.status, 200);
      assert.strictEqual(deleteRes.body.ok, true);
      assert.strictEqual(deleteRes.body.user?.hasPasskey, false);
      assert.strictEqual(deleteRes.body.user?.passkeyCreatedAt, null);

      // Confirm columns cleared in Postgres and login options now report hasPasskey: false
      const dbUser = await db.User.findOne({ where: { phone } });
      assert.strictEqual(dbUser.passkeyCredentialId, null);
      assert.strictEqual(dbUser.passkeyPublicKey, null);

      const loginCheckAfter = await request(app)
        .post('/api/auth/passkey/login/options')
        .send({ phone });
      assert.strictEqual(loginCheckAfter.status, 200);
      assert.strictEqual(loginCheckAfter.body.hasPasskey, false);
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
