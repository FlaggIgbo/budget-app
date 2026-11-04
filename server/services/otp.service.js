const crypto = require('crypto');
const { createClient } = require('redis');

const OTP_PREFIX = 'otp:';
const DEFAULT_TTL_SECONDS = 5 * 60; // 5 minutes in seconds

let redisClient = null;

// Generate random 6-digit OTP code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Build Redis key for an email address
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

// Save OTP in Redis with automatic expiration (TTL)
async function saveOtp(email, code, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const client = await getClient();
  const key = getOtpKey(email);
  await client.set(key, code, { EX: ttlSeconds });
}

// Get stored OTP for an email from Redis
async function getOtp(email) {
  const client = await getClient();
  const key = getOtpKey(email);
  return await client.get(key);
}

// Delete OTP for an email from Redis
async function deleteOtp(email) {
  const client = await getClient();
  const key = getOtpKey(email);
  await client.del(key);
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  generateCode,
  getOtpKey,
  getClient,
  setClient,
  saveOtp,
  getOtp,
  deleteOtp,
};
