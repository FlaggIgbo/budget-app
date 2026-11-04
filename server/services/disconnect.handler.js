const db = require('../models');
const bankAdapter = require('./teller.adapter');
const secretsVault = require('./secrets.vault');

// ============================================================================
// DISCONNECT HANDLER
// Revokes enrollment access at Teller API (DELETE /accounts) and purges all
// associated transactions, accounts, and enrollment records from the database.
// ============================================================================

async function disconnectInstitution(userId, enrollmentId) {
  // Step 1: Find the connected enrollment for this user
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return false;
  }

  // Step 2: Decrypt the access_token and call Teller API DELETE /accounts
  const accessToken = secretsVault.decryptToken(enrollment.accessToken);
  try {
    await bankAdapter.deleteEnrollment(accessToken);
  } catch {
    // Even if the token was already revoked on Teller's side, still purge local data
  }

  // Step 3: Cascade delete transactions, accounts, and enrollment in App Database
  await db.Transaction.destroy({
    where: { enrollmentId: enrollment.enrollmentId, userId },
  });

  await db.Account.destroy({
    where: { enrollmentId: enrollment.enrollmentId, userId },
  });

  await enrollment.destroy();

  return true;
}

module.exports = {
  disconnectInstitution,
};
