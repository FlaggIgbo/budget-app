import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

export interface Profile {
  id: string;
  phone: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
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
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="profile-form">
          <!-- TODO: Add displayName field when backend persists it -->
          <div class="field">
            <label>Phone</label>
            <span class="readonly">{{ p.phone }}</span>
          </div>
          <button type="submit" class="btn-save" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </form>
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
      .profile-form .field {
        margin-bottom: 1rem;
      }
      .profile-form label {
        display: block;
        font-size: 0.85rem;
        color: #64748b;
        margin-bottom: 0.25rem;
      }
      .profile-form .readonly {
        font-size: 1rem;
        color: #0f172a;
      }
      .btn-save {
        background: #0f172a;
        color: white;
        border: none;
        padding: 0.6rem 1rem;
        border-radius: 8px;
        font-size: 0.95rem;
        cursor: pointer;
        margin-top: 0.5rem;
      }
      .btn-save:hover:not(:disabled) {
        background: #1e293b;
      }
      .btn-save:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .error,
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
  saving = signal(false);
  form: FormGroup;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      // TODO: displayName: ['']
    });
  }

  ngOnInit() {
    this.api.get<Profile>('/profile').subscribe({
      next: (p) => {
        this.profile.set(p);
        this.form.patchValue({ /* displayName: p.displayName */ });
      },
      error: (err) => this.error.set(err?.error?.error || 'Failed to load profile'),
    });
  }

  onSubmit() {
    this.saving.set(true);
    this.api.patch<Profile>('/profile', this.form.value).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Failed to save');
        this.saving.set(false);
      },
    });
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
