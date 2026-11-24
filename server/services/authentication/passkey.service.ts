import type { ServiceResult } from '../../types';
import crypto = require('crypto');
import { createClient } from 'redis';
import db = require('../../models');
import sessionService = require('./session.service');

// ============================================================================
// WEBAUTHN / PASSKEY SERVICE
// Handles WebAuthn registration (navigator.credentials.create) and
// authentication (navigator.credentials.get) using Node's built-in crypto
// module and Redis-backed single-use challenges.
// ============================================================================

const CHALLENGE_PREFIX = 'webauthn:';
const CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes
const SUPPORTED_ALGORITHMS = [-7, -257]; // ES256 (P-256) and RS256 (RSA)

let redisClient = null;
const memoryFallbackStore = new Map();

function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  if (!str || typeof str !== 'string') {
    throw new Error('Invalid base64url string');
  }
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Get or connect to Redis client (matches session.service.js & otp.service.js pattern)
async function getClient() {
  if (redisClient) {
    return redisClient;
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      set: async (key, value, options) => {
        const ttl = options?.EX || CHALLENGE_TTL_SECONDS;
        memoryFallbackStore.set(key, {
          value,
          ttl,
          expiresAt: Date.now() + ttl * 1000,
        });
      },
      get: async (key) => {
        const entry = memoryFallbackStore.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          memoryFallbackStore.delete(key);
          return null;
        }
        return entry.value;
      },
      del: async (key) => {
        memoryFallbackStore.delete(key);
      },
    };
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = createClient({ url });

  client.on('error', (err) => {
    console.error('Redis passkey error:', err.message);
  });

  await client.connect();
  redisClient = client;
  return redisClient;
}

function setClient(customClient) {
  redisClient = customClient;
}

function getChallengeKey(scope, identifier) {
  return `${CHALLENGE_PREFIX}${scope}:${identifier}`;
}

async function saveChallenge(scope, identifier, payload, ttlSeconds = CHALLENGE_TTL_SECONDS) {
  const client = await getClient();
  await client.set(getChallengeKey(scope, identifier), JSON.stringify(payload), {
    EX: ttlSeconds,
  });
}

async function consumeChallenge(scope, identifier) {
  const client = await getClient();
  const key = getChallengeKey(scope, identifier);
  const raw = await client.get(key);
  if (!raw) {
    return null;
  }
  await client.del(key);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Resolve RP ID, RP Name, and allowed WebAuthn origins from env + request headers
function getWebAuthnConfig(req = null) {
  const rawOrigins =
    process.env.WEBAUTHN_ORIGIN ||
    process.env.CORS_ORIGIN ||
    'http://localhost:4200,http://localhost:3000';

  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const reqOrigin = req?.headers?.origin ? req.headers.origin.trim().replace(/\/+$/, '') : '';
  let activeOrigin = allowedOrigins[0] || 'http://localhost:4200';

  if (reqOrigin) {
    if (allowedOrigins.includes(reqOrigin)) {
      activeOrigin = reqOrigin;
    } else if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(reqOrigin);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          activeOrigin = reqOrigin;
          allowedOrigins.push(reqOrigin);
        }
      } catch {
        // Ignore malformed Origin header
      }
    }
  }

  let rpId = (process.env.WEBAUTHN_RP_ID || '').trim();
  if (!rpId) {
    try {
      rpId = new URL(activeOrigin).hostname;
    } catch {
      rpId = 'localhost';
    }
  }

  const rpName = (process.env.WEBAUTHN_RP_NAME || 'Budget App').trim();

  return {
    rpId,
    rpName,
    allowedOrigins,
  };
}

// ============================================================================
// MINIMAL STANDARDS-COMPLIANT CBOR DECODER (for WebAuthn attestationObject & COSE keys)
// ============================================================================
function readCborLength(buf, offset, additionalInfo) {
  if (additionalInfo < 24) {
    return { length: additionalInfo, nextOffset: offset };
  }
  if (additionalInfo === 24) {
    if (offset + 1 > buf.length) throw new Error('Unexpected end of CBOR data');
    return { length: buf.readUInt8(offset), nextOffset: offset + 1 };
  }
  if (additionalInfo === 25) {
    if (offset + 2 > buf.length) throw new Error('Unexpected end of CBOR data');
    return { length: buf.readUInt16BE(offset), nextOffset: offset + 2 };
  }
  if (additionalInfo === 26) {
    if (offset + 4 > buf.length) throw new Error('Unexpected end of CBOR data');
    return { length: buf.readUInt32BE(offset), nextOffset: offset + 4 };
  }
  if (additionalInfo === 27) {
    if (offset + 8 > buf.length) throw new Error('Unexpected end of CBOR data');
    const big = buf.readBigUInt64BE(offset);
    return { length: Number(big), nextOffset: offset + 8 };
  }
  throw new Error(`Unsupported CBOR additional info: ${additionalInfo}`);
}

function decodeCborItem(buf, offset = 0) {
  if (offset >= buf.length) {
    throw new Error('Unexpected end of CBOR buffer');
  }

  const initialByte = buf[offset];
  const majorType = initialByte >> 5;
  const additionalInfo = initialByte & 0x1f;
  let pos = offset + 1;

  // Major type 0: unsigned integer
  if (majorType === 0) {
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    return { value: length, nextOffset };
  }

  // Major type 1: negative integer (-1 - n)
  if (majorType === 1) {
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    return { value: -1 - length, nextOffset };
  }

  // Major type 2: byte string
  if (majorType === 2) {
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    if (nextOffset + length > buf.length) {
      throw new Error('CBOR byte string exceeds buffer length');
    }
    return {
      value: Buffer.from(buf.subarray(nextOffset, nextOffset + length)),
      nextOffset: nextOffset + length,
    };
  }

  // Major type 3: UTF-8 text string
  if (majorType === 3) {
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    if (nextOffset + length > buf.length) {
      throw new Error('CBOR text string exceeds buffer length');
    }
    return {
      value: buf.subarray(nextOffset, nextOffset + length).toString('utf8'),
      nextOffset: nextOffset + length,
    };
  }

  // Major type 4: array
  if (majorType === 4) {
    const arr = [];
    if (additionalInfo === 31) {
      while (pos < buf.length && buf[pos] !== 0xff) {
        const item = decodeCborItem(buf, pos);
        arr.push(item.value);
        pos = item.nextOffset;
      }
      if (pos >= buf.length || buf[pos] !== 0xff) {
        throw new Error('Unterminated indefinite-length CBOR array');
      }
      return { value: arr, nextOffset: pos + 1 };
    }
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    pos = nextOffset;
    for (let i = 0; i < length; i++) {
      const item = decodeCborItem(buf, pos);
      arr.push(item.value);
      pos = item.nextOffset;
    }
    return { value: arr, nextOffset: pos };
  }

  // Major type 5: map (returned as JS Map to preserve integer keys in COSE keys)
  if (majorType === 5) {
    const map = new Map();
    if (additionalInfo === 31) {
      while (pos < buf.length && buf[pos] !== 0xff) {
        const keyItem = decodeCborItem(buf, pos);
        const valItem = decodeCborItem(buf, keyItem.nextOffset);
        map.set(keyItem.value, valItem.value);
        pos = valItem.nextOffset;
      }
      if (pos >= buf.length || buf[pos] !== 0xff) {
        throw new Error('Unterminated indefinite-length CBOR map');
      }
      return { value: map, nextOffset: pos + 1 };
    }
    const { length, nextOffset } = readCborLength(buf, pos, additionalInfo);
    pos = nextOffset;
    for (let i = 0; i < length; i++) {
      const keyItem = decodeCborItem(buf, pos);
      const valItem = decodeCborItem(buf, keyItem.nextOffset);
      map.set(keyItem.value, valItem.value);
      pos = valItem.nextOffset;
    }
    return { value: map, nextOffset: pos };
  }

  // Major type 6: semantic tag
  if (majorType === 6) {
    const { nextOffset } = readCborLength(buf, pos, additionalInfo);
    return decodeCborItem(buf, nextOffset);
  }

  // Major type 7: simple values & floats
  if (majorType === 7) {
    if (additionalInfo === 20) return { value: false, nextOffset: pos };
    if (additionalInfo === 21) return { value: true, nextOffset: pos };
    if (additionalInfo === 22) return { value: null, nextOffset: pos };
    if (additionalInfo === 23) return { value: undefined, nextOffset: pos };
    if (additionalInfo === 24) return { value: buf.readUInt8(pos), nextOffset: pos + 1 };
    if (additionalInfo === 25) return { value: buf.readUInt16BE(pos), nextOffset: pos + 2 };
    if (additionalInfo === 26) return { value: buf.readFloatBE(pos), nextOffset: pos + 4 };
    if (additionalInfo === 27) return { value: buf.readDoubleBE(pos), nextOffset: pos + 8 };
    return { value: additionalInfo, nextOffset: pos };
  }

  throw new Error(`Unsupported CBOR major type: ${majorType}`);
}

function decodeCbor(buf) {
  return decodeCborItem(buf, 0).value;
}

// Convert a COSE public key Map (ES256 P-256 or RS256 RSA) into SPKI DER base64 string
function coseKeyToSpki(coseKey) {
  if (!(coseKey instanceof Map)) {
    throw new Error('COSE public key must be a CBOR map');
  }

  const kty = coseKey.get(1);
  const alg = coseKey.get(3);

  // EC2 key (kty = 2), e.g., ES256 (alg = -7, crv = 1 -> P-256)
  if (kty === 2) {
    const crvCode = coseKey.get(-1);
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    const crvMap = { 1: 'P-256', 2: 'P-384', 3: 'P-521' };
    const crv = crvMap[crvCode];
    if (!crv || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw new Error('Invalid EC2 COSE public key parameters');
    }

    const keyObj = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv,
        x: toBase64Url(x),
        y: toBase64Url(y),
      },
      format: 'jwk',
    });

    return {
      publicKeySpkiBase64: keyObj.export({ type: 'spki', format: 'der' }).toString('base64'),
      algorithm: typeof alg === 'number' ? alg : -7,
    };
  }

  // RSA key (kty = 3), e.g., RS256 (alg = -257)
  if (kty === 3) {
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) {
      throw new Error('Invalid RSA COSE public key parameters');
    }

    const keyObj = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: toBase64Url(n),
        e: toBase64Url(e),
      },
      format: 'jwk',
    });

    return {
      publicKeySpkiBase64: keyObj.export({ type: 'spki', format: 'der' }).toString('base64'),
      algorithm: typeof alg === 'number' ? alg : -257,
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
}

// Parse WebAuthn authenticatorData binary structure
function parseAuthenticatorData(authDataBuf) {
  if (!Buffer.isBuffer(authDataBuf) || authDataBuf.length < 37) {
    throw new Error('Invalid authenticatorData: buffer too short');
  }

  const rpIdHash = authDataBuf.subarray(0, 32);
  const flagsByte = authDataBuf[32];
  const flags = {
    up: Boolean(flagsByte & 0x01), // User Present
    uv: Boolean(flagsByte & 0x04), // User Verified
    be: Boolean(flagsByte & 0x08), // Backup Eligibility
    bs: Boolean(flagsByte & 0x10), // Backup State
    at: Boolean(flagsByte & 0x40), // Attested Credential Data included
    ed: Boolean(flagsByte & 0x80), // Extension Data included
  };
  const signCount = authDataBuf.readUInt32BE(33);

  const result = {
    rpIdHash,
    flags,
    signCount,
    aaguid: null,
    credentialId: null,
    cosePublicKey: null,
  };

  if (flags.at) {
    if (authDataBuf.length < 55) {
      throw new Error('Invalid authenticatorData: missing attested credential data');
    }
    result.aaguid = authDataBuf.subarray(37, 53);
    const credIdLen = authDataBuf.readUInt16BE(53);
    const credIdEnd = 55 + credIdLen;
    if (authDataBuf.length < credIdEnd) {
      throw new Error('Invalid authenticatorData: truncated credential ID');
    }
    result.credentialId = authDataBuf.subarray(55, credIdEnd);
    const decodedKey = decodeCborItem(authDataBuf, credIdEnd);
    result.cosePublicKey = decodedKey.value;
  }

  return result;
}

// Verify clientDataJSON for either 'webauthn.create' or 'webauthn.get'
function verifyClientData({
  clientDataJSON,
  expectedType,
  expectedChallenge,
  allowedOrigins,
}): ServiceResult {
  let clientDataBuf;
  let clientData;
  try {
    clientDataBuf = fromBase64Url(clientDataJSON);
    clientData = JSON.parse(clientDataBuf.toString('utf8'));
  } catch {
    return { error: 'Invalid clientDataJSON', status: 400 };
  }

  if (clientData.type !== expectedType) {
    return { error: `Invalid clientData type: expected ${expectedType}`, status: 400 };
  }

  if (!timingSafeStringEqual(clientData.challenge, expectedChallenge)) {
    return { error: 'Passkey challenge mismatch', status: 401 };
  }

  const normalizedOrigin =
    typeof clientData.origin === 'string' ? clientData.origin.replace(/\/+$/, '') : '';
  if (!allowedOrigins.includes(normalizedOrigin)) {
    return { error: 'Passkey origin mismatch', status: 401 };
  }

  return { clientDataBuf, clientData };
}

// Verify a navigator.credentials.create() registration response
function verifyRegistrationPayload({
  credential,
  expectedChallenge,
  allowedOrigins,
  expectedRpId,
}) {
  if (!credential || typeof credential !== 'object' || !credential.response) {
    return { error: 'Passkey credential payload is required', status: 400 };
  }

  const clientCheck = verifyClientData({
    clientDataJSON: credential.response.clientDataJSON,
    expectedType: 'webauthn.create',
    expectedChallenge,
    allowedOrigins,
  });
  if (clientCheck.error) {
    return clientCheck;
  }

  const expectedRpIdHash = sha256(Buffer.from(expectedRpId, 'utf8'));

  let authData;
  let credentialIdB64Url;
  let publicKeySpkiBase64;
  let algorithm;
  let signCount;

  if (credential.response.attestationObject) {
    try {
      const attObjBuf = fromBase64Url(credential.response.attestationObject);
      const attObj = decodeCbor(attObjBuf);
      if (!(attObj instanceof Map)) {
        return { error: 'Invalid attestationObject format', status: 400 };
      }

      const authDataBuf = attObj.get('authData');
      if (!Buffer.isBuffer(authDataBuf)) {
        return { error: 'Missing authData in attestationObject', status: 400 };
      }

      authData = parseAuthenticatorData(authDataBuf);

      if (!crypto.timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
        return { error: 'Passkey RP ID mismatch', status: 401 };
      }

      if (!authData.flags.up) {
        return { error: 'User presence flag not set during passkey creation', status: 400 };
      }

      if (!authData.flags.at || !authData.credentialId || !authData.cosePublicKey) {
        return { error: 'Attested credential data missing from passkey response', status: 400 };
      }

      credentialIdB64Url = toBase64Url(authData.credentialId);
      const spkiResult = coseKeyToSpki(authData.cosePublicKey);
      publicKeySpkiBase64 = spkiResult.publicKeySpkiBase64;
      algorithm = spkiResult.algorithm;
      signCount = authData.signCount;
    } catch (err) {
      return { error: `Invalid passkey attestation: ${err.message}`, status: 400 };
    }
  } else if (credential.response.authenticatorData && credential.response.publicKey) {
    // Fallback if client provided WebAuthn L2 getAuthenticatorData() + getPublicKey() directly
    try {
      const authDataBuf = fromBase64Url(credential.response.authenticatorData);
      authData = parseAuthenticatorData(authDataBuf);

      if (!crypto.timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
        return { error: 'Passkey RP ID mismatch', status: 401 };
      }

      if (!authData.flags.up) {
        return { error: 'User presence flag not set during passkey creation', status: 400 };
      }

      const spkiBuf = fromBase64Url(credential.response.publicKey);
      // Validate SPKI key is parseable by Node crypto
      const keyObj = crypto.createPublicKey({ key: spkiBuf, format: 'der', type: 'spki' });
      publicKeySpkiBase64 = keyObj.export({ type: 'spki', format: 'der' }).toString('base64');
      credentialIdB64Url = credential.rawId || credential.id;
      algorithm =
        typeof credential.response.publicKeyAlgorithm === 'number'
          ? credential.response.publicKeyAlgorithm
          : -7;
      signCount = authData.signCount;
    } catch (err) {
      return { error: `Invalid passkey public key: ${err.message}`, status: 400 };
    }
  } else {
    return { error: 'Passkey attestationObject is required', status: 400 };
  }

  if (!credentialIdB64Url) {
    return { error: 'Missing passkey credential ID', status: 400 };
  }

  if (credential.id && credential.id !== credentialIdB64Url) {
    return { error: 'Passkey credential ID mismatch', status: 400 };
  }

  const rawTransports = Array.isArray(credential.response.transports)
    ? credential.response.transports.filter((t) => typeof t === 'string')
    : null;

  return {
    ok: true,
    passkey: {
      passkeyCredentialId: credentialIdB64Url,
      passkeyPublicKey: publicKeySpkiBase64,
      passkeyAlgorithm: algorithm,
      passkeyCounter: signCount,
      passkeyTransports: rawTransports && rawTransports.length > 0 ? rawTransports : null,
      passkeyCreatedAt: new Date(),
    },
  };
}

// Verify a navigator.credentials.get() authentication assertion
function verifyAssertionPayload({
  credential,
  user,
  expectedChallenge,
  allowedOrigins,
  expectedRpId,
}) {
  if (!credential || typeof credential !== 'object' || !credential.response) {
    return { error: 'Passkey assertion payload is required', status: 400 };
  }

  if (!user.passkeyCredentialId || !user.passkeyPublicKey) {
    return { error: 'No passkey registered for this account', status: 400 };
  }

  const presentedId = credential.id || credential.rawId;
  if (!presentedId || !timingSafeStringEqual(presentedId, user.passkeyCredentialId)) {
    return { error: 'Passkey credential does not match this account', status: 401 };
  }

  const clientCheck = verifyClientData({
    clientDataJSON: credential.response.clientDataJSON,
    expectedType: 'webauthn.get',
    expectedChallenge,
    allowedOrigins,
  });
  if (clientCheck.error) {
    return clientCheck;
  }

  let authDataBuf;
  let signatureBuf;
  let authData;
  try {
    authDataBuf = fromBase64Url(credential.response.authenticatorData);
    signatureBuf = fromBase64Url(credential.response.signature);
    authData = parseAuthenticatorData(authDataBuf);
  } catch (err) {
    return { error: `Invalid passkey assertion data: ${err.message}`, status: 400 };
  }

  const expectedRpIdHash = sha256(Buffer.from(expectedRpId, 'utf8'));
  if (!crypto.timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
    return { error: 'Passkey RP ID mismatch', status: 401 };
  }

  if (!authData.flags.up) {
    return { error: 'User presence flag not set during passkey authentication', status: 401 };
  }

  // Counter check (synced passkeys may always report 0, which is valid when stored counter is also 0)
  const storedCounter = Number(user.passkeyCounter || 0);
  if ((authData.signCount > 0 || storedCounter > 0) && authData.signCount <= storedCounter) {
    return { error: 'Passkey signature counter invalid (possible replay)', status: 401 };
  }

  // Verify cryptographic signature over authenticatorData || SHA-256(clientDataJSON)
  let verified;
  try {
    const clientDataHash = sha256(clientCheck.clientDataBuf);
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(user.passkeyPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    verified = crypto.verify('sha256', signedData, publicKey, signatureBuf);
  } catch {
    verified = false;
  }

  if (!verified) {
    return { error: 'Passkey signature verification failed', status: 401 };
  }

  return {
    ok: true,
    newCounter: authData.signCount,
  };
}

// Build standard PublicKeyCredentialCreationOptions JSON
function buildRegistrationOptions({ challenge, rpId, rpName, userId, userName, displayName }) {
  return {
    challenge,
    rp: {
      name: rpName,
      id: rpId,
    },
    user: {
      id: toBase64Url(Buffer.from(String(userId), 'utf8')),
      name: userName,
      displayName,
    },
    pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  };
}

// ============================================================================
// HIGH-LEVEL SIGNUP, LOGIN, AND PROFILE PASSKEY FLOWS
// ============================================================================

// 1. Signup: generate passkey creation options for an email-verified pending signup
async function generateSignupRegistrationOptions(
  pendingSignup,
  signupToken,
  req = null
): Promise<ServiceResult> {
  if (!pendingSignup || !pendingSignup.phone) {
    return {
      error: 'Signup session expired. Please verify your phone number again.',
      status: 401,
    };
  }

  if (!pendingSignup.emailVerified || !pendingSignup.email) {
    return {
      error: 'Please verify your email address before creating a passkey',
      status: 400,
    };
  }

  const config = getWebAuthnConfig(req);
  const challenge = toBase64Url(crypto.randomBytes(32));
  const userHandle = pendingSignup.pendingUserId || crypto.randomUUID();

  await saveChallenge('signup', signupToken.trim(), {
    challenge,
    rpId: config.rpId,
    allowedOrigins: config.allowedOrigins,
  });

  const displayName =
    `${pendingSignup.firstName || ''} ${pendingSignup.lastName || ''}`.trim() ||
    pendingSignup.phone;

  return {
    ok: true,
    options: buildRegistrationOptions({
      challenge,
      rpId: config.rpId,
      rpName: config.rpName,
      userId: userHandle,
      userName: pendingSignup.phone,
      displayName,
    }),
  };
}

// 2. Signup: verify passkey creation response before persisting User in Postgres
async function verifySignupRegistration(signupToken, credential): Promise<ServiceResult> {
  if (!signupToken || typeof signupToken !== 'string') {
    return { error: 'Signup session expired. Please try again.', status: 401 };
  }

  const storedChallenge = await consumeChallenge('signup', signupToken.trim());
  if (!storedChallenge) {
    return { error: 'Passkey registration session expired. Please try again.', status: 401 };
  }

  const verification = verifyRegistrationPayload({
    credential,
    expectedChallenge: storedChallenge.challenge,
    allowedOrigins: storedChallenge.allowedOrigins,
    expectedRpId: storedChallenge.rpId,
  });
  if (verification.error) {
    return verification;
  }

  const existingCredentialUser = await db.User.findOne({
    where: { passkeyCredentialId: verification.passkey.passkeyCredentialId },
  });
  if (existingCredentialUser) {
    return { error: 'This passkey is already registered to another account', status: 409 };
  }

  return verification;
}

// 3. Login: look up user by phone in Postgres users table; if passkey exists, return get() options
async function generateLoginOptions(phoneInput, req = null): Promise<ServiceResult> {
  const rawPhone = typeof phoneInput === 'string' ? phoneInput : phoneInput?.phone || '';
  const phone = db.User.normalizePhone(rawPhone);
  if (!db.User.isValidPhone(phone)) {
    return { error: 'Valid phone number required', status: 400 };
  }

  const user = await db.User.findOne({ where: { phone } });
  if (!user || !user.passkeyCredentialId || !user.passkeyPublicKey) {
    return {
      ok: true,
      hasPasskey: false,
      phone,
    };
  }

  const config = getWebAuthnConfig(req);
  const challenge = toBase64Url(crypto.randomBytes(32));

  await saveChallenge('login', user.id, {
    challenge,
    rpId: config.rpId,
    allowedOrigins: config.allowedOrigins,
    credentialId: user.passkeyCredentialId,
  });

  const allowCredential: { id: any; type: string; transports?: string[] } = {
    id: user.passkeyCredentialId,
    type: 'public-key',
  };
  if (Array.isArray(user.passkeyTransports) && user.passkeyTransports.length > 0) {
    allowCredential.transports = user.passkeyTransports;
  }

  return {
    ok: true,
    hasPasskey: true,
    phone,
    options: {
      challenge,
      rpId: config.rpId,
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials: [allowCredential],
    },
  };
}

// 4. Login: verify navigator.credentials.get() assertion against user's stored passkey & issue session
async function verifyLoginAssertion(phoneInput, credential): Promise<ServiceResult> {
  const rawPhone = typeof phoneInput === 'string' ? phoneInput : phoneInput?.phone || '';
  const phone = db.User.normalizePhone(rawPhone);
  if (!db.User.isValidPhone(phone)) {
    return { error: 'Valid phone number required', status: 400 };
  }

  const user = await db.User.findOne({ where: { phone } });
  if (!user || !user.passkeyCredentialId || !user.passkeyPublicKey) {
    return { error: 'No passkey found for this account', status: 401 };
  }

  const storedChallenge = await consumeChallenge('login', user.id);
  if (!storedChallenge) {
    return { error: 'Passkey login session expired. Please try again.', status: 401 };
  }

  const verification = verifyAssertionPayload({
    credential,
    user,
    expectedChallenge: storedChallenge.challenge,
    allowedOrigins: storedChallenge.allowedOrigins,
    expectedRpId: storedChallenge.rpId,
  });
  if (verification.error) {
    return verification;
  }

  if (verification.newCounter !== user.passkeyCounter) {
    await user.update({ passkeyCounter: verification.newCounter });
  }

  const sessionData = await sessionService.issueSessionForUser(user);
  return {
    ok: true,
    ...sessionData,
  };
}

// 5. Profile: generate registration options for an authenticated user without a passkey
async function generateProfileRegistrationOptions(userId, req = null): Promise<ServiceResult> {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const user = await db.User.findByPk(userId);
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  if (user.passkeyCredentialId) {
    return { error: 'A passkey is already registered for this account', status: 409 };
  }

  const config = getWebAuthnConfig(req);
  const challenge = toBase64Url(crypto.randomBytes(32));

  await saveChallenge('profile', user.id, {
    challenge,
    rpId: config.rpId,
    allowedOrigins: config.allowedOrigins,
  });

  const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone;

  return {
    ok: true,
    options: buildRegistrationOptions({
      challenge,
      rpId: config.rpId,
      rpName: config.rpName,
      userId: user.id,
      userName: user.phone,
      displayName,
    }),
  };
}

// 6. Profile: verify passkey registration and save to users table
async function verifyProfileRegistration(userId, credential): Promise<ServiceResult> {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const user = await db.User.findByPk(userId);
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  if (user.passkeyCredentialId) {
    return { error: 'A passkey is already registered for this account', status: 409 };
  }

  const storedChallenge = await consumeChallenge('profile', user.id);
  if (!storedChallenge) {
    return { error: 'Passkey registration session expired. Please try again.', status: 401 };
  }

  const verification = verifyRegistrationPayload({
    credential,
    expectedChallenge: storedChallenge.challenge,
    allowedOrigins: storedChallenge.allowedOrigins,
    expectedRpId: storedChallenge.rpId,
  });
  if (verification.error) {
    return verification;
  }

  const existingCredentialUser = await db.User.findOne({
    where: { passkeyCredentialId: verification.passkey.passkeyCredentialId },
  });
  if (existingCredentialUser && existingCredentialUser.id !== user.id) {
    return { error: 'This passkey is already registered to another account', status: 409 };
  }

  await user.update(verification.passkey);

  return {
    ok: true,
    user: db.User.toPublicUser(user),
  };
}

// 7. Profile: delete existing passkey from users table
async function deleteProfilePasskey(userId): Promise<ServiceResult> {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const user = await db.User.findByPk(userId);
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  if (!user.passkeyCredentialId) {
    return { error: 'No passkey found for this account', status: 404 };
  }

  await user.update({
    passkeyCredentialId: null,
    passkeyPublicKey: null,
    passkeyAlgorithm: null,
    passkeyCounter: 0,
    passkeyTransports: null,
    passkeyCreatedAt: null,
  });

  return {
    ok: true,
    user: db.User.toPublicUser(user),
  };
}

export = {
  CHALLENGE_PREFIX,
  CHALLENGE_TTL_SECONDS,
  SUPPORTED_ALGORITHMS,
  toBase64Url,
  fromBase64Url,
  decodeCbor,
  coseKeyToSpki,
  parseAuthenticatorData,
  getWebAuthnConfig,
  getClient,
  setClient,
  getChallengeKey,
  verifyRegistrationPayload,
  verifyAssertionPayload,
  generateSignupRegistrationOptions,
  verifySignupRegistration,
  generateLoginOptions,
  verifyLoginAssertion,
  generateProfileRegistrationOptions,
  verifyProfileRegistration,
  deleteProfilePasskey,
};
