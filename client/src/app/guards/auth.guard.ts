import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

// Only allow logged-in users to view the page
export const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // If already checked session
  if (auth.loaded()) {
    if (auth.isLoggedIn()) {
      return true;
    }
    return router.createUrlTree(['/login']);
  }

  // Check session from server
  return auth.checkSession().pipe(
    map((user) => {
      if (user) {
        return true;
      }
      return router.createUrlTree(['/login']);
    })
  );
};
