import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard">
      <header class="header">
        <h1>Budget App</h1>
        <button class="btn-logout" (click)="logout()">Log out</button>
      </header>
      <p>Dashboard — coming soon</p>
      <a routerLink="/accounts" class="link-accounts">Connect bank account →</a>
      @if (apiStatus(); as status) {
        <p class="api-status" [class.connected]="status === 'ok'">API: {{ status }}</p>
      }
    </div>
  `,
  styles: [
    `
      .dashboard {
        padding: 2rem;
        font-family: system-ui, sans-serif;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
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
      .api-status {
        color: #666;
        font-size: 0.9rem;
      }
      .api-status.connected {
        color: #22c55e;
      }
      .link-accounts {
        display: inline-block;
        margin-top: 1rem;
        color: #0f172a;
        font-weight: 500;
      }
    `,
  ],
})
export class DashboardComponent {
  apiStatus = signal<string | null>(null);

  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {
    this.api.get<{ status: string }>('/health').subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
