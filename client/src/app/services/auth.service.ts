import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  phone: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private loadedSignal = signal(false);

  user = this.userSignal.asReadonly();
  isLoggedIn = computed(() => !!this.userSignal());
  loaded = this.loadedSignal.asReadonly();

  constructor(private api: ApiService) {}

  /** Check session on app init. */
  checkSession(): Observable<User | null> {
    return this.api.get<{ user: User }>('/auth/me').pipe(
      tap((res) => {
        this.userSignal.set(res.user);
        this.loadedSignal.set(true);
      }),
      map((res) => res.user),
      catchError(() => {
        this.userSignal.set(null);
        this.loadedSignal.set(true);
        return of(null);
      })
    );
  }

  sendOtp(phone: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/auth/send-otp', { phone });
  }

  verifyOtp(phone: string, otp: string): Observable<{ ok: boolean; user: User }> {
    return this.api.post<{ ok: boolean; user: User }>('/auth/verify-otp', { phone, otp }).pipe(
      tap((res) => {
        if (res.ok && res.user) {
          this.userSignal.set(res.user);
        }
      })
    );
  }

  logout(): Observable<{ ok: boolean }> {
    return this.api
      .post<{ ok: boolean }>('/auth/logout', {})
      .pipe(tap(() => this.userSignal.set(null)));
  }
}
