import { Component, OnInit, signal } from '@angular/core';
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

    <div class="bank-accounts">
      <header class="page-header">
        <h1>Bank Accounts</h1>
        <p class="subtitle">Connect your bank or credit card to sync transactions and balances</p>
      </header>

      @if (config(); as cfg) {
        @if (!cfg.tellerApplicationId) {
          <mat-card appearance="outlined" class="alert-card">
            <mat-card-content>
              Teller is not configured. Add TELLER_APPLICATION_ID to your server environment.
            </mat-card-content>
          </mat-card>
        } @else {
          <button
            mat-flat-button
            class="btn-connect"
            (click)="connectBank()"
            [disabled]="connecting()"
          >
            <mat-icon>add_link</mat-icon>
            {{ connecting() ? 'Connecting…' : 'Connect bank or credit card' }}
          </button>
        }
      }

      @if (error(); as err) {
        <div class="error">{{ err }}</div>
      }

      <section class="enrollments">
        <h2>Connected accounts</h2>
        @if (enrollments().length === 0) {
          <p class="empty">No accounts connected yet. Connect your bank or credit card above.</p>
        } @else {
          @for (e of enrollments(); track e.enrollmentId) {
            <mat-card appearance="outlined" class="enrollment-card">
              <mat-card-header class="enrollment-header">
                <mat-card-title class="institution">
                  {{ e.institutionName || 'Bank Account' }}
                </mat-card-title>
                <button
                  mat-stroked-button
                  class="btn-disconnect"
                  (click)="disconnect(e.enrollmentId)"
                  [disabled]="disconnecting() === e.enrollmentId"
                >
                  {{ disconnecting() === e.enrollmentId ? 'Disconnecting…' : 'Disconnect' }}
                </button>
              </mat-card-header>

              <mat-card-content>
                @if (loadingAccounts().has(e.enrollmentId)) {
                  <mat-progress-bar mode="indeterminate"></mat-progress-bar>
                  <p class="loading">Loading accounts…</p>
                } @else {
                  @if (accountsByEnrollment()[e.enrollmentId]; as accounts) {
                    <mat-list class="accounts">
                      @for (a of accounts; track a.id) {
                        <mat-list-item class="account">
                          <span matListItemTitle class="name">{{ a.name }}</span>
                          <span matListItemLine class="meta">
                            ···{{ a.last_four }} ({{ a.type }})
                          </span>
                        </mat-list-item>
                      }
                    </mat-list>
                  }
                }
              </mat-card-content>
            </mat-card>
          }
        }
      </section>
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
        max-width: 640px;
        margin: 0 auto;
      }
      .bank-accounts {
        padding: 2rem 1.5rem;
        max-width: 640px;
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
      .btn-connect {
        margin-bottom: 2rem;
      }
      .alert-card {
        background: #fef3c7;
        color: #92400e;
        margin-bottom: 1.5rem;
      }
      .error {
        padding: 0.75rem 1rem;
        border-radius: 12px;
        margin-bottom: 1.5rem;
        font-size: 0.9rem;
        background: #fee2e2;
        color: #991b1b;
      }
      .enrollments h2 {
        font-size: 1.1rem;
        margin-bottom: 1rem;
      }
      .empty {
        color: var(--mat-sys-on-surface-variant, #64748b);
      }
      .enrollment-card {
        margin-bottom: 1rem;
      }
      .enrollment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .btn-disconnect {
        color: var(--mat-sys-error, #dc2626);
        margin-left: auto;
      }
      .loading {
        color: var(--mat-sys-on-surface-variant, #64748b);
        font-size: 0.9rem;
        margin: 0.5rem 0 0;
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

  constructor(private bank: BankService) {}

  ngOnInit() {
    // Step 1: Get Teller Connect configuration
    this.bank.getConfig().subscribe({
      next: (c) => this.config.set(c),
      error: () => this.config.set({ tellerApplicationId: '', tellerEnvironment: 'sandbox' }),
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

  // Open Teller Connect UI popup (Select institution, login, consent)
  connectBank() {
    const cfg = this.config();
    if (!cfg || !cfg.tellerApplicationId) {
      return;
    }

    this.connecting.set(true);
    this.error.set(null);

    this.bank.openConnect({
      applicationId: cfg.tellerApplicationId,
      environment: cfg.tellerEnvironment || 'sandbox',
      onSuccess: (enrollment) => {
        const token = enrollment.accessToken;
        const id = enrollment.enrollment?.id || '';
        const name = enrollment.enrollment?.institution?.name;

        // Send token to API Server (POST /api/bank/exchange-token)
        // which stores the encrypted access_token in Secrets Vault and runs Sync Worker
        this.bank.exchangeToken(token, id, name).subscribe({
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
  }

  // Disconnect bank (calls Disconnect Handler -> Teller DELETE /accounts + DB cascade delete)
  disconnect(enrollmentId: string) {
    this.disconnecting.set(enrollmentId);

    this.bank.deleteEnrollment(enrollmentId).subscribe({
      next: () => {
        this.loadEnrollments();
        this.disconnecting.set(null);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to disconnect account';
        this.error.set(message);
        this.disconnecting.set(null);
      },
    });
  }

  // Log user out
  logout() {
    this.bank.logout().subscribe({
      next: () => {
        window.location.assign('/login');
      },
    });
  }
}
