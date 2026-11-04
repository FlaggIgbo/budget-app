import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Observable, from, of } from 'rxjs';

export interface BankConfig {
  tellerApplicationId: string;
  tellerEnvironment: string;
  authSandbox?: { email: string; otp: string };
}

export interface BankEnrollment {
  id: string;
  enrollmentId: string;
  institutionName: string;
  createdAt: string;
}

export interface BankAccountItem {
  id: string;
  enrollment_id: string;
  institution: { id: string; name: string };
  type: string;
  subtype: string;
  name: string;
  last_four: string;
  currency: string;
  status: string;
  links?: { balances?: string; transactions?: string };
}

export interface BankBalance {
  available?: number | string;
  ledger?: number | string;
}

export interface NetWorthResponse {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  accounts: {
    id: string;
    name: string;
    lastFour: string;
    type: string;
    subtype: string;
    institutionName: string | null;
    balance: number;
    isAsset: boolean;
  }[];
}

export interface DashboardSummaryResponse {
  incomeVsExpenses: { month: string; income: number; expenses: number }[];
  spendingByCategory: { category: string; amount: number }[];
  recentTransactions: {
    id: string;
    date: string;
    description: string;
    amount: number;
    category: string | null;
    accountName: string;
    institutionName: string | null;
  }[];
  quickStats: {
    thisMonthIncome: number;
    thisMonthExpenses: number;
    lastMonthIncome: number;
    lastMonthExpenses: number;
    ytdIncome: number;
    ytdExpenses: number;
    momIncomeChangePct: number | null;
    momExpensesChangePct: number | null;
  };
}

export interface BankConnectConfig {
  applicationId: string;
  environment?: string;
  products?: string[];
  onSuccess: (enrollment: {
    accessToken: string;
    enrollment?: { id: string; institution?: { name: string } };
  }) => void;
  onExit?: () => void;
  onInit?: () => void;
}

export interface BankConnectInstance {
  open: () => void;
}

declare global {
  interface Window {
    TellerConnect?: {
      setup: (config: BankConnectConfig) => BankConnectInstance;
    };
  }
}

// Feature service for bank connections, accounts, and dashboard insights
@Injectable({ providedIn: 'root' })
export class BankService {
  constructor(
    private api: ApiService,
    private auth: AuthService
  ) {}

  // Check API health status
  getHealthStatus(): Observable<{ status: string }> {
    return this.api.get<{ status: string }>('/health');
  }

  // Get bank provider configuration
  getConfig(): Observable<BankConfig> {
    return this.api.get<BankConfig>('/config');
  }

  // Get net worth calculation
  getNetWorth(): Observable<NetWorthResponse> {
    return this.api.get<NetWorthResponse>('/bank/net-worth');
  }

  // Get dashboard charts and statistics
  getDashboardSummary(months?: number): Observable<DashboardSummaryResponse> {
    const path = months ? `/bank/dashboard-summary?months=${months}` : '/bank/dashboard-summary';
    return this.api.get<DashboardSummaryResponse>(path);
  }

  // List connected bank enrollments
  listEnrollments(): Observable<BankEnrollment[]> {
    return this.api.get<BankEnrollment[]>('/bank/enrollments');
  }

  // Get accounts for a bank
  getAccounts(enrollmentId: string): Observable<BankAccountItem[]> {
    return this.api.get<BankAccountItem[]>(`/bank/enrollments/${enrollmentId}/accounts`);
  }

  // Get balance for an account
  getBalances(accountId: string, enrollmentId: string): Observable<BankBalance> {
    return this.api.get<BankBalance>(
      `/bank/accounts/${accountId}/balances?enrollmentId=${encodeURIComponent(enrollmentId)}`
    );
  }

  // Get transactions for an account
  getTransactions(
    accountId: string,
    enrollmentId: string,
    params?: { count?: number; from_date?: string; to_date?: string }
  ): Observable<unknown[]> {
    let url = `/bank/accounts/${accountId}/transactions?enrollmentId=${encodeURIComponent(enrollmentId)}`;
    if (params?.count) url += `&count=${params.count}`;
    if (params?.from_date) url += `&from_date=${params.from_date}`;
    if (params?.to_date) url += `&to_date=${params.to_date}`;
    return this.api.get<unknown[]>(url);
  }

  // Save bank connection
  createEnrollment(
    accessToken: string,
    enrollmentId: string,
    institutionName?: string
  ): Observable<BankEnrollment> {
    return this.api.post<BankEnrollment>('/bank/enrollments', {
      accessToken,
      enrollmentId,
      institutionName,
    });
  }

  // Disconnect bank
  deleteEnrollment(enrollmentId: string): Observable<void> {
    return this.api.delete<void>(`/bank/enrollments/${enrollmentId}`);
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }

  // Load bank connection widget script
  loadConnectWidget(): Observable<void> {
    if (typeof window === 'undefined') return of(undefined);
    if (window.TellerConnect) return of(undefined);

    return from(
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.teller.io/connect/connect.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load bank connect script'));
        document.body.appendChild(script);
      })
    );
  }

  // Open the bank connection popup dialog
  openConnect(config: BankConnectConfig): void {
    if (!window.TellerConnect) {
      this.loadConnectWidget().subscribe({
        next: () => this.openConnect(config),
        error: (err) => console.error('Error loading bank connect popup:', err),
      });
      return;
    }

    const instance = window.TellerConnect.setup({
      applicationId: config.applicationId,
      environment: config.environment || 'sandbox',
      products: config.products || ['balance', 'transactions', 'verify'],
      onSuccess: config.onSuccess,
      onExit: config.onExit,
      onInit: config.onInit,
    });

    instance.open();
  }
}
