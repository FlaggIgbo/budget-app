import { TestBed } from '@angular/core/testing';
import { WebAuthnService } from './webauthn.service';

describe('WebAuthnService (WebOTP navigator.credentials.get)', () => {
  let service: WebAuthnService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebAuthnService);
  });

  it('calls navigator.credentials.get with sms transport and returns the OTP code', async () => {
    spyOn(service, 'isOtpSupported').and.returnValue(true);
    const getSpy = spyOn(navigator.credentials, 'get').and.returnValue(
      Promise.resolve({ id: 'otp', type: 'otp', code: ' 654321 ' } as unknown as Credential)
    );

    const controller = new AbortController();
    const code = await service.receiveOtp('sms', controller.signal);

    expect(code).toBe('654321');
    expect(getSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({
        otp: { transport: ['sms'] },
        signal: controller.signal,
      })
    );
  });

  it('calls navigator.credentials.get with email transport and returns the OTP code', async () => {
    spyOn(service, 'isOtpSupported').and.returnValue(true);
    const getSpy = spyOn(navigator.credentials, 'get').and.returnValue(
      Promise.resolve({ id: 'otp', type: 'otp', code: '987654' } as unknown as Credential)
    );

    const code = await service.receiveOtp('email');

    expect(code).toBe('987654');
    expect(getSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({
        otp: { transport: ['email'] },
      })
    );
  });

  it('returns null gracefully when WebOTP is unsupported or aborted', async () => {
    spyOn(service, 'isOtpSupported').and.returnValue(false);
    expect(await service.receiveOtp('sms')).toBeNull();

    (service.isOtpSupported as jasmine.Spy).and.returnValue(true);
    spyOn(navigator.credentials, 'get').and.returnValue(
      Promise.reject(new DOMException('Aborted', 'AbortError'))
    );
    expect(await service.receiveOtp('email')).toBeNull();
  });
});
