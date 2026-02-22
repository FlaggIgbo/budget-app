import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

export const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.loaded()) {
    if (auth.isLoggedIn()) return true;
    return router.createUrlTree(['/login']);
  }

  return auth.checkSession().pipe(map((user) => (user ? true : router.createUrlTree(['/login']))));
};
