import type { ServiceResult } from '../../types';
import crypto = require('crypto');
import { createClient } from 'redis';
import db = require('../../models');
import envConfigModule = require('../../config/env.config');
const { getAppEnvironment } = envConfigModule;
import emailService = require('../communications/email.service');
import smsService = require('../communications/sms.service');
import sessionService = require('./session.service');
import passkeyService = require('./passkey.service');

const OTP_PREFIX = 'otp:';
const SIGNUP_PREFIX = 'signup:';
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes in seconds
const SIGNUP_TTL_SECONDS = 15 * 60; // 15 minutes in seconds

const SANDBOX_PHONE = '+15551234567';
const SANDBOX_OTP = '123456';

let redisClient = null;

// Check if running in non-production sandbox/development mode (strictly disabled in production)
function isSandboxMode() {
  if (getAppEnvironment() === 'production') {
    return false;
  }
  const explicitEnv = (process.env.ENV || process.env.env || process.env.VERCEL_ENV || '')
    .trim()
    .toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const plaidEnv = (process.env.PLAID_ENV || 'sandbox').trim().toLowerCase();
  return (
    explicitEnv === 'development' ||
    explicitEnv === 'dev' ||
    explicitEnv === 'preview' ||
    nodeEnv === 'development' ||
    plaidEnv === 'sandbox' ||
    plaidEnv === 'development'
  );
}

// Generate random 6-digit OTP code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Generate random opaque token for pending phone-verified signup sessions
function generateSignupToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Build Redis key for a phone number or email address: otp:{identifier} or otp:{scope}:{identifier}
function getOtpKey(identifier, scope = null) {
  if (scope) {
    return `${OTP_PREFIX}${scope}:${identifier}`;
  }
  return OTP_PREFIX + identifier;
}

// Build Redis key for a pending signup session: signup:{token}
function getSignupKey(token) {
  return SIGNUP_PREFIX + token;
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
async function saveOtp(identifier, code, ttlSeconds = DEFAULT_TTL_SECONDS, scope = null) {
  const client = await getClient();
  const key = getOtpKey(identifier, scope);
  await client.set(key, code, { EX: ttlSeconds });
}

// GET stored OTP code for an identifier from Redis
async function getOtp(identifier, scope = null) {
  const client = await getClient();
  const key = getOtpKey(identifier, scope);
  return await client.get(key);
}

// DEL OTP code for an identifier from Redis
async function deleteOtp(identifier, scope = null) {
  const client = await getClient();
  const key = getOtpKey(identifier, scope);
  await client.del(key);
}

// Store a short-lived pending signup token proving phone OTP ownership
async function createPendingSignup(phone, ttlSeconds = SIGNUP_TTL_SECONDS) {
  const token = generateSignupToken();
  const client = await getClient();
  await client.set(getSignupKey(token), JSON.stringify({ phone }), { EX: ttlSeconds });
  return token;
}

// Retrieve pending signup data from Redis by token
async function getPendingSignup(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const client = await getClient();
  const raw = await client.get(getSignupKey(token.trim()));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.phone ? parsed : null;
  } catch {
    return null;
  }
}

// Update a pending signup payload in Redis (e.g., after email OTP verification)
async function updatePendingSignup(token, payload, ttlSeconds = SIGNUP_TTL_SECONDS) {
  if (!token || typeof token !== 'string') {
    return;
  }
  const client = await getClient();
  await client.set(getSignupKey(token.trim()), JSON.stringify(payload), { EX: ttlSeconds });
}

// Delete a pending signup token from Redis
async function deletePendingSignup(token) {
  if (!token || typeof token !== 'string') {
    return;
  }
  const client = await getClient();
  await client.del(getSignupKey(token.trim()));
}

// Extract and validate a phone number
function parsePhoneInput(input): ServiceResult {
  const rawPhone = typeof input === 'string' ? input : input?.phone || '';
  const phone = db.User.normalizePhone(rawPhone);
  if (!db.User.isValidPhone(phone)) {
    return { error: 'Valid phone number required', status: 400 };
  }
  return { phone };
}

// Extract and validate an email address
function parseEmailInput(input): ServiceResult {
  const rawEmail = typeof input === 'string' ? input : input?.email || '';
  const email = db.User.normalizeEmail(rawEmail);
  if (!db.User.isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }
  return { email };
}

// Request login/signup OTP via Phone SMS (Twilio)
async function requestOtp(input): Promise<ServiceResult> {
  const parsed = parsePhoneInput(input);
  if (parsed.error) {
    return parsed;
  }

  // In sandbox/lower environments, use dummy code without sending real SMS
  if (isSandboxMode()) {
    return { ok: true, message: 'OTP sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(parsed.phone, code);
  await smsService.sendOtpSms(parsed.phone, code);

  return { ok: true, message: 'OTP sent' };
}

// Verify login/signup phone OTP:
// - If an account exists for this phone number, issue a session and return requiresSignup: false.
// - If no account exists yet, issue a pending signup token and return requiresSignup: true.
async function verifyOtp(input, rawCode): Promise<ServiceResult> {
  const parsed = parsePhoneInput(input);
  if (parsed.error) {
    return parsed;
  }

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) {
    return { error: 'OTP required', status: 400 };
  }

  let verified = false;
  if (isSandboxMode() && code === SANDBOX_OTP) {
    verified = true;
  } else {
    const storedCode = await getOtp(parsed.phone);
    if (storedCode && storedCode === code) {
      await deleteOtp(parsed.phone);
      verified = true;
    }
  }

  if (!verified) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  const existingUser = await db.User.findOne({ where: { phone: parsed.phone } });
  if (existingUser) {
    const sessionData = await sessionService.issueSessionForUser(existingUser);
    return {
      ok: true,
      requiresSignup: false,
      ...sessionData,
    };
  }

  // No account exists for this phone number yet; require signup with name + verified email
  const signupToken = await createPendingSignup(parsed.phone);
  return {
    ok: true,
    requiresSignup: true,
    phone: parsed.phone,
    signupToken,
  };
}

// Request a 6-digit email OTP during new-account signup to confirm ownership of the email address
async function requestSignupEmailOtp(signupToken, emailInput): Promise<ServiceResult> {
  const pending = await getPendingSignup(signupToken);
  if (!pending) {
    return {
      error: 'Signup session expired. Please verify your phone number again.',
      status: 401,
    };
  }

  const existingPhoneUser = await db.User.findOne({ where: { phone: pending.phone } });
  if (existingPhoneUser) {
    await deletePendingSignup(signupToken);
    return { error: 'An account already exists for this phone number', status: 409 };
  }

  const parsed = parseEmailInput(emailInput);
  if (parsed.error) {
    return parsed;
  }

  const existingEmailUser = await db.User.findOne({ where: { email: parsed.email } });
  if (existingEmailUser) {
    return { error: 'Email address is already associated with another account', status: 409 };
  }

  if (isSandboxMode()) {
    return { ok: true, message: 'Verification code sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(parsed.email, code, DEFAULT_TTL_SECONDS, 'signup');
  await emailService.sendOtpEmail(parsed.email, code);

  return { ok: true, message: 'Verification code sent' };
}

// Verify email OTP during signup and mark the pending signup ready for passkey creation
async function verifySignupEmailOtp({
  signupToken,
  firstName,
  lastName,
  email,
  code: rawCode,
}): Promise<ServiceResult> {
  const pending = await getPendingSignup(signupToken);
  if (!pending) {
    return {
      error: 'Signup session expired. Please verify your phone number again.',
      status: 401,
    };
  }

  const cleanFirstName = db.User.normalizeName(firstName);
  if (!db.User.isValidName(cleanFirstName)) {
    return { error: 'First name is required', status: 400 };
  }

  const cleanLastName = db.User.normalizeName(lastName);
  if (!db.User.isValidName(cleanLastName)) {
    return { error: 'Last name is required', status: 400 };
  }

  const parsedEmail = parseEmailInput(email);
  if (parsedEmail.error) {
    return parsedEmail;
  }

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) {
    return { error: 'OTP required', status: 400 };
  }

  const existingPhoneUser = await db.User.findOne({ where: { phone: pending.phone } });
  if (existingPhoneUser) {
    await deletePendingSignup(signupToken);
    return { error: 'An account already exists for this phone number', status: 409 };
  }

  const existingEmailUser = await db.User.findOne({ where: { email: parsedEmail.email } });
  if (existingEmailUser) {
    return { error: 'Email address is already associated with another account', status: 409 };
  }

  let verified = false;
  if (isSandboxMode() && code === SANDBOX_OTP) {
    verified = true;
  } else {
    const storedCode = await getOtp(parsedEmail.email, 'signup');
    if (storedCode && storedCode === code) {
      await deleteOtp(parsedEmail.email, 'signup');
      verified = true;
    }
  }

  if (!verified) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  const updatedPending = {
    phone: pending.phone,
    firstName: cleanFirstName,
    lastName: cleanLastName,
    email: parsedEmail.email,
    emailVerified: true,
    pendingUserId: pending.pendingUserId || crypto.randomUUID(),
  };

  await updatePendingSignup(signupToken, updatedPending);

  return {
    ok: true,
    emailVerified: true,
    phone: updatedPending.phone,
    email: updatedPending.email,
  };
}

// Complete signup: verify passkey (required unless skipPasskey: true after an error), create the
// User record in PostgreSQL, and issue a 1-hour Redis session.
async function completeSignup({
  signupToken,
  firstName,
  lastName,
  email,
  code: rawCode,
  passkeyCredential,
  skipPasskey = false,
}: {
  signupToken?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  code?: string;
  passkeyCredential?: any;
  skipPasskey?: boolean;
}): Promise<ServiceResult> {
  const pending = await getPendingSignup(signupToken);
  if (!pending) {
    return {
      error: 'Signup session expired. Please verify your phone number again.',
      status: 401,
    };
  }

  let cleanFirstName;
  let cleanLastName;
  let verifiedEmail;

  if (pending.emailVerified && pending.firstName && pending.lastName && pending.email) {
    cleanFirstName = pending.firstName;
    cleanLastName = pending.lastName;
    verifiedEmail = pending.email;
  } else {
    cleanFirstName = db.User.normalizeName(firstName);
    if (!db.User.isValidName(cleanFirstName)) {
      return { error: 'First name is required', status: 400 };
    }

    cleanLastName = db.User.normalizeName(lastName);
    if (!db.User.isValidName(cleanLastName)) {
      return { error: 'Last name is required', status: 400 };
    }

    const parsedEmail = parseEmailInput(email);
    if (parsedEmail.error) {
      return parsedEmail;
    }
    verifiedEmail = parsedEmail.email;

    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!code) {
      return { error: 'OTP required', status: 400 };
    }

    let verified = false;
    if (isSandboxMode() && code === SANDBOX_OTP) {
      verified = true;
    } else {
      const storedCode = await getOtp(verifiedEmail, 'signup');
      if (storedCode && storedCode === code) {
        await deleteOtp(verifiedEmail, 'signup');
        verified = true;
      }
    }

    if (!verified) {
      return { error: 'Invalid or expired OTP', status: 401 };
    }
  }

  const existingPhoneUser = await db.User.findOne({ where: { phone: pending.phone } });
  if (existingPhoneUser) {
    await deletePendingSignup(signupToken);
    return { error: 'An account already exists for this phone number', status: 409 };
  }

  const existingEmailUser = await db.User.findOne({ where: { email: verifiedEmail } });
  if (existingEmailUser) {
    return { error: 'Email address is already associated with another account', status: 409 };
  }

  // Passkey creation is required for signup unless the user explicitly skipped after an error
  let passkeyFields = {
    passkeyCredentialId: null,
    passkeyPublicKey: null,
    passkeyAlgorithm: null,
    passkeyCounter: 0,
    passkeyTransports: null,
    passkeyCreatedAt: null,
  };

  if (passkeyCredential) {
    const passkeyVerification = await passkeyService.verifySignupRegistration(
      signupToken,
      passkeyCredential
    );
    if (passkeyVerification.error) {
      return passkeyVerification;
    }
    passkeyFields = passkeyVerification.passkey;
  } else if (skipPasskey !== true) {
    return { error: 'Passkey creation is required to complete signup', status: 400 };
  }

  // Create the new user in PostgreSQL (password column remains null until password login is implemented)
  const user = await db.User.create({
    firstName: cleanFirstName,
    lastName: cleanLastName,
    phone: pending.phone,
    email: verifiedEmail,
    password: null, // TODO: Hash and store password here if switching to username/password signup
    ...passkeyFields,
  });

  await deletePendingSignup(signupToken);

  const sessionData = await sessionService.issueSessionForUser(user);
  return {
    ok: true,
    ...sessionData,
  };
}

// Resolve whether a profile contact change targets an email address or a phone number
function parseContactChangeInput(input): ServiceResult {
  if (typeof input === 'string') {
    const parsed = parseEmailInput(input);
    return parsed.error ? parsed : { type: 'email', value: parsed.email };
  }

  const explicitType = typeof input?.type === 'string' ? input.type.trim().toLowerCase() : '';
  if (explicitType === 'phone' || (!explicitType && input?.phone && !input?.email)) {
    const parsed = parsePhoneInput(input?.phone);
    return parsed.error ? parsed : { type: 'phone', value: parsed.phone };
  }

  if (explicitType === 'email' || (!explicitType && input?.email)) {
    const parsed = parseEmailInput(input?.email);
    return parsed.error ? parsed : { type: 'email', value: parsed.email };
  }

  return { error: 'Valid email address or phone number required', status: 400 };
}

// Request OTP to verify a new email address or phone number before updating a logged-in user's profile
async function requestContactOtp(userId, input): Promise<ServiceResult> {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const parsed = parseContactChangeInput(input);
  if (parsed.error) {
    return parsed;
  }

  const user = await db.User.findByPk(userId);
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  if (parsed.type === 'email') {
    if (user.email === parsed.value) {
      return { error: 'New email address must be different from your current email', status: 400 };
    }

    const existingUser = await db.User.findOne({ where: { email: parsed.value } });
    if (existingUser && existingUser.id !== userId) {
      return { error: 'Email address is already associated with another account', status: 409 };
    }

    if (isSandboxMode()) {
      return { ok: true, message: 'Verification code sent (sandbox: use 123456)' };
    }

    const code = generateCode();
    await saveOtp(parsed.value, code, DEFAULT_TTL_SECONDS, `contact:${userId}`);
    await emailService.sendOtpEmail(parsed.value, code);

    return { ok: true, message: 'Verification code sent' };
  }

  // Phone number change
  if (user.phone === parsed.value) {
    return {
      error: 'New phone number must be different from your current phone number',
      status: 400,
    };
  }

  const existingUser = await db.User.findOne({ where: { phone: parsed.value } });
  if (existingUser && existingUser.id !== userId) {
    return { error: 'Phone number is already associated with another account', status: 409 };
  }

  if (isSandboxMode()) {
    return { ok: true, message: 'Verification code sent (sandbox: use 123456)' };
  }

  const code = generateCode();
  await saveOtp(parsed.value, code, DEFAULT_TTL_SECONDS, `contact:${userId}`);
  await smsService.sendOtpSms(parsed.value, code);

  return { ok: true, message: 'Verification code sent' };
}

// Verify OTP and update the logged-in user's email address or phone number in PostgreSQL
async function verifyContactOtp(userId, input, rawCode): Promise<ServiceResult> {
  if (!userId) {
    return { error: 'Not authenticated', status: 401 };
  }

  const parsed = parseContactChangeInput(input);
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

  if (parsed.type === 'email') {
    if (user.email === parsed.value) {
      return { error: 'New email address must be different from your current email', status: 400 };
    }

    const existingUser = await db.User.findOne({ where: { email: parsed.value } });
    if (existingUser && existingUser.id !== userId) {
      return { error: 'Email address is already associated with another account', status: 409 };
    }
  } else {
    if (user.phone === parsed.value) {
      return {
        error: 'New phone number must be different from your current phone number',
        status: 400,
      };
    }

    const existingUser = await db.User.findOne({ where: { phone: parsed.value } });
    if (existingUser && existingUser.id !== userId) {
      return { error: 'Phone number is already associated with another account', status: 409 };
    }
  }

  const scope = `contact:${userId}`;
  let verified = false;
  if (isSandboxMode() && code === SANDBOX_OTP) {
    verified = true;
  } else {
    const storedCode = await getOtp(parsed.value, scope);
    if (storedCode && storedCode === code) {
      await deleteOtp(parsed.value, scope);
      verified = true;
    }
  }

  if (!verified) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  if (parsed.type === 'email') {
    await user.update({ email: parsed.value });
  } else {
    await user.update({ phone: parsed.value });
  }

  return {
    ok: true,
    user: db.User.toPublicUser(user),
  };
}

export = {
  DEFAULT_TTL_SECONDS,
  SIGNUP_TTL_SECONDS,
  SANDBOX_PHONE,
  SANDBOX_OTP,
  isSandboxMode,
  generateCode,
  generateSignupToken,
  getOtpKey,
  getSignupKey,
  getClient,
  setClient,
  saveOtp,
  getOtp,
  deleteOtp,
  createPendingSignup,
  getPendingSignup,
  updatePendingSignup,
  deletePendingSignup,
  requestOtp,
  verifyOtp,
  requestSignupEmailOtp,
  verifySignupEmailOtp,
  completeSignup,
  requestContactOtp,
  verifyContactOtp,
};
