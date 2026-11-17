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
        <a mat-button routerLink="/dashboard" class="back">
          <mat-icon>arrow_back</mat-icon>
          Dashboard
        </a>
        <button mat-stroked-button class="btn-logout" (click)="logout()">
          <mat-icon>logout</mat-icon>
          Log out
        </button>
      </div>
    </mat-toolbar>

    <div class="profile">
      <header class="page-header">
        <h1>Profile</h1>
        <p class="subtitle">Manage your phone login and email for personal finance summaries</p>
      </header>

      @if (profile(); as p) {
        <mat-card appearance="outlined" class="profile-card">
          <mat-card-content>
            <mat-list>
              <mat-list-item>
                <mat-icon matListItemIcon>phone</mat-icon>
                <span matListItemTitle class="label">Phone Number</span>
                <span matListItemLine class="value">{{ p.phone }}</span>
              </mat-list-item>

              <mat-list-item>
                <mat-icon matListItemIcon>mail</mat-icon>
                <span matListItemTitle class="label">Email Address</span>
                <span matListItemLine class="value">
                  {{ p.email || 'Not linked — add an email to receive finance summaries' }}
                </span>
                @if (!linkingEmail()) {
                  <button mat-stroked-button matListItemMeta (click)="startEmailLinking()">
                    {{ p.email ? 'Update email' : 'Add email' }}
                  </button>
                }
              </mat-list-item>
            </mat-list>
          </mat-card-content>
        </mat-card>

        @if (linkingEmail()) {
          <mat-card appearance="outlined" class="link-card">
            <mat-card-header>
              <mat-card-title>
                <h2>Verify & Link Email Address</h2>
              </mat-card-title>
              <mat-card-subtitle>
                We will send a 6-digit verification code to confirm your email before saving it.
              </mat-card-subtitle>
            </mat-card-header>

            <mat-card-content>
              @if (linkStep() === 'input') {
                <form (ngSubmit)="sendEmailOtp()" class="link-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Email address</mat-label>
                    <mat-icon matPrefix>mail</mat-icon>
                    <input
                      matInput
                      type="email"
                      [(ngModel)]="newEmail"
                      name="newEmail"
                      placeholder="you@example.com"
                    />
                  </mat-form-field>

                  <div class="link-actions">
                    <button
                      mat-flat-button
                      type="submit"
                      [disabled]="linkLoading() || !newEmail.trim()"
                    >
                      {{ linkLoading() ? 'Sending…' : 'Send verification code' }}
                    </button>
                    <button mat-button type="button" (click)="cancelEmailLinking()">Cancel</button>
                  </div>
                </form>
              } @else {
                <form (ngSubmit)="verifyEmailOtp()" class="link-form">
                  <mat-form-field appearance="outline">
                    <mat-label>6-digit verification code</mat-label>
                    <mat-icon matPrefix>lock</mat-icon>
                    <input
                      matInput
                      type="text"
                      [(ngModel)]="emailOtpCode"
                      name="emailOtpCode"
                      placeholder="123456"
                      maxlength="6"
                    />
                  </mat-form-field>

                  <div class="link-actions">
                    <button
                      mat-flat-button
                      type="submit"
                      [disabled]="linkLoading() || !emailOtpCode.trim()"
                    >
                      {{ linkLoading() ? 'Verifying…' : 'Verify & save' }}
                    </button>
                    <button mat-button type="button" (click)="linkStep.set('input')">Back</button>
                    <button mat-button type="button" (click)="cancelEmailLinking()">Cancel</button>
                  </div>
                </form>
              }

              @if (linkError(); as lErr) {
                <p class="error">{{ lErr }}</p>
              }
            </mat-card-content>
          </mat-card>
        }

        @if (successMessage(); as msg) {
          <p class="success">{{ msg }}</p>
        }
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        <p class="loading">Loading profile…</p>
      }
    </div>
  `,
  styles: [
    `
      .top-toolbar {
        background: var(--mat-sys-surface, #ffffff);
        border-bottom: 1px solid var(--mat-sys-outline-variant, #e2e8f0);
      }
      .toolbar-inner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 520px;
        margin: 0 auto;
      }
      .profile {
        padding: 2rem 1.5rem;
        max-width: 520px;
        margin: 0 auto;
      }
      .page-header {
        margin-bottom: 1.5rem;
      }
      h1 {
        margin: 0 0 0.25rem;
        font-size: 1.75rem;
        font-weight: 600;
      }
      h2 {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 600;
      }
      .subtitle {
        color: var(--mat-sys-on-surface-variant, #64748b);
        margin: 0;
        font-size: 0.95rem;
      }
      .profile-card {
        margin-bottom: 1.25rem;
      }
      .link-card {
        margin-bottom: 1.25rem;
      }
      .link-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .link-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .loading {
        color: var(--mat-sys-on-surface-variant, #64748b);
        margin-top: 0.5rem;
      }
      .error {
        color: var(--mat-sys-error, #dc2626);
        margin-top: 0.75rem;
      }
      .success {
        color: #16a34a;
        font-weight: 500;
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class ProfileComponent implements OnInit {
  profile = signal<Profile | null>(null);
  error = signal<string | null>(null);

  linkingEmail = signal(false);
  linkStep = signal<'input' | 'otp'>('input');
  linkLoading = signal(false);
  linkError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  newEmail = '';
  emailOtpCode = '';

  constructor(private userService: UserService) {}

  ngOnInit() {
    // Load profile from UserService
    this.userService.getProfile().subscribe({
      next: (data) => this.profile.set(data),
      error: () => this.error.set('Failed to load profile'),
    });
  }

  // Open the form to link or update the user's email address
  startEmailLinking() {
    this.linkingEmail.set(true);
    this.linkStep.set('input');
    this.newEmail = '';
    this.emailOtpCode = '';
    this.linkError.set(null);
    this.successMessage.set(null);
  }

  // Cancel the email linking flow
  cancelEmailLinking() {
    this.linkingEmail.set(false);
    this.linkError.set(null);
  }

  // Step 1: Request 6-digit OTP for the new email address
  sendEmailOtp() {
    if (!this.newEmail.trim()) {
      return;
    }

    this.linkLoading.set(true);
    this.linkError.set(null);

    this.userService.requestEmailOtp(this.newEmail.trim()).subscribe({
      next: () => {
        this.linkStep.set('otp');
        this.linkLoading.set(false);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to send verification code';
        this.linkError.set(message);
        this.linkLoading.set(false);
      },
    });
  }

  // Step 2: Verify OTP and upsert the email into the user's profile DB record
  verifyEmailOtp() {
    if (!this.emailOtpCode.trim()) {
      return;
    }

    this.linkLoading.set(true);
    this.linkError.set(null);

    this.userService.verifyEmailOtp(this.newEmail.trim(), this.emailOtpCode.trim()).subscribe({
      next: (res) => {
        this.profile.set(res.user);
        this.linkingEmail.set(false);
        this.linkLoading.set(false);
        this.successMessage.set('Email address verified and saved to your profile.');
      },
      error: (err) => {
        const message = err?.error?.error || 'Invalid verification code';
        this.linkError.set(message);
        this.linkLoading.set(false);
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
