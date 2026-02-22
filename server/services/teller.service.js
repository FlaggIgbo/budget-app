/**
 * Teller API service - mTLS + HTTP Basic Auth.
 * Docs: https://teller.io/docs
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const TELLER_BASE = 'https://api.teller.io';
const CERT_PATH = process.env.TELLER_CERT_PATH || path.join(__dirname, '../certs/teller/certificate.pem');
const KEY_PATH = process.env.TELLER_KEY_PATH || path.join(__dirname, '../certs/teller/private_key.pem');

/**
 * Get mTLS agent. Uses file paths for local, or PEM from env for Render/Vercel.
 */
function getAgent() {
  const certPem = process.env.TELLER_CERT || (fs.existsSync(CERT_PATH) ? fs.readFileSync(CERT_PATH) : null);
  const keyPem = process.env.TELLER_KEY || (fs.existsSync(KEY_PATH) ? fs.readFileSync(KEY_PATH) : null);

  if (!certPem || !keyPem) {
    return null; // Sandbox doesn't require mTLS
  }

  return new https.Agent({
    cert: certPem,
    key: keyPem,
    rejectUnauthorized: true,
  });
}

/**
 * Make authenticated request to Teller API.
 * @param {string} accessToken - User's access token from Teller Connect
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. /accounts)
 * @param {object} [body] - Optional JSON body for POST/PUT
 */
function tellerRequest(accessToken, method, path, body) {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const agent = getAgent();

  // Sandbox doesn't require mTLS; development and production do
  if ((env === 'development' || env === 'production') && !agent) {
    return Promise.reject(new Error('Teller mTLS certificates required for development/production. Set TELLER_CERT and TELLER_KEY or TELLER_CERT_PATH and TELLER_KEY_PATH.'));
  }

  const url = new URL(path.startsWith('http') ? path : `${TELLER_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  const auth = Buffer.from(`${accessToken}:`).toString('base64');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      ...(agent && { agent }),
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed?.message || parsed?.error || `Teller API error: ${res.statusCode}`));
          }
        } catch {
          reject(new Error(data || `Teller API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    if (body && (method === 'POST' || method === 'PUT')) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

module.exports = {
  getAgent,
  getAccounts: (accessToken) => tellerRequest(accessToken, 'GET', '/accounts'),
  getAccount: (accessToken, accountId) => tellerRequest(accessToken, 'GET', `/accounts/${accountId}`),
  getBalances: (accessToken, accountId) => tellerRequest(accessToken, 'GET', `/accounts/${accountId}/balances`),
  getTransactions: (accessToken, accountId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return tellerRequest(accessToken, 'GET', `/accounts/${accountId}/transactions${qs ? `?${qs}` : ''}`);
  },
  deleteAccount: (accessToken, accountId) => tellerRequest(accessToken, 'DELETE', `/accounts/${accountId}`),
  deleteEnrollment: (accessToken) => tellerRequest(accessToken, 'DELETE', '/accounts'),
};
