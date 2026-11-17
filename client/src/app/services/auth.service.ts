import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  phone: string;
  email?: string | null;
}

export interface AuthConfig {
  plaidConfigured?: boolean;
  plaidEnvironment?: string;
  authSandbox?: { phone: string; otp: string };
}

// Service to manage login status and user session (Phone OTP authentication)
@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private loadedSignal = signal(false);

  user = this.userSignal.asReadonly();
  isLoggedIn = computed(() => this.userSignal() !== null);
  loaded = this.loadedSignal.asReadonly();

  constructor(private api: ApiService) {}

  // Get auth/sandbox configuration for the login page
  getAuthConfig(): Observable<AuthConfig> {
    return this.api.get<AuthConfig>('/config');
  }

  // Check if user is currently logged in
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

  // POST /otp/request - Send 6-digit SMS verification code to phone number
  sendOtp(phone: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/otp/request', { phone });
  }

  // POST /otp/verify - Verify SMS code and issue user session
  verifyOtp(phone: string, code: string): Observable<{ ok: boolean; user: User }> {
    return this.api.post<{ ok: boolean; user: User }>('/otp/verify', { phone, code }).pipe(
      tap((res) => {
        if (res.ok && res.user) {
          this.userSignal.set(res.user);
        }
      })
    );
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.api
      .post<{ ok: boolean }>('/auth/logout', {})
      .pipe(tap(() => this.userSignal.set(null)));
  }
}
