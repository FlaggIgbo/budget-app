const db = require('../models');
const { isSandboxMode } = require('../services/otp.service');

const SANDBOX_EMAIL = 'test@example.com';

// Create sandbox test user in database
async function seedSandboxUser() {
  if (!isSandboxMode()) {
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
