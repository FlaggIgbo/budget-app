import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { OfflineQueueService, OfflineQueueReplayResult } from './offline-queue.service';

describe('OfflineQueueService & ApiService Offline Queueing (IndexedDB)', () => {
  let queueService: OfflineQueueService;
  let apiService: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    queueService = TestBed.inject(OfflineQueueService);
    apiService = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
    await queueService.clearQueue();
  });

  afterEach(async () => {
    httpMock.verify();
    await queueService.clearQueue();
  });

  it('queues bank sync, chat, disconnects, and general non-auth writes while excluding auth/OTP/passkey/Plaid link routes', () => {
    // Queueable non-auth writes
    expect(queueService.isQueueableRequest('POST', '/api/bank/transactions/sync')).toBeTrue();
    expect(queueService.isQueueableRequest('POST', '/api/chat/ask')).toBeTrue();
    expect(queueService.isQueueableRequest('DELETE', '/api/bank/enrollments/enr_chase')).toBeTrue();
    expect(queueService.isQueueableRequest('PUT', '/api/budgets/monthly')).toBeTrue();
    expect(queueService.isQueueableRequest('PATCH', '/api/transactions/txn_1')).toBeTrue();

    // Non-queueable reads & auth/security flows
    expect(queueService.isQueueableRequest('GET', '/api/bank/net-worth')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/otp/request')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/otp/verify')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/auth/passkey/login/verify')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/auth/signup/complete')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/profile/contact/verify-otp')).toBeFalse();
    expect(queueService.isQueueableRequest('DELETE', '/api/profile/passkey')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/bank/link-token')).toBeFalse();
    expect(queueService.isQueueableRequest('POST', '/api/bank/exchange-token')).toBeFalse();
  });

  it('persists queued mutations in IndexedDB and replays them in FIFO order on flush', async () => {
    await queueService.enqueue('POST', '/api/bank/transactions/sync', {});
    await queueService.enqueue('POST', '/api/chat/ask', { question: 'How is my budget?' });
    await queueService.enqueue('DELETE', '/api/bank/enrollments/enr_amex', null);

    const stored = await queueService.listQueued();
    expect(stored.length).toBe(3);
    expect(queueService.pendingCount()).toBe(3);
    expect(stored.map((m) => `${m.method} ${m.url}`)).toEqual([
      'POST /api/bank/transactions/sync',
      'POST /api/chat/ask',
      'DELETE /api/bank/enrollments/enr_amex',
    ]);

    const replayEvents: OfflineQueueReplayResult[] = [];
    const sub = queueService.replayed$.subscribe((ev) => replayEvents.push(ev));

    const fetchSpy = spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url.includes('/api/chat/ask')) {
        return new Response(JSON.stringify({ reply: 'Queued answer delivered' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await queueService.flushQueueDirectly();
    sub.unsubscribe();

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.replayed.length).toBe(3);
    expect(result.pendingCount).toBe(0);
    expect(queueService.pendingCount()).toBe(0);
    expect(replayEvents.length).toBe(1);
    expect((replayEvents[0].replayed[1].responseBody as { reply?: string })?.reply).toBe(
      'Queued answer delivered'
    );

    const remaining = await queueService.listQueued();
    expect(remaining.length).toBe(0);
  });

  it('retains queued items in IndexedDB when replay still fails due to network outage', async () => {
    await queueService.enqueue('POST', '/api/bank/transactions/sync', {});

    spyOn(window, 'fetch').and.rejectWith(new TypeError('Failed to fetch'));

    const result = await queueService.flushQueueDirectly();
    expect(result.replayed.length).toBe(0);
    expect(result.pendingCount).toBe(1);
    expect((await queueService.listQueued()).length).toBe(1);
  });

  it('enqueues failed non-auth ApiService writes in IndexedDB while propagating auth errors', async () => {
    const syncPromise = firstValueFrom(
      apiService.post<{ ok: boolean; queued?: boolean }>('/bank/transactions/sync', {})
    );

    const syncReq = httpMock.expectOne('/api/bank/transactions/sync');
    syncReq.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    const syncRes = await syncPromise;
    expect(syncRes.queued).toBeTrue();
    expect((await queueService.listQueued()).length).toBe(1);

    // Auth write requests must NOT be queued
    let authErrorCaught = false;
    const authPromise = firstValueFrom(apiService.post('/auth/logout', {})).catch(() => {
      authErrorCaught = true;
    });
    const authReq = httpMock.expectOne('/api/auth/logout');
    authReq.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await authPromise;

    expect(authErrorCaught).toBeTrue();
    expect((await queueService.listQueued()).length).toBe(1);
  });
});
