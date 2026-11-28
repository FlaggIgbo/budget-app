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
import { WebAuthnService } from '../../services/webauthn.service';
import { environment } from '../../../environments/environment';
import { EmailValidatorDirective, isValidEmail } from '../../utils/validation.util';

export const PASSKEY_USER_ERROR_WARNING =
  'Ideally, you should create a passkey. You can do this on the profile page.';
export const PASSKEY_SERVER_ERROR_WARNING =
  'Something went wrong, you can use OTP for now, but please try to create a passkey later on your profile page.';

@Component({
  selector: 'app-signup',
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
    EmailValidatorDirective,
  ],
  template: `
    <div class="signup">
      <div class="signup-container">
        <div class="brand-badge">
          <mat-icon>{{ step() === 'passkey' ? 'fingerprint' : 'person_add' }}</mat-icon>
        </div>
        <mat-card appearance="outlined" class="card">
          <mat-card-header class="signup-header">
            <mat-card-title>
              <h1>{{ step() === 'passkey' ? 'Create a passkey' : 'Create your account' }}</h1>
            </mat-card-title>
            <mat-card-subtitle class="subtitle">
              @if (step() === 'details') {
                Enter your name and email address to finish setting up your account
              } @else if (step() === 'email-otp') {
                Enter the 6-digit code sent to {{ email }}
              } @else {
                Use your device biometrics, PIN, or security key for fast, secure sign-in
              }
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            @if (verifiedPhone(); as phone) {
              <div class="verified-phone-banner">
                <mat-icon>verified</mat-icon>
                <span>Phone verified:</span>
                <strong>{{ phone }}</strong>
              </div>
            }

            @if (!isProduction && step() !== 'passkey' && sandboxOtp(); as code) {
              <div class="sandbox-banner">
                <mat-icon>info_outline</mat-icon>
                <span>Development email OTP (no email sent):</span>
                <code>{{ code }}</code>
              </div>
            }

            @if (step() === 'details') {
              <form (ngSubmit)="sendEmailOtp()" class="form">
                <div class="name-row">
                  <mat-form-field appearance="outline">
                    <mat-label>First name</mat-label>
                    <mat-icon matPrefix>badge</mat-icon>
                    <input
                      matInput
                      id="firstName"
                      type="text"
                      [(ngModel)]="firstName"
                      name="firstName"
                      placeholder="Alex"
                      autocomplete="given-name"
                      required
                    />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Last name</mat-label>
                    <input
                      matInput
                      id="lastName"
                      type="text"
                      [(ngModel)]="lastName"
                      name="lastName"
                      placeholder="Rivera"
                      autocomplete="family-name"
                      required
                    />
                  </mat-form-field>
                </div>

                <mat-form-field appearance="outline">
                  <mat-label>Email address</mat-label>
                  <mat-icon matPrefix>mail</mat-icon>
                  <input
                    matInput
                    id="email"
                    type="email"
                    [(ngModel)]="email"
                    #emailModel="ngModel"
                    name="email"
                    placeholder="you@example.com"
                    autocomplete="email"
                    required
                    appEmail
                  />
                  @if (emailModel.hasError('required')) {
                    <mat-error>Email address is required</mat-error>
                  } @else if (emailModel.hasError('emailFormat')) {
                    <mat-error>Enter a valid email address (e.g. you&#64;example.com)</mat-error>
                  }
                </mat-form-field>

                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !firstName.trim() || !lastName.trim() || !isEmailValid"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  }
                  {{ loading() ? 'Sending code…' : 'Send email verification code' }}
                </button>

                <button mat-button type="button" class="btn-link" (click)="backToLogin()">
                  <mat-icon>arrow_back</mat-icon>
                  Use a different phone number
                </button>
              </form>
            } @else if (step() === 'email-otp') {
              <form (ngSubmit)="verifyEmailOtp()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label>Email verification code</mat-label>
                  <mat-icon matPrefix>lock</mat-icon>
                  <input
                    matInput
                    id="emailOtp"
                    type="text"
                    class="otp-input"
                    [(ngModel)]="emailOtp"
                    name="emailOtp"
                    [placeholder]="sandboxOtp() ?? '123456'"
                    maxlength="6"
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    required
                  />
                </mat-form-field>

                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !emailOtp.trim()"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  }
                  {{ loading() ? 'Verifying…' : 'Verify email & Continue' }}
                </button>

                <div class="secondary-actions">
                  <button
                    mat-button
                    type="button"
                    class="btn-link"
                    (click)="editDetails()"
                    [disabled]="loading()"
                  >
                    <mat-icon>arrow_back</mat-icon>
                    Edit details
                  </button>
                  <button
                    mat-button
                    type="button"
                    class="btn-link"
                    (click)="sendEmailOtp()"
                    [disabled]="loading()"
                  >
                    <mat-icon>refresh</mat-icon>
                    Resend code
                  </button>
                </div>
              </form>
            } @else {
              <div class="passkey-step">
                <div class="passkey-info-box">
                  <div class="passkey-icon-circle">
                    <mat-icon>key</mat-icon>
                  </div>
                  <p class="passkey-description">
                    A passkey lets you sign in securely with Touch ID, Face ID, Windows Hello, or a
                    security key instead of waiting for an SMS code.
                  </p>
                </div>

                @if (passkeyWarning(); as warn) {
                  <div class="warning-banner" role="alert">
                    <mat-icon>warning_amber</mat-icon>
                    <span class="warning-text">{{ warn }}</span>
                  </div>
                }

                <button
                  mat-flat-button
                  type="button"
                  class="btn btn-create-passkey"
                  (click)="createPasskey()"
                  [disabled]="loading()"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  } @else {
                    <mat-icon>fingerprint</mat-icon>
                  }
                  {{
                    loading()
                      ? 'Setting up passkey…'
                      : canSkipPasskey()
                        ? 'Try creating passkey again'
                        : 'Create Passkey'
                  }}
                </button>

                @if (canSkipPasskey()) {
                  <button
                    mat-stroked-button
                    type="button"
                    class="btn-skip-passkey"
                    (click)="skipPasskeyAndFinish()"
                    [disabled]="loading()"
                  >
                    Skip for now & continue to dashboard
                  </button>
                }
              </div>
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
      .signup {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background:
          radial-gradient(circle at 50% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 60%),
          linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      }
      .signup-container {
        width: 100%;
        max-width: 480px;
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
      .signup-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-bottom: 1.5rem;
      }
      h1 {
        margin: 0;
        font-size: 1.65rem;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin-top: 0.35rem;
        color: #64748b;
        font-size: 0.925rem;
      }
      .verified-phone-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        border-radius: 12px;
        padding: 0.65rem 1rem;
        font-size: 0.875rem;
        margin-bottom: 1rem;
      }
      .verified-phone-banner mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .sandbox-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        background: rgba(37, 99, 235, 0.04);
        border: 1px solid rgba(37, 99, 235, 0.15);
        border-radius: 12px;
        padding: 0.6rem 0.9rem;
        margin-bottom: 1.25rem;
        font-size: 0.825rem;
        color: #1e40af;
      }
      .sandbox-banner mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #2563eb;
      }
      .sandbox-banner code {
        background: #ffffff;
        border: 1px solid rgba(203, 213, 225, 0.8);
        padding: 0.15rem 0.45rem;
        border-radius: 6px;
        font-weight: 600;
        color: #0f172a;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .form,
      .passkey-step {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .passkey-info-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.75rem;
        padding: 1.15rem 1rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
      }
      .passkey-icon-circle {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #eef2ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .passkey-icon-circle mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
      .passkey-description {
        margin: 0;
        font-size: 0.9rem;
        color: #475569;
        line-height: 1.5;
      }
      .warning-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        background: #fffbeb;
        border: 1px solid #fde68a;
        padding: 0.85rem 1rem;
        border-radius: 12px;
        color: #92400e;
        font-size: 0.875rem;
        line-height: 1.45;
      }
      .warning-banner mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: #d97706;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .name-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
      }
      @media (max-width: 520px) {
        .name-row {
          grid-template-columns: 1fr;
        }
      }
      mat-form-field {
        width: 100%;
      }
      .otp-input {
        letter-spacing: 0.25em;
        font-weight: 600;
        font-size: 1.1rem;
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
      .btn-skip-passkey {
        height: 44px;
        border-radius: 12px !important;
        border-color: #cbd5e1 !important;
        color: #475569 !important;
        font-weight: 600 !important;
      }
      .secondary-actions {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        margin-top: 0.25rem;
      }
      .btn-link {
        color: #475569 !important;
        font-weight: 500;
        font-size: 0.9rem;
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
export class SignupComponent implements OnInit, OnDestroy {
  firstName = '';
  lastName = '';
  email = '';
  emailOtp = '';

  step = signal<'details' | 'email-otp' | 'passkey'>('details');
  loading = signal(false);
  error = signal<string | null>(null);
  passkeyWarning = signal<string | null>(null);
  canSkipPasskey = signal(false);
  verifiedPhone = signal<string | null>(null);
  sandboxOtp = signal<string | null>(null);
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
    const pending = this.auth.pendingSignup();
    if (!pending) {
      this.router.navigate(['/login']);
      return;
    }

    this.verifiedPhone.set(pending.phone);

    if (!this.isProduction) {
      this.auth.getAuthConfig().subscribe({
        next: (cfg) => {
          if (cfg.environment !== 'production' && cfg.authSandbox?.otp) {
            this.sandboxOtp.set(cfg.authSandbox.otp);
          }
        },
      });
    }
  }

  get isEmailValid(): boolean {
    return isValidEmail(this.email);
  }

  // Step 1: Send 6-digit email OTP and start WebOTP listener for autofill
  sendEmailOtp() {
    if (!this.firstName.trim() || !this.lastName.trim() || !this.email.trim()) {
      return;
    }

    if (!isValidEmail(this.email)) {
      this.error.set('Please enter a valid email address');
      return;
    }

    this.abortOtpListener();
    this.error.set(null);
    this.loading.set(true);

    this.auth.requestSignupEmailOtp(this.email.trim()).subscribe({
      next: () => {
        this.step.set('email-otp');
        this.loading.set(false);
        this.listenForEmailOtp();
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send verification code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  // Step 2: Verify email OTP and advance to required passkey creation step
  verifyEmailOtp() {
    if (!this.emailOtp.trim()) {
      return;
    }

    this.abortOtpListener();
    this.error.set(null);
    this.loading.set(true);

    this.auth
      .verifySignupEmailOtp(
        this.firstName.trim(),
        this.lastName.trim(),
        this.email.trim(),
        this.emailOtp.trim()
      )
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.passkeyWarning.set(null);
          this.canSkipPasskey.set(false);
          this.step.set('passkey');
        },
        error: (err) => {
          const message = err?.error?.error || 'Invalid verification code';
          this.error.set(message);
          this.loading.set(false);
        },
      });
  }

  // Step 3: Create passkey via navigator.credentials.create() and complete signup
  async createPasskey() {
    this.error.set(null);
    this.passkeyWarning.set(null);
    this.loading.set(true);

    let optionsRes;
    try {
      optionsRes = await firstValueFrom(this.auth.getSignupPasskeyOptions());
    } catch (err: unknown) {
      this.loading.set(false);
      this.handlePasskeyError(err, true);
      return;
    }

    let credential;
    try {
      credential = await this.webauthn.createPasskey(optionsRes.options);
    } catch (err: unknown) {
      this.loading.set(false);
      this.handlePasskeyError(err, false);
      return;
    }

    try {
      await firstValueFrom(this.auth.completeSignupWithPasskey(credential));
      this.loading.set(false);
      this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      this.loading.set(false);
      this.handlePasskeyError(err, true);
    }
  }

  // Allow skipping passkey creation only after a user or internal server error occurred
  skipPasskeyAndFinish() {
    if (!this.canSkipPasskey()) {
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    const warningMessage = this.passkeyWarning() || PASSKEY_USER_ERROR_WARNING;

    this.auth.completeSignupSkippingPasskey().subscribe({
      next: () => {
        this.loading.set(false);
        this.auth.setPasskeyWarning(warningMessage);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to complete signup';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  private handlePasskeyError(err: unknown, isHttpError: boolean): void {
    const status = (err as { status?: number })?.status;
    const isServerError =
      isHttpError && (typeof status !== 'number' || status >= 500 || status === 0);

    if (isServerError) {
      this.passkeyWarning.set(PASSKEY_SERVER_ERROR_WARNING);
    } else {
      this.passkeyWarning.set(PASSKEY_USER_ERROR_WARNING);
    }
    this.canSkipPasskey.set(true);
  }

  editDetails() {
    this.abortOtpListener();
    this.step.set('details');
    this.emailOtp = '';
    this.error.set(null);
  }

  backToLogin() {
    this.abortOtpListener();
    this.auth.clearPendingSignup();
    this.router.navigate(['/login']);
  }

  private listenForEmailOtp(): void {
    this.abortOtpListener();
    if (typeof this.webauthn.receiveOtp !== 'function') {
      return;
    }
    const controller = new AbortController();
    this.otpAbortController = controller;

    void this.webauthn.receiveOtp('email', controller.signal).then((code) => {
      if (code && !controller.signal.aborted && this.step() === 'email-otp' && !this.loading()) {
        this.emailOtp = code;
        this.verifyEmailOtp();
      }
    });
  }

  private abortOtpListener(): void {
    if (this.otpAbortController) {
      this.otpAbortController.abort();
      this.otpAbortController = null;
    }
  }
}
