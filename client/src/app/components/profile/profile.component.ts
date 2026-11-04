import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

export interface Profile {
  id: string;
  email: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
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
        <p class="subtitle">Manage your account settings</p>
      </header>

      @if (profile(); as p) {
        <mat-card appearance="outlined" class="profile-card">
          <mat-card-content>
            <mat-list>
              <mat-list-item>
                <mat-icon matListItemIcon>mail</mat-icon>
                <span matListItemTitle class="label">Email Address</span>
                <span matListItemLine class="value">{{ p.email }}</span>
              </mat-list-item>
            </mat-list>
          </mat-card-content>
        </mat-card>
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
      .subtitle {
        color: var(--mat-sys-on-surface-variant, #64748b);
        margin: 0;
        font-size: 0.95rem;
      }
      .loading {
        color: var(--mat-sys-on-surface-variant, #64748b);
        margin-top: 0.5rem;
      }
      .error {
        color: var(--mat-sys-error, #dc2626);
      }
    `,
  ],
})
export class ProfileComponent implements OnInit {
  profile = signal<Profile | null>(null);
  error = signal<string | null>(null);

  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {}

  ngOnInit() {
    // Load profile from API
    this.api.get<Profile>('/profile').subscribe({
      next: (data) => this.profile.set(data),
      error: () => this.error.set('Failed to load profile'),
    });
  }

  // Log user out
  logout() {
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
