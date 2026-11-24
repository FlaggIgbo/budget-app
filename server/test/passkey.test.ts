// Unit tests for WebAuthn / Passkey cryptography & service flows (signup, login, profile add/delete)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert = require('node:assert');
import crypto = require('crypto');
import db = require('../models');
import otpService = require('../services/authentication/otp.service');
import passkeyService = require('../services/authentication/passkey.service');
import sessionService = require('../services/authentication/session.service');

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
  throw new Error(`Unsupported CBOR type: ${typeof val}`);
}

function createVirtualEs256Authenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const credIdBuf = crypto.randomBytes(32);
  const credId = passkeyService.toBase64Url(credIdBuf);
  const coseKey = new Map<number, number | Buffer>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);

  return {
    credId,
    buildRegistration(
      challenge,
      rpId = 'localhost',
      origin = 'http://localhost:4200',
      counter = 0
    ) {
      const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
      const flags = Buffer.from([0x41]); // UP + AT
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(counter, 0);
      const aaguid = Buffer.alloc(16, 0);
      const credIdLen = Buffer.alloc(2);
      credIdLen.writeUInt16BE(credIdBuf.length, 0);
      const authData = Buffer.concat([
        rpIdHash,
        flags,
        signCount,
        aaguid,
        credIdLen,
        credIdBuf,
        encodeCbor(coseKey),
      ]);
      const attestationObject = encodeCbor(
        new Map<string, any>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.create', challenge, origin }),
        'utf8'
      );

      return {
        id: credId,
        rawId: credId,
        type: 'public-key',
        response: {
          clientDataJSON: passkeyService.toBase64Url(clientDataJSON),
          attestationObject: passkeyService.toBase64Url(attestationObject),
          transports: ['internal', 'hybrid'],
        },
      };
    },
    buildAssertion(challenge, rpId = 'localhost', origin = 'http://localhost:4200', counter = 0) {
      const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
      const flags = Buffer.from([0x05]); // UP + UV
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(counter, 0);
      const authData = Buffer.concat([rpIdHash, flags, signCount]);
      const clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge, origin }),
        'utf8'
      );
      const signedData = Buffer.concat([
        authData,
        crypto.createHash('sha256').update(clientDataJSON).digest(),
      ]);
      const signature = crypto.sign('sha256', signedData, privateKey);

      return {
        id: credId,
        rawId: credId,
        type: 'public-key',
        response: {
          clientDataJSON: passkeyService.toBase64Url(clientDataJSON),
          authenticatorData: passkeyService.toBase64Url(authData),
          signature: passkeyService.toBase64Url(signature),
          userHandle: null,
        },
      };
    },
  };
}

describe('Passkey WebAuthn Cryptographic Verification', () => {
  it('verifies ES256 registration attestation and subsequent assertion signatures', () => {
    const auth = createVirtualEs256Authenticator();
    const regChallenge = passkeyService.toBase64Url(crypto.randomBytes(32));

    const regPayload = auth.buildRegistration(
      regChallenge,
      'localhost',
      'http://localhost:4200',
      1
    );
    const regResult = passkeyService.verifyRegistrationPayload({
      credential: regPayload,
      expectedChallenge: regChallenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });

    assert.strictEqual(regResult.ok, true);
    assert.strictEqual(regResult.passkey.passkeyCredentialId, auth.credId);
    assert.strictEqual(regResult.passkey.passkeyAlgorithm, -7);
    assert.strictEqual(regResult.passkey.passkeyCounter, 1);
    assert.deepStrictEqual(regResult.passkey.passkeyTransports, ['internal', 'hybrid']);

    // Verify valid assertion with incremented counter
    const authChallenge = passkeyService.toBase64Url(crypto.randomBytes(32));
    const assertion = auth.buildAssertion(authChallenge, 'localhost', 'http://localhost:4200', 2);
    const authResult = passkeyService.verifyAssertionPayload({
      credential: assertion,
      user: regResult.passkey,
      expectedChallenge: authChallenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });

    assert.strictEqual(authResult.ok, true);
    assert.strictEqual(authResult.newCounter, 2);
  });

  it('allows synced passkeys that consistently report signCount = 0', () => {
    const auth = createVirtualEs256Authenticator();
    const regChallenge = passkeyService.toBase64Url(crypto.randomBytes(32));
    const regResult = passkeyService.verifyRegistrationPayload({
      credential: auth.buildRegistration(regChallenge, 'localhost', 'http://localhost:4200', 0),
      expectedChallenge: regChallenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(regResult.ok, true);

    const authChallenge = passkeyService.toBase64Url(crypto.randomBytes(32));
    const authResult = passkeyService.verifyAssertionPayload({
      credential: auth.buildAssertion(authChallenge, 'localhost', 'http://localhost:4200', 0),
      user: regResult.passkey,
      expectedChallenge: authChallenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(authResult.ok, true);
    assert.strictEqual(authResult.newCounter, 0);
  });

  it('rejects challenge mismatch, origin mismatch, RP ID mismatch, tampered signature, and replayed counter', () => {
    const auth = createVirtualEs256Authenticator();
    const regChallenge = passkeyService.toBase64Url(crypto.randomBytes(32));
    const regResult = passkeyService.verifyRegistrationPayload({
      credential: auth.buildRegistration(regChallenge, 'localhost', 'http://localhost:4200', 5),
      expectedChallenge: regChallenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(regResult.ok, true);

    const challenge = passkeyService.toBase64Url(crypto.randomBytes(32));

    // Wrong challenge
    const wrongChallenge = passkeyService.verifyAssertionPayload({
      credential: auth.buildAssertion(
        'different-challenge',
        'localhost',
        'http://localhost:4200',
        6
      ),
      user: regResult.passkey,
      expectedChallenge: challenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(wrongChallenge.status, 401);

    // Wrong origin
    const wrongOrigin = passkeyService.verifyAssertionPayload({
      credential: auth.buildAssertion(challenge, 'localhost', 'https://evil.example.com', 6),
      user: regResult.passkey,
      expectedChallenge: challenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(wrongOrigin.status, 401);

    // Wrong RP ID
    const wrongRp = passkeyService.verifyAssertionPayload({
      credential: auth.buildAssertion(challenge, 'evil.example.com', 'http://localhost:4200', 6),
      user: regResult.passkey,
      expectedChallenge: challenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(wrongRp.status, 401);

    // Tampered signature
    const tampered = auth.buildAssertion(challenge, 'localhost', 'http://localhost:4200', 6);
    tampered.response.signature = passkeyService.toBase64Url(crypto.randomBytes(64));
    const badSig = passkeyService.verifyAssertionPayload({
      credential: tampered,
      user: regResult.passkey,
      expectedChallenge: challenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(badSig.status, 401);

    // Replayed counter (5 <= 5)
    const replay = passkeyService.verifyAssertionPayload({
      credential: auth.buildAssertion(challenge, 'localhost', 'http://localhost:4200', 5),
      user: regResult.passkey,
      expectedChallenge: challenge,
      allowedOrigins: ['http://localhost:4200'],
      expectedRpId: 'localhost',
    });
    assert.strictEqual(replay.status, 401);
  });
});

describe('Passkey Service End-to-End Flows (Signup, Phone Login, Profile Add/Delete)', () => {
  const originalFindOne = db.User.findOne;
  const originalFindByPk = db.User.findByPk;
  const originalCreate = db.User.create;

  let usersById;
  let fakeRedis;

  function makeUserRecord(data) {
    const record = {
      id: data.id || crypto.randomUUID(),
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
      password: data.password ?? null,
      passkeyCredentialId: data.passkeyCredentialId ?? null,
      passkeyPublicKey: data.passkeyPublicKey ?? null,
      passkeyAlgorithm: data.passkeyAlgorithm ?? null,
      passkeyCounter: data.passkeyCounter ?? 0,
      passkeyTransports: data.passkeyTransports ?? null,
      passkeyCreatedAt: data.passkeyCreatedAt ?? null,
      update: async (patch) => {
        Object.assign(record, patch);
        return record;
      },
    };
    return record;
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PLAID_ENV = 'sandbox';
    usersById = new Map();
    fakeRedis = new Map();

    const mockRedis = {
      set: async (key, value, options) => {
        fakeRedis.set(key, { value, ttl: options?.EX || null });
      },
      get: async (key) => {
        const entry = fakeRedis.get(key);
        return entry ? entry.value : null;
      },
      del: async (key) => {
        fakeRedis.delete(key);
      },
    };

    otpService.setClient(mockRedis);
    passkeyService.setClient(mockRedis);
    sessionService.setClient(mockRedis);

    db.User.findOne = async ({ where }) => {
      for (const user of usersById.values()) {
        const matches = Object.entries(where).every(([k, v]) => user[k] === v);
        if (matches) return user;
      }
      return null;
    };

    db.User.findByPk = async (id) => usersById.get(id) || null;

    db.User.create = async (data) => {
      const record = makeUserRecord(data);
      usersById.set(record.id, record);
      return record;
    };
  });

  afterEach(() => {
    db.User.findOne = originalFindOne;
    db.User.findByPk = originalFindByPk;
    db.User.create = originalCreate;
    otpService.setClient(null);
    passkeyService.setClient(null);
    sessionService.setClient(null);
  });

  it('requires passkey during signup, supports skipping on error, and authenticates by phone passkey on login', async () => {
    const phone = '+15551112222';
    const email = 'flow@example.com';

    // 1. Phone OTP verify -> pending signup token
    const phoneVerify = await otpService.verifyOtp(phone, '123456');
    assert.strictEqual(phoneVerify.requiresSignup, true);
    const signupToken = phoneVerify.signupToken;

    // 2. Verify email OTP
    const emailVerify = await otpService.verifySignupEmailOtp({
      signupToken,
      firstName: 'Jordan',
      lastName: 'Flow',
      email,
      code: '123456',
    });
    assert.strictEqual(emailVerify.ok, true);

    // 3. Attempting to complete signup without passkey and without skipPasskey fails with 400
    const missingPasskey = await otpService.completeSignup({ signupToken });
    assert.strictEqual(missingPasskey.status, 400);

    // 4. Generate WebAuthn signup options & complete signup with real signed passkey
    const pending = await otpService.getPendingSignup(signupToken);
    const regOpts = await passkeyService.generateSignupRegistrationOptions(pending, signupToken);
    assert.strictEqual(regOpts.ok, true);

    const auth = createVirtualEs256Authenticator();
    const regCred = auth.buildRegistration(regOpts.options.challenge, regOpts.options.rp.id);

    const completed = await otpService.completeSignup({
      signupToken,
      passkeyCredential: regCred,
    });
    assert.strictEqual(completed.ok, true);
    assert.strictEqual(completed.user.hasPasskey, true);
    assert.strictEqual(completed.user.passkeyPublicKey, undefined);

    // 5. Login with phone number finds passkey in users table & authenticates assertion
    const loginOpts = await passkeyService.generateLoginOptions(phone);
    assert.strictEqual(loginOpts.ok, true);
    assert.strictEqual(loginOpts.hasPasskey, true);
    assert.strictEqual(loginOpts.options.allowCredentials[0].id, auth.credId);

    const assertion = auth.buildAssertion(
      loginOpts.options.challenge,
      loginOpts.options.rpId,
      'http://localhost:4200',
      1
    );
    const loginResult = await passkeyService.verifyLoginAssertion(phone, assertion);
    assert.strictEqual(loginResult.ok, true);
    assert.strictEqual(loginResult.user.phone, phone);
    assert.ok(loginResult.token);
  });

  it('allows skipping passkey during signup and later adding/deleting passkey on profile', async () => {
    const phone = '+15553339999';
    const email = 'profile-flow@example.com';

    const phoneVerify = await otpService.verifyOtp(phone, '123456');
    const signupToken = phoneVerify.signupToken;

    await otpService.verifySignupEmailOtp({
      signupToken,
      firstName: 'Alex',
      lastName: 'Skip',
      email,
      code: '123456',
    });

    const skipped = await otpService.completeSignup({ signupToken, skipPasskey: true });
    assert.strictEqual(skipped.ok, true);
    assert.strictEqual(skipped.user.hasPasskey, false);

    // Login options report no passkey yet
    const loginBefore = await passkeyService.generateLoginOptions(phone);
    assert.strictEqual(loginBefore.hasPasskey, false);

    // Add passkey on profile
    const profileOpts = await passkeyService.generateProfileRegistrationOptions(skipped.user.id);
    assert.strictEqual(profileOpts.ok, true);

    const auth = createVirtualEs256Authenticator();
    const regCred = auth.buildRegistration(
      profileOpts.options.challenge,
      profileOpts.options.rp.id
    );
    const added = await passkeyService.verifyProfileRegistration(skipped.user.id, regCred);
    assert.strictEqual(added.ok, true);
    assert.strictEqual(added.user.hasPasskey, true);

    // Duplicate add rejected with 409
    const dup = await passkeyService.generateProfileRegistrationOptions(skipped.user.id);
    assert.strictEqual(dup.status, 409);

    // Login options now report passkey present
    const loginWithPasskey = await passkeyService.generateLoginOptions(phone);
    assert.strictEqual(loginWithPasskey.hasPasskey, true);

    // Delete passkey on profile
    const deleted = await passkeyService.deleteProfilePasskey(skipped.user.id);
    assert.strictEqual(deleted.ok, true);
    assert.strictEqual(deleted.user.hasPasskey, false);

    // Login options back to hasPasskey: false
    const loginAfterDelete = await passkeyService.generateLoginOptions(phone);
    assert.strictEqual(loginAfterDelete.hasPasskey, false);
  });
});
