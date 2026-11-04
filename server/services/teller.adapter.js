const https = require('https');
const fs = require('fs');
const path = require('path');

const TELLER_BASE_URL = 'https://api.teller.io';
const CERT_FILE =
  process.env.TELLER_CERT_PATH || path.join(__dirname, '../certs/teller/certificate.pem');
const KEY_FILE =
  process.env.TELLER_KEY_PATH || path.join(__dirname, '../certs/teller/private_key.pem');

// Load certificate for HTTPS if available
function getAgent() {
  let cert = process.env.TELLER_CERT || null;
  let key = process.env.TELLER_KEY || null;

  if (!cert && fs.existsSync(CERT_FILE)) {
    cert = fs.readFileSync(CERT_FILE);
  }
  if (!key && fs.existsSync(KEY_FILE)) {
    key = fs.readFileSync(KEY_FILE);
  }

  // If no certs found, return null (sandbox mode does not need certs)
  if (!cert || !key) {
    return null;
  }

  return new https.Agent({
    cert,
    key,
    rejectUnauthorized: true,
  });
}

// Make HTTP request to Teller API (only this adapter knows Teller exists)
function tellerRequest(accessToken, method, endpoint, body) {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const agent = getAgent();

  // Development and production require certificates
  if ((env === 'development' || env === 'production') && !agent) {
    return Promise.reject(
      new Error('Teller certificates required for development/production mode.')
    );
  }

  // Build the full URL for the Teller endpoint
  let fullUrl = endpoint;
  if (!endpoint.startsWith('http')) {
    if (endpoint.startsWith('/')) {
      fullUrl = TELLER_BASE_URL + endpoint;
    } else {
      fullUrl = TELLER_BASE_URL + '/' + endpoint;
    }
  }

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
              parsed?.message || parsed?.error || `Bank provider error code: ${res.statusCode}`;
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

// Provider adapter interface for bank operations
module.exports = {
  getAgent,
  getAccounts: (token) => tellerRequest(token, 'GET', '/accounts'),
  getAccount: (token, accountId) => tellerRequest(token, 'GET', `/accounts/${accountId}`),
  getBalances: (token, accountId) => tellerRequest(token, 'GET', `/accounts/${accountId}/balances`),
  getTransactions: (token, accountId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    let url = `/accounts/${accountId}/transactions`;
    if (query) {
      url += `?${query}`;
    }
    return tellerRequest(token, 'GET', url);
  },
  deleteAccount: (token, accountId) => tellerRequest(token, 'DELETE', `/accounts/${accountId}`),
  deleteEnrollment: (token) => tellerRequest(token, 'DELETE', '/accounts'),
};
