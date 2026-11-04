const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// TELLER API ADAPTER
// Handles all HTTP requests to https://api.teller.io using HTTP Basic Auth
// (username = accessToken, password = empty string) and mTLS client certs.
// ============================================================================

const TELLER_BASE_URL = 'https://api.teller.io';
const CERT_FILE =
  process.env.TELLER_CERT_PATH || path.join(__dirname, '../certs/teller/certificate.pem');
const KEY_FILE =
  process.env.TELLER_KEY_PATH || path.join(__dirname, '../certs/teller/private_key.pem');

// Return Teller Connect UI configuration (Teller equivalent of /link-token)
function getConnectConfig() {
  return {
    applicationId: process.env.TELLER_APPLICATION_ID || '',
    environment: process.env.TELLER_ENVIRONMENT || 'sandbox',
    products: ['balance', 'transactions', 'verify'],
  };
}

// Load mTLS client certificate for HTTPS if available (required in dev/production)
function getAgent() {
  let cert = process.env.TELLER_CERT || null;
  let key = process.env.TELLER_KEY || null;

  if (!cert && fs.existsSync(CERT_FILE)) {
    cert = fs.readFileSync(CERT_FILE);
  }
  if (!key && fs.existsSync(KEY_FILE)) {
    key = fs.readFileSync(KEY_FILE);
  }

  // Sandbox mode does not require client certificates
  if (!cert || !key) {
    return null;
  }

  return new https.Agent({
    cert,
    key,
    rejectUnauthorized: true,
  });
}

// Make an authenticated HTTPS request to the Teller API
function tellerRequest(accessToken, method, endpoint, body) {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const agent = getAgent();

  // Development and production require mTLS certificates
  if ((env === 'development' || env === 'production') && !agent) {
    return Promise.reject(
      new Error('Teller certificates required for development/production mode.')
    );
  }

  // Step 1: Build the full URL for the Teller endpoint
  let fullUrl = endpoint;
  if (!endpoint.startsWith('http')) {
    if (endpoint.startsWith('/')) {
      fullUrl = TELLER_BASE_URL + endpoint;
    } else {
      fullUrl = TELLER_BASE_URL + '/' + endpoint;
    }
  }

  // Step 2: Teller uses HTTP Basic Auth with the access_token as the username
  // and an empty password -> base64("accessToken:")
  const url = new URL(fullUrl);
  const basicAuth = Buffer.from(`${accessToken}:`).toString('base64');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    };

    if (agent) {
      options.agent = agent;
    }

    const req = https.request(options, (res) => {
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = rawData ? JSON.parse(rawData) : null;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const errorMsg =
              parsed?.error?.message ||
              parsed?.message ||
              parsed?.error ||
              `Bank provider error code: ${res.statusCode}`;
            reject(new Error(errorMsg));
          }
        } catch {
          reject(new Error(rawData || `Bank provider error code: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Teller.io API endpoints:
// - GET /accounts                           -> List all accounts for enrollment
// - GET /accounts/:account_id               -> Get single account details
// - GET /accounts/:account_id/balances      -> Get account ledger & available balances
// - GET /accounts/:account_id/transactions  -> List transactions (supports from_id, count, start_date, end_date)
// - DELETE /accounts/:account_id            -> Disconnect a single account
// - DELETE /accounts                        -> Disconnect entire enrollment (all accounts)
module.exports = {
  getConnectConfig,
  getAgent,
  getAccounts: (token) => tellerRequest(token, 'GET', '/accounts'),
  getAccount: (token, accountId) => tellerRequest(token, 'GET', `/accounts/${accountId}`),
  getBalances: (token, accountId) => tellerRequest(token, 'GET', `/accounts/${accountId}/balances`),
  getTransactions: (token, accountId, params = {}) => {
    const cleanParams = {};
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        cleanParams[key] = params[key];
      }
    }

    const query = new URLSearchParams(cleanParams).toString();
    let url = `/accounts/${accountId}/transactions`;
    if (query) {
      url += `?${query}`;
    }
    return tellerRequest(token, 'GET', url);
  },
  deleteAccount: (token, accountId) => tellerRequest(token, 'DELETE', `/accounts/${accountId}`),
  deleteEnrollment: (token) => tellerRequest(token, 'DELETE', '/accounts'),
};
