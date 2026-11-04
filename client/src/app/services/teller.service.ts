import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, from, of } from 'rxjs';

export interface TellerConfig {
  tellerApplicationId: string;
  tellerEnvironment: string;
  authSandbox?: { email: string; otp: string };
}

export interface TellerEnrollment {
  id: string;
  enrollmentId: string;
  institutionName: string;
  createdAt: string;
}

export interface TellerAccount {
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

export interface TellerBalance {
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

declare global {
  interface Window {
    TellerConnect?: {
      setup: (config: TellerConnectConfig) => TellerConnectInstance;
    };
  }
}

export interface TellerConnectConfig {
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

export interface TellerConnectInstance {
  open: () => void;
}

// Service to communicate with Teller bank endpoints
@Injectable({ providedIn: 'root' })
export class TellerService {
  constructor(private api: ApiService) {}

  // Get Teller settings
  getConfig(): Observable<TellerConfig> {
    return this.api.get<TellerConfig>('/config');
  }

  // Get net worth calculation
  getNetWorth(): Observable<NetWorthResponse> {
    return this.api.get<NetWorthResponse>('/teller/net-worth');
  }

  // Get dashboard charts and statistics
  getDashboardSummary(months?: number): Observable<DashboardSummaryResponse> {
    const path = months
      ? `/teller/dashboard-summary?months=${months}`
      : '/teller/dashboard-summary';
    return this.api.get<DashboardSummaryResponse>(path);
  }

  // List connected bank enrollments
  listEnrollments(): Observable<TellerEnrollment[]> {
    return this.api.get<TellerEnrollment[]>('/teller/enrollments');
  }

  // Get accounts for a bank
  getAccounts(enrollmentId: string): Observable<TellerAccount[]> {
    return this.api.get<TellerAccount[]>(`/teller/enrollments/${enrollmentId}/accounts`);
  }

  // Get balance for an account
  getBalances(accountId: string, enrollmentId: string): Observable<TellerBalance> {
    return this.api.get<TellerBalance>(
      `/teller/accounts/${accountId}/balances?enrollmentId=${encodeURIComponent(enrollmentId)}`
    );
  }

  // Get transactions for an account
  getTransactions(
    accountId: string,
    enrollmentId: string,
    params?: { count?: number; from_date?: string; to_date?: string }
  ): Observable<unknown[]> {
    let url = `/teller/accounts/${accountId}/transactions?enrollmentId=${encodeURIComponent(enrollmentId)}`;
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
  ): Observable<TellerEnrollment> {
    return this.api.post<TellerEnrollment>('/teller/enrollments', {
      accessToken,
      enrollmentId,
      institutionName,
    });
  }

  // Disconnect bank
  deleteEnrollment(enrollmentId: string): Observable<void> {
    return this.api.delete<void>(`/teller/enrollments/${enrollmentId}`);
  }

  // Load Teller Connect script
  loadTellerConnect(): Observable<void> {
    if (typeof window === 'undefined') return of(undefined);
    if (window.TellerConnect) return of(undefined);

    return from(
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.teller.io/connect/connect.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Teller Connect script'));
        document.body.appendChild(script);
      })
    );
  }

  // Open the Teller popup dialog
  openConnect(config: TellerConnectConfig): void {
    if (!window.TellerConnect) {
      this.loadTellerConnect().subscribe({
        next: () => this.openConnect(config),
        error: (err) => console.error('Error loading Teller popup:', err),
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
