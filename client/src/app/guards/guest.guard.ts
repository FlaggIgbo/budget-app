import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

/** Redirect to dashboard if already logged in. */
export const guestGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loaded() && auth.isLoggedIn()) {
    return router.createUrlTree(['/dashboard']);
  }
  if (auth.loaded()) return true;

  return auth
    .checkSession()
    .pipe(map((user) => (user ? router.createUrlTree(['/dashboard']) : true)));
};
