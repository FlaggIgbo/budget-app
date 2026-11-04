const nodemailer = require('nodemailer');

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

// Send 6-digit OTP login code via SMTP
async function sendOtpEmail(toEmail, code) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@budgetapp.local';

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Your Budget App verification code',
    text: `Your Budget App verification code is ${code}. It expires in 5 minutes.`,
    html: `<p>Your Budget App verification code is <strong>${code}</strong>.</p><p>This code expires in 5 minutes.</p>`,
  });
}

module.exports = {
  createTransporter,
  setTransporter,
  sendOtpEmail,
};
