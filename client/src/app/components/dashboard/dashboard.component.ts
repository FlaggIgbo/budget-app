import { Component, DestroyRef, signal, OnInit, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  BankService,
  NetWorthResponse,
  DashboardSummaryResponse,
} from '../../services/bank.service';
import { AuthService } from '../../services/auth.service';
import { PwaService } from '../../services/pwa.service';
import { OfflineQueueService } from '../../services/offline-queue.service';

export interface InstitutionGroup {
  institutionName: string;
  enrollmentId: string;
  accounts: NetWorthResponse['accounts'];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressBarModule,
  ],
  template: `
    <mat-toolbar class="top-toolbar">
      <div class="toolbar-inner">
        <div class="brand">
          <div class="brand-icon">
            <mat-icon>account_balance_wallet</mat-icon>
          </div>
          <h1>Budget App</h1>
        </div>
        <div class="header-actions">
          @if (canInstallApp()) {
            <button mat-stroked-button class="btn-install-app" (click)="installApp()">
              <mat-icon>install_mobile</mat-icon>
              Install App
            </button>
          }
          <a mat-button routerLink="/chat" class="link-chat">
            <mat-icon>smart_toy</mat-icon>
            AI Assistant
          </a>
          <a mat-button routerLink="/profile" class="link-profile">
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

    <div class="dashboard">
      @if (passkeyWarning(); as warn) {
        <div class="passkey-warning-banner" role="alert">
          <mat-icon class="warning-icon">warning_amber</mat-icon>
          <span class="warning-message">{{ warn }}</span>
          <div class="warning-actions">
            <a mat-stroked-button routerLink="/profile" class="btn-warning-profile">
              Go to Profile
            </a>
            <button
              mat-icon-button
              type="button"
              aria-label="Dismiss passkey warning"
              (click)="dismissPasskeyWarning()"
            >
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </div>
      }

      @if (netWorth(); as nw) {
        <mat-card appearance="outlined" class="section-card net-worth-card">
          <div class="net-worth-header">
            <div>
              <span class="section-eyebrow">Financial Overview</span>
              <h2>Accounts & Balances (Net Worth)</h2>
            </div>
            <button mat-flat-button class="btn-sync" (click)="syncAll()" [disabled]="syncing()">
              <mat-icon [class.spinning]="syncing()">sync</mat-icon>
              {{ syncing() ? 'Syncing…' : 'Sync' }}
            </button>
          </div>
          <mat-card-content>
            <div class="net-worth-hero">
              <p
                class="amount"
                [class.positive]="nw.netWorth >= 0"
                [class.negative]="nw.netWorth < 0"
              >
                {{ nw.netWorth | currency }}
              </p>
              <div class="breakdown">
                <div class="breakdown-pill asset-pill">
                  <span class="pill-dot"></span>
                  <span class="pill-label">Assets:</span>
                  <strong>{{ nw.totalAssets | currency }}</strong>
                </div>
                <div class="breakdown-pill liability-pill">
                  <span class="pill-dot"></span>
                  <span class="pill-label">Liabilities:</span>
                  <strong>{{ nw.totalLiabilities | currency }}</strong>
                </div>
              </div>
            </div>

            @if (institutionGroups().length > 0) {
              <div class="institutions-container">
                @for (group of institutionGroups(); track group.institutionName) {
                  <div class="institution-group">
                    <div class="institution-header">
                      <div class="inst-info">
                        <div class="inst-icon">
                          <mat-icon>account_balance</mat-icon>
                        </div>
                        <span class="institution-title">{{ group.institutionName }}</span>
                      </div>
                      @if (group.enrollmentId) {
                        <button
                          mat-button
                          class="btn-disconnect"
                          (click)="disconnectInstitution(group.enrollmentId)"
                          [disabled]="disconnecting() === group.enrollmentId"
                        >
                          <mat-icon>link_off</mat-icon>
                          {{
                            disconnecting() === group.enrollmentId ? 'Disconnecting…' : 'Disconnect'
                          }}
                        </button>
                      }
                    </div>
                    <div class="account-list">
                      @for (a of group.accounts; track a.id) {
                        <div class="account-item">
                          <div class="account-main">
                            <span class="account-name">{{ a.name }}</span>
                            <span class="account-meta">{{ a.institutionName || 'Bank' }}</span>
                          </div>
                          <span class="balance" [class.liability]="!a.isAsset">
                            {{ a.balance | currency }}
                          </span>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </mat-card-content>
        </mat-card>
      } @else if (netWorthError()) {
        <mat-card appearance="outlined" class="section-card error-card">
          <mat-card-content>
            <mat-icon>info_outline</mat-icon>
            <p class="error">Could not load net worth. Connect a bank account to get started.</p>
          </mat-card-content>
        </mat-card>
      } @else {
        <div class="loading-card">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p>Loading net worth…</p>
        </div>
      }

      @if (summary(); as s) {
        @if (s.quickStats) {
          <section class="quick-stats">
            <div class="section-title-row">
              <h2>Quick Stats</h2>
              <span class="section-badge">Live</span>
            </div>
            <div class="stats-grid">
              <div class="stat-card">
                <span class="stat-label">This Month</span>
                <div class="stat-values">
                  <span class="stat-income">+{{ s.quickStats.thisMonthIncome | currency }}</span>
                  <span class="stat-expense">-{{ s.quickStats.thisMonthExpenses | currency }}</span>
                </div>
              </div>
              <div class="stat-card">
                <span class="stat-label">MoM Trend</span>
                <div class="stat-values">
                  <span
                    class="stat-pct"
                    [class.up]="(s.quickStats.momIncomeChangePct ?? 0) >= 0"
                    [class.down]="(s.quickStats.momIncomeChangePct ?? 0) < 0"
                  >
                    Income {{ s.quickStats.momIncomeChangePct ?? 0 | number: '1.1-1' }}%
                  </span>
                  <span
                    class="stat-pct"
                    [class.up]="(s.quickStats.momExpensesChangePct ?? 0) <= 0"
                    [class.down]="(s.quickStats.momExpensesChangePct ?? 0) > 0"
                  >
                    Expenses {{ s.quickStats.momExpensesChangePct ?? 0 | number: '1.1-1' }}%
                  </span>
                </div>
              </div>
              <div class="stat-card">
                <span class="stat-label">Year to Date (YTD)</span>
                <div class="stat-values">
                  <span class="stat-income">+{{ s.quickStats.ytdIncome | currency }}</span>
                  <span class="stat-expense">-{{ s.quickStats.ytdExpenses | currency }}</span>
                </div>
              </div>
            </div>
          </section>
        }

        <div class="charts-grid">
          <mat-card appearance="outlined" class="section-card income-expenses">
            <mat-card-header>
              <div class="chart-header">
                <div>
                  <mat-card-title><h2>Income vs. Expenses</h2></mat-card-title>
                  <mat-card-subtitle class="subtitle">Monthly cash flow</mat-card-subtitle>
                </div>
                <div class="chart-legend">
                  <span class="legend-item"><span class="dot income-dot"></span> Income</span>
                  <span class="legend-item"><span class="dot expense-dot"></span> Expenses</span>
                </div>
              </div>
            </mat-card-header>
            <mat-card-content>
              @if (s.incomeVsExpenses && s.incomeVsExpenses.length > 0) {
                <div class="bar-chart">
                  @for (row of s.incomeVsExpenses; track row.month) {
                    <div class="bar-row">
                      <span class="bar-label">{{ row.month }}</span>
                      <div class="bar-track">
                        <div
                          class="bar income"
                          [style.width.%]="barWidth(row.income, row.expenses, row.income)"
                        ></div>
                        <div
                          class="bar expense"
                          [style.width.%]="barWidth(row.income, row.expenses, row.expenses)"
                        ></div>
                      </div>
                      <span class="bar-values"
                        >{{ row.income | currency }} / {{ row.expenses | currency }}</span
                      >
                    </div>
                  }
                </div>
              } @else {
                <p class="empty">No transaction data yet. Connect a bank and sync.</p>
              }
            </mat-card-content>
          </mat-card>

          <mat-card appearance="outlined" class="section-card spending-category">
            <mat-card-header>
              <mat-card-title><h2>Spending by Category</h2></mat-card-title>
              <mat-card-subtitle class="subtitle">This month breakdown</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              @if (s.spendingByCategory && s.spendingByCategory.length > 0) {
                <div class="category-bars">
                  @for (c of s.spendingByCategory; track c.category) {
                    <div class="cat-row">
                      <span class="cat-name">{{ c.category }}</span>
                      <div class="cat-bar-wrap">
                        <div class="cat-bar" [style.width.%]="catBarWidth(c.amount)"></div>
                      </div>
                      <span class="cat-amt">{{ c.amount | currency }}</span>
                    </div>
                  }
                </div>
              } @else {
                <p class="empty">No spending data this month.</p>
              }
            </mat-card-content>
          </mat-card>
        </div>

        <mat-card appearance="outlined" class="section-card recent-transactions">
          <mat-card-header>
            <div class="txns-header">
              <h2>Transactions per Institution</h2>
              <div class="filter-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Filter by institution</mat-label>
                  <mat-select
                    id="inst-filter"
                    [value]="institutionFilter()"
                    (selectionChange)="institutionFilter.set($event.value)"
                  >
                    <mat-option value="">All institutions</mat-option>
                    @for (inst of institutionOptions(); track inst) {
                      <mat-option [value]="inst">{{ inst }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Filter by category</mat-label>
                  <mat-select
                    id="cat-filter"
                    [value]="categoryFilter()"
                    (selectionChange)="categoryFilter.set($event.value)"
                  >
                    <mat-option value="">All categories</mat-option>
                    @for (c of categoryOptions(); track c) {
                      <mat-option [value]="c">{{ c }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
            </div>
          </mat-card-header>
          <mat-card-content>
            @if (filteredTransactions() && filteredTransactions().length > 0) {
              <ul class="txn-list">
                @for (t of filteredTransactions(); track t.id) {
                  <li class="txn-item">
                    <div class="txn-icon-wrap" [class.is-income]="t.amount > 0">
                      <mat-icon>{{ t.amount > 0 ? 'arrow_downward' : 'shopping_bag' }}</mat-icon>
                    </div>
                    <div class="txn-main">
                      <span class="txn-desc">{{ t.description }}</span>
                      <span class="txn-date">
                        {{ t.date }}
                        @if (t.institutionName) {
                          · {{ t.institutionName }}
                        }
                        @if (t.accountName) {
                          ({{ t.accountName }})
                        }
                      </span>
                    </div>
                    <div class="txn-meta">
                      @if (t.category) {
                        <span class="txn-cat">{{ t.category }}</span>
                      }
                      <span
                        class="txn-amt"
                        [class.income]="t.amount > 0"
                        [class.expense]="t.amount < 0"
                      >
                        {{ t.amount > 0 ? '+' : '' }}{{ t.amount | currency }}
                      </span>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <div class="empty-state">
                <mat-icon>receipt_long</mat-icon>
                <p class="empty">No recent transactions matching filters.</p>
              </div>
            }
          </mat-card-content>
        </mat-card>
      } @else if (summaryError()) {
        <p class="error">Could not load dashboard summary.</p>
      } @else if (!netWorthError()) {
        <div class="loading-card">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p>Loading dashboard…</p>
        </div>
      }

      <div class="footer-row">
        <a mat-flat-button routerLink="/accounts" class="link-accounts">
          <mat-icon>add_link</mat-icon>
          Connect bank or credit card →
        </a>
        @if (apiStatus(); as status) {
          <div class="api-status-badge">
            <span class="status-indicator" [class.connected]="status === 'ok'"></span>
            <span class="api-status" [class.connected]="status === 'ok'">API: {{ status }}</span>
          </div>
        }
      </div>
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
        max-width: 960px;
        margin: 0 auto;
        padding: 0 1rem;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }
      .brand-icon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .brand-icon mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .toolbar-inner h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #0f172a;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .link-chat,
      .link-profile {
        color: #475569 !important;
        font-weight: 500;
      }
      .btn-install-app {
        border-color: rgba(37, 99, 235, 0.35) !important;
        color: #1d4ed8 !important;
        font-size: 0.85rem;
        font-weight: 600 !important;
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
      .dashboard {
        padding: 2rem 1rem 4rem;
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }
      .passkey-warning-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.9rem 1.15rem;
        border-radius: 14px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        color: #92400e;
        flex-wrap: wrap;
      }
      .passkey-warning-banner .warning-icon {
        color: #d97706;
        flex-shrink: 0;
      }
      .passkey-warning-banner .warning-message {
        flex: 1;
        font-size: 0.9rem;
        font-weight: 500;
        line-height: 1.45;
      }
      .passkey-warning-banner .warning-actions {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .btn-warning-profile {
        border-color: #f59e0b !important;
        color: #92400e !important;
        font-weight: 600 !important;
        border-radius: 8px !important;
      }
      .section-card {
        padding: 1.5rem;
        background: #ffffff !important;
        border-radius: 18px !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
        box-shadow:
          0 4px 6px -1px rgba(15, 23, 42, 0.03),
          0 2px 4px -2px rgba(15, 23, 42, 0.03) !important;
      }
      .section-eyebrow {
        text-transform: uppercase;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #64748b;
        display: block;
        margin-bottom: 0.25rem;
      }
      h2 {
        font-size: 1.15rem;
        margin: 0;
        font-weight: 600;
        color: #0f172a;
        letter-spacing: -0.01em;
      }
      .net-worth-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.25rem;
      }
      .btn-sync {
        background: #2563eb !important;
        color: #ffffff !important;
        border-radius: 10px !important;
        font-size: 0.875rem;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
      }
      .btn-sync:hover:not([disabled]) {
        background: #1d4ed8 !important;
      }
      .spinning {
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      .net-worth-hero {
        padding-bottom: 1.25rem;
      }
      .net-worth .amount,
      .net-worth-hero .amount {
        font-size: 2.75rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        margin: 0 0 1rem;
        font-variant-numeric: tabular-nums;
        color: #0f172a;
      }
      .amount.positive {
        color: #0f172a;
      }
      .amount.negative {
        color: #dc2626;
      }
      .breakdown {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .breakdown-pill {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.45rem 0.85rem;
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 500;
      }
      .asset-pill {
        background: rgba(16, 185, 129, 0.08);
        color: #065f46;
        border: 1px solid rgba(16, 185, 129, 0.25);
      }
      .liability-pill {
        background: rgba(239, 68, 68, 0.08);
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.25);
      }
      .pill-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .asset-pill .pill-dot {
        background: #10b981;
      }
      .liability-pill .pill-dot {
        background: #ef4444;
      }
      .pill-label {
        color: #64748b;
      }
      .institutions-container {
        border-top: 1px solid #f1f5f9;
        margin-top: 1.25rem;
        padding-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .institution-group {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1rem;
      }
      .institution-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }
      .inst-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .inst-icon {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: #e2e8f0;
        color: #475569;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .inst-icon mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .institution-title {
        font-weight: 600;
        font-size: 0.95rem;
        color: #1e293b;
      }
      .btn-disconnect {
        color: #dc2626 !important;
        font-size: 0.8rem;
      }
      .btn-disconnect mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-right: 0.25rem;
      }
      .account-list {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .account-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.65rem 0.85rem;
        background: #ffffff;
        border-radius: 8px;
        border: 1px solid #edf2f7;
      }
      .account-name {
        font-size: 0.9rem;
        font-weight: 500;
        color: #1e293b;
      }
      .account-meta {
        font-size: 0.8rem;
        color: #94a3b8;
        display: block;
      }
      .balance {
        font-weight: 600;
        font-size: 0.95rem;
        color: #0f172a;
        font-variant-numeric: tabular-nums;
      }
      .balance.liability {
        color: #dc2626;
      }

      /* Quick Stats */
      .quick-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .section-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .section-badge {
        background: rgba(16, 185, 129, 0.1);
        color: #059669;
        padding: 0.15rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
      }
      .stat-card {
        background: #ffffff;
        border-radius: 14px;
        border: 1px solid rgba(226, 232, 240, 0.9);
        padding: 1.25rem;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
      }
      .stat-label {
        font-size: 0.8rem;
        color: #64748b;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .stat-values {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-top: 0.5rem;
      }
      .stat-income {
        color: #059669;
        font-weight: 700;
        font-size: 1.15rem;
        font-variant-numeric: tabular-nums;
      }
      .stat-expense {
        color: #dc2626;
        font-weight: 600;
        font-size: 0.95rem;
        font-variant-numeric: tabular-nums;
      }
      .stat-pct {
        font-weight: 600;
        font-size: 0.9rem;
      }
      .stat-pct.up {
        color: #059669;
      }
      .stat-pct.down {
        color: #dc2626;
      }

      /* Charts */
      .charts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
        gap: 1.25rem;
      }
      .chart-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        width: 100%;
      }
      .subtitle {
        color: #64748b;
        font-size: 0.85rem;
        margin-top: 0.25rem;
      }
      .chart-legend {
        display: flex;
        gap: 0.75rem;
        font-size: 0.8rem;
        color: #64748b;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .income-dot {
        background: #10b981;
      }
      .expense-dot {
        background: #f43f5e;
      }

      .bar-chart,
      .category-bars {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        margin-top: 0.75rem;
      }
      .bar-row,
      .cat-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .bar-label {
        width: 4.5rem;
        font-size: 0.85rem;
        font-weight: 500;
        color: #334155;
      }
      .bar-track,
      .cat-bar-wrap {
        flex: 1;
        display: flex;
        height: 1rem;
        background: #f1f5f9;
        border-radius: 9999px;
        overflow: hidden;
      }
      .bar.income {
        background: linear-gradient(90deg, #34d399 0%, #10b981 100%);
      }
      .bar.expense {
        background: linear-gradient(90deg, #fb7185 0%, #f43f5e 100%);
      }
      .bar-values {
        width: 9.5rem;
        font-size: 0.8rem;
        color: #64748b;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .cat-name {
        width: 6.5rem;
        font-size: 0.85rem;
        font-weight: 500;
        color: #334155;
      }
      .cat-bar {
        height: 100%;
        background: linear-gradient(90deg, #60a5fa 0%, #2563eb 100%);
        border-radius: 9999px;
      }
      .cat-amt {
        width: 4.5rem;
        font-size: 0.85rem;
        font-weight: 600;
        text-align: right;
        color: #0f172a;
        font-variant-numeric: tabular-nums;
      }

      /* Transactions */
      .txns-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 0.5rem;
      }
      .filter-row {
        display: flex;
        gap: 0.75rem;
      }
      .filter-row mat-form-field {
        font-size: 0.85rem;
        width: 180px;
      }
      .txn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .txn-item {
        padding: 0.85rem 1rem;
        background: #ffffff;
        border: 1px solid #f1f5f9;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 1rem;
        transition: all 0.15s ease-in-out;
      }
      .txn-item:hover {
        background: #f8fafc;
        border-color: #e2e8f0;
      }
      .txn-icon-wrap {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: rgba(239, 68, 68, 0.08);
        color: #dc2626;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .txn-icon-wrap.is-income {
        background: rgba(16, 185, 129, 0.08);
        color: #059669;
      }
      .txn-icon-wrap mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      .txn-main {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        flex: 1;
      }
      .txn-desc {
        font-weight: 600;
        font-size: 0.925rem;
        color: #1e293b;
      }
      .txn-date {
        font-size: 0.8rem;
        color: #94a3b8;
      }
      .txn-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
      }
      .txn-cat {
        font-size: 0.75rem;
        color: #475569;
        background: #f1f5f9;
        padding: 0.15rem 0.5rem;
        border-radius: 6px;
        font-weight: 500;
      }
      .txn-amt {
        font-weight: 700;
        font-size: 0.95rem;
        font-variant-numeric: tabular-nums;
      }
      .txn-amt.income {
        color: #059669;
      }
      .txn-amt.expense {
        color: #0f172a;
      }
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 1rem;
        color: #94a3b8;
      }
      .empty-state mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        margin-bottom: 0.5rem;
      }
      .empty {
        color: #94a3b8;
        margin: 0;
        font-size: 0.9rem;
      }

      /* Footer */
      .footer-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 1rem;
      }
      .link-accounts {
        background: #0f172a !important;
        color: #ffffff !important;
        padding: 0.5rem 1.25rem !important;
        border-radius: 10px !important;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .link-accounts mat-icon {
        margin-right: 0.35rem;
      }
      .api-status-badge {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        padding: 0.35rem 0.75rem;
        border-radius: 9999px;
      }
      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #94a3b8;
      }
      .status-indicator.connected {
        background: #10b981;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
      }
      .api-status {
        color: #64748b;
        font-size: 0.8rem;
        font-weight: 500;
      }
      .api-status.connected {
        color: #059669;
      }
      .loading-card {
        padding: 2rem;
        text-align: center;
        background: #ffffff;
        border-radius: 16px;
        border: 1px solid #e2e8f0;
      }
      .loading-card p {
        color: #64748b;
        font-size: 0.9rem;
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  apiStatus = signal<string | null>(null);
  netWorth = signal<NetWorthResponse | null>(null);
  netWorthError = signal(false);
  summary = signal<DashboardSummaryResponse | null>(null);
  summaryError = signal(false);
  categoryFilter = signal<string>('');
  institutionFilter = signal<string>('');
  syncing = signal(false);
  disconnecting = signal<string | null>(null);

  // Group accounts & balances by institution so users can view & disconnect per institution
  institutionGroups = computed(() => {
    const nw = this.netWorth();
    if (!nw || !nw.accounts || nw.accounts.length === 0) {
      return [];
    }

    const groupMap: Record<string, InstitutionGroup> = {};
    for (const account of nw.accounts) {
      const instName = account.institutionName || 'Bank';
      if (!groupMap[instName]) {
        groupMap[instName] = {
          institutionName: instName,
          enrollmentId: account.enrollmentId || '',
          accounts: [],
        };
      }
      groupMap[instName].accounts.push(account);
    }

    const groups: InstitutionGroup[] = [];
    const keys = Object.keys(groupMap);
    for (const key of keys) {
      groups.push(groupMap[key]);
    }
    return groups;
  });

  // Get unique list of institutions for the "Transactions per institution" filter
  institutionOptions = computed(() => {
    const s = this.summary();
    if (!s || !s.recentTransactions) {
      return [];
    }

    const institutions = new Set<string>();
    for (const txn of s.recentTransactions) {
      if (txn.institutionName) {
        institutions.add(txn.institutionName);
      }
    }
    return Array.from(institutions).sort();
  });

  // Get unique list of categories for the category filter dropdown
  categoryOptions = computed(() => {
    const s = this.summary();
    if (!s || !s.recentTransactions) {
      return [];
    }

    const categories = new Set<string>();
    for (const txn of s.recentTransactions) {
      if (txn.category) {
        categories.add(txn.category);
      }
    }
    return Array.from(categories).sort();
  });

  // Filter transactions by selected institution and category
  filteredTransactions = computed(() => {
    const s = this.summary();
    const catFilter = this.categoryFilter();
    const instFilter = this.institutionFilter();
    if (!s || !s.recentTransactions) {
      return [];
    }

    const result = [];
    for (const t of s.recentTransactions) {
      if (instFilter && t.institutionName !== instFilter) {
        continue;
      }
      if (catFilter && t.category !== catFilter) {
        continue;
      }
      result.push(t);
    }
    return result;
  });

  passkeyWarning = computed(() => this.auth.passkeyWarning());
  canInstallApp = computed(() => this.pwa.canInstall());

  constructor(
    private bank: BankService,
    private auth: AuthService,
    private pwa: PwaService,
    private offlineQueue: OfflineQueueService,
    destroyRef: DestroyRef
  ) {
    // Check API health status
    this.bank.getHealthStatus().subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });

    // Reload dashboard data automatically after queued bank sync or disconnect mutations replay
    this.offlineQueue.replayed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((result) => {
      const hasBankMutation = result.replayed.some(
        (item) =>
          item.url.startsWith('/api/bank/transactions/sync') ||
          item.url.startsWith('/api/bank/enrollments/')
      );
      if (hasBankMutation) {
        this.loadDashboardData();
      }
    });
  }

  installApp() {
    this.pwa.promptInstall();
  }

  dismissPasskeyWarning() {
    this.auth.clearPasskeyWarning();
  }

  ngOnInit() {
    this.loadDashboardData();
  }

  // Load Net Worth (Accounts & Balances) and Dashboard Summary (Transactions)
  loadDashboardData() {
    // Step 1: Load net worth and accounts
    this.bank.getNetWorth().subscribe({
      next: (res) => {
        this.netWorth.set(res);
        this.netWorthError.set(false);
      },
      error: () => {
        this.netWorth.set(null);
        this.netWorthError.set(true);
      },
    });

    // Step 2: Load dashboard summary and transactions
    this.bank.getDashboardSummary().subscribe({
      next: (res) => {
        this.summary.set(res);
        this.summaryError.set(false);
      },
      error: () => {
        this.summary.set(null);
        this.summaryError.set(true);
      },
    });
  }

  // Trigger Sync Worker (POST /api/bank/transactions/sync)
  syncAll() {
    if (!this.bank.syncTransactions) {
      return;
    }
    this.syncing.set(true);
    this.bank.syncTransactions().subscribe({
      next: (res) => {
        this.syncing.set(false);
        if (!(res as { queued?: boolean })?.queued) {
          this.loadDashboardData();
        }
      },
      error: () => {
        this.syncing.set(false);
      },
    });
  }

  // Disconnect an institution via the Disconnect Handler
  disconnectInstitution(enrollmentId: string) {
    if (!enrollmentId || !this.bank.deleteEnrollment) {
      return;
    }
    this.disconnecting.set(enrollmentId);
    this.bank.deleteEnrollment(enrollmentId).subscribe({
      next: (res) => {
        this.disconnecting.set(null);
        if (!(res as unknown as { queued?: boolean })?.queued) {
          this.loadDashboardData();
        }
      },
      error: () => {
        this.disconnecting.set(null);
      },
    });
  }

  // Calculate percentage bar width for income vs expenses
  barWidth(income: number, expenses: number, value: number): number {
    const total = income + expenses;
    if (total <= 0) {
      return 0;
    }
    const percent = (value / total) * 100;
    return Math.max(2, percent);
  }

  // Calculate width for category spending bar
  catBarWidth(amount: number): number {
    const s = this.summary();
    if (!s || !s.spendingByCategory || s.spendingByCategory.length === 0) {
      return 0;
    }

    let maxAmount = 0;
    for (const cat of s.spendingByCategory) {
      if (cat.amount > maxAmount) {
        maxAmount = cat.amount;
      }
    }

    if (maxAmount <= 0) {
      return 0;
    }

    const percent = (amount / maxAmount) * 100;
    return Math.max(5, percent);
  }

  // Log user out
  logout() {
    this.bank.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
