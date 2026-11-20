import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export const OFFLINE_DB_NAME = 'budget-app-offline-db';
export const OFFLINE_DB_VERSION = 2;
export const MUTATION_STORE = 'mutation_queue';
export const PUSH_STATE_STORE = 'push_state';
export const OFFLINE_SYNC_TAG = 'budget-app-offline-queue';
const MAX_RETRIES = 5;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Auth, OTP, passkey, and ephemeral Plaid Link token endpoints must not be queued offline
const EXCLUDED_QUEUE_PREFIXES = [
  '/api/auth/',
  '/api/otp/',
  '/api/profile/contact/',
  '/api/profile/passkey',
  '/api/bank/link-token',
  '/api/bank/exchange-token',
];

export interface QueuedMutation {
  id?: number;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body: unknown;
  headers: Record<string, string>;
  createdAt: number;
  retries: number;
}

export interface QueuedMutationResponse {
  ok: true;
  queued: true;
  queueId: number;
  message: string;
}

export interface ReplayedMutationItem {
  id?: number;
  url: string;
  method: string;
  status: number;
  responseBody?: unknown;
}

export interface DroppedMutationItem {
  id?: number;
  url: string;
  method: string;
  status: number;
}

export interface OfflineQueueReplayResult {
  replayed: ReplayedMutationItem[];
  dropped: DroppedMutationItem[];
  pendingCount: number;
}

interface SyncManagerLike {
  register(tag: string): Promise<void>;
}

interface ServiceWorkerRegistrationWithSync extends ServiceWorkerRegistration {
  sync?: SyncManagerLike;
}

// IndexedDB-backed offline mutation queue with Service Worker Background Sync & online-event replay
@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly isOnlineSignal = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  private readonly pendingCountSignal = signal<number>(0);
  private readonly syncingSignal = signal<boolean>(false);
  private readonly replayedSubject = new Subject<OfflineQueueReplayResult>();

  private activeFlushPromise: Promise<OfflineQueueReplayResult> | null = null;
  private memoryFallback: QueuedMutation[] = [];
  private memoryIdSeq = 1;

  readonly isOnline = this.isOnlineSignal.asReadonly();
  readonly pendingCount = this.pendingCountSignal.asReadonly();
  readonly syncing = this.syncingSignal.asReadonly();
  readonly replayed$ = this.replayedSubject.asObservable();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnlineSignal.set(true);
        void this.flushQueue();
      });

      window.addEventListener('offline', () => {
        this.isOnlineSignal.set(false);
      });

      if ('serviceWorker' in navigator && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as
            | ({ type: 'OFFLINE_QUEUE_UPDATED'; pendingCount?: number } & Record<string, unknown>)
            | ({ type: 'OFFLINE_QUEUE_REPLAYED' } & OfflineQueueReplayResult)
            | null;
          if (!data || typeof data !== 'object') {
            return;
          }

          if (data.type === 'OFFLINE_QUEUE_UPDATED' && typeof data.pendingCount === 'number') {
            this.pendingCountSignal.set(data.pendingCount);
          } else if (data.type === 'OFFLINE_QUEUE_REPLAYED') {
            this.pendingCountSignal.set(data.pendingCount ?? 0);
            this.syncingSignal.set(false);
            this.replayedSubject.next({
              replayed: data.replayed ?? [],
              dropped: data.dropped ?? [],
              pendingCount: data.pendingCount ?? 0,
            });
          }
        });
      }

      void this.initializeQueueState();
    }
  }

  private async initializeQueueState(): Promise<void> {
    const count = await this.refreshCount();
    if (count > 0 && this.isOnlineSignal()) {
      await this.flushQueue();
    }
  }

  isQueueableRequest(method: string, pathOrUrl: string): boolean {
    const upperMethod = String(method || '').toUpperCase();
    if (!WRITE_METHODS.has(upperMethod)) {
      return false;
    }

    let pathname = pathOrUrl;
    try {
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        pathname = new URL(pathOrUrl).pathname;
      }
    } catch {
      pathname = pathOrUrl;
    }

    if (!pathname.startsWith('/api/')) {
      return false;
    }

    return !EXCLUDED_QUEUE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }

  private hasIndexedDb(): boolean {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MUTATION_STORE)) {
          const store = db.createObjectStore(MUTATION_STORE, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('by_createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(PUSH_STATE_STORE)) {
          db.createObjectStore(PUSH_STATE_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async enqueue(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body: unknown = null,
    headers: Record<string, string> = {}
  ): Promise<QueuedMutationResponse> {
    const record: QueuedMutation = {
      url,
      method,
      body: method === 'DELETE' ? null : body,
      headers:
        method !== 'DELETE' && !headers['Content-Type']
          ? { 'Content-Type': 'application/json', ...headers }
          : { ...headers },
      createdAt: Date.now(),
      retries: 0,
    };

    const queueId = await this.addRecord(record);
    await this.refreshCount();
    await this.registerBackgroundSync();

    return {
      ok: true,
      queued: true,
      queueId,
      message:
        'You appear to be offline. This action was saved and will sync automatically when connectivity returns.',
    };
  }

  async listQueued(): Promise<QueuedMutation[]> {
    if (!this.hasIndexedDb()) {
      return [...this.memoryFallback];
    }

    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE, 'readonly');
      const store = tx.objectStore(MUTATION_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? (req.result as QueuedMutation[]) : [];
        items.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async refreshCount(): Promise<number> {
    try {
      const items = await this.listQueued();
      this.pendingCountSignal.set(items.length);
      return items.length;
    } catch {
      return this.pendingCountSignal();
    }
  }

  async clearQueue(): Promise<void> {
    if (!this.hasIndexedDb()) {
      this.memoryFallback = [];
      this.pendingCountSignal.set(0);
      return;
    }

    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE, 'readwrite');
      const store = tx.objectStore(MUTATION_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    this.pendingCountSignal.set(0);
  }

  async registerBackgroundSync(): Promise<boolean> {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !navigator.serviceWorker ||
      typeof navigator.serviceWorker.getRegistration !== 'function'
    ) {
      return false;
    }

    try {
      const registration = (await navigator.serviceWorker.getRegistration()) as
        | ServiceWorkerRegistrationWithSync
        | undefined;
      if (registration && registration.sync && typeof registration.sync.register === 'function') {
        await registration.sync.register(OFFLINE_SYNC_TAG);
        return true;
      }
    } catch {
      // Background Sync unavailable or denied; online event listener handles replay
    }
    return false;
  }

  // Replay queued mutations via active Service Worker (to prevent races with Background Sync)
  // or directly from IndexedDB when no Service Worker controller is active.
  async flushQueue(): Promise<OfflineQueueReplayResult> {
    if (this.activeFlushPromise) {
      return this.activeFlushPromise;
    }

    this.syncingSignal.set(true);
    this.activeFlushPromise = (async () => {
      const swResult = await this.tryFlushViaServiceWorker();
      if (swResult) {
        this.pendingCountSignal.set(swResult.pendingCount);
        return swResult;
      }
      return await this.flushQueueDirectly();
    })().finally(() => {
      this.syncingSignal.set(false);
      this.activeFlushPromise = null;
    });

    return this.activeFlushPromise;
  }

  private tryFlushViaServiceWorker(): Promise<OfflineQueueReplayResult | null> {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !navigator.serviceWorker?.controller ||
      typeof MessageChannel === 'undefined'
    ) {
      return Promise.resolve(null);
    }

    const controller = navigator.serviceWorker.controller;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeoutId = setTimeout(() => resolve(null), 5000);

      channel.port1.onmessage = (event: MessageEvent) => {
        clearTimeout(timeoutId);
        const payload = event.data as { ok?: boolean; result?: OfflineQueueReplayResult } | null;
        if (payload?.ok && payload.result) {
          resolve(payload.result);
        } else {
          resolve(null);
        }
      };

      try {
        controller.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' }, [channel.port2]);
      } catch {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  }

  async flushQueueDirectly(): Promise<OfflineQueueReplayResult> {
    const items = await this.listQueued();
    const replayed: ReplayedMutationItem[] = [];
    const dropped: DroppedMutationItem[] = [];

    for (const item of items) {
      const headers: Record<string, string> = { ...(item.headers || {}) };
      const init: RequestInit = {
        method: item.method,
        credentials: 'include',
        headers,
      };
      if (item.body !== null && item.body !== undefined && item.method !== 'DELETE') {
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        init.body = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
      }

      try {
        const res = await fetch(item.url, init);
        if (res.ok) {
          let responseBody: unknown = null;
          try {
            responseBody = await res.clone().json();
          } catch {
            responseBody = null;
          }
          if (item.id !== undefined) {
            await this.deleteRecord(item.id);
          }
          replayed.push({
            id: item.id,
            url: item.url,
            method: item.method,
            status: res.status,
            responseBody,
          });
          continue;
        }

        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          if (item.id !== undefined) {
            await this.deleteRecord(item.id);
          }
          dropped.push({
            id: item.id,
            url: item.url,
            method: item.method,
            status: res.status,
          });
          continue;
        }

        const nextRetries = (item.retries || 0) + 1;
        if (nextRetries >= MAX_RETRIES) {
          if (item.id !== undefined) {
            await this.deleteRecord(item.id);
          }
          dropped.push({
            id: item.id,
            url: item.url,
            method: item.method,
            status: res.status,
          });
        } else {
          await this.updateRecord({ ...item, retries: nextRetries });
          break;
        }
      } catch {
        // Still offline; preserve queue order for next reconnect
        break;
      }
    }

    const pendingCount = await this.refreshCount();
    const result: OfflineQueueReplayResult = { replayed, dropped, pendingCount };
    if (replayed.length > 0 || dropped.length > 0) {
      this.replayedSubject.next(result);
    }
    return result;
  }

  private async addRecord(record: QueuedMutation): Promise<number> {
    if (!this.hasIndexedDb()) {
      const id = this.memoryIdSeq++;
      this.memoryFallback.push({ ...record, id });
      return id;
    }

    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE, 'readwrite');
      const store = tx.objectStore(MUTATION_STORE);
      const req = store.add(record);
      req.onsuccess = () => resolve(Number(req.result));
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  private async updateRecord(record: QueuedMutation): Promise<void> {
    if (!this.hasIndexedDb()) {
      this.memoryFallback = this.memoryFallback.map((item) =>
        item.id === record.id ? record : item
      );
      return;
    }

    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE, 'readwrite');
      const store = tx.objectStore(MUTATION_STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  private async deleteRecord(id: number): Promise<void> {
    if (!this.hasIndexedDb()) {
      this.memoryFallback = this.memoryFallback.filter((item) => item.id !== id);
      return;
    }

    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MUTATION_STORE, 'readwrite');
      const store = tx.objectStore(MUTATION_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
}
