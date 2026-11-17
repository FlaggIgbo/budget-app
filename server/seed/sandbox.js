const db = require('../models');
const { isSandboxMode, SANDBOX_PHONE } = require('../services/otp.service');

// Create sandbox test user in database
async function seedSandboxUser() {
  if (!isSandboxMode()) {
    return;
  }

  try {
    const [user] = await db.User.findOrCreate({
      where: { phone: SANDBOX_PHONE },
      defaults: { phone: SANDBOX_PHONE },
    });
    if (user.isNewRecord) {
      console.log(`Created sandbox test user: ${SANDBOX_PHONE} (Code: 123456)`);
    }
  } catch (err) {
    console.error('Failed to create test user:', err.message);
  }
}

module.exports = { seedSandboxUser };
