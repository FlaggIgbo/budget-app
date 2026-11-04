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
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <mat-card-title><h1>Budget App</h1></mat-card-title>
          <mat-card-subtitle class="subtitle">Sign in with your email address</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          @if (sandbox(); as creds) {
            <div class="sandbox-banner">
              <div class="sandbox-header">
                <mat-icon>science</mat-icon>
                <strong>Sandbox test credentials</strong>
              </div>
              <p>
                Email: <code>{{ creds.email }}</code> · Code: <code>{{ creds.otp }}</code>
              </p>
            </div>
          }

          @if (step() === 'email') {
            <form (ngSubmit)="sendOtp()" class="form">
              <mat-form-field appearance="outline">
                <mat-label><label for="email">Email address</label></mat-label>
                <mat-icon matPrefix>mail</mat-icon>
                <input
                  matInput
                  id="email"
                  type="email"
                  [(ngModel)]="email"
                  name="email"
                  [placeholder]="sandbox()?.email ?? 'you@example.com'"
                  autocomplete="email"
                  inputmode="email"
                />
              </mat-form-field>
              <button
                mat-flat-button
                type="submit"
                class="btn"
                [disabled]="loading() || !email.trim()"
              >
                @if (loading()) {
                  <mat-spinner diameter="20"></mat-spinner>
                }
                {{ loading() ? 'Sending…' : 'Send code' }}
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
                {{ loading() ? 'Verifying…' : 'Verify' }}
              </button>
              <button mat-button type="button" class="btn-link" (click)="step.set('email')">
                <mat-icon>arrow_back</mat-icon>
                Change email
              </button>
            </form>
          }

          @if (error(); as err) {
            <p class="error">{{ err }}</p>
          }
        </mat-card-content>
      </mat-card>
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
      }
      .card {
        width: 100%;
        max-width: 420px;
        padding: 1rem;
      }
      mat-card-header {
        margin-bottom: 1rem;
      }
      h1 {
        margin: 0;
        font-size: 1.75rem;
        font-weight: 600;
      }
      .subtitle {
        margin-top: 0.25rem;
      }
      .sandbox-banner {
        background: var(--mat-sys-surface-container, #f1f5f9);
        border: 1px solid var(--mat-sys-outline-variant, #e2e8f0);
        border-radius: 12px;
        padding: 0.75rem 1rem;
        margin-bottom: 1.25rem;
        font-size: 0.85rem;
      }
      .sandbox-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .sandbox-header mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .sandbox-banner p {
        margin: 0.35rem 0 0;
      }
      .sandbox-banner code {
        background: var(--mat-sys-surface-container-high, #e2e8f0);
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        font-size: 0.85em;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      mat-form-field {
        width: 100%;
      }
      .btn {
        height: 44px;
      }
      .error {
        color: var(--mat-sys-error, #dc2626);
        font-size: 0.9rem;
        margin: 1rem 0 0;
      }
    `,
  ],
})
export class LoginComponent implements OnInit {
  email = '';
  otp = '';
  step = signal<'email' | 'otp'>('email');
  loading = signal(false);
  error = signal<string | null>(null);
  sandbox = signal<{ email: string; otp: string } | null>(null);

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

  // Send verification code
  sendOtp() {
    this.error.set(null);
    this.loading.set(true);

    this.auth.sendOtp(this.email).subscribe({
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

  // Verify code and navigate to dashboard
  verifyOtp() {
    this.error.set(null);
    this.loading.set(true);

    this.auth.verifyOtp(this.email, this.otp).subscribe({
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
