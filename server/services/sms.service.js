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

  // TODO: Install and initialize the official Twilio SDK client (`const twilio = require('twilio')`)
  // and return `twilio(accountSid, authToken)` once your Twilio credentials are ready.
  return {
    accountSid,
    authToken,
    messages: {
      create: async ({ to, from, body }) => {
        // TODO: Replace this stub with the live Twilio Messages API request:
        // return await client.messages.create({ to, from, body });
        return { sid: 'SM_STUB_TODO', to, from, body };
      },
    },
  };
}

// Allow overriding SMS sender in tests
function setSmsSender(sender) {
  customSmsSender = sender;
}

// Send 6-digit OTP login/verification code via Twilio SMS
async function sendOtpSms(toPhone, code) {
  const fromPhone = process.env.TWILIO_PHONE_NUMBER || '+15005550006';
  const body = `Your Budget App verification code is ${code}. It expires in 5 minutes.`;

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
