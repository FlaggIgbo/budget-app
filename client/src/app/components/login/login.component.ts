import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { TellerService } from '../../services/teller.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login">
      <div class="card">
        <h1>Budget App</h1>
        <p class="subtitle">Sign in with your phone number</p>

        @if (sandbox(); as creds) {
          <div class="sandbox-banner">
            <strong>Sandbox credentials</strong>
            <p>
              Phone: <code>{{ creds.phone }}</code> · OTP: <code>{{ creds.otp }}</code>
            </p>
          </div>
        }

        @if (step() === 'phone') {
          <form (ngSubmit)="sendOtp()" class="form">
            <label for="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              [(ngModel)]="phone"
              (ngModelChange)="phone = formatPhone($event)"
              name="phone"
              [placeholder]="sandbox()?.phone ?? '(555) 555-5555'"
              autocomplete="tel"
              inputmode="numeric"
            />
            <button type="submit" class="btn" [disabled]="loading() || !phone.trim()">
              {{ loading() ? 'Sending…' : 'Send code' }}
            </button>
          </form>
        } @else {
          <form (ngSubmit)="verifyOtp()" class="form">
            <label for="otp">Verification code</label>
            <input
              id="otp"
              type="text"
              [(ngModel)]="otp"
              name="otp"
              [placeholder]="sandbox()?.otp ?? '123456'"
              maxlength="6"
              autocomplete="one-time-code"
            />
            <button type="submit" class="btn" [disabled]="loading() || !otp.trim()">
              {{ loading() ? 'Verifying…' : 'Verify' }}
            </button>
            <button type="button" class="btn-link" (click)="step.set('phone')">
              ← Change number
            </button>
          </form>
        }

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
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
        padding: 2rem;
        font-family: system-ui, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      }
      .card {
        background: white;
        border-radius: 16px;
        padding: 2.5rem;
        max-width: 360px;
        width: 100%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      }
      h1 {
        margin: 0 0 0.25rem;
        font-size: 1.75rem;
        color: #0f172a;
      }
      .subtitle {
        color: #64748b;
        margin: 0 0 1.5rem;
        font-size: 0.95rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      label {
        font-weight: 500;
        font-size: 0.9rem;
        color: #334155;
      }
      input {
        padding: 0.75rem 1rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
      }
      input:focus {
        outline: none;
        border-color: #0f172a;
        box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.1);
      }
      .sandbox-banner {
        background: #fef3c7;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        padding: 0.75rem 1rem;
        margin-bottom: 1.25rem;
        font-size: 0.9rem;
      }
      .sandbox-banner strong {
        display: block;
        color: #92400e;
        margin-bottom: 0.25rem;
      }
      .sandbox-banner code {
        background: rgba(0, 0, 0, 0.06);
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        font-family: ui-monospace, monospace;
      }
      .btn {
        background: #0f172a;
        color: white;
        border: none;
        padding: 0.75rem 1.25rem;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        margin-top: 0.5rem;
      }
      .btn:hover:not(:disabled) {
        background: #1e293b;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn-link {
        background: none;
        border: none;
        color: #64748b;
        font-size: 0.9rem;
        cursor: pointer;
        padding: 0.5rem 0;
      }
      .btn-link:hover {
        color: #0f172a;
      }
      .error {
        color: #dc2626;
        font-size: 0.9rem;
        margin: 1rem 0 0;
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
    private teller: TellerService,
    private router: Router
  ) {}

  /** Format as XXX-XXX-XXXX, max 10 digits. */
  formatPhone(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  ngOnInit() {
    this.teller.getConfig().subscribe({
      next: (cfg) => {
        if (cfg.authSandbox) this.sandbox.set(cfg.authSandbox);
      },
    });
  }

  sendOtp() {
    this.error.set(null);
    this.loading.set(true);
    this.auth.sendOtp(this.phone).subscribe({
      next: () => {
        this.step.set('otp');
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Failed to send code');
        this.loading.set(false);
      },
    });
  }

  verifyOtp() {
    this.error.set(null);
    this.loading.set(true);
    this.auth.verifyOtp(this.phone, this.otp).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Invalid code');
        this.loading.set(false);
      },
    });
  }
}
