import { ErrorHandler, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

// ============================================================================
// SENTRY ERROR & ISSUE LOGGING SERVICE (FRONTEND STUB)
// Captures unhandled Angular errors and manual diagnostic messages.
// ============================================================================

@Injectable({ providedIn: 'root' })
export class SentryService {
  private initialized = false;

  initSentry(): void {
    if (!environment.sentryDsn) {
      return;
    }

    // TODO: Install `@sentry/angular` and initialize Sentry here:
    // Sentry.init({
    //   dsn: environment.sentryDsn,
    //   environment: environment.name,
    // });
    this.initialized = true;
  }

  captureException(error: unknown, context: Record<string, unknown> = {}): void {
    // TODO: Forward exception to Sentry when `@sentry/angular` is configured:
    // if (this.initialized) {
    //   Sentry.captureException(error, { extra: context });
    // }
    console.error('[SentryStub]', error, context);
  }

  captureMessage(message: string, context: Record<string, unknown> = {}): void {
    // TODO: Forward message to Sentry when `@sentry/angular` is configured:
    // if (this.initialized) {
    //   Sentry.captureMessage(message, { extra: context });
    // }
    console.info('[SentryStub]', message, context);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

@Injectable()
export class SentryErrorHandler implements ErrorHandler {
  constructor(private sentry: SentryService) {}

  handleError(error: unknown): void {
    this.sentry.captureException(error, { source: 'AngularErrorHandler' });
  }
}
