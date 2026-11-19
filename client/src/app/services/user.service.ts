import { Injectable } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { PasskeyCreationOptionsJSON, SerializedRegistrationCredential } from './webauthn.service';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  hasPasskey?: boolean;
  passkeyCreatedAt?: string | null;
}

// Feature service for user profile, OTP-verified email/phone updates, and passkey management
@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {}

  // Load current user's profile
  getProfile(): Observable<UserProfile> {
    return this.api.get<UserProfile>('/profile');
  }

  // Request a 6-digit OTP to verify a new email address before updating the profile
  requestEmailChangeOtp(email: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/profile/contact/request-otp', {
      type: 'email',
      email,
    });
  }

  // Verify the 6-digit email OTP and update the user's email address
  verifyEmailChangeOtp(
    email: string,
    code: string
  ): Observable<{ ok: boolean; user: UserProfile }> {
    return this.api
      .post<{ ok: boolean; user: UserProfile }>('/profile/contact/verify-otp', {
        type: 'email',
        email,
        code,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.auth.updateUser(res.user);
          }
        })
      );
  }

  // Request a 6-digit SMS OTP to verify a new phone number before updating the profile
  requestPhoneChangeOtp(phone: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/profile/contact/request-otp', {
      type: 'phone',
      phone,
    });
  }

  // Verify the 6-digit SMS OTP and update the user's phone number
  verifyPhoneChangeOtp(
    phone: string,
    code: string
  ): Observable<{ ok: boolean; user: UserProfile }> {
    return this.api
      .post<{ ok: boolean; user: UserProfile }>('/profile/contact/verify-otp', {
        type: 'phone',
        phone,
        code,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.auth.updateUser(res.user);
          }
        })
      );
  }

  // Fetch WebAuthn creation options to register a passkey on the profile page
  getPasskeyRegisterOptions(): Observable<{ ok: boolean; options: PasskeyCreationOptionsJSON }> {
    return this.api.post<{ ok: boolean; options: PasskeyCreationOptionsJSON }>(
      '/profile/passkey/register/options',
      {}
    );
  }

  // Verify and persist a newly created passkey from navigator.credentials.create()
  verifyPasskeyRegister(
    credential: SerializedRegistrationCredential
  ): Observable<{ ok: boolean; user: UserProfile }> {
    return this.api
      .post<{ ok: boolean; user: UserProfile }>('/profile/passkey/register/verify', {
        credential,
      })
      .pipe(
        tap((res) => {
          if (res.ok && res.user) {
            this.auth.updateUser(res.user);
          }
        })
      );
  }

  // Delete the user's registered passkey
  deletePasskey(): Observable<{ ok: boolean; user: UserProfile }> {
    return this.api.delete<{ ok: boolean; user: UserProfile }>('/profile/passkey').pipe(
      tap((res) => {
        if (res.ok && res.user) {
          this.auth.updateUser(res.user);
        }
      })
    );
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }
}
