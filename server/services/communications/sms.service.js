let customSmsSender = null;

// ============================================================================
// SMS SERVICE (TWILIO STUBS)
// Sends 6-digit OTP verification codes via SMS.
// ============================================================================

// Create Twilio client from environment variables
function createTwilioClient() {
  if (customSmsSender) {
    return customSmsSender;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // TODO: Do NOT install the third-party `twilio` SDK — call Twilio's HTTPS Messages REST API
  // directly using native `fetch()`, `URLSearchParams`, and HTTP Basic Auth (`Buffer.from(...)`):
  //   POST https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json
  //   Headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
  //              'Content-Type': 'application/x-www-form-urlencoded' }
  //   Body: new URLSearchParams({ To: to, From: from, Body: body })
  return {
    accountSid,
    authToken,
    messages: {
      create: async ({ to, from, body }) => {
        // TODO: Replace this stub with the live native `fetch()` call to Twilio's HTTPS Messages API above.
        return { sid: 'SM_STUB_TODO', to, from, body };
      },
    },
  };
}

// Allow overriding SMS sender in tests
function setSmsSender(sender) {
  customSmsSender = sender;
}

// Resolve origin domain for WebOTP origin-bound SMS format (`@<domain> #<code>`)
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

// Send 6-digit OTP login/verification code via Twilio SMS (formatted for WebOTP autofill)
async function sendOtpSms(toPhone, code) {
  const fromPhone = process.env.TWILIO_PHONE_NUMBER || '+15005550006';
  const domain = getWebOtpDomain();
  const body = `Your Budget App verification code is ${code}. It expires in 5 minutes.\n\n@${domain} #${code}`;

  if (customSmsSender && typeof customSmsSender.sendSms === 'function') {
    return await customSmsSender.sendSms({
      from: fromPhone,
      to: toPhone,
      body,
    });
  }

  // TODO: Wire up production Twilio SMS delivery in createTwilioClient() above
  // and ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set in .env.
  const client = createTwilioClient();
  return await client.messages.create({
    from: fromPhone,
    to: toPhone,
    body,
  });
}

module.exports = {
  createTwilioClient,
  setSmsSender,
  sendOtpSms,
};
