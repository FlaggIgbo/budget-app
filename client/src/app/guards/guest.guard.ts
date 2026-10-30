import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

// If user is already logged in, redirect to dashboard
export const guestGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // If already checked session
  if (auth.loaded()) {
    if (auth.isLoggedIn()) {
      return router.createUrlTree(['/dashboard']);
    }
    return true;
  }

  // Check session from server
  return auth.checkSession().pipe(
    map((user) => {
      if (user) {
        return router.createUrlTree(['/dashboard']);
      }
      return true;
    })
  );
};
