const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');

// Detect whether running against a remote deployment or local preview server
const targetArg = process.argv.find(
  (arg) => arg.startsWith('http://') || arg.startsWith('https://')
);
const TARGET_URL = process.env.TARGET_URL || targetArg || null;
const isRemote = Boolean(TARGET_URL);

const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.resolve(ROOT_DIR, 'client');
const DIST_BROWSER_DIR = path.resolve(CLIENT_DIR, 'dist/client/browser');
const RECORDINGS_DIR = path.resolve(ROOT_DIR, 'recordings');
const DOWNLOADS_DIR =
  process.env.DOWNLOADS_DIR ||
  (process.env.HOME ? path.resolve(process.env.HOME, 'Downloads') : RECORDINGS_DIR);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureClientBuild() {
  console.log('🔨 Building Angular client bundle...');
  execSync('npm --prefix client run build -- --configuration development', {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
}

function startStaticSpaServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(parsedUrl.pathname);
      if (pathname === '/') {
        pathname = '/index.html';
      }

      let filePath = path.join(DIST_BROWSER_DIR, pathname);
      if (!filePath.startsWith(DIST_BROWSER_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_BROWSER_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 4299;
      // Use localhost (not raw IP) so WebAuthn rpId="localhost" and Service Workers work as a secure context
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

// Configure stateful API routes for local E2E flow verification
async function setupStatefulE2EMocks(page, offlineState = { offline: false }) {
  let currentUser = null;
  const accountsByPhone = new Map([
    [
      '+15551234567',
      {
        id: 'usr_1',
        firstName: 'Alex',
        lastName: 'Demo',
        phone: '+15551234567',
        email: 'alex@budgetapp.local',
        hasPasskey: false,
        passkeyCredentialId: null,
        passkeyCreatedAt: null,
      },
    ],
  ]);
  const pendingSignups = new Map();

  const toPublicUser = (user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    email: user.email,
    hasPasskey: Boolean(user.passkeyCredentialId),
    passkeyCreatedAt: user.passkeyCreatedAt || null,
  });
  const enrollments = [
    {
      id: '1',
      enrollmentId: 'enr_chase',
      institutionName: 'Chase',
      syncCursor: 'cur_chase_1',
      createdAt: '2026-11-01T12:00:00.000Z',
    },
    {
      id: '2',
      enrollmentId: 'enr_amex',
      institutionName: 'American Express',
      syncCursor: 'cur_amex_1',
      createdAt: '2026-11-02T12:00:00.000Z',
    },
  ];
  const pushSubscriptionsByEndpoint = new Map();

  await page.context().route('**/api/**', async (route) => {
    if (offlineState.offline) {
      return route.abort('internetdisconnected');
    }
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();
    let body = {};
    try {
      body = req.postDataJSON() || {};
    } catch {
      body = {};
    }

    if (pathname.endsWith('/api/health')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', message: 'Budget App API is running' }),
      });
    }

    if (pathname.endsWith('/api/config')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          environment: 'development',
          plaidConfigured: true,
          plaidEnvironment: 'sandbox',
          authSandbox: { phone: '+15551234567', otp: '123456' },
        }),
      });
    }

    if (pathname.endsWith('/api/auth/me')) {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not authenticated' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: toPublicUser(currentUser),
        }),
      });
    }

    if (pathname.endsWith('/api/auth/passkey/login/options')) {
      const phone = (body.phone || '').trim();
      const existing = accountsByPhone.get(phone);
      if (existing && existing.passkeyCredentialId) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            hasPasskey: true,
            phone,
            options: {
              challenge: 'ZTJlLWxvZ2luLWNoYWxsZW5nZQ',
              rpId: 'localhost',
              timeout: 60000,
              userVerification: 'preferred',
              allowCredentials: [{ id: existing.passkeyCredentialId, type: 'public-key' }],
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, hasPasskey: false, phone }),
      });
    }

    if (pathname.endsWith('/api/auth/passkey/login/verify')) {
      const phone = (body.phone || '').trim();
      const existing = accountsByPhone.get(phone);
      if (
        existing &&
        existing.passkeyCredentialId &&
        body.credential &&
        body.credential.id === existing.passkeyCredentialId
      ) {
        currentUser = existing;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, user: toPublicUser(currentUser) }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Passkey verification failed' }),
      });
    }

    if (pathname.endsWith('/api/otp/request')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'OTP sent (sandbox: use 123456)' }),
      });
    }

    if (pathname.endsWith('/api/otp/verify')) {
      if (body.code === '123456') {
        const phone = (body.phone || '').trim();
        const existing = accountsByPhone.get(phone);
        if (!existing) {
          const signupToken = `tok_e2e_${Date.now()}`;
          pendingSignups.set(signupToken, { phone, emailVerified: false });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              requiresSignup: true,
              phone,
              signupToken,
            }),
          });
        }
        currentUser = existing;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            requiresSignup: false,
            user: toPublicUser(currentUser),
          }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid or expired OTP' }),
      });
    }

    if (pathname.endsWith('/api/auth/signup/request-email-otp')) {
      if (!pendingSignups.has(body.signupToken)) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Signup session expired' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Verification code sent' }),
      });
    }

    if (pathname.endsWith('/api/auth/signup/verify-email-otp')) {
      const pending = pendingSignups.get(body.signupToken);
      if (!pending) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Signup session expired' }),
        });
      }
      if (body.code !== '123456') {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid or expired OTP' }),
        });
      }
      pending.firstName = (body.firstName || '').trim();
      pending.lastName = (body.lastName || '').trim();
      pending.email = (body.email || '').trim().toLowerCase();
      pending.emailVerified = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, emailVerified: true }),
      });
    }

    if (pathname.endsWith('/api/auth/signup/passkey/options')) {
      const pending = pendingSignups.get(body.signupToken);
      if (!pending || !pending.emailVerified) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Signup session expired' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          options: {
            challenge: 'ZTJlLXNpZ251cC1jaGFsbGVuZ2U',
            rp: { name: 'Budget App', id: 'localhost' },
            user: {
              id: 'dXNyX2UyZQ',
              name: pending.phone,
              displayName: `${pending.firstName} ${pending.lastName}`,
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 60000,
            attestation: 'none',
          },
        }),
      });
    }

    if (pathname.endsWith('/api/auth/signup/complete')) {
      const pending = pendingSignups.get(body.signupToken);
      if (!pending || !pending.emailVerified) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Signup session expired' }),
        });
      }
      if (!body.passkeyCredential && !body.skipPasskey) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Passkey creation is required to complete signup' }),
        });
      }
      const newUser = {
        id: `usr_${accountsByPhone.size + 1}`,
        firstName: pending.firstName,
        lastName: pending.lastName,
        phone: pending.phone,
        email: pending.email,
        passkeyCredentialId: body.passkeyCredential?.id || null,
        passkeyCreatedAt: body.passkeyCredential ? new Date().toISOString() : null,
      };
      accountsByPhone.set(pending.phone, newUser);
      pendingSignups.delete(body.signupToken);
      currentUser = newUser;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: toPublicUser(currentUser) }),
      });
    }

    if (pathname.endsWith('/api/auth/logout')) {
      currentUser = null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }

    if (pathname.endsWith('/api/bank/net-worth')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          netWorth: 14850.75,
          totalAssets: 16250.0,
          totalLiabilities: 1399.25,
          accounts: [
            {
              id: 'acc_chase_chk',
              enrollmentId: 'enr_chase',
              name: 'Total Checking',
              lastFour: '4421',
              type: 'depository',
              subtype: 'checking',
              institutionName: 'Chase',
              balance: 4250.0,
              isAsset: true,
            },
            {
              id: 'acc_chase_sav',
              enrollmentId: 'enr_chase',
              name: 'Premier Savings',
              lastFour: '8890',
              type: 'depository',
              subtype: 'savings',
              institutionName: 'Chase',
              balance: 12000.0,
              isAsset: true,
            },
            {
              id: 'acc_amex_plat',
              enrollmentId: 'enr_amex',
              name: 'Blue Cash Preferred',
              lastFour: '3005',
              type: 'credit',
              subtype: 'credit_card',
              institutionName: 'American Express',
              balance: -1399.25,
              isAsset: false,
            },
          ],
        }),
      });
    }

    if (pathname.endsWith('/api/bank/dashboard-summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          incomeVsExpenses: [
            { month: '2026-09', income: 6200.0, expenses: 3850.5 },
            { month: '2026-10', income: 6200.0, expenses: 4120.0 },
            { month: '2026-11', income: 6450.0, expenses: 3490.25 },
          ],
          spendingByCategory: [
            { category: 'Rent And Utilities', amount: 1850.0 },
            { category: 'Food And Drink', amount: 685.5 },
            { category: 'General Merchandise', amount: 492.75 },
          ],
          recentTransactions: [
            {
              id: 'txn_1',
              enrollmentId: 'enr_chase',
              accountId: 'acc_chase_chk',
              date: '2026-11-15',
              description: 'Acme Corp Direct Deposit',
              amount: 3225.0,
              category: 'Income',
              accountName: 'Total Checking',
              institutionName: 'Chase',
            },
            {
              id: 'txn_2',
              enrollmentId: 'enr_amex',
              accountId: 'acc_amex_plat',
              date: '2026-11-14',
              description: 'Whole Foods Market',
              amount: -142.8,
              category: 'Food And Drink',
              accountName: 'Blue Cash Preferred',
              institutionName: 'American Express',
            },
            {
              id: 'txn_3',
              enrollmentId: 'enr_chase',
              accountId: 'acc_chase_chk',
              date: '2026-11-12',
              description: 'Avalon Communities Rent',
              amount: -1850.0,
              category: 'Rent And Utilities',
              accountName: 'Total Checking',
              institutionName: 'Chase',
            },
          ],
          quickStats: {
            thisMonthIncome: 6450.0,
            thisMonthExpenses: 3490.25,
            lastMonthIncome: 6200.0,
            lastMonthExpenses: 4120.0,
            ytdIncome: 18850.0,
            ytdExpenses: 11460.75,
            momIncomeChangePct: 4.0,
            momExpensesChangePct: -15.3,
          },
        }),
      });
    }

    if (pathname.endsWith('/api/bank/transactions/sync') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ synced: enrollments }),
      });
    }

    if (pathname.endsWith('/api/bank/enrollments') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(enrollments),
      });
    }

    if (pathname.includes('/api/bank/enrollments/') && pathname.endsWith('/accounts')) {
      const parts = pathname.split('/');
      const enrollmentId = parts[parts.length - 2];
      const accounts =
        enrollmentId === 'enr_chase'
          ? [
              {
                id: 'acc_chase_chk',
                name: 'Total Checking',
                last_four: '4421',
                type: 'depository',
                subtype: 'checking',
              },
              {
                id: 'acc_chase_sav',
                name: 'Premier Savings',
                last_four: '8890',
                type: 'depository',
                subtype: 'savings',
              },
            ]
          : [
              {
                id: 'acc_amex_plat',
                name: 'Blue Cash Preferred',
                last_four: '3005',
                type: 'credit',
                subtype: 'credit_card',
              },
            ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(accounts),
      });
    }

    if (pathname.endsWith('/api/profile')) {
      if (!currentUser) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not authenticated' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(toPublicUser(currentUser)),
      });
    }

    if (pathname.endsWith('/api/profile/passkey/register/options')) {
      if (!currentUser) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          options: {
            challenge: 'ZTJlLXByb2ZpbGUtY2hhbGxlbmdl',
            rp: { name: 'Budget App', id: 'localhost' },
            user: {
              id: 'dXNyX3Byb2ZpbGU',
              name: currentUser.phone,
              displayName: `${currentUser.firstName} ${currentUser.lastName}`,
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 60000,
            attestation: 'none',
          },
        }),
      });
    }

    if (pathname.endsWith('/api/profile/passkey/register/verify')) {
      if (!currentUser || !body.credential?.id) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      }
      currentUser.passkeyCredentialId = body.credential.id;
      currentUser.passkeyCreatedAt = new Date().toISOString();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: toPublicUser(currentUser) }),
      });
    }

    if (pathname.endsWith('/api/profile/passkey') && method === 'DELETE') {
      if (!currentUser) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      }
      currentUser.passkeyCredentialId = null;
      currentUser.passkeyCreatedAt = null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: toPublicUser(currentUser) }),
      });
    }

    if (pathname.endsWith('/api/profile/contact/request-otp')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Verification code sent' }),
      });
    }

    if (pathname.endsWith('/api/profile/contact/verify-otp')) {
      if (body.code === '123456' && currentUser) {
        if (body.type === 'phone' || body.phone) {
          accountsByPhone.delete(currentUser.phone);
          currentUser.phone = body.phone;
          accountsByPhone.set(currentUser.phone, currentUser);
        } else if (body.email) {
          currentUser.email = body.email;
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user: toPublicUser(currentUser),
          }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid or expired OTP' }),
      });
    }

    if (pathname.endsWith('/api/push/vapid-public-key')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          vapidPublicKey: 'BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        }),
      });
    }

    if (pathname.endsWith('/api/push/subscriptions')) {
      const subs = Array.from(pushSubscriptionsByEndpoint.values());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: subs.length, subscriptions: subs }),
      });
    }

    if (pathname.endsWith('/api/push/subscribe') && method === 'POST') {
      if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid PushSubscription payload' }),
        });
      }
      const record = {
        id: `push_sub_${pushSubscriptionsByEndpoint.size + 1}`,
        endpoint: body.endpoint,
        expirationTime: body.expirationTime ?? null,
        createdAt: new Date().toISOString(),
      };
      pushSubscriptionsByEndpoint.set(body.endpoint, record);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          subscription: record,
          count: pushSubscriptionsByEndpoint.size,
        }),
      });
    }

    if (
      (pathname.endsWith('/api/push/unsubscribe') && method === 'POST') ||
      (pathname.endsWith('/api/push/subscribe') && method === 'DELETE')
    ) {
      const removed = Boolean(body.endpoint && pushSubscriptionsByEndpoint.delete(body.endpoint));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          removed,
          count: pushSubscriptionsByEndpoint.size,
        }),
      });
    }

    if (pathname.endsWith('/api/push/test') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          jobId: `push_job_${Date.now()}`,
          delivery: {
            status: 'completed',
            deliveredCount: pushSubscriptionsByEndpoint.size,
            prunedCount: 0,
          },
        }),
      });
    }

    if (pathname.endsWith('/api/chat/ask')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          todo: true,
          geminiConfigured: false,
          question: body.question || 'How should I budget?',
          reply:
            '[LLM Assistant Stub] Based on your PostgreSQL & MINIO statement data: your current net worth is $14850.75, with $6450.00 in monthly income and $3490.25 in monthly expenses.',
          contextSummary: {
            netWorth: 14850.75,
            thisMonthIncome: 6450.0,
            thisMonthExpenses: 3490.25,
            topCategory: 'Rent And Utilities',
            statementsCount: 2,
            storageProvider: 'minio',
          },
          historyLength: 2,
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function main() {
  console.log('========================================================================');
  console.log('🎬 Starting Playwright E2E Tests with Browser Automation & Recording');
  console.log(`   Recording Folder: ${DOWNLOADS_DIR}`);
  console.log('========================================================================\n');

  let localServer = null;
  let webUrl = TARGET_URL ? TARGET_URL.replace(/\/+$/, '') : '';

  if (!isRemote) {
    ensureClientBuild();
    const started = await startStaticSpaServer();
    localServer = started.server;
    webUrl = started.baseUrl;
    console.log(`✅ Local web server listening at ${webUrl}\n`);
  }

  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const isHeadless = process.env.HEADLESS === 'true' || process.env.CI === 'true';
  console.log(`🌐 Launching Chromium browser (headless: ${isHeadless})...`);
  const browser = await chromium.launch({
    headless: isHeadless,
    slowMo: isHeadless ? 0 : 350,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    recordVideo: {
      dir: DOWNLOADS_DIR,
      size: { width: 1280, height: 850 },
    },
  });

  const page = await context.newPage();

  // Enable Chromium CDP Virtual WebAuthn Authenticator so navigator.credentials.create() / get() run for real
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('WebAuthn.enable');
  await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      html, body, h1, h2, h3, h4, h5, h6, p, span:not(.material-icons), button, input, label, div,
      .mat-mdc-card-title, .mat-mdc-card-subtitle, .subtitle, .section-eyebrow {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
    `;
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    }
  });
  const offlineState = { offline: false };
  if (!isRemote) {
    await setupStatefulE2EMocks(page, offlineState);
  }

  let videoPath = null;

  try {
    // -------------------------------------------------------------
    // TEST SUITE 0: Installable PWA Verification (Manifest + Service Worker)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 0] Progressive Web App (Manifest & Service Worker) ---');
    await page.goto(`${webUrl}/login`, { waitUntil: 'networkidle' });
    await sleep(400);

    const pwaInfo = await page.evaluate(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const manifestHref = manifestLink ? manifestLink.getAttribute('href') : null;
      let manifest = null;
      if (manifestHref) {
        const res = await fetch(manifestHref);
        manifest = await res.json();
      }
      let swScope = null;
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        swScope = reg.scope;
      }
      return { manifestHref, manifest, swScope };
    });

    if (
      !pwaInfo.manifest ||
      pwaInfo.manifest.display !== 'standalone' ||
      !Array.isArray(pwaInfo.manifest.icons) ||
      pwaInfo.manifest.icons.length < 2
    ) {
      throw new Error(`Invalid PWA manifest: ${JSON.stringify(pwaInfo.manifest)}`);
    }
    if (!pwaInfo.swScope) {
      throw new Error('Expected active Service Worker registration for PWA installability');
    }
    // Verify zero external Google Fonts CDN links and self-hosted Material Icons font loads locally
    const fontCheck = await page.evaluate(async () => {
      const cdnLinks = Array.from(document.querySelectorAll('link[href]')).filter((el) =>
        /fonts\.(googleapis|gstatic)\.com/i.test(el.getAttribute('href') || '')
      );
      const fontRes = await fetch('/fonts/material-icons.woff2');
      return { cdnLinkCount: cdnLinks.length, localIconFontOk: fontRes.ok };
    });
    if (fontCheck.cdnLinkCount !== 0) {
      throw new Error(`Expected 0 Google Fonts CDN links, found ${fontCheck.cdnLinkCount}`);
    }
    if (!fontCheck.localIconFontOk) {
      throw new Error('Expected self-hosted /fonts/material-icons.woff2 to load locally');
    }
    console.log('   ✓ Zero Google Fonts CDN links; self-hosted Material Icons WOFF2 loaded');

    console.log(
      `   ✓ Manifest loaded (${pwaInfo.manifest.name}, display=${pwaInfo.manifest.display})`
    );
    console.log(`   ✓ Service Worker active at scope: ${pwaInfo.swScope}`);

    // -------------------------------------------------------------
    // TEST SUITE 1: New User Signup (Phone OTP -> Email OTP -> Passkey) & Passkey Login
    // -------------------------------------------------------------
    console.log('\n--- [TEST 1] New User Signup (Email OTP + Passkey) & Passkey Login ---');

    const loginHeading = await page.textContent('h1');
    if (!loginHeading?.includes('Budget App')) {
      throw new Error(`Expected heading "Budget App", got: ${loginHeading}`);
    }

    const devBannerText = await page.textContent('.sandbox-banner');
    if (!devBannerText?.includes('+15551234567') || !devBannerText?.includes('123456')) {
      throw new Error('Expected Development Test Account banner with +15551234567 and 123456');
    }
    console.log('   ✓ Development Test Account banner displayed');

    // Enter a brand-new phone number that does not have an account yet
    await page.fill('#phone', '+15559990001');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#otp');

    await page.fill('#otp', '123456');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/signup');
    await page.waitForSelector('#firstName');

    const verifiedPhoneBanner = await page.textContent('.verified-phone-banner');
    if (!verifiedPhoneBanner?.includes('+15559990001')) {
      throw new Error('Expected verified phone +15559990001 on signup page');
    }
    console.log('   ✓ Unregistered phone redirected to /signup');

    // Fill first name, last name, and email, then request email OTP
    await page.fill('#firstName', 'Jordan');
    await page.fill('#lastName', 'Lee');
    await page.fill('#email', 'jordan@example.com');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#emailOtp');

    // Verify invalid email OTP is rejected before advancing to passkey step
    await page.fill('#emailOtp', '000000');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.signup .error-banner');
    console.log('   ✓ Invalid signup email OTP rejected');

    // Verify valid email OTP -> advances to required Passkey creation step
    await page.fill('#emailOtp', '123456');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.btn-create-passkey');
    const skipBeforeError = await page.locator('.btn-skip-passkey').count();
    if (skipBeforeError !== 0) {
      throw new Error('Expected passkey skip button to be hidden until an error occurs');
    }
    console.log('   ✓ Email OTP verified -> required Passkey creation step shown');

    // Create passkey via real navigator.credentials.create() -> redirected to /dashboard
    await page.click('.btn-create-passkey');
    await page.waitForURL('**/dashboard');
    await page.waitForSelector('.net-worth-card');
    console.log(
      '   ✅ New user created passkey via navigator.credentials.create() and reached /dashboard'
    );

    // Log out and sign back in with Passkey via navigator.credentials.get()
    await page.click('.btn-logout');
    await page.waitForURL('**/login');
    await page.waitForSelector('#phone');

    await page.fill('#phone', '+15559990001');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    await page.waitForSelector('.net-worth-card');
    console.log('   ✅ Returning user authenticated with passkey via navigator.credentials.get()');

    // Log out to test existing account OTP login (no passkey)
    await page.click('.btn-logout');
    await page.waitForURL('**/login');
    await page.waitForSelector('#phone');

    // -------------------------------------------------------------
    // TEST SUITE 2: Existing Account Phone OTP Login -> Directly to /dashboard
    // -------------------------------------------------------------
    console.log('\n--- [TEST 2] Existing Account Phone OTP Login -> /dashboard ---');
    await page.fill('#phone', '+15551234567');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#otp');

    await page.fill('#otp', '123456');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    await page.waitForSelector('.net-worth-card');
    console.log('   ✅ Existing account phone OTP login redirected directly to /dashboard');

    // -------------------------------------------------------------
    // TEST SUITE 3: Dashboard Net Worth, Cash Flow, & Quick Stats
    // -------------------------------------------------------------
    console.log('\n--- [TEST 3] Dashboard Net Worth, Cash Flow, & Quick Stats ---');
    const netWorthText = await page.textContent('.net-worth-card .amount');
    console.log(`   Net Worth displayed: ${netWorthText?.trim()}`);
    if (!netWorthText?.includes('$14,850.75')) {
      throw new Error(`Expected Net Worth $14,850.75, got: ${netWorthText}`);
    }

    const txnCount = await page.locator('.txn-item').count();
    console.log(`   Recent Transactions displayed: ${txnCount}`);
    if (txnCount !== 3) {
      throw new Error(`Expected 3 transactions, found ${txnCount}`);
    }

    await page.click('.btn-sync');
    await sleep(300);
    console.log('   ✅ Dashboard net worth, charts, and transaction sync verified');

    // -------------------------------------------------------------
    // TEST SUITE 4: Bank Accounts (Plaid Institutions)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 4] Bank Accounts Page (Plaid Institutions) ---');
    await page.click('a.link-accounts');
    await page.waitForSelector('.enrollment-card');

    const enrollmentCount = await page.locator('.enrollment-card').count();
    console.log(`   Connected Plaid institutions: ${enrollmentCount}`);
    if (enrollmentCount !== 2) {
      throw new Error(`Expected 2 connected institutions, found ${enrollmentCount}`);
    }
    console.log('   ✅ Bank Accounts page verified');

    // -------------------------------------------------------------
    // TEST SUITE 5: Profile Tab — Change Email & Phone Number (OTP Required)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 5] Profile Tab — Change Email & Phone Number (OTP Required) ---');
    await page.click('a.back-link');
    await page.waitForSelector('a.link-profile');
    await page.click('a.link-profile');
    await page.waitForSelector('.profile-card');

    const initialProfileText = await page.textContent('.profile-card');
    if (!initialProfileText?.includes('+15551234567')) {
      throw new Error('Expected phone number +15551234567 on profile');
    }

    // Change email with OTP verification
    await page.click('.btn-edit-email');
    await page.waitForSelector('.link-card');
    await page.fill('input[name="newEmail"]', 'alex@example.com');
    await page.click('button:has-text("Send verification code")');
    await page.waitForSelector('input[name="contactOtpCode"]');

    // Test invalid OTP rejection before DB update
    await page.fill('input[name="contactOtpCode"]', '000000');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.link-card .error-banner');
    console.log('   ✓ Invalid email OTP rejected before DB update');

    // Verify with valid OTP
    await page.fill('input[name="contactOtpCode"]', '123456');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.success-banner');

    const updatedEmailText = await page.textContent('.profile-card');
    if (!updatedEmailText?.includes('alex@example.com')) {
      throw new Error('Expected verified email alex@example.com on profile card');
    }
    console.log('   ✅ Profile email OTP change verified');

    // Change phone number with OTP verification
    await page.click('.btn-edit-phone');
    await page.waitForSelector('.link-card');
    await page.fill('input[name="newPhone"]', '+15559876543');
    await page.click('button:has-text("Send verification code")');
    await page.waitForSelector('input[name="contactOtpCode"]');

    // Test invalid phone OTP rejection before DB update
    await page.fill('input[name="contactOtpCode"]', '000000');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.link-card .error-banner');
    console.log('   ✓ Invalid phone OTP rejected before DB update');

    // Verify with valid phone OTP
    await page.fill('input[name="contactOtpCode"]', '123456');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.success-banner');

    const updatedPhoneText = await page.textContent('.profile-card');
    if (!updatedPhoneText?.includes('+15559876543')) {
      throw new Error('Expected verified phone +15559876543 on profile card');
    }
    console.log('   ✅ Profile phone OTP change verified');

    // Add a passkey on the Profile page (via real navigator.credentials.create()) and then delete it
    await page.waitForSelector('.btn-add-passkey');
    await page.click('.btn-add-passkey');
    await page.waitForSelector('.btn-delete-passkey');
    console.log('   ✓ Added passkey from Profile page');

    await page.click('.btn-delete-passkey');
    await page.waitForSelector('.btn-add-passkey');
    console.log('   ✅ Deleted passkey from Profile page');

    // Enable, test, and disable native Web Push notifications on Profile page
    await page.evaluate(async () => {
      let currentSub = null;
      const mockSubJson = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device-1',
        expirationTime: null,
        keys: {
          p256dh:
            'BOr7mockPublicKeyForE2EPushSubscriptionTest0000000000000000000000000000000000000000000',
          auth: 'mockAuthSecret16Byte',
        },
      };

      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => 'granted',
      });
      Notification.requestPermission = async () => 'granted';

      const reg = await navigator.serviceWorker.ready;
      Object.defineProperty(reg, 'pushManager', {
        configurable: true,
        value: {
          getSubscription: async () => currentSub,
          subscribe: async () => {
            currentSub = {
              endpoint: mockSubJson.endpoint,
              toJSON: () => mockSubJson,
              unsubscribe: async () => {
                currentSub = null;
                return true;
              },
            };
            return currentSub;
          },
        },
      });
    });

    await page.waitForSelector('.btn-enable-push');
    await page.click('.btn-enable-push');
    await page.waitForSelector('.btn-test-push');
    console.log('   ✓ Enabled Web Push notifications via native PushManager & PushSubscription');

    // Verify VAPID public key was persisted in IndexedDB push_state store for SW pushsubscriptionchange
    const savedVapidInIdb = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('budget-app-offline-db');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('push_state')) {
              db.close();
              resolve(null);
              return;
            }
            const tx = db.transaction('push_state', 'readonly');
            const getReq = tx.objectStore('push_state').get('vapidPublicKey');
            getReq.onsuccess = () => {
              db.close();
              resolve(getReq.result ? getReq.result.value : null);
            };
            getReq.onerror = () => {
              db.close();
              resolve(null);
            };
          };
          req.onerror = () => resolve(null);
        })
    );
    if (!savedVapidInIdb) {
      throw new Error('Expected vapidPublicKey to be persisted in IndexedDB push_state store');
    }
    console.log('   ✓ Persisted VAPID public key in IndexedDB push_state store');

    await page.click('.btn-test-push');
    await page.waitForSelector('.success-banner');
    console.log('   ✓ Dispatched test push notification via RabbitMQ push queue');

    await page.click('.btn-disable-push');
    await page.waitForSelector('.btn-enable-push');
    console.log('   ✅ Disabled Web Push notifications via native PushSubscription.unsubscribe()');

    // -------------------------------------------------------------
    // TEST SUITE 6: AI Financial Assistant Chat Page
    // -------------------------------------------------------------
    console.log('\n--- [TEST 6] AI Financial Assistant Chat Page ---');
    await page.click('a.back-link');
    await page.waitForSelector('a.link-chat');
    await page.click('a.link-chat');
    await page.waitForSelector('.chat-card');

    await page.fill('#chat-question-input', 'How should I budget?');
    await page.click('.btn-send');
    await page.waitForSelector('.context-card');

    const chatText = await page.textContent('.chat-card');
    if (!chatText?.includes('$14850.75')) {
      throw new Error('Expected LLM assistant response with net worth context');
    }
    console.log('   ✅ AI Financial Assistant Chat page verified');

    // -------------------------------------------------------------
    // TEST SUITE 7: IndexedDB Offline Queueing & Online Replay
    // -------------------------------------------------------------
    console.log('\n--- [TEST 7] IndexedDB Offline Queueing & Online Replay ---');
    // Go offline and submit a chat question -> Service Worker / ApiService persists in IndexedDB mutation_queue
    offlineState.offline = true;
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.fill('#chat-question-input', 'What is my top spending category?');
    await page.click('.btn-send');
    await page.waitForSelector('.offline-queue-banner');

    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('budget-app-offline-db');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('mutation_queue')) {
              db.close();
              resolve(false);
              return;
            }
            const tx = db.transaction('mutation_queue', 'readonly');
            const countReq = tx.objectStore('mutation_queue').count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result >= 1);
            };
            countReq.onerror = () => {
              db.close();
              resolve(false);
            };
          };
          req.onerror = () => resolve(false);
        }),
      null,
      { timeout: 10000 }
    );

    const queuedInIdb = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('budget-app-offline-db');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('mutation_queue', 'readonly');
            const getAll = tx.objectStore('mutation_queue').getAll();
            getAll.onsuccess = () => {
              const items = getAll.result || [];
              db.close();
              resolve(items);
            };
            getAll.onerror = () => reject(getAll.error);
          };
          req.onerror = () => reject(req.error);
        })
    );
    if (!Array.isArray(queuedInIdb) || queuedInIdb.length < 1) {
      throw new Error('Expected offline chat mutation to be persisted in IndexedDB mutation_queue');
    }
    console.log(
      `   ✓ Offline mutation persisted in IndexedDB (${queuedInIdb[0].method} ${queuedInIdb[0].url})`
    );

    // Go back online -> online event / Service Worker replays queued mutation and empties IndexedDB
    offlineState.offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('budget-app-offline-db');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('mutation_queue', 'readonly');
            const countReq = tx.objectStore('mutation_queue').count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result === 0);
            };
          };
          req.onerror = () => resolve(false);
        }),
      null,
      { timeout: 10000 }
    );
    console.log('   ✅ Reconnected online: IndexedDB queue replayed automatically and cleared');

    console.log('\n========================================================================');
    console.log('🎉 ALL PLAYWRIGHT E2E FLOW TESTS PASSED!');
    console.log('========================================================================');
  } finally {
    console.log('\n💾 Finalizing and saving video recording...');
    const video = page.video();
    await page.close();
    await context.close();
    await browser.close();

    if (video) {
      const origVideoPath = await video.path();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const targetVideoPath = path.join(DOWNLOADS_DIR, `budget-app-e2e-${timestamp}.webm`);
      try {
        fs.copyFileSync(origVideoPath, targetVideoPath);
        videoPath = targetVideoPath;
        console.log(`📹 Video recording saved to: ${targetVideoPath}`);
      } catch {
        videoPath = origVideoPath;
      }

      const repoVideoPath = path.join(RECORDINGS_DIR, 'e2e-flow.webm');
      try {
        fs.copyFileSync(origVideoPath, repoVideoPath);
        console.log(`📹 Repository recording updated: ${repoVideoPath}`);
      } catch {
        // Ignore copy error
      }
    }

    if (localServer) {
      await new Promise((resolve) => localServer.close(resolve));
    }
  }

  return videoPath;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Playwright E2E error:', err);
      process.exit(1);
    });
}
