import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

// Allow access to /signup only when the user is not logged in and has a phone-verified pending signup
export const signupGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const evaluate = () => {
    if (auth.isLoggedIn()) {
      return router.createUrlTree(['/dashboard']);
    }
    if (auth.pendingSignup()) {
      return true;
    }
    return router.createUrlTree(['/login']);
  };

  if (auth.loaded()) {
    return evaluate();
  }

  return auth.checkSession().pipe(map(() => evaluate()));
};
