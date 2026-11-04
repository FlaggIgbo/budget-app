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
  syncCursor?: string | null;
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

export interface StoredTransaction {
  id: string;
  transactionId?: string;
  accountId?: string;
  enrollmentId?: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  accountName: string;
  institutionName: string | null;
}

export interface NetWorthResponse {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  accounts: {
    id: string;
    enrollmentId?: string;
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
  recentTransactions: StoredTransaction[];
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

// ============================================================================
// BANK SERVICE (FRONTEND)
// Connects the Browser (Teller Connect UI & Finance Dashboard) to the API Server
// ============================================================================
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

  // Get Teller public configuration
  getConfig(): Observable<BankConfig> {
    return this.api.get<BankConfig>('/config');
  }

  // POST /bank/exchange-token -> Store encrypted access_token in Secrets Vault & sync
  exchangeToken(
    accessToken: string,
    enrollmentId: string,
    institutionName?: string
  ): Observable<BankEnrollment> {
    return this.api.post<BankEnrollment>('/bank/exchange-token', {
      accessToken,
      enrollmentId,
      institutionName,
    });
  }

  // POST /bank/transactions/sync -> Trigger Sync Worker (Balances + transactions/sync)
  syncTransactions(enrollmentId?: string): Observable<{ synced: unknown[] }> {
    const body = enrollmentId ? { enrollmentId } : {};
    return this.api.post<{ synced: unknown[] }>('/bank/transactions/sync', body);
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

  // Get accounts for a specific bank enrollment
  getAccounts(enrollmentId: string): Observable<BankAccountItem[]> {
    return this.api.get<BankAccountItem[]>(`/bank/enrollments/${enrollmentId}/accounts`);
  }

  // Disconnect bank (calls Disconnect Handler -> Teller DELETE /accounts + DB cascade delete)
  deleteEnrollment(enrollmentId: string): Observable<void> {
    return this.api.delete<void>(`/bank/enrollments/${enrollmentId}`);
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }

  // Load Teller Connect UI widget script from Teller CDN
  loadConnectWidget(): Observable<void> {
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

  // Open Teller Connect UI modal (Select institution, login, consent)
  openConnect(config: BankConnectConfig): void {
    if (!window.TellerConnect) {
      this.loadConnectWidget().subscribe({
        next: () => this.openConnect(config),
        error: (err) => console.error('Error loading Teller Connect popup:', err),
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
