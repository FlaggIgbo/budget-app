const crypto = require('crypto');
const { createClient } = require('redis');
const db = require('../models');
const emailService = require('./email.service');
const sessionService = require('./session.service');

const OTP_PREFIX = 'otp:';
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes in seconds

const SANDBOX_EMAIL = 'test@example.com';
const SANDBOX_OTP = '123456';

let redisClient = null;

// Check if running in sandbox or lower environment
function isSandboxMode() {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Generate random 6-digit OTP code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Build Redis key for an email address: otp:{email}
function getOtpKey(email) {
  return OTP_PREFIX + email;
}

// Get or connect to Redis client
async function getClient() {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = createClient({ url });

  client.on('error', (err) => {
    console.error('Redis error:', err.message);
  });

  await client.connect();
  redisClient = client;
  return redisClient;
}

// Allow overriding Redis client in tests
function setClient(customClient) {
  redisClient = customClient;
}

// SET code in Redis with automatic expiration (otp:{email} TTL)
async function saveOtp(email, code, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const client = await getClient();
  const key = getOtpKey(email);
  await client.set(key, code, { EX: ttlSeconds });
}

// GET stored OTP code for an email from Redis
async function getOtp(email) {
  const client = await getClient();
  const key = getOtpKey(email);
  return await client.get(key);
}

// DEL OTP code for an email from Redis
async function deleteOtp(email) {
  const client = await getClient();
  const key = getOtpKey(email);
  await client.del(key);
}

// Request OTP: generate 6-digit code, SET code in Redis with TTL, and send OTP email via Nodemailer
async function requestOtp(rawEmail) {
  const email = db.User.normalizeEmail(rawEmail);

  if (!db.User.isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }

  // In sandbox/lower environments, use dummy credentials without sending real email
  if (isSandboxMode()) {
    return { ok: true, message: 'OTP sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(email, code);
  await emailService.sendOtpEmail(email, code);

  return { ok: true, message: 'OTP sent' };
}

// Verify OTP: GET/compare code from Redis, DEL on match, and issue session via Session Service
async function verifyOtp(rawEmail, rawCode) {
  const email = db.User.normalizeEmail(rawEmail);
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';

  if (!db.User.isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }

  if (!code) {
    return { error: 'OTP required', status: 400 };
  }

  // Sandbox check: allow dummy email test@example.com with code 123456
  if (isSandboxMode()) {
    if (email === SANDBOX_EMAIL && code === SANDBOX_OTP) {
      const sessionData = await sessionService.issueSession(email);
      return { ok: true, ...sessionData };
    }
  }

  // Compare code against Redis (GET) and delete upon match (DEL)
  const storedCode = await getOtp(email);
  if (!storedCode || storedCode !== code) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  await deleteOtp(email);
  const sessionData = await sessionService.issueSession(email);
  return { ok: true, ...sessionData };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  isSandboxMode,
  generateCode,
  getOtpKey,
  getClient,
  setClient,
  saveOtp,
  getOtp,
  deleteOtp,
  requestOtp,
  verifyOtp,
};
