import nodemailer = require('nodemailer');

let customTransporter = null;

// Create Nodemailer SMTP transporter from environment variables
function createTransporter() {
  if (customTransporter) {
    return customTransporter;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration is missing (SMTP_HOST, SMTP_USER, SMTP_PASS required)');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

// Allow overriding transporter in tests
function setTransporter(transporter) {
  customTransporter = transporter;
}

// Resolve origin domain for WebOTP origin-bound email format (`@<domain> #<code>`)
function getWebOtpDomain() {
  if (process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_RP_ID.trim()) {
    return process.env.WEBAUTHN_RP_ID.trim();
  }
  const rawOrigin = (
    process.env.WEBAUTHN_ORIGIN ||
    process.env.CORS_ORIGIN ||
    'http://localhost:4200'
  )
    .split(',')[0]
    .trim();
  try {
    return new URL(rawOrigin).hostname;
  } catch {
    return 'localhost';
  }
}

// Send 6-digit OTP verification code via SMTP (used during signup and when changing a user's profile email)
async function sendOtpEmail(toEmail, code) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@budgetapp.local';
  const domain = getWebOtpDomain();

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Your Budget App email verification code',
    text: `Your Budget App email verification code is ${code}. It expires in 5 minutes.\n\n@${domain} #${code}`,
    html: `<p>Your Budget App email verification code is <strong>${code}</strong>.</p><p>This code expires in 5 minutes.</p><p>@${domain} #${code}</p>`,
  });
}

// Send a personal finance summary (net worth, cash flow, spending breakdown) to a user's verified email
async function sendFinanceSummaryEmail(toEmail, summaryData: Record<string, any> = {}) {
  // TODO: Implement personal finance summary email template and scheduled/on-demand delivery.
  // Consider including:
  //   1. Net Worth snapshot (totalAssets, totalLiabilities, netWorth)
  //   2. Monthly Cash Flow (thisMonthIncome vs. thisMonthExpenses, MoM % change)
  //   3. Top Spending Categories for the current period
  //   4. Notable or recent transactions across linked Plaid institutions
  // Once ready, format an HTML digest and send via `createTransporter().sendMail(...)`.
  return {
    todo: true,
    to: toEmail,
    summaryData,
  };
}

export = {
  createTransporter,
  setTransporter,
  sendOtpEmail,
  sendFinanceSummaryEmail,
};
