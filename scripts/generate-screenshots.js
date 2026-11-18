const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.resolve(ROOT_DIR, 'client');
const DIST_BROWSER_DIR = path.resolve(CLIENT_DIR, 'dist/client/browser');
const SCREENSHOTS_DIR = path.resolve(ROOT_DIR, 'screenshots');
const COMPONENTS_DIR = path.resolve(SCREENSHOTS_DIR, 'components');
const PAGES_DIR = path.resolve(SCREENSHOTS_DIR, 'pages');

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

const MOCK_NET_WORTH = {
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
};

const MOCK_DASHBOARD_SUMMARY = {
  incomeVsExpenses: [
    { month: '2026-09', income: 6200.0, expenses: 3850.5 },
    { month: '2026-10', income: 6200.0, expenses: 4120.0 },
    { month: '2026-11', income: 6450.0, expenses: 3490.25 },
  ],
  spendingByCategory: [
    { category: 'Rent And Utilities', amount: 1850.0 },
    { category: 'Food And Drink', amount: 685.5 },
    { category: 'General Merchandise', amount: 492.75 },
    { category: 'Transportation', amount: 262.0 },
    { category: 'Entertainment', amount: 200.0 },
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
    {
      id: 'txn_4',
      enrollmentId: 'enr_amex',
      accountId: 'acc_amex_plat',
      date: '2026-11-10',
      description: 'Blue Bottle Coffee',
      amount: -18.5,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      id: 'txn_5',
      enrollmentId: 'enr_amex',
      accountId: 'acc_amex_plat',
      date: '2026-11-08',
      description: 'Target',
      amount: -94.2,
      category: 'General Merchandise',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
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
};

const MOCK_ENROLLMENTS = [
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

const MOCK_ACCOUNTS_BY_ENROLLMENT = {
  enr_chase: [
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
  ],
  enr_amex: [
    {
      id: 'acc_amex_plat',
      name: 'Blue Cash Preferred',
      last_four: '3005',
      type: 'credit',
      subtype: 'credit_card',
    },
  ],
};

// Build Angular frontend so static bundle reflects latest templates and styles
function ensureClientBuild() {
  console.log('🔨 Building Angular client bundle for deterministic preview server...');
  execSync('npm --prefix client run build -- --configuration development', {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
}

// Start an ephemeral static HTTP server with SPA fallback to index.html
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

// Inject styles to freeze animations, spinners, carets, and guarantee modern sans-serif typography
async function applyDeterministicStyles(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      *, *::before, *::after, html, body, h1, h2, h3, h4, h5, h6, p, span, button, input, label, div,
      .mat-mdc-card-title, .mat-mdc-card-subtitle, .subtitle, .section-eyebrow {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
    `,
  });
}

// Configure mocked API responses on a Playwright page
async function setupApiMockRoutes(page, options = {}) {
  const {
    authenticated = true,
    emptyData = false,
    profileEmail = null,
    plaidConfigured = true,
  } = options;

  // Provide deterministic local sans-serif @font-face mappings without hanging networkidle in offline environments
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: `
        @font-face {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 300 800;
          src: local('Inter'), local('-apple-system'), local('BlinkMacSystemFont'), local('SF Pro Text'), local('Segoe UI'), local('Arial');
        }
        @font-face {
          font-family: 'Roboto';
          font-style: normal;
          font-weight: 300 800;
          src: local('Roboto'), local('Inter'), local('-apple-system'), local('BlinkMacSystemFont'), local('SF Pro Text'), local('Segoe UI'), local('Arial');
        }
      `,
    })
  );
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'font/woff2', body: '' })
  );

  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after, html, body, h1, h2, h3, h4, h5, h6, p, span, button, input, label, div,
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

  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

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
          plaidConfigured,
          plaidEnvironment: 'sandbox',
          authSandbox: { phone: '+15551234567', otp: '123456' },
        }),
      });
    }

    if (pathname.endsWith('/api/auth/me')) {
      if (!authenticated) {
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
          user: { id: 'usr_1', phone: '+15551234567', email: profileEmail },
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { id: 'usr_1', phone: '+15551234567', email: profileEmail },
        }),
      });
    }

    if (pathname.endsWith('/api/bank/net-worth')) {
      const payload = emptyData
        ? { netWorth: 0, totalAssets: 0, totalLiabilities: 0, accounts: [] }
        : MOCK_NET_WORTH;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    }

    if (pathname.endsWith('/api/bank/dashboard-summary')) {
      const payload = emptyData
        ? {
            incomeVsExpenses: [],
            spendingByCategory: [],
            recentTransactions: [],
            quickStats: {
              thisMonthIncome: 0,
              thisMonthExpenses: 0,
              lastMonthIncome: 0,
              lastMonthExpenses: 0,
              ytdIncome: 0,
              ytdExpenses: 0,
              momIncomeChangePct: 0,
              momExpensesChangePct: 0,
            },
          }
        : MOCK_DASHBOARD_SUMMARY;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    }

    if (pathname.endsWith('/api/bank/enrollments')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyData ? [] : MOCK_ENROLLMENTS),
      });
    }

    if (pathname.includes('/api/bank/enrollments/') && pathname.endsWith('/accounts')) {
      const parts = pathname.split('/');
      const enrollmentId = parts[parts.length - 2];
      const accounts = MOCK_ACCOUNTS_BY_ENROLLMENT[enrollmentId] || [];
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
          email: profileEmail,
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { id: 'usr_1', phone: '+15551234567', email: 'alex@example.com' },
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
          question: 'How should I budget?',
          reply:
            '[LLM Assistant Stub] Based on your PostgreSQL & MINIO statement data: your current net worth is $14850.75, with $6450.00 in monthly income and $3490.25 in monthly expenses (top spending category: Rent And Utilities).',
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

async function generateScreenshots() {
  console.log('🚀 Starting screenshot generation...');

  fs.mkdirSync(COMPONENTS_DIR, { recursive: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  ensureClientBuild();

  const { server, baseUrl } = await startStaticSpaServer();
  console.log(`📡 Local preview server running at ${baseUrl}`);

  const savedFiles = [];
  const browser = await chromium.launch();

  try {
    // ----------------------------------------------------
    // Section A: Component & Desktop Page Screenshots (1280x800)
    // ----------------------------------------------------
    console.log('📸 Capturing frontend components & desktop pages (1280x800)...');

    // 1. Login Page (Phone Step & OTP Step)
    const loginPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(loginPage, { authenticated: false });
    await loginPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(loginPage);
    await loginPage.waitForSelector('.login .card');

    // Component: Login Card (Phone input)
    await loginPage.locator('.login .card').screenshot({
      path: path.join(COMPONENTS_DIR, 'login-card-phone.png'),
    });
    savedFiles.push('screenshots/components/login-card-phone.png');
    console.log('  ✓ components/login-card-phone.png');

    // Page: Login Page (Phone step)
    await loginPage.screenshot({
      path: path.join(PAGES_DIR, 'login-page.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/login-page.png');
    console.log('  ✓ pages/login-page.png');

    // Advance to OTP verification step
    await loginPage.fill('#phone', '+15551234567');
    await loginPage.click('button[type="submit"]');
    await loginPage.waitForSelector('#otp');
    await applyDeterministicStyles(loginPage);

    // Component: Login Card (OTP input)
    await loginPage.locator('.login .card').screenshot({
      path: path.join(COMPONENTS_DIR, 'login-card-otp.png'),
    });
    savedFiles.push('screenshots/components/login-card-otp.png');
    console.log('  ✓ components/login-card-otp.png');

    // Page: Login Page (OTP step)
    await loginPage.screenshot({
      path: path.join(PAGES_DIR, 'login-page-otp.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/login-page-otp.png');
    console.log('  ✓ pages/login-page-otp.png');
    await loginPage.close();

    // 2. Dashboard Page & Dashboard Components
    const dashPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(dashPage, { authenticated: true });
    await dashPage.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(dashPage);
    await dashPage.waitForSelector('.net-worth-card');

    const dashComponents = [
      { selector: '.net-worth-card', filename: 'net-worth-card.png' },
      { selector: '.section-card.income-expenses', filename: 'income-vs-expenses-card.png' },
      { selector: '.section-card.spending-category', filename: 'spending-by-category-card.png' },
      { selector: '.quick-stats', filename: 'quick-stats-grid.png' },
      { selector: '.section-card.recent-transactions', filename: 'transactions-card.png' },
    ];

    for (const target of dashComponents) {
      const locator = dashPage.locator(target.selector);
      await locator.waitFor({ state: 'visible' });
      await locator.screenshot({ path: path.join(COMPONENTS_DIR, target.filename) });
      savedFiles.push(`screenshots/components/${target.filename}`);
      console.log(`  ✓ components/${target.filename}`);
    }

    // Page: Dashboard Page (Populated)
    await dashPage.screenshot({
      path: path.join(PAGES_DIR, 'dashboard-page.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/dashboard-page.png');
    console.log('  ✓ pages/dashboard-page.png');

    // Page: Dashboard Page Empty State
    const emptyDashPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(emptyDashPage, { authenticated: true, emptyData: true });
    await emptyDashPage.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(emptyDashPage);
    await emptyDashPage.waitForSelector('.net-worth-card');
    await emptyDashPage.screenshot({
      path: path.join(PAGES_DIR, 'dashboard-page-empty.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/dashboard-page-empty.png');
    console.log('  ✓ pages/dashboard-page-empty.png');
    await emptyDashPage.close();
    await dashPage.close();

    // 3. Bank Accounts Page & Enrollment Card Component
    const accountsPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(accountsPage, { authenticated: true });
    await accountsPage.goto(`${baseUrl}/accounts`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(accountsPage);
    await accountsPage.waitForSelector('.enrollment-card');

    // Component: Bank Enrollment Card
    await accountsPage
      .locator('.enrollment-card')
      .first()
      .screenshot({
        path: path.join(COMPONENTS_DIR, 'bank-enrollment-card.png'),
      });
    savedFiles.push('screenshots/components/bank-enrollment-card.png');
    console.log('  ✓ components/bank-enrollment-card.png');

    // Page: Bank Accounts Page (Connected)
    await accountsPage.screenshot({
      path: path.join(PAGES_DIR, 'bank-accounts-page.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/bank-accounts-page.png');
    console.log('  ✓ pages/bank-accounts-page.png');
    await accountsPage.close();

    // Page: Bank Accounts Page (Empty state)
    const emptyAccountsPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(emptyAccountsPage, { authenticated: true, emptyData: true });
    await emptyAccountsPage.goto(`${baseUrl}/accounts`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(emptyAccountsPage);
    await emptyAccountsPage.waitForSelector('.bank-accounts');
    await emptyAccountsPage.screenshot({
      path: path.join(PAGES_DIR, 'bank-accounts-page-empty.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/bank-accounts-page-empty.png');
    console.log('  ✓ pages/bank-accounts-page-empty.png');
    await emptyAccountsPage.close();

    // 4. Profile Page & Email Linking Components
    const profilePage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(profilePage, { authenticated: true, profileEmail: null });
    await profilePage.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(profilePage);
    await profilePage.waitForSelector('.profile-card');

    // Component: Profile Card (Unlinked email)
    await profilePage.locator('.profile-card').screenshot({
      path: path.join(COMPONENTS_DIR, 'profile-card-unlinked.png'),
    });
    savedFiles.push('screenshots/components/profile-card-unlinked.png');
    console.log('  ✓ components/profile-card-unlinked.png');

    // Page: Profile Page
    await profilePage.screenshot({
      path: path.join(PAGES_DIR, 'profile-page.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/profile-page.png');
    console.log('  ✓ pages/profile-page.png');

    // Open Email Verification Card
    await profilePage.click('button:has-text("Add email")');
    await profilePage.waitForSelector('.link-card');
    await profilePage.fill('input[name="newEmail"]', 'alex@example.com');
    await applyDeterministicStyles(profilePage);

    // Component: Profile Email Verification Card
    await profilePage.locator('.link-card').screenshot({
      path: path.join(COMPONENTS_DIR, 'profile-email-verify-card.png'),
    });
    savedFiles.push('screenshots/components/profile-email-verify-card.png');
    console.log('  ✓ components/profile-email-verify-card.png');

    // Page: Profile Page with Email Verification Open
    await profilePage.screenshot({
      path: path.join(PAGES_DIR, 'profile-page-link-email.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/profile-page-link-email.png');
    console.log('  ✓ pages/profile-page-link-email.png');
    await profilePage.close();

    // 5. LLM Chat Page & Chat Component
    const chatPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(chatPage, { authenticated: true });
    await chatPage.goto(`${baseUrl}/chat`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(chatPage);
    await chatPage.waitForSelector('.chat-card');
    await chatPage.fill('#chat-question-input', 'How should I budget?');
    await chatPage.click('.btn-send');
    await chatPage.waitForSelector('.context-card');
    await applyDeterministicStyles(chatPage);

    // Component: Chat Card
    await chatPage.locator('.chat-card').screenshot({
      path: path.join(COMPONENTS_DIR, 'chat-card.png'),
    });
    savedFiles.push('screenshots/components/chat-card.png');
    console.log('  ✓ components/chat-card.png');

    // Page: Chat Page
    await chatPage.screenshot({
      path: path.join(PAGES_DIR, 'chat-page.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/chat-page.png');
    console.log('  ✓ pages/chat-page.png');
    await chatPage.close();

    // ----------------------------------------------------
    // Section B: Mobile Page Screenshots (390x844)
    // ----------------------------------------------------
    console.log('📸 Capturing mobile pages (390x844)...');

    // Mobile Login
    const mobileLoginPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(mobileLoginPage, { authenticated: false });
    await mobileLoginPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(mobileLoginPage);
    await mobileLoginPage.waitForSelector('.login .card');
    await mobileLoginPage.screenshot({
      path: path.join(PAGES_DIR, 'login-page-mobile.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/login-page-mobile.png');
    console.log('  ✓ pages/login-page-mobile.png');
    await mobileLoginPage.close();

    // Mobile Dashboard, Bank Accounts, Profile, and Chat
    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    await setupApiMockRoutes(mobilePage, { authenticated: true });

    await mobilePage.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(mobilePage);
    await mobilePage.waitForSelector('.net-worth-card');
    await mobilePage.screenshot({
      path: path.join(PAGES_DIR, 'dashboard-page-mobile.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/dashboard-page-mobile.png');
    console.log('  ✓ pages/dashboard-page-mobile.png');

    await mobilePage.goto(`${baseUrl}/accounts`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(mobilePage);
    await mobilePage.waitForSelector('.enrollment-card');
    await mobilePage.screenshot({
      path: path.join(PAGES_DIR, 'bank-accounts-page-mobile.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/bank-accounts-page-mobile.png');
    console.log('  ✓ pages/bank-accounts-page-mobile.png');

    await mobilePage.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(mobilePage);
    await mobilePage.waitForSelector('.profile-card');
    await mobilePage.screenshot({
      path: path.join(PAGES_DIR, 'profile-page-mobile.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/profile-page-mobile.png');
    console.log('  ✓ pages/profile-page-mobile.png');

    await mobilePage.goto(`${baseUrl}/chat`, { waitUntil: 'networkidle' });
    await applyDeterministicStyles(mobilePage);
    await mobilePage.waitForSelector('.chat-card');
    await mobilePage.screenshot({
      path: path.join(PAGES_DIR, 'chat-page-mobile.png'),
      fullPage: true,
    });
    savedFiles.push('screenshots/pages/chat-page-mobile.png');
    console.log('  ✓ pages/chat-page-mobile.png');

    await mobilePage.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n🎉 Successfully captured ${savedFiles.length} screenshots!`);
  return savedFiles;
}

if (require.main === module) {
  generateScreenshots()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to generate screenshots:', err);
      process.exit(1);
    });
}

module.exports = { generateScreenshots };
