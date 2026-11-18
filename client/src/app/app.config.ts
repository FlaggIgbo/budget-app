import {
  ApplicationConfig,
  provideZoneChangeDetection,
  APP_INITIALIZER,
  ErrorHandler,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './services/auth.service';
import { SentryService, SentryErrorHandler } from './services/sentry.service';

import { routes } from './app.routes';

// Initialize Sentry stub and check if the user is logged in when the app starts
function initializeApp(auth: AuthService, sentry: SentryService) {
  return () => {
    sentry.initSentry();
    return firstValueFrom(auth.checkSession());
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync(),
    {
      provide: ErrorHandler,
      useClass: SentryErrorHandler,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AuthService, SentryService],
      multi: true,
    },
  ],
};
