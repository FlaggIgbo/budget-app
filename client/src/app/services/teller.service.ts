import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, from, of } from 'rxjs';

export interface TellerConfig {
  tellerApplicationId: string;
  tellerEnvironment: string;
  authSandbox?: { phone: string; otp: string };
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
  available?: number;
  ledger?: number;
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

@Injectable({ providedIn: 'root' })
export class TellerService {
  constructor(private api: ApiService) {}

  getConfig(): Observable<TellerConfig> {
    return this.api.get<TellerConfig>('/config');
  }

  listEnrollments(): Observable<TellerEnrollment[]> {
    return this.api.get<TellerEnrollment[]>('/teller/enrollments');
  }

  getAccounts(enrollmentId: string): Observable<TellerAccount[]> {
    return this.api.get<TellerAccount[]>(`/teller/enrollments/${enrollmentId}/accounts`);
  }

  getBalances(accountId: string, enrollmentId: string): Observable<TellerBalance> {
    return this.api.get<TellerBalance>(
      `/teller/accounts/${accountId}/balances?enrollmentId=${encodeURIComponent(enrollmentId)}`
    );
  }

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

  deleteEnrollment(enrollmentId: string): Observable<void> {
    return this.api.delete<void>(`/teller/enrollments/${enrollmentId}`);
  }

  /** Load Teller Connect script. */
  loadTellerConnect(): Observable<void> {
    if (typeof window === 'undefined') return of(undefined);
    if (window.TellerConnect) return of(undefined);

    return from(
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.teller.io/connect/connect.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Teller Connect'));
        document.body.appendChild(script);
      })
    );
  }

  /** Open Teller Connect. Caller provides onSuccess/onExit. */
  openConnect(config: TellerConnectConfig): void {
    if (!window.TellerConnect) {
      this.loadTellerConnect().subscribe({
        next: () => this.openConnect(config),
        error: (err) => console.error('Teller Connect load failed', err),
      });
      return;
    }
    const setupConfig: TellerConnectConfig = {
      applicationId: config.applicationId,
      environment: config.environment || 'sandbox',
      products: config.products || ['balance', 'transactions', 'verify'],
      onSuccess: config.onSuccess,
      ...(typeof config.onExit === 'function' && { onExit: config.onExit }),
      ...(typeof config.onInit === 'function' && { onInit: config.onInit }),
    };

    const instance = window.TellerConnect.setup(setupConfig);
    instance.open();
  }
}
