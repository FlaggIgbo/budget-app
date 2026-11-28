import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { PasskeyRequestOptionsJSON, WebAuthnService } from '../../services/webauthn.service';
import { environment } from '../../../environments/environment';
import {
  isValidUsPhone,
  normalizeUsPhone,
  UsPhoneValidatorDirective,
} from '../../utils/validation.util';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    UsPhoneValidatorDirective,
  ],
  template: `
    <div class="login">
      <div class="login-container">
        <div class="brand-badge">
          <mat-icon>{{ step() === 'passkey' ? 'fingerprint' : 'account_balance_wallet' }}</mat-icon>
        </div>
        <mat-card appearance="outlined" class="card">
          <mat-card-header class="login-header">
            <mat-card-title><h1>Budget App</h1></mat-card-title>
            <mat-card-subtitle class="subtitle">
              @if (step() === 'phone') {
                Sign in with your phone number
              } @else if (step() === 'passkey') {
                Verify with your passkey for {{ phone }}
              } @else {
                Enter the 6-digit code sent to {{ phone }}
              }
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            @if (!isProduction && sandbox(); as creds) {
              <div class="sandbox-banner">
                <div class="sandbox-header">
                  <mat-icon>developer_mode</mat-icon>
                  <strong>Development Test Account</strong>
                  <span class="dev-badge">Dev Only</span>
                </div>
                <p class="sandbox-note">
                  No SMS is sent in development mode. Use these test credentials:
                </p>
                <div class="sandbox-creds">
                  <div class="cred-chip">
                    <span class="cred-label">Phone:</span>
                    <code>{{ creds.phone }}</code>
                  </div>
                  <div class="cred-chip">
                    <span class="cred-label">OTP:</span>
                    <code>{{ creds.otp }}</code>
                  </div>
                </div>
              </div>
            }

            @if (step() === 'phone') {
              <form (ngSubmit)="continueWithPhone()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label>Phone number</mat-label>
                  <mat-icon matPrefix>phone</mat-icon>
                  <input
                    matInput
                    id="phone"
                    type="tel"
                    [(ngModel)]="phone"
                    #phoneModel="ngModel"
                    name="phone"
                    [placeholder]="sandbox()?.phone ?? '+15551234567'"
                    autocomplete="tel"
                    inputmode="tel"
                    required
                    appUsPhone
                  />
                  <mat-hint>US phone number (+1)</mat-hint>
                  @if (phoneModel.hasError('required')) {
                    <mat-error>Phone number is required</mat-error>
                  } @else if (phoneModel.hasError('usPhone')) {
                    <mat-error>Enter a valid US (+1) phone number (e.g. +15551234567)</mat-error>
                  }
                </mat-form-field>
                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !isPhoneValid"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  }
                  {{ loading() ? 'Continuing…' : 'Continue' }}
                </button>
              </form>
            } @else if (step() === 'passkey') {
              <div class="form">
                <button
                  mat-flat-button
                  type="button"
                  class="btn btn-retry-passkey"
                  (click)="authenticateWithPasskey()"
                  [disabled]="loading()"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  } @else {
                    <mat-icon>fingerprint</mat-icon>
                  }
                  {{ loading() ? 'Verifying passkey…' : 'Sign in with passkey' }}
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  class="btn-secondary"
                  (click)="sendOtp()"
                  [disabled]="loading()"
                >
                  <mat-icon>sms</mat-icon>
                  Use SMS verification code instead
                </button>
                <button
                  mat-button
                  type="button"
                  class="btn-link"
                  (click)="resetToPhone()"
                  [disabled]="loading()"
                >
                  <mat-icon>arrow_back</mat-icon>
                  Change phone number
                </button>
              </div>
            } @else {
              <form (ngSubmit)="verifyOtp()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label>Verification code</mat-label>
                  <mat-icon matPrefix>lock</mat-icon>
                  <input
                    matInput
                    id="otp"
                    type="text"
                    [(ngModel)]="otp"
                    name="otp"
                    [placeholder]="sandbox()?.otp ?? '123456'"
                    maxlength="6"
                    autocomplete="one-time-code"
                    inputmode="numeric"
                  />
                </mat-form-field>
                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !otp.trim()"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  }
                  {{ loading() ? 'Verifying…' : 'Verify & Continue' }}
                </button>
                <button mat-button type="button" class="btn-link" (click)="resetToPhone()">
                  <mat-icon>arrow_back</mat-icon>
                  Change phone number
                </button>
              </form>
            }

            @if (error(); as err) {
              <div class="error-banner">
                <mat-icon>error_outline</mat-icon>
                <span class="error">{{ err }}</span>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [
    `
      .login {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background:
          radial-gradient(circle at 50% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 60%),
          linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      }
      .login-container {
        width: 100%;
        max-width: 440px;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .brand-badge {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: -28px;
        z-index: 2;
        box-shadow: 0 10px 20px -5px rgba(37, 99, 235, 0.4);
      }
      .brand-badge mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .card {
        width: 100%;
        padding: 2.25rem 1.75rem 1.75rem;
        border-radius: 20px !important;
        box-shadow:
          0 20px 35px -10px rgba(15, 23, 42, 0.08),
          0 1px 3px rgba(15, 23, 42, 0.04) !important;
        background: #ffffff !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
      }
      .login-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-bottom: 1.5rem;
      }
      h1 {
        margin: 0;
        font-size: 1.75rem;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin-top: 0.35rem;
        color: #64748b;
        font-size: 0.925rem;
      }
      .sandbox-banner {
        background: rgba(37, 99, 235, 0.04);
        border: 1px solid rgba(37, 99, 235, 0.15);
        border-radius: 14px;
        padding: 0.85rem 1rem;
        margin-bottom: 1.5rem;
      }
      .sandbox-header {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        color: #1e40af;
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }
      .sandbox-header mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #2563eb;
      }
      .dev-badge {
        margin-left: auto;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #1d4ed8;
        background: rgba(37, 99, 235, 0.12);
        padding: 0.15rem 0.5rem;
        border-radius: 9999px;
      }
      .sandbox-note {
        margin: 0 0 0.6rem;
        font-size: 0.8rem;
        color: #475569;
        line-height: 1.4;
      }
      .sandbox-creds {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .cred-chip {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.825rem;
      }
      .cred-label {
        color: #64748b;
      }
      .sandbox-banner code {
        background: #ffffff;
        border: 1px solid rgba(203, 213, 225, 0.8);
        padding: 0.2rem 0.5rem;
        border-radius: 6px;
        font-size: 0.85em;
        font-weight: 600;
        color: #0f172a;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      mat-form-field {
        width: 100%;
      }
      .btn {
        height: 48px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
        color: #ffffff !important;
        font-size: 0.95rem;
        font-weight: 600 !important;
        border-radius: 12px !important;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .btn:hover:not([disabled]) {
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
        transform: translateY(-1px);
      }
      .btn-secondary {
        height: 44px;
        border-radius: 12px !important;
        border-color: #cbd5e1 !important;
        color: #334155 !important;
        font-weight: 600 !important;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
      }
      .btn-link {
        color: #475569 !important;
        font-weight: 500;
        font-size: 0.9rem;
        margin-top: 0.25rem;
      }
      .btn-link mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-right: 0.25rem;
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        padding: 0.75rem 1rem;
        border-radius: 12px;
        margin-top: 1rem;
        color: #dc2626;
      }
      .error-banner mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .error {
        font-size: 0.875rem;
        font-weight: 500;
        margin: 0;
      }
    `,
  ],
})
export class LoginComponent implements OnInit, OnDestroy {
  phone = '';
  otp = '';
  step = signal<'phone' | 'passkey' | 'otp'>('phone');
  loading = signal(false);
  error = signal<string | null>(null);
  sandbox = signal<{ phone: string; otp: string } | null>(null);
  readonly isProduction = environment.production;
  private otpAbortController: AbortController | null = null;

  constructor(
    private auth: AuthService,
    private webauthn: WebAuthnService,
    private router: Router
  ) {}

  ngOnDestroy() {
    this.abortOtpListener();
  }

  ngOnInit() {
    // Only display development test account credentials outside production
    if (!this.isProduction) {
      this.auth.getAuthConfig().subscribe({
        next: (cfg) => {
          if (cfg.environment !== 'production' && cfg.authSandbox) {
            this.sandbox.set(cfg.authSandbox);
          }
        },
      });
    }
  }

  get isPhoneValid(): boolean {
    return isValidUsPhone(this.phone);
  }

  // Look up account by phone: authenticate with passkey via navigator.credentials.get() if registered,
  // otherwise proceed with SMS OTP (for new users or users without a passkey)
  async continueWithPhone() {
    const normalizedPhone = normalizeUsPhone(this.phone);
    if (!normalizedPhone) {
      if (this.phone.trim()) {
        this.error.set('Please enter a valid US (+1) phone number');
      }
      return;
    }

    this.phone = normalizedPhone;
    this.error.set(null);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(this.auth.getPasskeyLoginOptions(this.phone));
      if (res.hasPasskey && res.options) {
        await this.completePasskeyLogin(res.options);
        return;
      }
      // No passkey associated with this phone number (or new account) -> proceed to SMS OTP
      this.sendOtp();
    } catch (err: unknown) {
      const httpErr = err as { status?: number; error?: { error?: string } };
      if (httpErr?.status === 400) {
        this.error.set(httpErr?.error?.error || 'Valid phone number required');
        this.loading.set(false);
        return;
      }
      // On unexpected server error during passkey lookup, fall back to OTP
      this.sendOtp();
    }
  }

  // Re-request a fresh passkey challenge and call navigator.credentials.get()
  async authenticateWithPasskey() {
    this.error.set(null);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(this.auth.getPasskeyLoginOptions(this.phone));
      if (!res.hasPasskey || !res.options) {
        this.sendOtp();
        return;
      }
      await this.completePasskeyLogin(res.options);
    } catch (err: unknown) {
      const httpErr = err as { error?: { error?: string } };
      this.error.set(
        httpErr?.error?.error || 'Passkey sign-in failed. You can try again or use SMS.'
      );
      this.step.set('passkey');
      this.loading.set(false);
    }
  }

  private async completePasskeyLogin(options: PasskeyRequestOptionsJSON): Promise<void> {
    let credential;
    try {
      credential = await this.webauthn.getPasskey(options);
    } catch {
      this.error.set(
        'Passkey authentication was cancelled or failed. Try again or sign in with an SMS code.'
      );
      this.step.set('passkey');
      this.loading.set(false);
      return;
    }

    try {
      await firstValueFrom(this.auth.verifyPasskeyLogin(this.phone, credential));
      this.loading.set(false);
      this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      const httpErr = err as { error?: { error?: string } };
      this.error.set(
        httpErr?.error?.error ||
          'Passkey verification failed. Try again or sign in with an SMS code.'
      );
      this.step.set('passkey');
      this.loading.set(false);
    }
  }

  // Send SMS verification code and start WebOTP listener for autofill
  sendOtp() {
    this.abortOtpListener();
    this.error.set(null);
    this.loading.set(true);

    this.auth.sendOtp(this.phone).subscribe({
      next: () => {
        this.step.set('otp');
        this.loading.set(false);
        this.listenForSmsOtp();
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  // Verify SMS code: navigate to home page if account exists, or to sign up page if new user
  verifyOtp() {
    this.abortOtpListener();
    this.error.set(null);
    this.loading.set(true);

    this.auth.verifyOtp(this.phone, this.otp).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.requiresSignup) {
          this.router.navigate(['/signup']);
        } else {
          this.router.navigate(['/dashboard']);
        }
      },
      error: (err) => {
        const message = err?.error?.error || 'Invalid code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  resetToPhone() {
    this.abortOtpListener();
    this.step.set('phone');
    this.otp = '';
    this.error.set(null);
  }

  private listenForSmsOtp(): void {
    this.abortOtpListener();
    if (typeof this.webauthn.receiveOtp !== 'function') {
      return;
    }
    const controller = new AbortController();
    this.otpAbortController = controller;

    void this.webauthn.receiveOtp('sms', controller.signal).then((code) => {
      if (code && !controller.signal.aborted && this.step() === 'otp' && !this.loading()) {
        this.otp = code;
        this.verifyOtp();
      }
    });
  }

  private abortOtpListener(): void {
    if (this.otpAbortController) {
      this.otpAbortController.abort();
      this.otpAbortController = null;
    }
  }

  // TODO: Add username/password login form mode calling `auth.loginWithPassword(...)`
  // if migrating away from phone OTP authentication in the future.
}
