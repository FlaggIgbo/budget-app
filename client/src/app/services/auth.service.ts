import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export interface PendingSignup {
  phone: string;
  signupToken: string;
}

export interface VerifyPhoneOtpResponse {
  ok: boolean;
  requiresSignup?: boolean;
  user?: User;
  phone?: string;
  signupToken?: string;
}

export interface AuthConfig {
  environment?: 'development' | 'production';
  plaidConfigured?: boolean;
  plaidEnvironment?: string;
  authSandbox?: { phone: string; otp: string };
}

const PENDING_SIGNUP_STORAGE_KEY = 'budget_app_pending_signup';

// Service to manage login status, signup handoff, and user session (Phone OTP authentication)
@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private loadedSignal = signal(false);
  private pendingSignupSignal = signal<PendingSignup | null>(this.loadPendingSignup());

  user = this.userSignal.asReadonly();
  isLoggedIn = computed(() => this.userSignal() !== null);
  loaded = this.loadedSignal.asReadonly();
  pendingSignup = this.pendingSignupSignal.asReadonly();

  constructor(private api: ApiService) {}

  private loadPendingSignup(): PendingSignup | null {
    try {
      const raw = sessionStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as PendingSignup;
      if (parsed && parsed.phone && parsed.signupToken) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private savePendingSignup(pending: PendingSignup | null): void {
    this.pendingSignupSignal.set(pending);
    try {
      if (pending) {
        sessionStorage.setItem(PENDING_SIGNUP_STORAGE_KEY, JSON.stringify(pending));
      } else {
        sessionStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  clearPendingSignup(): void {
    this.savePendingSignup(null);
  }

  // Keep auth user signal synced after profile contact updates
  updateUser(user: User): void {
    this.userSignal.set(user);
  }

  // Get auth/sandbox configuration for the login / signup pages
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

  // POST /otp/verify - Verify SMS code; issue session for existing accounts or store pending signup token
  verifyOtp(phone: string, code: string): Observable<VerifyPhoneOtpResponse> {
    return this.api.post<VerifyPhoneOtpResponse>('/otp/verify', { phone, code }).pipe(
      tap((res) => {
        if (res.ok && res.requiresSignup && res.signupToken && res.phone) {
          this.userSignal.set(null);
          this.savePendingSignup({
            phone: res.phone,
            signupToken: res.signupToken,
          });
        } else if (res.ok && res.user) {
          this.savePendingSignup(null);
          this.userSignal.set(res.user);
        }
      })
    );
  }

  // POST /auth/signup/request-email-otp - Send 6-digit email OTP to confirm email ownership during signup
  requestSignupEmailOtp(email: string): Observable<{ ok: boolean; message?: string }> {
    const pending = this.pendingSignupSignal();
    return this.api.post<{ ok: boolean; message?: string }>('/auth/signup/request-email-otp', {
      signupToken: pending?.signupToken || '',
      email,
    });
  }

  // POST /auth/signup/complete - Verify email OTP, create User record, and issue session
  completeSignup(
    firstName: string,
    lastName: string,
    email: string,
    code: string
  ): Observable<{ ok: boolean; user: User }> {
    const pending = this.pendingSignupSignal();
    return this.api
      .post<{ ok: boolean; user: User }>('/auth/signup/complete', {
        signupToken: pending?.signupToken || '',
        firstName,
        lastName,
        email,
        code,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.savePendingSignup(null);
            this.userSignal.set(res.user);
          }
        })
      );
  }

  // TODO: Username/email + password login stub for future migration away from phone OTP
  loginWithPassword(
    identifier: string,
    password: string
  ): Observable<{ ok: boolean; user?: User }> {
    // TODO: Wire this up to the login UI once server-side password hashing and verification
    // in `server/services/password.service.js` are implemented.
    return this.api.post<{ ok: boolean; user?: User }>('/auth/login-password', {
      username: identifier,
      password,
    });
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.api.post<{ ok: boolean }>('/auth/logout', {}).pipe(
      tap(() => {
        this.userSignal.set(null);
        this.savePendingSignup(null);
      })
    );
  }
}
