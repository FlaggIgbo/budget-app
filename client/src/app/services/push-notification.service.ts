import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import {
  MUTATION_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  PUSH_STATE_STORE,
} from './offline-queue.service';

export interface StoredPushSubscriptionSummary {
  id: string;
  endpoint: string;
  expirationTime: number | null;
  userAgent: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface PushStatusResponse {
  count: number;
  subscriptions: StoredPushSubscriptionSummary[];
}

export interface VapidKeyResponse {
  configured: boolean;
  vapidPublicKey: string | null;
}

export interface PushTestResponse {
  ok: boolean;
  jobId: string;
  queued?: boolean;
  delivery?: {
    status: string;
    deliveredCount: number;
    prunedCount: number;
  } | null;
}

// Manages Web Push notifications using native MDN Web APIs only:
// - ServiceWorkerRegistration.pushManager & PushSubscription (Push API)
// - Notification API (Notification.permission / Notification.requestPermission)
// - IndexedDB API (persists VAPID public key + endpoint metadata for SW pushsubscriptionchange)
@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  readonly isSupported = signal<boolean>(this.detectSupport());
  readonly permission = signal<NotificationPermission>(this.readNotificationPermission());
  readonly isSubscribed = signal<boolean>(false);
  readonly subscriptionCount = signal<number>(0);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  constructor(private api: ApiService) {}

  private detectSupport(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  private readNotificationPermission(): NotificationPermission {
    if (typeof Notification === 'undefined') {
      return 'default';
    }
    return Notification.permission;
  }

  // Convert a base64url VAPID public key into a Uint8Array for PushManager.subscribe({ applicationServerKey })
  urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const buffer = new ArrayBuffer(rawData.length);
    const outputArray = new Uint8Array(buffer);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  private openOfflineDb(): Promise<IDBDatabase> {
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

  // Persist VAPID key / local subscription metadata in native IndexedDB for SW pushsubscriptionchange
  async savePushStateInIndexedDb(key: string, value: unknown): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }
    try {
      const db = await this.openOfflineDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PUSH_STATE_STORE, 'readwrite');
        const store = tx.objectStore(PUSH_STATE_STORE);
        const req = store.put({ key, value, updatedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    } catch {
      // Non-fatal: Push API works even if IndexedDB is unavailable in private browsing
    }
  }

  private async getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
    if (!this.detectSupport()) {
      throw new Error('Push notifications are not supported in this browser.');
    }
    return await navigator.serviceWorker.ready;
  }

  // Refresh local PushManager subscription state and PostgreSQL device count
  async refreshStatus(): Promise<void> {
    this.isSupported.set(this.detectSupport());
    this.permission.set(this.readNotificationPermission());

    if (this.isSupported()) {
      try {
        const registration = await this.getServiceWorkerRegistration();
        const existingSub = await registration.pushManager.getSubscription();
        this.isSubscribed.set(Boolean(existingSub));
      } catch {
        this.isSubscribed.set(false);
      }
    }

    try {
      const serverStatus = await firstValueFrom(
        this.api.get<PushStatusResponse>('/push/subscriptions')
      );
      this.subscriptionCount.set(serverStatus.count);
    } catch {
      // Ignore if offline or unauthenticated
    }
  }

  // Request Notification permission, create a native PushSubscription, and store it in PostgreSQL
  async subscribe(): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);

    try {
      if (!this.detectSupport()) {
        throw new Error('Push notifications are not supported on this device or browser.');
      }

      const permission = await Notification.requestPermission();
      this.permission.set(permission);
      if (permission !== 'granted') {
        throw new Error(
          permission === 'denied'
            ? 'Notification permission is blocked in your browser settings.'
            : 'Notification permission was not granted.'
        );
      }

      const vapidRes = await firstValueFrom(
        this.api.get<VapidKeyResponse>('/push/vapid-public-key')
      );
      if (!vapidRes.configured || !vapidRes.vapidPublicKey) {
        throw new Error('Push notifications are not configured on the server yet.');
      }

      await this.savePushStateInIndexedDb('vapidPublicKey', vapidRes.vapidPublicKey);

      const registration = await this.getServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(vapidRes.vapidPublicKey),
        });
      }

      // Use standard MDN PushSubscription.prototype.toJSON() serialization
      const subscriptionJson = subscription.toJSON();
      const saveRes = await firstValueFrom(
        this.api.post<{ ok: boolean; count?: number; queued?: boolean }>(
          '/push/subscribe',
          subscriptionJson
        )
      );

      await this.savePushStateInIndexedDb('lastEndpoint', subscription.endpoint);
      this.isSubscribed.set(true);
      if (typeof saveRes.count === 'number') {
        this.subscriptionCount.set(saveRes.count);
      } else {
        this.subscriptionCount.update((c) => Math.max(c, 1));
      }
      this.loading.set(false);
      return true;
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : (err as { error?: { error?: string } })?.error?.error ||
            'Failed to enable push notifications.';
      this.error.set(msg);
      this.loading.set(false);
      return false;
    }
  }

  // Unsubscribe via native PushSubscription.unsubscribe() and delete from PostgreSQL
  async unsubscribe(): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const registration = await this.getServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        const res = await firstValueFrom(
          this.api.post<{ ok: boolean; count?: number }>('/push/unsubscribe', { endpoint })
        );
        if (typeof res.count === 'number') {
          this.subscriptionCount.set(res.count);
        } else {
          this.subscriptionCount.update((c) => Math.max(0, c - 1));
        }
      }

      await this.savePushStateInIndexedDb('lastEndpoint', null);
      this.isSubscribed.set(false);
      this.loading.set(false);
      return true;
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : (err as { error?: { error?: string } })?.error?.error ||
            'Failed to disable push notifications.';
      this.error.set(msg);
      this.loading.set(false);
      return false;
    }
  }

  // Enqueue a test notification into RabbitMQ for this user's PostgreSQL PushSubscriptions
  async sendTestNotification(): Promise<PushTestResponse | null> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const res = await firstValueFrom(this.api.post<PushTestResponse>('/push/test', {}));
      this.loading.set(false);
      return res;
    } catch (err: unknown) {
      const msg =
        (err as { error?: { error?: string } })?.error?.error ||
        (err instanceof Error && err.message) ||
        'Failed to send test notification.';
      this.error.set(msg);
      this.loading.set(false);
      return null;
    }
  }
}
