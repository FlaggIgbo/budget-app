import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, from, tap, throwError } from 'rxjs';
import { OfflineQueueService } from './offline-queue.service';

// Helper service to send HTTP requests to the backend API with IndexedDB offline queueing
// for failed/offline non-auth write requests.
@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = '/api';
  private readonly options = { withCredentials: true };

  constructor(
    private http: HttpClient,
    private offlineQueue: OfflineQueueService
  ) {}

  // GET request
  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, this.options);
  }

  // POST request (queued in IndexedDB on network failure for non-auth endpoints)
  post<T>(path: string, body: unknown): Observable<T> {
    return this.sendWrite<T>('POST', path, body);
  }

  // PUT request (queued in IndexedDB on network failure for non-auth endpoints)
  put<T>(path: string, body: unknown): Observable<T> {
    return this.sendWrite<T>('PUT', path, body);
  }

  // PATCH request (queued in IndexedDB on network failure for non-auth endpoints)
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.sendWrite<T>('PATCH', path, body);
  }

  // DELETE request (queued in IndexedDB on network failure for non-auth endpoints)
  delete<T>(path: string): Observable<T> {
    return this.sendWrite<T>('DELETE', path, null);
  }

  private sendWrite<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown
  ): Observable<T> {
    const fullUrl = `${this.baseUrl}${path}`;
    const queueable = this.offlineQueue.isQueueableRequest(method, fullUrl);

    // If the browser is already offline and no Service Worker is controlling the page,
    // enqueue immediately into IndexedDB so the mutation is persisted without failing.
    const swControlling =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      Boolean(navigator.serviceWorker?.controller);

    if (queueable && typeof navigator !== 'undefined' && !navigator.onLine && !swControlling) {
      return from(this.offlineQueue.enqueue(method, fullUrl, body)) as Observable<T>;
    }

    let request$: Observable<T>;
    if (method === 'POST') {
      request$ = this.http.post<T>(fullUrl, body, this.options);
    } else if (method === 'PUT') {
      request$ = this.http.put<T>(fullUrl, body, this.options);
    } else if (method === 'PATCH') {
      request$ = this.http.patch<T>(fullUrl, body, this.options);
    } else {
      request$ = this.http.delete<T>(fullUrl, this.options);
    }

    if (!queueable) {
      return request$;
    }

    return request$.pipe(
      tap((res) => {
        // If Service Worker intercepted and returned synthetic 202 { queued: true }, sync pending count
        if (res && typeof res === 'object' && (res as { queued?: boolean }).queued === true) {
          void this.offlineQueue.refreshCount();
        }
      }),
      catchError((err: unknown) => {
        const httpErr = err as HttpErrorResponse;
        const isOfflineOrNetworkError =
          httpErr?.status === 0 || (typeof navigator !== 'undefined' && !navigator.onLine);
        if (isOfflineOrNetworkError) {
          return from(this.offlineQueue.enqueue(method, fullUrl, body)) as Observable<T>;
        }
        return throwError(() => err);
      })
    );
  }
}
