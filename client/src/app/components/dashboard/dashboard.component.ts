import { Component, signal, OnInit, computed } from '@angular/core';
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
        <h1>Budget App</h1>
        <div class="header-actions">
          <a mat-button routerLink="/profile" class="link-profile">
            <mat-icon>person</mat-icon>
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
      @if (netWorth(); as nw) {
        <mat-card appearance="outlined" class="section-card net-worth">
          <mat-card-header>
            <mat-card-title><h2>Net Worth</h2></mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p
              class="amount"
              [class.positive]="nw.netWorth >= 0"
              [class.negative]="nw.netWorth < 0"
            >
              {{ nw.netWorth | currency }}
            </p>
            <div class="breakdown">
              <mat-chip-set>
                <mat-chip>Assets: {{ nw.totalAssets | currency }}</mat-chip>
                <mat-chip>Liabilities: {{ nw.totalLiabilities | currency }}</mat-chip>
              </mat-chip-set>
            </div>
            @if (nw.accounts && nw.accounts.length > 0) {
              <mat-list class="account-list">
                @for (a of nw.accounts; track a.id) {
                  <mat-list-item class="account-item">
                    <span matListItemTitle class="name">
                      {{ a.name }} ({{ a.institutionName || 'Bank' }})
                    </span>
                    <span matListItemMeta class="balance" [class.liability]="!a.isAsset">
                      {{ a.balance | currency }}
                    </span>
                  </mat-list-item>
                }
              </mat-list>
            }
          </mat-card-content>
        </mat-card>
      } @else if (netWorthError()) {
        <p class="error">Could not load net worth. Connect a bank account to get started.</p>
      } @else {
        <div class="loading">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p>Loading net worth…</p>
        </div>
      }

      @if (summary(); as s) {
        <mat-card appearance="outlined" class="section-card income-expenses">
          <mat-card-header>
            <mat-card-title><h2>Income vs. Expenses</h2></mat-card-title>
            <mat-card-subtitle>Monthly cash flow</mat-card-subtitle>
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
            <mat-card-subtitle>This month</mat-card-subtitle>
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

        @if (s.quickStats) {
          <section class="quick-stats">
            <h2>Quick Stats</h2>
            <div class="stats-grid">
              <mat-card appearance="outlined" class="stat-card">
                <mat-card-content class="stat-content">
                  <span class="stat-label">This month</span>
                  <span class="stat-income">+{{ s.quickStats.thisMonthIncome | currency }}</span>
                  <span class="stat-expense">-{{ s.quickStats.thisMonthExpenses | currency }}</span>
                </mat-card-content>
              </mat-card>
              <mat-card appearance="outlined" class="stat-card">
                <mat-card-content class="stat-content">
                  <span class="stat-label">MoM change</span>
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
                </mat-card-content>
              </mat-card>
              <mat-card appearance="outlined" class="stat-card">
                <mat-card-content class="stat-content">
                  <span class="stat-label">YTD</span>
                  <span class="stat-income">+{{ s.quickStats.ytdIncome | currency }}</span>
                  <span class="stat-expense">-{{ s.quickStats.ytdExpenses | currency }}</span>
                </mat-card-content>
              </mat-card>
            </div>
          </section>
        }

        <mat-card appearance="outlined" class="section-card recent-transactions">
          <mat-card-header>
            <mat-card-title><h2>Recent Transactions</h2></mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="filter-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Filter by category</mat-label>
                <mat-select
                  id="cat-filter"
                  [value]="categoryFilter()"
                  (selectionChange)="categoryFilter.set($event.value)"
                >
                  <mat-option value="">All</mat-option>
                  @for (c of categoryOptions(); track c) {
                    <mat-option [value]="c">{{ c }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            @if (filteredTransactions() && filteredTransactions().length > 0) {
              <ul class="txn-list">
                @for (t of filteredTransactions(); track t.id) {
                  <li class="txn-item">
                    <div class="txn-main">
                      <span class="txn-desc">{{ t.description }}</span>
                      <span class="txn-date">{{ t.date }}</span>
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
                        {{ t.amount | currency }}
                      </span>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <p class="empty">No recent transactions.</p>
            }
          </mat-card-content>
        </mat-card>
      } @else if (summaryError()) {
        <p class="error">Could not load dashboard summary.</p>
      } @else if (!netWorthError()) {
        <div class="loading">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <p>Loading dashboard…</p>
        </div>
      }

      <div class="footer-row">
        <a mat-flat-button routerLink="/accounts" class="link-accounts">
          <mat-icon>account_balance</mat-icon>
          Connect bank or credit card →
        </a>
        @if (apiStatus(); as status) {
          <span class="api-status" [class.connected]="status === 'ok'">API: {{ status }}</span>
        }
      </div>
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
        max-width: 840px;
        margin: 0 auto;
      }
      .toolbar-inner h1 {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 600;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .dashboard {
        padding: 2rem 1.5rem;
        max-width: 840px;
        margin: 0 auto;
      }
      .section-card {
        margin-bottom: 1.5rem;
      }
      mat-card-header {
        margin-bottom: 0.75rem;
      }
      h2 {
        font-size: 1.05rem;
        margin: 0;
        font-weight: 500;
      }
      .net-worth .amount {
        font-size: 2.25rem;
        font-weight: 700;
        margin: 0.25rem 0 0.75rem;
      }
      .net-worth .amount.positive {
        color: #16a34a;
      }
      .net-worth .amount.negative {
        color: var(--mat-sys-error, #dc2626);
      }
      .breakdown {
        margin-bottom: 0.75rem;
      }
      .account-item .balance.liability {
        color: var(--mat-sys-error, #dc2626);
      }
      .loading,
      .error,
      .empty {
        color: var(--mat-sys-on-surface-variant, #64748b);
        margin-bottom: 1rem;
      }
      .error {
        color: var(--mat-sys-error, #dc2626);
      }
      .bar-chart,
      .category-bars {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        margin-top: 0.5rem;
      }
      .bar-row,
      .cat-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .bar-label {
        width: 5rem;
        font-size: 0.85rem;
      }
      .bar-track,
      .cat-bar-wrap {
        flex: 1;
        display: flex;
        height: 1.1rem;
        background: var(--mat-sys-surface-container, #f1f5f9);
        border-radius: 6px;
        overflow: hidden;
      }
      .bar.income {
        background: #22c55e;
      }
      .bar.expense {
        background: #ef4444;
      }
      .bar-values {
        width: 10rem;
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant, #64748b);
      }
      .cat-name {
        width: 7rem;
        font-size: 0.9rem;
      }
      .cat-bar {
        height: 100%;
        background: var(--mat-sys-primary, #6366f1);
        border-radius: 6px;
      }
      .cat-amt {
        width: 5rem;
        font-size: 0.9rem;
        text-align: right;
      }
      .quick-stats {
        margin-bottom: 1.5rem;
      }
      .quick-stats h2 {
        margin-bottom: 0.75rem;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
      }
      .stat-content {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .stat-label {
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant, #64748b);
      }
      .stat-income,
      .stat-pct.up {
        color: #16a34a;
        font-weight: 600;
      }
      .stat-expense,
      .stat-pct.down {
        color: var(--mat-sys-error, #dc2626);
        font-weight: 600;
      }
      .filter-row {
        margin: 0.5rem 0 1rem;
      }
      .txn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid var(--mat-sys-outline-variant, #e2e8f0);
        border-radius: 12px;
      }
      .txn-item {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--mat-sys-surface-container, #f1f5f9);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .txn-item:last-child {
        border-bottom: none;
      }
      .txn-main {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .txn-desc {
        font-weight: 500;
      }
      .txn-date,
      .txn-cat {
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant, #64748b);
      }
      .txn-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
      }
      .txn-amt.income {
        color: #16a34a;
        font-weight: 500;
      }
      .txn-amt.expense {
        color: var(--mat-sys-error, #dc2626);
        font-weight: 500;
      }
      .footer-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.5rem;
      }
      .api-status {
        color: var(--mat-sys-on-surface-variant, #666);
        font-size: 0.85rem;
      }
      .api-status.connected {
        color: #22c55e;
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

  // Get unique list of categories for filter dropdown
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

  // Filter transactions by selected category
  filteredTransactions = computed(() => {
    const s = this.summary();
    const filter = this.categoryFilter();
    if (!s || !s.recentTransactions) {
      return [];
    }
    if (!filter) {
      return s.recentTransactions;
    }

    const result = [];
    for (const t of s.recentTransactions) {
      if (t.category === filter) {
        result.push(t);
      }
    }
    return result;
  });

  constructor(private bank: BankService) {
    // Check API health status
    this.bank.getHealthStatus().subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });
  }

  ngOnInit() {
    // 1. Load net worth
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

    // 2. Load dashboard summary
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

  // Change category filter
  onCategoryFilter(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.categoryFilter.set(target?.value ?? '');
  }

  // Log user out
  logout() {
    this.bank.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
