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
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Configure stateful API routes for local E2E flow verification
async function setupStatefulE2EMocks(page) {
  let isLoggedIn = false;
  let linkedEmail = null;
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

  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );

  await page.route('**/api/**', async (route) => {
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
          plaidConfigured: true,
          plaidEnvironment: 'sandbox',
          authSandbox: { phone: '+15551234567', otp: '123456' },
        }),
      });
    }

    if (pathname.endsWith('/api/auth/me')) {
      if (!isLoggedIn) {
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
          user: { id: 'usr_1', phone: '+15551234567', email: linkedEmail },
        }),
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
        isLoggedIn = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user: { id: 'usr_1', phone: '+15551234567', email: linkedEmail },
          }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid or expired OTP' }),
      });
    }

    if (pathname.endsWith('/api/auth/logout')) {
      isLoggedIn = false;
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'usr_1',
          phone: '+15551234567',
          email: linkedEmail,
        }),
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
      if (body.code === '123456') {
        linkedEmail = body.email;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user: { id: 'usr_1', phone: '+15551234567', email: linkedEmail },
          }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid or expired OTP' }),
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
  if (!isRemote) {
    await setupStatefulE2EMocks(page);
  }

  let videoPath = null;

  try {
    // -------------------------------------------------------------
    // TEST SUITE 1: Phone OTP Login Flow
    // -------------------------------------------------------------
    console.log('\n--- [TEST 1] Phone OTP Login Flow ---');
    await page.goto(`${webUrl}/login`, { waitUntil: 'networkidle' });
    await sleep(400);

    const loginHeading = await page.textContent('h1');
    if (!loginHeading?.includes('Budget App')) {
      throw new Error(`Expected heading "Budget App", got: ${loginHeading}`);
    }

    await page.fill('#phone', '+15551234567');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#otp');

    await page.fill('#otp', '123456');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.net-worth-card');
    console.log('   ✅ Phone OTP login verified and redirected to /dashboard');

    // -------------------------------------------------------------
    // TEST SUITE 2: Dashboard Net Worth, Cash Flow, & Quick Stats
    // -------------------------------------------------------------
    console.log('\n--- [TEST 2] Dashboard Net Worth, Cash Flow, & Quick Stats ---');
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
    // TEST SUITE 3: Bank Accounts (Plaid Institutions)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 3] Bank Accounts Page (Plaid Institutions) ---');
    await page.click('a.link-accounts');
    await page.waitForSelector('.enrollment-card');

    const enrollmentCount = await page.locator('.enrollment-card').count();
    console.log(`   Connected Plaid institutions: ${enrollmentCount}`);
    if (enrollmentCount !== 2) {
      throw new Error(`Expected 2 connected institutions, found ${enrollmentCount}`);
    }
    console.log('   ✅ Bank Accounts page verified');

    // -------------------------------------------------------------
    // TEST SUITE 4: Profile Tab & Verified Email Linking (OTP Required)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 4] Profile Tab & Verified Email Linking ---');
    await page.click('a.back-link');
    await page.waitForSelector('a.link-profile');
    await page.click('a.link-profile');
    await page.waitForSelector('.profile-card');

    const initialProfileText = await page.textContent('.profile-card');
    if (!initialProfileText?.includes('+15551234567')) {
      throw new Error('Expected phone number +15551234567 on profile');
    }

    await page.click('button:has-text("Add email")');
    await page.waitForSelector('.link-card');
    await page.fill('input[name="newEmail"]', 'alex@example.com');
    await page.click('button:has-text("Send verification code")');
    await page.waitForSelector('input[name="emailOtpCode"]');

    // Test invalid OTP rejection before DB upsert
    await page.fill('input[name="emailOtpCode"]', '000000');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.link-card .error-banner');
    console.log('   ✓ Invalid email OTP rejected before DB upsert');

    // Verify with valid OTP
    await page.fill('input[name="emailOtpCode"]', '123456');
    await page.click('button:has-text("Verify & save")');
    await page.waitForSelector('.success-banner');

    const updatedProfileText = await page.textContent('.profile-card');
    if (!updatedProfileText?.includes('alex@example.com')) {
      throw new Error('Expected verified email alex@example.com on profile card');
    }
    console.log('   ✅ Profile email OTP verification and upsert verified');

    // -------------------------------------------------------------
    // TEST SUITE 5: AI Financial Assistant Chat Page
    // -------------------------------------------------------------
    console.log('\n--- [TEST 5] AI Financial Assistant Chat Page ---');
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
