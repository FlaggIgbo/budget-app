import { Component, DestroyRef, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  BankService,
  BankEnrollment,
  BankAccountItem,
  BankConfig,
} from '../../services/bank.service';
import { OfflineQueueService } from '../../services/offline-queue.service';
import { getAccountIcon } from '../../utils/material-icons.util';

@Component({
  selector: 'app-bank-accounts',
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
        <a mat-button routerLink="/dashboard" class="back-link">
          <mat-icon>arrow_back</mat-icon>
          Dashboard
        </a>
        <div class="header-actions">
          <a mat-button routerLink="/profile" class="nav-link">
            <mat-icon>person_outline</mat-icon>
            Profile
          </a>
          <button mat-stroked-button class="btn-logout" (click)="logout()">
            <mat-icon>logout</mat-icon>
            Log out
          </button>
        </div>
      </div>
    </mat-toolbar>

    <div class="bank-accounts">
      <header class="page-header">
        <div class="header-icon">
          <mat-icon>account_balance</mat-icon>
        </div>
        <div class="header-text">
          <h1>Bank Accounts</h1>
          <p class="subtitle">
            Connect and manage your bank or credit card to automatically sync transactions and
            balances
          </p>
        </div>
      </header>

      @if (config(); as cfg) {
        @if (!cfg.plaidConfigured) {
          <mat-card appearance="outlined" class="alert-card">
            <mat-card-content class="alert-content">
              <mat-icon class="alert-icon">warning_amber</mat-icon>
              <div>
                <strong>Plaid Integration Not Configured</strong>
                <p>
                  Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> to your server
                  environment to link live institutions.
                </p>
              </div>
            </mat-card-content>
          </mat-card>
        } @else {
          <div class="action-banner">
            <button
              mat-flat-button
              class="btn-connect"
              (click)="connectBank()"
              [disabled]="connecting()"
            >
              <mat-icon>{{ connecting() ? 'sync' : 'add_link' }}</mat-icon>
              {{ connecting() ? 'Connecting…' : 'Connect bank or credit card' }}
            </button>
          </div>
        }
      }

      @if (error(); as err) {
        <div class="error-banner">
          <mat-icon>error_outline</mat-icon>
          <span>{{ err }}</span>
        </div>
      }

      <section class="enrollments">
        <div class="section-title-row">
          <h2>Connected Institutions</h2>
          <span class="count-badge">{{ enrollments().length }} linked</span>
        </div>

        @if (enrollments().length === 0) {
          <mat-card appearance="outlined" class="empty-state-card">
            <div class="empty-icon-wrap">
              <mat-icon>account_balance</mat-icon>
            </div>
            <h3>No accounts connected yet</h3>
            <p class="empty">
              Connect your bank or credit card to automatically import balances, monitor cash flow,
              and track net worth.
            </p>
          </mat-card>
        } @else {
          <div class="enrollment-list">
            @for (e of enrollments(); track e.enrollmentId) {
              <mat-card appearance="outlined" class="enrollment-card">
                <div class="enrollment-header">
                  <div class="institution-info">
                    <div class="institution-avatar">
                      <mat-icon>account_balance</mat-icon>
                    </div>
                    <div>
                      <h3 class="institution">
                        {{ e.institutionName || 'Bank Account' }}
                      </h3>
                      <span class="enrollment-sub">Sync active</span>
                    </div>
                  </div>
                  <button
                    mat-stroked-button
                    class="btn-disconnect"
                    (click)="disconnect(e.enrollmentId)"
                    [disabled]="disconnecting() === e.enrollmentId"
                  >
                    <mat-icon>link_off</mat-icon>
                    {{ disconnecting() === e.enrollmentId ? 'Disconnecting…' : 'Disconnect' }}
                  </button>
                </div>

                <div class="enrollment-body">
                  @if (loadingAccounts().has(e.enrollmentId)) {
                    <div class="loading-wrap">
                      <mat-progress-bar mode="indeterminate"></mat-progress-bar>
                      <p class="loading">Loading accounts…</p>
                    </div>
                  } @else {
                    @if (accountsByEnrollment()[e.enrollmentId]; as accounts) {
                      <mat-list class="accounts">
                        @for (a of accounts; track a.id) {
                          <mat-list-item class="account">
                            <mat-icon matListItemIcon class="acct-icon">{{
                              getAccountIcon(a.type, a.subtype)
                            }}</mat-icon>
                            <span matListItemTitle class="name">{{ a.name }}</span>
                            <span matListItemLine class="meta">
                              <span class="chip-digits">···· {{ a.last_four }}</span>
                              <span class="chip-type">{{ a.type }}</span>
                            </span>
                          </mat-list-item>
                        }
                      </mat-list>
                    }
                  }
                </div>
              </mat-card>
            }
          </div>
        }
      </section>
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
        max-width: 760px;
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
      .bank-accounts {
        padding: 2.5rem 1.25rem 4rem;
        max-width: 760px;
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
      .action-banner {
        margin-bottom: 2rem;
      }
      .btn-connect {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
        color: #ffffff !important;
        font-weight: 600;
        padding: 0.75rem 1.5rem !important;
        border-radius: 12px !important;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25) !important;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      .btn-connect:hover:not([disabled]) {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35) !important;
      }
      .alert-card {
        background: #fefce8 !important;
        border: 1px solid #fef08a !important;
        border-radius: 14px !important;
        margin-bottom: 2rem;
      }
      .alert-content {
        display: flex;
        gap: 0.85rem;
        align-items: flex-start;
        color: #854d0e;
        font-size: 0.9rem;
      }
      .alert-content p {
        margin: 0.25rem 0 0;
      }
      .alert-icon {
        color: #d97706;
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1.15rem;
        border-radius: 12px;
        margin-bottom: 1.5rem;
        font-size: 0.9rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
      }
      .section-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.25rem;
      }
      .section-title-row h2 {
        font-size: 1.2rem;
        font-weight: 700;
        color: #0f172a;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .count-badge {
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.25rem 0.65rem;
        background: #e2e8f0;
        color: #475569;
        border-radius: 20px;
      }
      .empty-state-card {
        padding: 3rem 2rem;
        text-align: center;
        background: #ffffff !important;
        border-radius: 16px !important;
        border: 1px dashed #cbd5e1 !important;
      }
      .empty-icon-wrap {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: #f1f5f9;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.25rem;
      }
      .empty-icon-wrap mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
      }
      .empty-state-card h3 {
        margin: 0 0 0.5rem;
        font-size: 1.1rem;
        font-weight: 600;
        color: #1e293b;
      }
      .empty-state-card .empty {
        color: #64748b;
        margin: 0 auto;
        max-width: 420px;
        font-size: 0.925rem;
        line-height: 1.5;
      }
      .enrollment-list {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .enrollment-card {
        background: #ffffff !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
        border-radius: 18px !important;
        overflow: hidden;
        box-shadow:
          0 4px 6px -1px rgba(15, 23, 42, 0.03),
          0 2px 4px -2px rgba(15, 23, 42, 0.03) !important;
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      .enrollment-card:hover {
        box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.05) !important;
      }
      .enrollment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 1.5rem;
        background: #fafafa;
        border-bottom: 1px solid #f1f5f9;
      }
      .institution-info {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .institution-avatar {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: #eef2ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .institution-avatar mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
      .institution {
        margin: 0 0 0.15rem;
        font-size: 1.1rem;
        font-weight: 700;
        color: #0f172a;
      }
      .enrollment-sub {
        font-size: 0.8rem;
        color: #10b981;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .enrollment-sub::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
      }
      .btn-disconnect {
        border-color: #fee2e2 !important;
        color: #dc2626 !important;
        font-size: 0.85rem;
        border-radius: 8px !important;
      }
      .btn-disconnect:hover {
        background: #fef2f2 !important;
        border-color: #fecaca !important;
      }
      .enrollment-body {
        padding: 0.5rem 1rem 1rem;
      }
      .accounts {
        padding: 0;
      }
      .account {
        border-radius: 10px;
        margin-bottom: 0.25rem;
      }
      .acct-icon {
        color: #94a3b8;
      }
      .name {
        font-weight: 600;
        color: #1e293b;
        font-size: 0.95rem;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.25rem;
      }
      .chip-digits {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.8rem;
        background: #f1f5f9;
        padding: 0.15rem 0.5rem;
        border-radius: 6px;
        color: #475569;
      }
      .chip-type {
        font-size: 0.8rem;
        text-transform: capitalize;
        color: #64748b;
      }
      .loading-wrap {
        padding: 1.5rem 1rem;
        text-align: center;
      }
      .loading {
        color: #64748b;
        font-size: 0.9rem;
        margin: 0.75rem 0 0;
      }
    `,
  ],
})
export class BankAccountsComponent implements OnInit {
  config = signal<BankConfig | null>(null);
  enrollments = signal<BankEnrollment[]>([]);
  accountsByEnrollment = signal<Record<string, BankAccountItem[]>>({});
  loadingAccounts = signal<Set<string>>(new Set());
  connecting = signal(false);
  disconnecting = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor(
    private bank: BankService,
    private offlineQueue: OfflineQueueService,
    destroyRef: DestroyRef
  ) {
    this.offlineQueue.replayed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((result) => {
      const hasEnrollmentChange = result.replayed.some((item) =>
        item.url.startsWith('/api/bank/enrollments/')
      );
      if (hasEnrollmentChange) {
        this.loadEnrollments();
      }
    });
  }

  ngOnInit() {
    // Step 1: Get Plaid public configuration
    this.bank.getConfig().subscribe({
      next: (c) => this.config.set(c),
      error: () => this.config.set({ plaidConfigured: false, plaidEnvironment: 'sandbox' }),
    });

    // Step 2: Load connected bank institutions
    this.loadEnrollments();
  }

  // Load user's connected bank list
  loadEnrollments() {
    this.bank.listEnrollments().subscribe({
      next: (list) => {
        this.enrollments.set(list);
        for (const enrollment of list) {
          this.loadAccounts(enrollment.enrollmentId);
        }
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to load accounts';
        this.error.set(message);
      },
    });
  }

  // Update loading state for a bank enrollment
  setEnrollmentLoading(enrollmentId: string, isLoading: boolean) {
    const updatedSet = new Set(this.loadingAccounts());
    if (isLoading) {
      updatedSet.add(enrollmentId);
    } else {
      updatedSet.delete(enrollmentId);
    }
    this.loadingAccounts.set(updatedSet);
  }

  // Load individual accounts for a connected bank
  loadAccounts(enrollmentId: string) {
    this.setEnrollmentLoading(enrollmentId, true);

    this.bank.getAccounts(enrollmentId).subscribe({
      next: (accounts) => {
        const updatedMap = { ...this.accountsByEnrollment() };
        updatedMap[enrollmentId] = accounts;
        this.accountsByEnrollment.set(updatedMap);
        this.setEnrollmentLoading(enrollmentId, false);
      },
      error: () => {
        this.setEnrollmentLoading(enrollmentId, false);
      },
    });
  }

  // Open Plaid Link UI popup (Select institution, login, consent)
  connectBank() {
    const cfg = this.config();
    if (!cfg || !cfg.plaidConfigured) {
      return;
    }

    this.connecting.set(true);
    this.error.set(null);

    // Step 1: Request a link_token from the API server (POST /api/bank/link-token)
    this.bank.createLinkToken().subscribe({
      next: (res) => {
        // Step 2: Open Plaid Link modal with the link_token
        this.bank.openConnect({
          linkToken: res.link_token,
          onSuccess: (publicToken, metadata) => {
            const institutionId = metadata?.institution?.institution_id;
            const institutionName = metadata?.institution?.name;

            // Step 3: Exchange public_token on API Server (POST /api/bank/exchange-token),
            // store encrypted access_token in Secrets Vault, and run Sync Worker
            this.bank.exchangeToken(publicToken, institutionId, institutionName).subscribe({
              next: () => {
                this.loadEnrollments();
                this.connecting.set(false);
              },
              error: (err) => {
                const message = err?.error?.error || 'Failed to save account';
                this.error.set(message);
                this.connecting.set(false);
              },
            });
          },
          onExit: () => {
            this.connecting.set(false);
          },
        });
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to initialize Plaid Link';
        this.error.set(message);
        this.connecting.set(false);
      },
    });
  }

  // Disconnect bank (calls Disconnect Handler -> Plaid POST /item/remove + DB cascade delete)
  disconnect(enrollmentId: string) {
    this.disconnecting.set(enrollmentId);

    this.bank.deleteEnrollment(enrollmentId).subscribe({
      next: (res) => {
        if ((res as unknown as { queued?: boolean })?.queued) {
          this.enrollments.set(this.enrollments().filter((e) => e.enrollmentId !== enrollmentId));
        } else {
          this.loadEnrollments();
        }
        this.disconnecting.set(null);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to disconnect account';
        this.error.set(message);
        this.disconnecting.set(null);
      },
    });
  }

  readonly getAccountIcon = getAccountIcon;

  // Log user out
  logout() {
    this.bank.logout().subscribe({
      next: () => {
        window.location.assign('/login');
      },
    });
  }
}
