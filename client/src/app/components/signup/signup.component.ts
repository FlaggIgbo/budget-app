import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

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
  ],
  template: `
    <div class="signup">
      <div class="signup-container">
        <div class="brand-badge">
          <mat-icon>person_add</mat-icon>
        </div>
        <mat-card appearance="outlined" class="card">
          <mat-card-header class="signup-header">
            <mat-card-title><h1>Create your account</h1></mat-card-title>
            <mat-card-subtitle class="subtitle">
              {{
                step() === 'details'
                  ? 'Enter your name and email address to finish setting up your account'
                  : 'Enter the 6-digit code sent to ' + email
              }}
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

            @if (!isProduction && sandboxOtp(); as code) {
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
                    <mat-label><label for="firstName">First name</label></mat-label>
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
                    <mat-label><label for="lastName">Last name</label></mat-label>
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
                  <mat-label><label for="email">Email address</label></mat-label>
                  <mat-icon matPrefix>mail</mat-icon>
                  <input
                    matInput
                    id="email"
                    type="email"
                    [(ngModel)]="email"
                    name="email"
                    placeholder="you@example.com"
                    autocomplete="email"
                    required
                  />
                </mat-form-field>

                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !firstName.trim() || !lastName.trim() || !email.trim()"
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
            } @else {
              <form (ngSubmit)="completeSignup()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label><label for="emailOtp">Email verification code</label></mat-label>
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
                  {{ loading() ? 'Creating account…' : 'Verify & Create Account' }}
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
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
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
export class SignupComponent implements OnInit {
  firstName = '';
  lastName = '';
  email = '';
  emailOtp = '';

  step = signal<'details' | 'email-otp'>('details');
  loading = signal(false);
  error = signal<string | null>(null);
  verifiedPhone = signal<string | null>(null);
  sandboxOtp = signal<string | null>(null);
  readonly isProduction = environment.production;

  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

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

  // Step 1: Send 6-digit email OTP to confirm the user owns the email address
  sendEmailOtp() {
    if (!this.firstName.trim() || !this.lastName.trim() || !this.email.trim()) {
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    this.auth.requestSignupEmailOtp(this.email.trim()).subscribe({
      next: () => {
        this.step.set('email-otp');
        this.loading.set(false);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send verification code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  // Step 2: Verify email OTP, create User record in DB, and navigate to home page
  completeSignup() {
    if (!this.emailOtp.trim()) {
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    this.auth
      .completeSignup(
        this.firstName.trim(),
        this.lastName.trim(),
        this.email.trim(),
        this.emailOtp.trim()
      )
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          const message = err?.error?.error || 'Invalid verification code';
          this.error.set(message);
          this.loading.set(false);
        },
      });
  }

  editDetails() {
    this.step.set('details');
    this.emailOtp = '';
    this.error.set(null);
  }

  backToLogin() {
    this.auth.clearPendingSignup();
    this.router.navigate(['/login']);
  }
}
