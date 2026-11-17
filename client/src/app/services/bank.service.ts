import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Observable, from, of } from 'rxjs';

export interface BankConfig {
  plaidConfigured: boolean;
  plaidEnvironment: string;
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
  enrollment_id?: string;
  institution?: { id: string; name: string };
  type: string;
  subtype: string;
  name: string;
  last_four: string;
  currency?: string;
  status?: string;
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

export interface PlaidLinkMetadata {
  institution?: {
    name?: string;
    institution_id?: string;
  };
  link_session_id?: string;
}

export interface BankConnectConfig {
  linkToken: string;
  onSuccess: (publicToken: string, metadata?: PlaidLinkMetadata) => void;
  onExit?: () => void;
}

export interface PlaidHandlerInstance {
  open: () => void;
  exit?: () => void;
  destroy?: () => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        onExit?: () => void;
      }) => PlaidHandlerInstance;
    };
  }
}

// ============================================================================
// BANK SERVICE (FRONTEND)
// Connects the Browser (Plaid Link UI & Finance Dashboard) to the API Server
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

  // Get Plaid public configuration
  getConfig(): Observable<BankConfig> {
    return this.api.get<BankConfig>('/config');
  }

  // POST /bank/link-token -> Create a short-lived Plaid Link token
  createLinkToken(): Observable<{ link_token: string }> {
    return this.api.post<{ link_token: string }>('/bank/link-token', {});
  }

  // POST /bank/exchange-token -> Exchange public_token, store encrypted access_token & sync
  exchangeToken(
    publicToken: string,
    enrollmentId?: string,
    institutionName?: string
  ): Observable<BankEnrollment> {
    return this.api.post<BankEnrollment>('/bank/exchange-token', {
      public_token: publicToken,
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

  // Disconnect bank (calls Disconnect Handler -> Plaid POST /item/remove + DB cascade delete)
  deleteEnrollment(enrollmentId: string): Observable<void> {
    return this.api.delete<void>(`/bank/enrollments/${enrollmentId}`);
  }

  // Log user out
  logout(): Observable<{ ok: boolean }> {
    return this.auth.logout();
  }

  // Load Plaid Link UI widget script from Plaid CDN
  loadConnectWidget(): Observable<void> {
    if (typeof window === 'undefined') return of(undefined);
    if (window.Plaid) return of(undefined);

    return from(
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Plaid Link script'));
        document.body.appendChild(script);
      })
    );
  }

  // Open Plaid Link UI modal (Select institution, login, consent)
  openConnect(config: BankConnectConfig): void {
    if (!window.Plaid) {
      this.loadConnectWidget().subscribe({
        next: () => this.openConnect(config),
        error: (err) => console.error('Error loading Plaid Link popup:', err),
      });
      return;
    }

    const handler = window.Plaid.create({
      token: config.linkToken,
      onSuccess: (publicToken, metadata) => config.onSuccess(publicToken, metadata),
      onExit: config.onExit,
    });

    handler.open();
  }
}
