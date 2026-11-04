const crypto = require('crypto');
const db = require('../models');

// ============================================================================
// SECRETS VAULT
// Encrypts and decrypts Teller access_tokens (one per enrollment / institution)
// ============================================================================

// Step 1: Turn our secret string into a 32-byte key for AES-256 encryption
function getEncryptionKey() {
  const rawSecret = process.env.TOKEN_ENCRYPTION_KEY || 'budget-app-default-encryption-key';
  return crypto.createHash('sha256').update(rawSecret).digest();
}

// Step 2: Encrypt a plain access_token before saving it to the database
function encryptToken(plainToken) {
  if (!plainToken) {
    return '';
  }

  const iv = crypto.randomBytes(16);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(plainToken, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Store as "iv:ciphertext" so we have the IV when decrypting later
  return iv.toString('hex') + ':' + encrypted;
}

// Step 3: Decrypt a stored access_token when we need to call Teller API
function decryptToken(storedToken) {
  if (!storedToken || !storedToken.includes(':')) {
    return storedToken;
  }

  try {
    const parts = storedToken.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return storedToken;
  }
}

// Step 4: Save an encrypted access_token for one enrollment (institution)
async function storeEnrollmentToken(userId, { enrollmentId, accessToken, institutionName }) {
  const encryptedToken = encryptToken(accessToken);

  const [enrollment] = await db.Enrollment.findOrCreate({
    where: { enrollmentId },
    defaults: {
      accessToken: encryptedToken,
      institutionName: institutionName || null,
      userId,
    },
  });

  if (!enrollment.isNewRecord) {
    await enrollment.update({
      accessToken: encryptedToken,
      institutionName: institutionName || enrollment.institutionName,
      userId,
    });
  }

  return enrollment;
}

module.exports = {
  encryptToken,
  decryptToken,
  storeEnrollmentToken,
};
