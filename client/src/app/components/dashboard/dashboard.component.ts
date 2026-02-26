import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { TellerService, NetWorthResponse } from '../../services/teller.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard">
      <header class="header">
        <h1>Budget App</h1>
        <div class="header-actions">
          <a routerLink="/profile" class="link-profile">Profile</a>
          <button class="btn-logout" (click)="logout()">Log out</button>
        </div>
      </header>

      @if (netWorth(); as nw) {
        <section class="net-worth">
          <h2>Net Worth</h2>
          <p class="amount" [class.positive]="nw.netWorth >= 0" [class.negative]="nw.netWorth < 0">
            {{ nw.netWorth | currency }}
          </p>
          <div class="breakdown">
            <span>Assets: {{ nw.totalAssets | currency }}</span>
            <span>Liabilities: {{ nw.totalLiabilities | currency }}</span>
          </div>
          @if (nw.accounts.length > 0) {
            <ul class="account-list">
              @for (a of nw.accounts; track a.id) {
                <li class="account-item">
                  <span class="name">{{ a.name }} ({{ a.institutionName }})</span>
                  <span class="balance" [class.liability]="!a.isAsset">{{ a.balance | currency }}</span>
                </li>
              }
            </ul>
          }
        </section>
      } @else if (netWorthError()) {
        <p class="error">Could not load net worth. Connect a bank account to get started.</p>
      } @else {
        <p class="loading">Loading net worth…</p>
      }

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
      .header-actions {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .link-profile {
        color: #64748b;
        text-decoration: none;
        font-size: 0.9rem;
      }
      .link-profile:hover {
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
      .net-worth {
        margin-bottom: 1.5rem;
      }
      .net-worth h2 {
        font-size: 1rem;
        color: #64748b;
        margin: 0 0 0.25rem;
        font-weight: 500;
      }
      .net-worth .amount {
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 0.5rem;
      }
      .net-worth .amount.positive {
        color: #16a34a;
      }
      .net-worth .amount.negative {
        color: #dc2626;
      }
      .breakdown {
        display: flex;
        gap: 1rem;
        font-size: 0.9rem;
        color: #64748b;
        margin-bottom: 1rem;
      }
      .account-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid #e2e8f0;
      }
      .account-item {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        font-size: 0.9rem;
      }
      .account-item .name {
        color: #475569;
      }
      .account-item .balance.liability {
        color: #dc2626;
      }
      .loading,
      .error {
        color: #64748b;
        margin-bottom: 1rem;
      }
      .error {
        color: #dc2626;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  apiStatus = signal<string | null>(null);
  netWorth = signal<NetWorthResponse | null>(null);
  netWorthError = signal(false);

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private teller: TellerService
  ) {
    this.api.get<{ status: string }>('/health').subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });
  }

  ngOnInit() {
    this.teller.getNetWorth().subscribe({
      next: (res) => {
        this.netWorth.set(res);
        this.netWorthError.set(false);
      },
      error: () => {
        this.netWorth.set(null);
        this.netWorthError.set(true);
      },
    });
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
