/**
 * Seed sandbox user in development/sandbox environments.
 * Ensures 555-555-5555 exists so login works without manual setup.
 */
const db = require('../models');

const SANDBOX_PHONE = '+15555555555';

function isSandboxEnv() {
  return (
    process.env.TELLER_ENVIRONMENT === 'sandbox' || process.env.NODE_ENV === 'development'
  );
}

async function seedSandboxUser() {
  if (!isSandboxEnv()) return;

  try {
    const [user] = await db.User.findOrCreate({
      where: { phone: SANDBOX_PHONE },
      defaults: { phone: SANDBOX_PHONE },
    });
    if (user.isNewRecord) {
      console.log(`Sandbox user seeded: ${SANDBOX_PHONE} (OTP: 123456)`);
    }
  } catch (err) {
    console.error('Sandbox seed failed:', err.message);
  }
}

module.exports = { seedSandboxUser };
