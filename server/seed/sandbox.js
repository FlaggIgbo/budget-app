const db = require('../models');

const SANDBOX_EMAIL = 'test@example.com';

// Check if we are running in sandbox or dev mode
function isSandboxEnv() {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Create sandbox test user in database
async function seedSandboxUser() {
  if (!isSandboxEnv()) {
    return;
  }

  try {
    const [user] = await db.User.findOrCreate({
      where: { email: SANDBOX_EMAIL },
      defaults: { email: SANDBOX_EMAIL },
    });
    if (user.isNewRecord) {
      console.log(`Created sandbox test user: ${SANDBOX_EMAIL} (Code: 123456)`);
    }
  } catch (err) {
    console.error('Failed to create test user:', err.message);
  }
}

module.exports = { seedSandboxUser };
