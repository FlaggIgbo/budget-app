import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  email: string;
}

export interface AuthConfig {
  tellerApplicationId?: string;
  tellerEnvironment?: string;
  authSandbox?: { email: string; otp: string };
}

// Service to manage login status and user session
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

  // POST /otp/request - Send 6-digit verification code to email
  sendOtp(email: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/otp/request', { email });
  }

  // POST /otp/verify - Verify code and issue user session
  verifyOtp(email: string, code: string): Observable<{ ok: boolean; user: User }> {
    return this.api.post<{ ok: boolean; user: User }>('/otp/verify', { email, code }).pipe(
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
