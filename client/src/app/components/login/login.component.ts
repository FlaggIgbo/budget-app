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
  ],
  template: `
    <div class="login">
      <div class="login-container">
        <div class="brand-badge">
          <mat-icon>account_balance_wallet</mat-icon>
        </div>
        <mat-card appearance="outlined" class="card">
          <mat-card-header class="login-header">
            <mat-card-title><h1>Budget App</h1></mat-card-title>
            <mat-card-subtitle class="subtitle">Sign in with your phone number</mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            @if (sandbox(); as creds) {
              <div class="sandbox-banner">
                <div class="sandbox-header">
                  <mat-icon>verified</mat-icon>
                  <strong>Sandbox Test Credentials</strong>
                </div>
                <div class="sandbox-creds">
                  <div class="cred-chip">
                    <span class="cred-label">Phone:</span>
                    <code>{{ creds.phone }}</code>
                  </div>
                  <div class="cred-chip">
                    <span class="cred-label">Code:</span>
                    <code>{{ creds.otp }}</code>
                  </div>
                </div>
              </div>
            }

            @if (step() === 'phone') {
              <form (ngSubmit)="sendOtp()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label><label for="phone">Phone number</label></mat-label>
                  <mat-icon matPrefix>phone</mat-icon>
                  <input
                    matInput
                    id="phone"
                    type="tel"
                    [(ngModel)]="phone"
                    name="phone"
                    [placeholder]="sandbox()?.phone ?? '+15551234567'"
                    autocomplete="tel"
                    inputmode="tel"
                  />
                </mat-form-field>
                <button
                  mat-flat-button
                  type="submit"
                  class="btn"
                  [disabled]="loading() || !phone.trim()"
                >
                  @if (loading()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  }
                  {{ loading() ? 'Sending…' : 'Send verification code' }}
                </button>
              </form>
            } @else {
              <form (ngSubmit)="verifyOtp()" class="form">
                <mat-form-field appearance="outline">
                  <mat-label><label for="otp">Verification code</label></mat-label>
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
                <button mat-button type="button" class="btn-link" (click)="step.set('phone')">
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
export class LoginComponent implements OnInit {
  phone = '';
  otp = '';
  step = signal<'phone' | 'otp'>('phone');
  loading = signal(false);
  error = signal<string | null>(null);
  sandbox = signal<{ phone: string; otp: string } | null>(null);

  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    // Check if server provides sandbox test credentials
    this.auth.getAuthConfig().subscribe({
      next: (cfg) => {
        if (cfg.authSandbox) {
          this.sandbox.set(cfg.authSandbox);
        }
      },
    });
  }

  // Send SMS verification code
  sendOtp() {
    this.error.set(null);
    this.loading.set(true);

    this.auth.sendOtp(this.phone).subscribe({
      next: () => {
        this.step.set('otp');
        this.loading.set(false);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  // Verify SMS code and navigate to dashboard
  verifyOtp() {
    this.error.set(null);
    this.loading.set(true);

    this.auth.verifyOtp(this.phone, this.otp).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        const message = err?.error?.error || 'Invalid code';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }
}
