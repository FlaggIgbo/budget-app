import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

export interface Profile {
  id: string;
  phone: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="profile">
      <header>
        <div class="header-row">
          <a routerLink="/dashboard" class="back">← Dashboard</a>
          <button class="btn-logout" (click)="logout()">Log out</button>
        </div>
        <h1>Profile</h1>
        <p class="subtitle">Manage your account settings</p>
      </header>

      @if (profile(); as p) {
        <div class="profile-card">
          <div class="field">
            <span class="label">Phone Number</span>
            <span class="value">{{ p.phone }}</span>
          </div>
        </div>
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <p class="loading">Loading profile…</p>
      }
    </div>
  `,
  styles: [
    `
      .profile {
        padding: 2rem;
        font-family: system-ui, sans-serif;
        max-width: 480px;
        margin: 0 auto;
      }
      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      .back {
        color: #64748b;
        text-decoration: none;
        font-size: 0.9rem;
      }
      .back:hover {
        color: #0f172a;
      }
      .btn-logout {
        background: transparent;
        color: #64748b;
        border: 1px solid #e2e8f0;
        padding: 0.4rem 0.75rem;
        border-radius: 6px;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .btn-logout:hover {
        color: #0f172a;
        border-color: #94a3b8;
      }
      h1 {
        margin: 0 0 0.25rem;
        font-size: 1.5rem;
      }
      .subtitle {
        color: #64748b;
        margin: 0 0 1.5rem;
        font-size: 0.95rem;
      }
      .profile-card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.5rem;
      }
      .field label {
        display: block;
        font-size: 0.85rem;
        color: #64748b;
        margin-bottom: 0.25rem;
      }
      .field .value {
        font-size: 1.1rem;
        font-weight: 500;
        color: #0f172a;
      }
      .loading {
        color: #64748b;
      }
      .error {
        color: #dc2626;
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
