import { Component, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  TellerService,
  NetWorthResponse,
  DashboardSummaryResponse,
} from '../../services/teller.service';

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
          @if (nw.accounts && nw.accounts.length > 0) {
            <ul class="account-list">
              @for (a of nw.accounts; track a.id) {
                <li class="account-item">
                  <span class="name">{{ a.name }} ({{ a.institutionName || 'Bank' }})</span>
                  <span class="balance" [class.liability]="!a.isAsset">{{
                    a.balance | currency
                  }}</span>
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

      @if (summary(); as s) {
        <section class="income-expenses">
          <h2>Income vs. Expenses</h2>
          <p class="section-desc">Monthly cash flow</p>
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
        </section>

        <section class="spending-category">
          <h2>Spending by Category</h2>
          <p class="section-desc">This month</p>
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
        </section>

        @if (s.quickStats) {
          <section class="quick-stats">
            <h2>Quick Stats</h2>
            <div class="stats-grid">
              <div class="stat-card">
                <span class="stat-label">This month</span>
                <span class="stat-income">+{{ s.quickStats.thisMonthIncome | currency }}</span>
                <span class="stat-expense">-{{ s.quickStats.thisMonthExpenses | currency }}</span>
              </div>
              <div class="stat-card">
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
              </div>
              <div class="stat-card">
                <span class="stat-label">YTD</span>
                <span class="stat-income">+{{ s.quickStats.ytdIncome | currency }}</span>
                <span class="stat-expense">-{{ s.quickStats.ytdExpenses | currency }}</span>
              </div>
            </div>
          </section>
        }

        <section class="recent-transactions">
          <h2>Recent Transactions</h2>
          <div class="filter-row">
            <label for="cat-filter">Filter by category:</label>
            <select id="cat-filter" [value]="categoryFilter()" (change)="onCategoryFilter($event)">
              <option value="">All</option>
              @for (c of categoryOptions(); track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
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
        </section>
      } @else if (summaryError()) {
        <p class="error">Could not load dashboard summary.</p>
      } @else if (!netWorthError()) {
        <p class="loading">Loading dashboard…</p>
      }

      <a routerLink="/accounts" class="link-accounts">Connect bank or credit card →</a>
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
        max-width: 800px;
        margin: 0 auto;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
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
        margin-bottom: 2rem;
      }
      .net-worth h2,
      .income-expenses h2,
      .spending-category h2,
      .quick-stats h2,
      .recent-transactions h2 {
        font-size: 1rem;
        color: #64748b;
        margin: 0 0 0.25rem;
        font-weight: 500;
      }
      .section-desc {
        font-size: 0.85rem;
        color: #94a3b8;
        margin: 0 0 0.75rem;
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
      .error,
      .empty {
        color: #64748b;
        margin-bottom: 1rem;
      }
      .error {
        color: #dc2626;
      }
      .income-expenses,
      .spending-category,
      .quick-stats,
      .recent-transactions {
        margin-bottom: 2rem;
      }
      .bar-chart {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .bar-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .bar-label {
        width: 5rem;
        font-size: 0.85rem;
      }
      .bar-track {
        flex: 1;
        display: flex;
        height: 1.25rem;
        background: #f1f5f9;
        border-radius: 4px;
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
        color: #64748b;
      }
      .category-bars {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .cat-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .cat-name {
        width: 7rem;
        font-size: 0.9rem;
      }
      .cat-bar-wrap {
        flex: 1;
        height: 1rem;
        background: #f1f5f9;
        border-radius: 4px;
        overflow: hidden;
      }
      .cat-bar {
        height: 100%;
        background: #6366f1;
        border-radius: 4px;
      }
      .cat-amt {
        width: 5rem;
        font-size: 0.9rem;
        text-align: right;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1rem;
      }
      .stat-card {
        padding: 1rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .stat-label {
        font-size: 0.8rem;
        color: #64748b;
      }
      .stat-income {
        color: #16a34a;
        font-weight: 600;
      }
      .stat-expense {
        color: #dc2626;
        font-weight: 600;
      }
      .stat-pct.up {
        color: #16a34a;
      }
      .stat-pct.down {
        color: #dc2626;
      }
      .filter-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }
      .filter-row select {
        padding: 0.35rem 0.5rem;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }
      .txn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      .txn-item {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #f1f5f9;
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
      .txn-date {
        font-size: 0.8rem;
        color: #64748b;
      }
      .txn-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
      }
      .txn-cat {
        font-size: 0.8rem;
        color: #64748b;
      }
      .txn-amt.income {
        color: #16a34a;
      }
      .txn-amt.expense {
        color: #dc2626;
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

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private teller: TellerService
  ) {
    // Check API health status
    this.api.get<{ status: string }>('/health').subscribe({
      next: (res) => this.apiStatus.set(res.status),
      error: () => this.apiStatus.set('error'),
    });
  }

  ngOnInit() {
    // 1. Load net worth
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

    // 2. Load dashboard summary
    this.teller.getDashboardSummary().subscribe({
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
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
