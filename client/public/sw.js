// Budget App Service Worker — installable PWA app-shell caching, IndexedDB offline mutation queue
// with Background Sync API replay, and native W3C Web Push API notification handling.
const CACHE_NAME = 'budget-app-shell-v3';
const OFFLINE_DB_NAME = 'budget-app-offline-db';
const OFFLINE_DB_VERSION = 2;
const MUTATION_STORE = 'mutation_queue';
const PUSH_STATE_STORE = 'push_state';
const SYNC_TAG = 'budget-app-offline-queue';
const MAX_RETRIES = 5;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/fonts/material-icons.woff2',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Auth, OTP, passkey, and ephemeral Plaid Link token routes must never be queued for delayed replay
const EXCLUDED_QUEUE_PREFIXES = [
  '/api/auth/',
  '/api/otp/',
  '/api/profile/contact/',
  '/api/profile/passkey',
  '/api/bank/link-token',
  '/api/bank/exchange-token',
];

function isQueueableWriteRequest(method, pathname) {
  if (!WRITE_METHODS.has(String(method || '').toUpperCase())) {
    return false;
  }
  if (!pathname.startsWith('/api/')) {
    return false;
  }
  return !EXCLUDED_QUEUE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ============================================================================
// INDEXEDDB HELPERS (shared schema with Angular OfflineQueueService)
// ============================================================================
function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
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

async function getPushState(key) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STATE_STORE, 'readonly');
    const store = tx.objectStore(PUSH_STATE_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function setPushState(key, value) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STATE_STORE, 'readwrite');
    const store = tx.objectStore(PUSH_STATE_STORE);
    const req = store.put({ key, value, updatedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function urlBase64ToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function enqueueMutation(record) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUTATION_STORE, 'readwrite');
    const store = tx.objectStore(MUTATION_STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function getAllMutations() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUTATION_STORE, 'readonly');
    const store = tx.objectStore(MUTATION_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = Array.isArray(req.result) ? req.result : [];
      items.sort((a, b) => (a.id || 0) - (b.id || 0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function updateMutation(record) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUTATION_STORE, 'readwrite');
    const store = tx.objectStore(MUTATION_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function deleteMutation(id) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUTATION_STORE, 'readwrite');
    const store = tx.objectStore(MUTATION_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

let activeFlushPromise = null;

async function flushOfflineQueue() {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    const items = await getAllMutations();
    const replayed = [];
    const dropped = [];

    for (const item of items) {
      const headers = { ...(item.headers || {}) };
      const fetchInit = {
        method: item.method,
        credentials: 'include',
        headers,
      };
      if (item.body !== null && item.body !== undefined && item.method !== 'DELETE') {
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        fetchInit.body = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
      }

      try {
        const res = await fetch(item.url, fetchInit);
        if (res.ok) {
          let responseBody = null;
          try {
            responseBody = await res.clone().json();
          } catch {
            responseBody = null;
          }
          await deleteMutation(item.id);
          replayed.push({
            id: item.id,
            url: item.url,
            method: item.method,
            status: res.status,
            responseBody,
          });
          continue;
        }

        // Permanent 4xx client error (except 408 timeout / 429 rate limit): remove so queue is not blocked
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          await deleteMutation(item.id);
          dropped.push({
            id: item.id,
            url: item.url,
            method: item.method,
            status: res.status,
          });
          continue;
        }

        // Transient server error (5xx / 408 / 429): increment retry count and stop flush to preserve order
        const nextRetries = (item.retries || 0) + 1;
        if (nextRetries >= MAX_RETRIES) {
          await deleteMutation(item.id);
          dropped.push({ id: item.id, url: item.url, method: item.method, status: res.status });
        } else {
          await updateMutation({ ...item, retries: nextRetries });
          break;
        }
      } catch {
        // Still offline: keep item in IndexedDB and stop flushing until next sync / online event
        break;
      }
    }

    const remaining = await getAllMutations();
    const result = {
      replayed,
      dropped,
      pendingCount: remaining.length,
    };

    if (replayed.length > 0 || dropped.length > 0) {
      await notifyClients({ type: 'OFFLINE_QUEUE_REPLAYED', ...result });
    } else {
      await notifyClients({ type: 'OFFLINE_QUEUE_UPDATED', pendingCount: remaining.length });
    }

    return result;
  })().finally(() => {
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}

// ============================================================================
// SERVICE WORKER LIFECYCLE
// ============================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// Background Sync API replay trigger
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushOfflineQueue());
  }
});

// Window-triggered replay (online event / manual sync) via postMessage
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') {
    return;
  }

  if (data.type === 'FLUSH_OFFLINE_QUEUE') {
    const replyPort = event.ports && event.ports[0];
    event.waitUntil(
      flushOfflineQueue()
        .then((result) => {
          if (replyPort) {
            replyPort.postMessage({ ok: true, result });
          }
        })
        .catch((err) => {
          if (replyPort) {
            replyPort.postMessage({ ok: false, error: err?.message || 'Queue flush failed' });
          }
        })
    );
  }
});

// ============================================================================
// WEB PUSH API LISTENERS (push, notificationclick, pushsubscriptionchange)
// Uses native MDN Push API & Notification API + IndexedDB offline fallback.
// ============================================================================
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Budget App',
    body: 'You have a new update in Budget App.',
    url: '/dashboard',
    tag: 'budget-app-notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = { ...payload, ...parsed };
      }
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  const targetUrl = (payload.data && payload.data.url) || payload.url || '/dashboard';

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Budget App', {
      body: payload.body || '',
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-192x192.png',
      tag: payload.tag || 'budget-app-notification',
      data: {
        ...(payload.data || {}),
        url: targetUrl,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification && event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const targetAbsolute = new URL(targetUrl, self.location.origin).href;
      for (const client of windowClients) {
        if (client.url === targetAbsolute && 'focus' in client) {
          return client.focus();
        }
      }
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if (focused && 'navigate' in focused) {
              return focused.navigate(targetAbsolute);
            }
            return focused;
          });
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetAbsolute);
      }
      return undefined;
    })
  );
});

// Automatically re-subscribe when the browser rotates a PushSubscription endpoint
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let applicationServerKey =
        event.oldSubscription &&
        event.oldSubscription.options &&
        event.oldSubscription.options.applicationServerKey;

      if (!applicationServerKey) {
        try {
          const cachedKey = await getPushState('vapidPublicKey');
          if (typeof cachedKey === 'string' && cachedKey) {
            applicationServerKey = urlBase64ToUint8Array(cachedKey);
          }
        } catch {
          applicationServerKey = null;
        }
      }

      if (!applicationServerKey || !self.registration || !self.registration.pushManager) {
        return;
      }

      const newSubscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));

      const subscriptionJson = newSubscription.toJSON();
      try {
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscriptionJson),
        });
        if (!res.ok) {
          throw new Error(`Sync failed with status ${res.status}`);
        }
        await setPushState('lastEndpoint', newSubscription.endpoint);
      } catch {
        // Offline or transient error: persist in IndexedDB mutation_queue for Background Sync replay
        await enqueueMutation({
          url: '/api/push/subscribe',
          method: 'POST',
          body: subscriptionJson,
          headers: { 'Content-Type': 'application/json' },
          createdAt: Date.now(),
          retries: 0,
        });
        if (self.registration && 'sync' in self.registration) {
          try {
            await self.registration.sync.register(SYNC_TAG);
          } catch {
            // Online event will replay if Background Sync is unavailable
          }
        }
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Queue failed/offline non-auth write requests in IndexedDB and register Background Sync
  if (isQueueableWriteRequest(request.method, url.pathname)) {
    event.respondWith(
      (async () => {
        let serializedBody = null;
        if (request.method !== 'DELETE') {
          try {
            const rawText = await request.clone().text();
            if (rawText) {
              try {
                serializedBody = JSON.parse(rawText);
              } catch {
                serializedBody = rawText;
              }
            }
          } catch {
            serializedBody = null;
          }
        }

        try {
          return await fetch(request);
        } catch {
          const headers = {};
          const contentType = request.headers.get('content-type');
          if (contentType) {
            headers['Content-Type'] = contentType;
          }

          const queueId = await enqueueMutation({
            url: `${url.pathname}${url.search}`,
            method: request.method.toUpperCase(),
            body: serializedBody,
            headers,
            createdAt: Date.now(),
            retries: 0,
          });

          if (self.registration && 'sync' in self.registration) {
            try {
              await self.registration.sync.register(SYNC_TAG);
            } catch {
              // Ignore if Background Sync is unavailable or denied; online event will replay
            }
          }

          const allItems = await getAllMutations();
          await notifyClients({
            type: 'OFFLINE_QUEUE_UPDATED',
            pendingCount: allItems.length,
          });

          return new Response(
            JSON.stringify({
              ok: true,
              queued: true,
              queueId,
              message:
                'You appear to be offline. This action was saved and will sync automatically when connectivity returns.',
            }),
            {
              status: 202,
              statusText: 'Accepted',
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      })()
    );
    return;
  }

  // Never cache other API requests (GET /api/*, auth/passkey/OTP endpoints)
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // SPA navigation requests: network-first with cached index.html fallback when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
