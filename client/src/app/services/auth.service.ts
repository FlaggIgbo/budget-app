import { Injectable, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  email: string;
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

  // Send verification code to email
  sendOtp(email: string): Observable<{ ok: boolean; message?: string }> {
    return this.api.post<{ ok: boolean; message?: string }>('/auth/send-otp', { email });
  }

  // Verify code and log user in
  verifyOtp(email: string, otp: string): Observable<{ ok: boolean; user: User }> {
    return this.api.post<{ ok: boolean; user: User }>('/auth/verify-otp', { email, otp }).pipe(
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
