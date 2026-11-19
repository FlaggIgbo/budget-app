import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import {
  PasskeyCreationOptionsJSON,
  PasskeyRequestOptionsJSON,
  SerializedAuthenticationCredential,
  SerializedRegistrationCredential,
} from './webauthn.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  hasPasskey?: boolean;
  passkeyCreatedAt?: string | null;
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

export interface PasskeyLoginOptionsResponse {
  ok: boolean;
  hasPasskey: boolean;
  phone?: string;
  options?: PasskeyRequestOptionsJSON;
}

export interface AuthConfig {
  environment?: 'development' | 'production';
  plaidConfigured?: boolean;
  plaidEnvironment?: string;
  authSandbox?: { phone: string; otp: string };
}

const PENDING_SIGNUP_STORAGE_KEY = 'budget_app_pending_signup';
const PASSKEY_WARNING_STORAGE_KEY = 'budget_app_passkey_warning';

// Service to manage login status, passkey auth, signup handoff, and user session
@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSignal = signal<User | null>(null);
  private loadedSignal = signal(false);
  private pendingSignupSignal = signal<PendingSignup | null>(this.loadPendingSignup());
  private passkeyWarningSignal = signal<string | null>(this.loadPasskeyWarning());

  user = this.userSignal.asReadonly();
  isLoggedIn = computed(() => this.userSignal() !== null);
  loaded = this.loadedSignal.asReadonly();
  pendingSignup = this.pendingSignupSignal.asReadonly();
  passkeyWarning = this.passkeyWarningSignal.asReadonly();

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

  private loadPasskeyWarning(): string | null {
    try {
      return sessionStorage.getItem(PASSKEY_WARNING_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  setPasskeyWarning(message: string | null): void {
    this.passkeyWarningSignal.set(message);
    try {
      if (message) {
        sessionStorage.setItem(PASSKEY_WARNING_STORAGE_KEY, message);
      } else {
        sessionStorage.removeItem(PASSKEY_WARNING_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  clearPasskeyWarning(): void {
    this.setPasskeyWarning(null);
  }

  clearPendingSignup(): void {
    this.savePendingSignup(null);
  }

  // Keep auth user signal synced after profile contact or passkey updates
  updateUser(user: User): void {
    this.userSignal.set(user);
    if (user.hasPasskey) {
      this.clearPasskeyWarning();
    }
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

  // POST /auth/passkey/login/options - Find user by phone and fetch passkey challenge if registered
  getPasskeyLoginOptions(phone: string): Observable<PasskeyLoginOptionsResponse> {
    return this.api.post<PasskeyLoginOptionsResponse>('/auth/passkey/login/options', { phone });
  }

  // POST /auth/passkey/login/verify - Verify navigator.credentials.get() assertion and issue session
  verifyPasskeyLogin(
    phone: string,
    credential: SerializedAuthenticationCredential
  ): Observable<{ ok: boolean; user: User }> {
    return this.api
      .post<{ ok: boolean; user: User }>('/auth/passkey/login/verify', {
        phone,
        credential,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.savePendingSignup(null);
            this.clearPasskeyWarning();
            this.userSignal.set(res.user);
          }
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

  // POST /auth/signup/verify-email-otp - Verify email OTP during signup before passkey creation step
  verifySignupEmailOtp(
    firstName: string,
    lastName: string,
    email: string,
    code: string
  ): Observable<{ ok: boolean; emailVerified: boolean; phone?: string; email?: string }> {
    const pending = this.pendingSignupSignal();
    return this.api.post<{ ok: boolean; emailVerified: boolean; phone?: string; email?: string }>(
      '/auth/signup/verify-email-otp',
      {
        signupToken: pending?.signupToken || '',
        firstName,
        lastName,
        email,
        code,
      }
    );
  }

  // POST /auth/signup/passkey/options - Fetch WebAuthn options for navigator.credentials.create()
  getSignupPasskeyOptions(): Observable<{ ok: boolean; options: PasskeyCreationOptionsJSON }> {
    const pending = this.pendingSignupSignal();
    return this.api.post<{ ok: boolean; options: PasskeyCreationOptionsJSON }>(
      '/auth/signup/passkey/options',
      {
        signupToken: pending?.signupToken || '',
      }
    );
  }

  // POST /auth/signup/complete - Complete signup with newly created passkey
  completeSignupWithPasskey(
    passkeyCredential: SerializedRegistrationCredential
  ): Observable<{ ok: boolean; user: User }> {
    const pending = this.pendingSignupSignal();
    return this.api
      .post<{ ok: boolean; user: User }>('/auth/signup/complete', {
        signupToken: pending?.signupToken || '',
        passkeyCredential,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.savePendingSignup(null);
            this.clearPasskeyWarning();
            this.userSignal.set(res.user);
          }
        })
      );
  }

  // POST /auth/signup/complete - Complete signup skipping passkey creation after an error
  completeSignupSkippingPasskey(): Observable<{ ok: boolean; user: User }> {
    const pending = this.pendingSignupSignal();
    return this.api
      .post<{ ok: boolean; user: User }>('/auth/signup/complete', {
        signupToken: pending?.signupToken || '',
        skipPasskey: true,
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
        this.clearPasskeyWarning();
      })
    );
  }
}
