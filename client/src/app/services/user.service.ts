import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface UserProfile {
  id: string;
  phone: string;
  email: string | null;
}

// Feature service for user profile and email verification operations
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

  // Request a 6-digit OTP to verify an email address before linking it to the profile
  requestEmailOtp(email: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/profile/contact/request-otp', {
      email,
    });
  }

  // Verify the 6-digit email OTP and upsert the verified email into the user profile
  verifyEmailOtp(email: string, code: string): Observable<{ ok: boolean; user: UserProfile }> {
    return this.api.post<{ ok: boolean; user: UserProfile }>('/profile/contact/verify-otp', {
      email,
      code,
    });
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }
}
