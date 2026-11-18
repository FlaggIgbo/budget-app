const { getEnvConfig } = require('../config/env.config');

// ============================================================================
// SENTRY ERROR & ISSUE LOGGING SERVICE (STUB)
// Centralizes exception and message reporting across the backend server.
// ============================================================================

let initialized = false;
const capturedEvents = [];

// Initialize Sentry SDK when SENTRY_DSN is provided
function initSentry() {
  const { sentryDsn, appEnv } = getEnvConfig();
  if (!sentryDsn) {
    return { initialized: false, environment: appEnv };
  }

  // TODO: Install `@sentry/node` and initialize Sentry here:
  // Sentry.init({
  //   dsn: sentryDsn,
  //   environment: appEnv,
  //   tracesSampleRate: appEnv === 'production' ? 0.2 : 1.0,
  // });
  initialized = true;
  return { initialized: true, environment: appEnv };
}

// Report an unhandled or caught exception to Sentry
function captureException(error, context = {}) {
  const event = {
    type: 'exception',
    message: error?.message || String(error),
    stack: error?.stack || null,
    context,
    timestamp: new Date().toISOString(),
  };

  capturedEvents.push(event);

  // TODO: Forward exception to Sentry in production:
  // if (initialized) {
  //   Sentry.withScope((scope) => {
  //     scope.setExtras(context);
  //     Sentry.captureException(error);
  //   });
  // }
  return event;
}

// Log an informational or warning issue to Sentry
function captureMessage(message, level = 'info', context = {}) {
  const event = {
    type: 'message',
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  };

  capturedEvents.push(event);

  // TODO: Forward message to Sentry:
  // if (initialized) {
  //   Sentry.captureMessage(message, { level, extra: context });
  // }
  return event;
}

function getCapturedEvents() {
  return capturedEvents;
}

function clearCapturedEvents() {
  capturedEvents.length = 0;
}

module.exports = {
  initSentry,
  captureException,
  captureMessage,
  getCapturedEvents,
  clearCapturedEvents,
  isInitialized: () => initialized,
};
