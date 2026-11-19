import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { UserService, UserProfile } from '../../services/user.service';

export type Profile = UserProfile;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <mat-toolbar class="top-toolbar">
      <div class="toolbar-inner">
        <a mat-button routerLink="/dashboard" class="back-link">
          <mat-icon>arrow_back</mat-icon>
          Dashboard
        </a>
        <div class="header-actions">
          <a mat-button routerLink="/accounts" class="nav-link">
            <mat-icon>account_balance</mat-icon>
            Accounts
          </a>
          <button mat-stroked-button class="btn-logout" (click)="logout()">
            <mat-icon>logout</mat-icon>
            Log out
          </button>
        </div>
      </div>
    </mat-toolbar>

    <div class="profile">
      <header class="page-header">
        <div class="header-icon">
          <mat-icon>person</mat-icon>
        </div>
        <div class="header-text">
          <h1>Profile</h1>
          <p class="subtitle">
            View your account details and update your verified phone number or email address
          </p>
        </div>
      </header>

      @if (profile(); as p) {
        <mat-card appearance="outlined" class="profile-card">
          <div class="profile-card-header">
            <div class="user-avatar-large">
              <mat-icon>person</mat-icon>
            </div>
            <div class="user-meta">
              <h2>{{ p.firstName }} {{ p.lastName }}</h2>
              <span class="user-status-pill">Active Session</span>
            </div>
          </div>

          <mat-card-content class="profile-content">
            <div class="info-row">
              <div class="info-icon">
                <mat-icon>phone</mat-icon>
              </div>
              <div class="info-body">
                <div class="info-label-group">
                  <span class="info-label">Phone Number</span>
                  <span class="verified-tag"><mat-icon>verified</mat-icon> Verified</span>
                </div>
                <span class="info-value">{{ p.phone }}</span>
              </div>
              @if (editingContact() !== 'phone') {
                <button
                  mat-stroked-button
                  class="btn-edit-contact btn-edit-phone"
                  (click)="startContactChange('phone')"
                >
                  <mat-icon>edit</mat-icon>
                  Change
                </button>
              }
            </div>

            <div class="divider"></div>

            <div class="info-row">
              <div class="info-icon">
                <mat-icon>mail</mat-icon>
              </div>
              <div class="info-body">
                <div class="info-label-group">
                  <span class="info-label">Email Address</span>
                  <span class="verified-tag"><mat-icon>verified</mat-icon> Verified</span>
                </div>
                <span class="info-value">{{ p.email }}</span>
              </div>
              @if (editingContact() !== 'email') {
                <button
                  mat-stroked-button
                  class="btn-edit-contact btn-edit-email"
                  (click)="startContactChange('email')"
                >
                  <mat-icon>edit</mat-icon>
                  Change
                </button>
              }
            </div>
          </mat-card-content>
        </mat-card>

        @if (editingContact(); as target) {
          <mat-card appearance="outlined" class="link-card">
            <mat-card-header class="link-header">
              <div class="link-icon-wrap">
                <mat-icon>
                  {{
                    editStep() === 'input'
                      ? target === 'email'
                        ? 'mail'
                        : 'phone'
                      : target === 'email'
                        ? 'mark_email_read'
                        : 'sms'
                  }}
                </mat-icon>
              </div>
              <div>
                <mat-card-title>
                  <h2>
                    @if (editStep() === 'input') {
                      {{ target === 'email' ? 'Change Email Address' : 'Change Phone Number' }}
                    } @else {
                      {{ target === 'email' ? 'Verify New Email' : 'Verify New Phone Number' }}
                    }
                  </h2>
                </mat-card-title>
                <mat-card-subtitle class="subtitle">
                  @if (editStep() === 'input') {
                    {{
                      target === 'email'
                        ? 'We will send a 6-digit verification code to confirm your new email address.'
                        : 'We will send a 6-digit SMS code to confirm your new phone number.'
                    }}
                  } @else {
                    {{
                      target === 'email'
                        ? 'Enter the 6-digit code sent to ' + newEmail
                        : 'Enter the 6-digit SMS code sent to ' + newPhone
                    }}
                  }
                </mat-card-subtitle>
              </div>
            </mat-card-header>

            <mat-card-content class="link-body">
              @if (editStep() === 'input') {
                <form (ngSubmit)="sendContactOtp()" class="link-form">
                  @if (target === 'email') {
                    <mat-form-field appearance="outline" class="form-field-full">
                      <mat-label>New email address</mat-label>
                      <mat-icon matPrefix>mail</mat-icon>
                      <input
                        matInput
                        type="email"
                        [(ngModel)]="newEmail"
                        name="newEmail"
                        placeholder="new-email@example.com"
                        required
                      />
                    </mat-form-field>
                  } @else {
                    <mat-form-field appearance="outline" class="form-field-full">
                      <mat-label>New phone number</mat-label>
                      <mat-icon matPrefix>phone</mat-icon>
                      <input
                        matInput
                        type="tel"
                        [(ngModel)]="newPhone"
                        name="newPhone"
                        placeholder="+15559876543"
                        autocomplete="tel"
                        inputmode="tel"
                        required
                      />
                    </mat-form-field>
                  }

                  <div class="link-actions">
                    <button
                      mat-flat-button
                      class="btn-primary"
                      type="submit"
                      [disabled]="
                        editLoading() || (target === 'email' ? !newEmail.trim() : !newPhone.trim())
                      "
                    >
                      <mat-icon>send</mat-icon>
                      {{ editLoading() ? 'Sending…' : 'Send verification code' }}
                    </button>
                    <button
                      mat-button
                      type="button"
                      class="btn-cancel"
                      (click)="cancelContactChange()"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              } @else {
                <form (ngSubmit)="verifyContactOtp()" class="link-form">
                  <mat-form-field appearance="outline" class="form-field-full">
                    <mat-label>6-digit verification code</mat-label>
                    <mat-icon matPrefix>lock</mat-icon>
                    <input
                      matInput
                      type="text"
                      class="otp-input"
                      [(ngModel)]="contactOtpCode"
                      name="contactOtpCode"
                      placeholder="123456"
                      maxlength="6"
                      autocomplete="one-time-code"
                      required
                    />
                  </mat-form-field>

                  <div class="link-actions">
                    <button
                      mat-flat-button
                      class="btn-primary"
                      type="submit"
                      [disabled]="editLoading() || !contactOtpCode.trim()"
                    >
                      <mat-icon>check_circle</mat-icon>
                      {{ editLoading() ? 'Verifying…' : 'Verify & save' }}
                    </button>
                    <button mat-button type="button" (click)="editStep.set('input')">Back</button>
                    <button
                      mat-button
                      type="button"
                      class="btn-cancel"
                      (click)="cancelContactChange()"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              }

              @if (editError(); as cErr) {
                <div class="error-banner">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ cErr }}</span>
                </div>
              }
            </mat-card-content>
          </mat-card>
        }

        @if (successMessage(); as msg) {
          <div class="success-banner">
            <mat-icon>check_circle</mat-icon>
            <span>{{ msg }}</span>
          </div>
        }
      } @else if (error()) {
        <div class="error-banner">
          <mat-icon>error_outline</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else {
        <div class="loading-wrap">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p class="loading">Loading profile…</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .top-toolbar {
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(226, 232, 240, 0.8);
        position: sticky;
        top: 0;
        z-index: 100;
        height: 64px;
      }
      .toolbar-inner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 680px;
        margin: 0 auto;
        padding: 0 1rem;
      }
      .back-link {
        font-weight: 500;
        color: #475569 !important;
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .nav-link {
        color: #475569 !important;
        font-weight: 500;
      }
      .btn-logout {
        border-color: rgba(203, 213, 225, 0.8) !important;
        color: #475569 !important;
        font-size: 0.875rem;
      }
      .btn-logout:hover {
        background: #f1f5f9 !important;
        color: #0f172a !important;
      }
      .profile {
        padding: 2.5rem 1.25rem 4rem;
        max-width: 680px;
        margin: 0 auto;
      }
      .page-header {
        display: flex;
        align-items: flex-start;
        gap: 1.25rem;
        margin-bottom: 2rem;
      }
      .header-icon {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
        flex-shrink: 0;
      }
      .header-icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .header-text h1 {
        margin: 0 0 0.35rem;
        font-size: 1.85rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        color: #0f172a;
      }
      .subtitle {
        color: #64748b;
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.5;
      }
      .profile-card {
        background: #ffffff !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
        border-radius: 18px !important;
        box-shadow:
          0 4px 6px -1px rgba(15, 23, 42, 0.03),
          0 2px 4px -2px rgba(15, 23, 42, 0.03) !important;
        overflow: hidden;
        margin-bottom: 1.5rem;
      }
      .profile-card-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1.5rem;
        background: #fafafa;
        border-bottom: 1px solid #f1f5f9;
      }
      .user-avatar-large {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #eef2ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .user-avatar-large mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .user-meta h2 {
        margin: 0 0 0.25rem;
        font-size: 1.15rem;
        font-weight: 700;
        color: #0f172a;
      }
      .user-status-pill {
        font-size: 0.75rem;
        font-weight: 600;
        color: #10b981;
        background: #ecfdf5;
        padding: 0.15rem 0.5rem;
        border-radius: 12px;
        border: 1px solid #a7f3d0;
      }
      .profile-content {
        padding: 1.5rem !important;
      }
      .info-row {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .info-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        color: #475569;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .info-icon mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .info-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .info-label-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .info-label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
      }
      .verified-tag {
        font-size: 0.75rem;
        color: #059669;
        display: flex;
        align-items: center;
        gap: 0.15rem;
        font-weight: 600;
      }
      .verified-tag mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
      .info-value {
        font-size: 1rem;
        font-weight: 600;
        color: #0f172a;
      }
      .btn-edit-contact {
        border-color: #cbd5e1 !important;
        color: #2563eb !important;
        font-weight: 600;
        border-radius: 10px !important;
        font-size: 0.85rem;
      }
      .divider {
        height: 1px;
        background: #f1f5f9;
        margin: 1.25rem 0;
      }
      .link-card {
        background: #ffffff !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
        border-radius: 18px !important;
        box-shadow:
          0 4px 6px -1px rgba(15, 23, 42, 0.03),
          0 2px 4px -2px rgba(15, 23, 42, 0.03) !important;
        margin-bottom: 1.5rem;
        overflow: hidden;
      }
      .link-header {
        display: flex;
        gap: 1rem;
        align-items: center;
        padding: 1.25rem 1.5rem;
        background: #f8fafc;
        border-bottom: 1px solid #f1f5f9;
      }
      .link-icon-wrap {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: #eef2ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .link-icon-wrap mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
      .link-header h2 {
        margin: 0 0 0.15rem;
        font-size: 1.15rem;
        font-weight: 700;
        color: #0f172a;
      }
      .link-body {
        padding: 1.5rem !important;
      }
      .link-form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .form-field-full {
        width: 100%;
      }
      .otp-input {
        letter-spacing: 0.25em;
        font-weight: 600;
        font-size: 1.1rem;
      }
      .link-actions {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        margin-top: 0.5rem;
      }
      .btn-primary {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
        color: #ffffff !important;
        font-weight: 600;
        padding: 0.65rem 1.25rem !important;
        border-radius: 10px !important;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .btn-cancel {
        color: #64748b !important;
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1.15rem;
        border-radius: 12px;
        margin-top: 1rem;
        font-size: 0.9rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
      }
      .success-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1.15rem;
        border-radius: 12px;
        margin-top: 1rem;
        font-size: 0.9rem;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        font-weight: 500;
      }
      .loading-wrap {
        padding: 2rem 1rem;
        text-align: center;
      }
      .loading {
        color: #64748b;
        margin-top: 0.75rem;
        font-size: 0.95rem;
      }
    `,
  ],
})
export class ProfileComponent implements OnInit {
  profile = signal<Profile | null>(null);
  error = signal<string | null>(null);

  editingContact = signal<'email' | 'phone' | null>(null);
  editStep = signal<'input' | 'otp'>('input');
  editLoading = signal(false);
  editError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  newEmail = '';
  newPhone = '';
  contactOtpCode = '';

  constructor(private userService: UserService) {}

  ngOnInit() {
    this.userService.getProfile().subscribe({
      next: (data) => this.profile.set(data),
      error: () => this.error.set('Failed to load profile'),
    });
  }

  // Open the form to change either email address or phone number
  startContactChange(target: 'email' | 'phone') {
    this.editingContact.set(target);
    this.editStep.set('input');
    this.newEmail = '';
    this.newPhone = '';
    this.contactOtpCode = '';
    this.editError.set(null);
    this.successMessage.set(null);
  }

  // Cancel the active contact change flow
  cancelContactChange() {
    this.editingContact.set(null);
    this.editError.set(null);
  }

  // Step 1: Request 6-digit OTP for the new email address or phone number
  sendContactOtp() {
    const target = this.editingContact();
    if (!target) {
      return;
    }

    const value = target === 'email' ? this.newEmail.trim() : this.newPhone.trim();
    if (!value) {
      return;
    }

    this.editLoading.set(true);
    this.editError.set(null);

    const request$ =
      target === 'email'
        ? this.userService.requestEmailChangeOtp(value)
        : this.userService.requestPhoneChangeOtp(value);

    request$.subscribe({
      next: () => {
        this.editStep.set('otp');
        this.editLoading.set(false);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send verification code';
        this.editError.set(message);
        this.editLoading.set(false);
      },
    });
  }

  // Step 2: Verify OTP and update email address or phone number in DB
  verifyContactOtp() {
    const target = this.editingContact();
    if (!target || !this.contactOtpCode.trim()) {
      return;
    }

    const value = target === 'email' ? this.newEmail.trim() : this.newPhone.trim();
    this.editLoading.set(true);
    this.editError.set(null);

    const verify$ =
      target === 'email'
        ? this.userService.verifyEmailChangeOtp(value, this.contactOtpCode.trim())
        : this.userService.verifyPhoneChangeOtp(value, this.contactOtpCode.trim());

    verify$.subscribe({
      next: (res) => {
        this.profile.set(res.user);
        this.editingContact.set(null);
        this.editLoading.set(false);
        this.successMessage.set(
          target === 'email'
            ? 'Email address verified and updated.'
            : 'Phone number verified and updated.'
        );
      },
      error: (err) => {
        const message = err?.error?.error || 'Invalid verification code';
        this.editError.set(message);
        this.editLoading.set(false);
      },
    });
  }

  // Log user out
  logout() {
    this.userService.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
