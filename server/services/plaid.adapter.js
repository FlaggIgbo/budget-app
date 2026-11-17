const https = require('https');

// ============================================================================
// PLAID API ADAPTER
// Handles all HTTPS requests to Plaid API (sandbox, development, production)
// using PLAID_CLIENT_ID and PLAID_SECRET.
// ============================================================================

const PLAID_ENVIRONMENTS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

const PLAID_VERSION = '2020-09-14';

// Return current Plaid environment name
function getEnvironment() {
  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  return PLAID_ENVIRONMENTS[env] ? env : 'sandbox';
}

// Return Plaid base URL for the active environment
function getBaseUrl() {
  const env = getEnvironment();
  return PLAID_ENVIRONMENTS[env];
}

// Check whether Plaid API credentials are configured
function isConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// Return public Plaid configuration for the client
function getConnectConfig() {
  return {
    plaidConfigured: isConfigured(),
    plaidEnvironment: getEnvironment(),
    products: (process.env.PLAID_PRODUCTS || 'transactions')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    countryCodes: (process.env.PLAID_COUNTRY_CODES || 'US')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  };
}

// Make an authenticated POST request to the Plaid API
function plaidRequest(endpoint, body = {}) {
  const clientId = process.env.PLAID_CLIENT_ID || '';
  const secret = process.env.PLAID_SECRET || '';

  if (!clientId || !secret) {
    return Promise.reject(
      new Error('Plaid credentials (PLAID_CLIENT_ID and PLAID_SECRET) are required.')
    );
  }

  const baseUrl = getBaseUrl();
  const fullUrl = endpoint.startsWith('http')
    ? endpoint
    : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const url = new URL(fullUrl);
  const payload = JSON.stringify({
    client_id: clientId,
    secret: secret,
    ...body,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Plaid-Version': PLAID_VERSION,
      },
    };

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
              parsed?.error_message ||
              parsed?.display_message ||
              parsed?.error_code ||
              `Plaid API error code: ${res.statusCode}`;
            reject(new Error(errorMsg));
          }
        } catch {
          reject(new Error(rawData || `Plaid API error code: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// Normalize a Plaid account object into the shape expected by the app
function normalizeAccount(plaidAccount) {
  return {
    id: plaidAccount.account_id || plaidAccount.id,
    account_id: plaidAccount.account_id || plaidAccount.id,
    name: plaidAccount.name || plaidAccount.official_name || 'Account',
    last_four: plaidAccount.mask || plaidAccount.last_four || '',
    type: plaidAccount.type || 'depository',
    subtype: plaidAccount.subtype || '',
    balances: plaidAccount.balances || {},
  };
}

// Format human-readable category from Plaid's personal_finance_category or legacy category array
function formatPlaidCategory(txn) {
  if (txn.personal_finance_category?.primary) {
    return txn.personal_finance_category.primary
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  if (Array.isArray(txn.category) && txn.category.length > 0) {
    return txn.category[0];
  }
  return txn.details?.category || 'Uncategorized';
}

// Normalize a Plaid transaction object.
// In Plaid, positive amounts are expenses (outflows) and negative amounts are income (inflows).
// Our app stores income as positive (+) and expenses as negative (-).
function normalizeTransaction(txn) {
  const rawAmount = parseFloat(txn.amount) || 0;
  return {
    id: txn.transaction_id || txn.id,
    transaction_id: txn.transaction_id || txn.id,
    account_id: txn.account_id,
    date: txn.date || txn.authorized_date,
    description: txn.merchant_name || txn.name || txn.description || 'Transaction',
    amount: rawAmount === 0 ? 0 : -rawAmount,
    category: formatPlaidCategory(txn),
  };
}

// Create a Link token for Plaid Link initialization in the browser
async function createLinkToken(userId) {
  const config = getConnectConfig();
  return await plaidRequest('/link/token/create', {
    user: { client_user_id: String(userId) },
    client_name: process.env.PLAID_CLIENT_NAME || 'Budget App',
    products: config.products,
    country_codes: config.countryCodes,
    language: 'en',
  });
}

// Exchange a Plaid Link public_token for a permanent access_token and item_id
async function exchangePublicToken(publicToken) {
  return await plaidRequest('/item/public_token/exchange', {
    public_token: publicToken,
  });
}

// Fetch accounts (and included balances) for an Item
async function getAccounts(accessToken) {
  const response = await plaidRequest('/accounts/get', {
    access_token: accessToken,
  });
  const accounts = Array.isArray(response?.accounts) ? response.accounts : [];
  return accounts.map(normalizeAccount);
}

// Fetch live balances for a specific account
async function getBalances(accessToken, accountId) {
  const options = accountId ? { account_ids: [accountId] } : undefined;
  const response = await plaidRequest('/accounts/balance/get', {
    access_token: accessToken,
    ...(options ? { options } : {}),
  });
  const accounts = Array.isArray(response?.accounts) ? response.accounts : [];
  const match = accountId
    ? accounts.find((a) => a.account_id === accountId) || accounts[0]
    : accounts[0];

  if (!match) {
    return { current: 0, available: 0 };
  }

  return {
    account_id: match.account_id,
    current: match.balances?.current ?? 0,
    available: match.balances?.available ?? match.balances?.current ?? 0,
    ledger: match.balances?.current ?? 0,
    iso_currency_code: match.balances?.iso_currency_code || 'USD',
  };
}

// Incremental transaction sync using Plaid's cursor-based /transactions/sync API
async function syncTransactions(accessToken, cursor = null, count = 250) {
  const body = {
    access_token: accessToken,
    count,
  };
  if (cursor) {
    body.cursor = cursor;
  }

  const response = await plaidRequest('/transactions/sync', body);
  const added = Array.isArray(response?.added) ? response.added.map(normalizeTransaction) : [];
  const modified = Array.isArray(response?.modified)
    ? response.modified.map(normalizeTransaction)
    : [];
  const removed = Array.isArray(response?.removed)
    ? response.removed.map((r) => r.transaction_id).filter(Boolean)
    : [];

  return {
    added,
    modified,
    removed,
    nextCursor: response?.next_cursor || cursor || null,
    hasMore: Boolean(response?.has_more),
  };
}

// Fetch transactions for a specific account via /transactions/get
async function getTransactions(accessToken, accountId, params = {}) {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear() - 1, now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultEnd = now.toISOString().slice(0, 10);

  const startDate = params.start_date || defaultStart;
  const endDate = params.end_date || defaultEnd;
  const count = parseInt(params.count, 10) || 100;

  const options = { count };
  if (accountId) {
    options.account_ids = [accountId];
  }

  const response = await plaidRequest('/transactions/get', {
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
    options,
  });

  const txns = Array.isArray(response?.transactions) ? response.transactions : [];
  return txns.map(normalizeTransaction);
}

// Remove an Item (disconnect bank enrollment) at Plaid
async function deleteEnrollment(accessToken) {
  return await plaidRequest('/item/remove', {
    access_token: accessToken,
  });
}

module.exports = {
  getEnvironment,
  getBaseUrl,
  isConfigured,
  getConnectConfig,
  plaidRequest,
  normalizeAccount,
  normalizeTransaction,
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  getBalances,
  syncTransactions,
  getTransactions,
  deleteEnrollment,
};
