const crypto = require('crypto');
const { createClient } = require('redis');
const db = require('../models');
const emailService = require('./email.service');
const smsService = require('./sms.service');
const sessionService = require('./session.service');

const OTP_PREFIX = 'otp:';
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes in seconds

const SANDBOX_PHONE = '+15551234567';
const SANDBOX_OTP = '123456';

let redisClient = null;

// Check if running in sandbox or lower environment
function isSandboxMode() {
  const env = process.env.PLAID_ENV || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Generate random 6-digit OTP code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Build Redis key for a phone number or email address: otp:{identifier}
function getOtpKey(identifier) {
  return OTP_PREFIX + identifier;
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

// SET code in Redis with automatic expiration (otp:{identifier} TTL)
async function saveOtp(identifier, code, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const client = await getClient();
  const key = getOtpKey(identifier);
  await client.set(key, code, { EX: ttlSeconds });
}

// GET stored OTP code for an identifier from Redis
async function getOtp(identifier) {
  const client = await getClient();
  const key = getOtpKey(identifier);
  return await client.get(key);
}

// DEL OTP code for an identifier from Redis
async function deleteOtp(identifier) {
  const client = await getClient();
  const key = getOtpKey(identifier);
  await client.del(key);
}

// Extract and validate a phone number for login / signup
function parsePhoneInput(input) {
  const rawPhone = typeof input === 'string' ? input : input?.phone || '';
  const phone = db.User.normalizePhone(rawPhone);
  if (!db.User.isValidPhone(phone)) {
    return { error: 'Valid phone number required', status: 400 };
  }
  return { phone };
}

// Extract and validate an email address for profile linking
function parseEmailInput(input) {
  const rawEmail = typeof input === 'string' ? input : input?.email || '';
  const email = db.User.normalizeEmail(rawEmail);
  if (!db.User.isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }
  return { email };
}

// Request login/signup OTP via Phone SMS (Twilio)
async function requestOtp(input) {
  const parsed = parsePhoneInput(input);
  if (parsed.error) {
    return parsed;
  }

  // In sandbox/lower environments, use dummy credentials without sending real SMS
  if (isSandboxMode()) {
    return { ok: true, message: 'OTP sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(parsed.phone, code);
  await smsService.sendOtpSms(parsed.phone, code);

  return { ok: true, message: 'OTP sent' };
}

// Verify login/signup phone OTP: GET/compare code from Redis, DEL on match, and issue session
async function verifyOtp(input, rawCode) {
  const parsed = parsePhoneInput(input);
  if (parsed.error) {
    return parsed;
  }

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) {
    return { error: 'OTP required', status: 400 };
  }

  // Sandbox check: allow dummy phone +15551234567 with code 123456
  if (isSandboxMode()) {
    if (parsed.phone === SANDBOX_PHONE && code === SANDBOX_OTP) {
      const sessionData = await sessionService.issueSession(parsed.phone);
      return { ok: true, ...sessionData };
    }
  }

  // Compare code against Redis (GET) and delete upon match (DEL)
  const storedCode = await getOtp(parsed.phone);
  if (!storedCode || storedCode !== code) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  await deleteOtp(parsed.phone);
  const sessionData = await sessionService.issueSession(parsed.phone);
  return { ok: true, ...sessionData };
}

// Request OTP to verify and link an email address to a logged-in user's profile
async function requestContactOtp(userId, input) {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const parsed = parseEmailInput(input);
  if (parsed.error) {
    return parsed;
  }

  // Ensure the email is not already linked to a different user
  const existingUser = await db.User.findOne({ where: { email: parsed.email } });
  if (existingUser && existingUser.id !== userId) {
    return { error: 'Email address is already associated with another account', status: 409 };
  }

  if (isSandboxMode()) {
    return { ok: true, message: 'Verification code sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(parsed.email, code);
  await emailService.sendOtpEmail(parsed.email, code);

  return { ok: true, message: 'Verification code sent' };
}

// Verify email OTP and upsert the verified email onto the logged-in user's profile in PostgreSQL
async function verifyContactOtp(userId, input, rawCode) {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const parsed = parseEmailInput(input);
  if (parsed.error) {
    return parsed;
  }

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) {
    return { error: 'OTP required', status: 400 };
  }

  const user = await db.User.findByPk(userId);
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  // Ensure the email was not claimed by another user in the meantime
  const existingUser = await db.User.findOne({ where: { email: parsed.email } });
  if (existingUser && existingUser.id !== userId) {
    return { error: 'Email address is already associated with another account', status: 409 };
  }

  // Verify the OTP code before updating the database
  let verified = false;
  if (isSandboxMode() && code === SANDBOX_OTP) {
    verified = true;
  } else {
    const storedCode = await getOtp(parsed.email);
    if (storedCode && storedCode === code) {
      await deleteOtp(parsed.email);
      verified = true;
    }
  }

  if (!verified) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  // Upsert the verified email onto the user profile record
  await user.update({ email: parsed.email });

  return {
    ok: true,
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email || null,
    },
  };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  SANDBOX_PHONE,
  SANDBOX_OTP,
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
  requestContactOtp,
  verifyContactOtp,
};
