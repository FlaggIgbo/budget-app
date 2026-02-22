import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TellerService, TellerEnrollment, TellerAccount, TellerConfig } from '../../services/teller.service';

@Component({
  selector: 'app-bank-accounts',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="bank-accounts">
      <header>
        <a routerLink="/dashboard" class="back">← Dashboard</a>
        <h1>Bank Accounts</h1>
        <p class="subtitle">Connect your bank to sync transactions and balances</p>
      </header>

      @if (config(); as cfg) {
        @if (!cfg.tellerApplicationId) {
          <div class="alert">
            Teller is not configured. Add TELLER_APPLICATION_ID to your API server environment.
          </div>
        } @else {
          <button
            class="btn-connect"
            (click)="connectBank()"
            [disabled]="connecting()"
          >
            {{ connecting() ? 'Connecting…' : '+ Connect bank account' }}
          </button>
        }
      }

      @if (error(); as err) {
        <div class="error">{{ err }}</div>
      }

      <section class="enrollments">
        <h2>Connected banks</h2>
        @if (enrollments().length === 0) {
          <p class="empty">No banks connected yet. Click above to connect.</p>
        } @else {
          @for (e of enrollments(); track e.enrollmentId) {
            <div class="enrollment-card">
              <div class="enrollment-header">
                <span class="institution">{{ e.institutionName || 'Bank' }}</span>
                <button
                  class="btn-disconnect"
                  (click)="disconnect(e.enrollmentId)"
                  [disabled]="disconnecting() === e.enrollmentId"
                >
                  Disconnect
                </button>
              </div>
              @if (accountsByEnrollment()[e.enrollmentId]; as accounts) {
                <ul class="accounts">
                  @for (a of accounts; track a.id) {
                    <li class="account">
                      <span class="name">{{ a.name }}</span>
                      <span class="meta">•••• {{ a.last_four }} · {{ a.subtype }}</span>
                    </li>
                  }
                </ul>
              } @else if (loadingAccounts().has(e.enrollmentId)) {
                <p class="loading">Loading accounts…</p>
              }
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .bank-accounts {
      padding: 2rem;
      font-family: system-ui, sans-serif;
      max-width: 640px;
      margin: 0 auto;
    }
    .back {
      color: #64748b;
      text-decoration: none;
      font-size: 0.9rem;
      margin-bottom: 1rem;
      display: inline-block;
    }
    .back:hover { color: #0f172a; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .subtitle { color: #64748b; margin: 0 0 1.5rem; font-size: 0.95rem; }
    .btn-connect {
      background: #0f172a;
      color: white;
      border: none;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      margin-bottom: 2rem;
    }
    .btn-connect:hover:not(:disabled) { background: #1e293b; }
    .btn-connect:disabled { opacity: 0.6; cursor: not-allowed; }
    .alert, .error {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    .alert { background: #fef3c7; color: #92400e; }
    .error { background: #fee2e2; color: #991b1b; }
    .enrollments h2 { font-size: 1.1rem; margin-bottom: 1rem; }
    .empty { color: #64748b; }
    .enrollment-card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .enrollment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .institution { font-weight: 600; }
    .btn-disconnect {
      background: transparent;
      color: #dc2626;
      border: 1px solid #dc2626;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-disconnect:hover:not(:disabled) { background: #fef2f2; }
    .btn-disconnect:disabled { opacity: 0.6; }
    .accounts { list-style: none; margin: 0; padding: 0; }
    .account {
      padding: 0.5rem 0;
      border-top: 1px solid #f1f5f9;
      font-size: 0.9rem;
    }
    .account .name { font-weight: 500; }
    .account .meta { color: #64748b; margin-left: 0.5rem; }
    .loading { color: #64748b; font-size: 0.9rem; margin: 0; }
  `],
})
export class BankAccountsComponent implements OnInit {
  config = signal<TellerConfig | null>(null);
  enrollments = signal<TellerEnrollment[]>([]);
  accountsByEnrollment = signal<Record<string, TellerAccount[]>>({});
  loadingAccounts = signal<Set<string>>(new Set());
  connecting = signal(false);
  disconnecting = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor(private teller: TellerService) {}

  ngOnInit() {
    this.teller.getConfig().subscribe({
      next: (c) => this.config.set(c),
      error: () => this.config.set({ tellerApplicationId: '', tellerEnvironment: 'sandbox' }),
    });
    this.loadEnrollments();
  }

  loadEnrollments() {
    this.teller.listEnrollments().subscribe({
      next: (list) => {
        this.enrollments.set(list);
        list.forEach((e) => this.loadAccounts(e.enrollmentId));
      },
      error: (err) => this.error.set(err?.error?.error || 'Failed to load enrollments'),
    });
  }

  loadAccounts(enrollmentId: string) {
    this.loadingAccounts.update((s) => new Set(s).add(enrollmentId));
    this.teller.getAccounts(enrollmentId).subscribe({
      next: (accounts) => {
        this.accountsByEnrollment.update((m) => ({ ...m, [enrollmentId]: accounts }));
        this.loadingAccounts.update((s) => {
          const next = new Set(s);
          next.delete(enrollmentId);
          return next;
        });
      },
      error: () => {
        this.loadingAccounts.update((s) => {
          const next = new Set(s);
          next.delete(enrollmentId);
          return next;
        });
      },
    });
  }

  connectBank() {
    const cfg = this.config();
    if (!cfg?.tellerApplicationId) return;

    this.connecting.set(true);
    this.error.set(null);

    this.teller.openConnect({
      applicationId: cfg.tellerApplicationId,
      environment: cfg.tellerEnvironment || 'sandbox',
      onSuccess: (enrollment) => {
        this.teller
          .createEnrollment(
            enrollment.accessToken,
            enrollment.enrollment?.id ?? '',
            enrollment.enrollment?.institution?.name
          )
          .subscribe({
            next: () => {
              this.loadEnrollments();
              this.connecting.set(false);
            },
            error: (err) => {
              this.error.set(err?.error?.error || 'Failed to save enrollment');
              this.connecting.set(false);
            },
          });
      },
      onExit: () => this.connecting.set(false),
    });
  }

  disconnect(enrollmentId: string) {
    this.disconnecting.set(enrollmentId);
    this.teller.deleteEnrollment(enrollmentId).subscribe({
      next: () => {
        this.loadEnrollments();
        this.disconnecting.set(null);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Failed to disconnect');
        this.disconnecting.set(null);
      },
    });
  }
}
