import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PushNotificationService } from './push-notification.service';

describe('PushNotificationService (Native MDN Push API & PushSubscription)', () => {
  let service: PushNotificationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PushNotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('converts a base64url VAPID public key to Uint8Array for PushManager.subscribe()', () => {
    // 4 bytes [0x04, 0x01, 0x02, 0x03] -> base64url "BAECAw"
    const bytes = service.urlBase64ToUint8Array('BAECAw');
    expect(Array.from(bytes)).toEqual([4, 1, 2, 3]);
  });

  it('subscribes via native PushManager, serializes with PushSubscription.toJSON(), and persists to PostgreSQL', async () => {
    const mockSubJson: PushSubscriptionJSON = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/native_sub_1',
      expirationTime: null,
      keys: {
        p256dh: 'BOr7fakePublicKeyValue',
        auth: 'fakeAuthSecret16',
      },
    };

    const mockSubscription = {
      endpoint: mockSubJson.endpoint!,
      toJSON: jasmine.createSpy('toJSON').and.returnValue(mockSubJson),
      unsubscribe: jasmine.createSpy('unsubscribe').and.returnValue(Promise.resolve(true)),
    } as unknown as PushSubscription;

    const mockPushManager = {
      getSubscription: jasmine.createSpy('getSubscription').and.returnValue(Promise.resolve(null)),
      subscribe: jasmine.createSpy('subscribe').and.returnValue(Promise.resolve(mockSubscription)),
    };

    spyOn(service as unknown as { detectSupport: () => boolean }, 'detectSupport').and.returnValue(
      true
    );
    spyOn(
      service as unknown as {
        getServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
      },
      'getServiceWorkerRegistration'
    ).and.returnValue(
      Promise.resolve({ pushManager: mockPushManager } as unknown as ServiceWorkerRegistration)
    );
    spyOn(Notification, 'requestPermission').and.returnValue(Promise.resolve('granted'));

    const subscribePromise = service.subscribe();
    await Promise.resolve();

    const vapidReq = httpMock.expectOne('/api/push/vapid-public-key');
    expect(vapidReq.request.method).toBe('GET');
    vapidReq.flush({ configured: true, vapidPublicKey: 'BAECAw' });

    // Wait for IndexedDB save + pushManager.subscribe()
    await new Promise((resolve) => setTimeout(resolve, 25));

    const saveReq = httpMock.expectOne('/api/push/subscribe');
    expect(saveReq.request.method).toBe('POST');
    expect(saveReq.request.body).toEqual(mockSubJson);
    saveReq.flush({ ok: true, count: 1 });

    const ok = await subscribePromise;
    expect(ok).toBeTrue();
    expect(mockPushManager.subscribe).toHaveBeenCalledWith(
      jasmine.objectContaining({ userVisibleOnly: true })
    );
    expect(mockSubscription.toJSON).toHaveBeenCalled();
    expect(service.isSubscribed()).toBeTrue();
    expect(service.subscriptionCount()).toBe(1);
  });

  it('unsubscribes via native PushSubscription.unsubscribe() and removes from PostgreSQL', async () => {
    const mockSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/native_sub_1',
      unsubscribe: jasmine.createSpy('unsubscribe').and.returnValue(Promise.resolve(true)),
    } as unknown as PushSubscription;

    const mockPushManager = {
      getSubscription: jasmine
        .createSpy('getSubscription')
        .and.returnValue(Promise.resolve(mockSubscription)),
    };

    spyOn(
      service as unknown as {
        getServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
      },
      'getServiceWorkerRegistration'
    ).and.returnValue(
      Promise.resolve({ pushManager: mockPushManager } as unknown as ServiceWorkerRegistration)
    );

    const unsubPromise = service.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = httpMock.expectOne('/api/push/unsubscribe');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ endpoint: mockSubscription.endpoint });
    req.flush({ ok: true, removed: true, count: 0 });

    const ok = await unsubPromise;
    expect(ok).toBeTrue();
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    expect(service.isSubscribed()).toBeFalse();
    expect(service.subscriptionCount()).toBe(0);
  });

  it('dispatches a test push notification through POST /api/push/test', async () => {
    const testPromise = service.sendTestNotification();
    const req = httpMock.expectOne('/api/push/test');
    expect(req.request.method).toBe('POST');
    req.flush({
      ok: true,
      jobId: 'push_123',
      delivery: { status: 'completed', deliveredCount: 1, prunedCount: 0 },
    });

    const res = await testPromise;
    expect(res?.ok).toBeTrue();
    expect(res?.delivery?.deliveredCount).toBe(1);
  });
});
