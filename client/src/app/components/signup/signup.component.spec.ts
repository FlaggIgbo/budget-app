import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import {
  PASSKEY_SERVER_ERROR_WARNING,
  PASSKEY_USER_ERROR_WARNING,
  SignupComponent,
} from './signup.component';
import { AuthService } from '../../services/auth.service';
import { WebAuthnService } from '../../services/webauthn.service';

describe('SignupComponent', () => {
  let component: SignupComponent;
  let fixture: ComponentFixture<SignupComponent>;
  let authServiceMock: {
    pendingSignup: ReturnType<typeof signal<{ phone: string; signupToken: string } | null>>;
    getAuthConfig: jasmine.Spy;
    requestSignupEmailOtp: jasmine.Spy;
    verifySignupEmailOtp: jasmine.Spy;
    getSignupPasskeyOptions: jasmine.Spy;
    completeSignupWithPasskey: jasmine.Spy;
    completeSignupSkippingPasskey: jasmine.Spy;
    setPasskeyWarning: jasmine.Spy;
    clearPendingSignup: jasmine.Spy;
  };
  let webauthnMock: jasmine.SpyObj<WebAuthnService>;
  let routerMock: { navigate: jasmine.Spy };

  const mockPasskeyOptions = {
    challenge: 'test-challenge',
    rp: { name: 'Budget App', id: 'localhost' },
    user: { id: 'dXNyXzE', name: '+15559990001', displayName: 'Jordan Lee' },
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  };

  const mockCreatedCredential = {
    id: 'cred_123',
    rawId: 'cred_123',
    type: 'public-key',
    response: {
      clientDataJSON: 'Y2xpZW50',
      attestationObject: 'YXR0ZXN0',
      transports: ['internal'],
    },
  };

  beforeEach(async () => {
    authServiceMock = {
      pendingSignup: signal<{ phone: string; signupToken: string } | null>({
        phone: '+15559990001',
        signupToken: 'tok_signup_123',
      }),
      getAuthConfig: jasmine
        .createSpy('getAuthConfig')
        .and.returnValue(of({ authSandbox: { phone: '+15551234567', otp: '123456' } })),
      requestSignupEmailOtp: jasmine
        .createSpy('requestSignupEmailOtp')
        .and.returnValue(of({ ok: true, message: 'Verification code sent' })),
      verifySignupEmailOtp: jasmine
        .createSpy('verifySignupEmailOtp')
        .and.returnValue(of({ ok: true, emailVerified: true })),
      getSignupPasskeyOptions: jasmine
        .createSpy('getSignupPasskeyOptions')
        .and.returnValue(of({ ok: true, options: mockPasskeyOptions })),
      completeSignupWithPasskey: jasmine.createSpy('completeSignupWithPasskey').and.returnValue(
        of({
          ok: true,
          user: {
            id: 'usr_new',
            firstName: 'Jordan',
            lastName: 'Lee',
            phone: '+15559990001',
            email: 'jordan@example.com',
            hasPasskey: true,
          },
        })
      ),
      completeSignupSkippingPasskey: jasmine
        .createSpy('completeSignupSkippingPasskey')
        .and.returnValue(
          of({
            ok: true,
            user: {
              id: 'usr_new',
              firstName: 'Jordan',
              lastName: 'Lee',
              phone: '+15559990001',
              email: 'jordan@example.com',
              hasPasskey: false,
            },
          })
        ),
      setPasskeyWarning: jasmine.createSpy('setPasskeyWarning'),
      clearPendingSignup: jasmine.createSpy('clearPendingSignup'),
    };
    webauthnMock = jasmine.createSpyObj<WebAuthnService>('WebAuthnService', [
      'createPasskey',
      'receiveOtp',
    ]);
    webauthnMock.createPasskey.and.returnValue(Promise.resolve(mockCreatedCredential));
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve(null));
    routerMock = { navigate: jasmine.createSpy('navigate') };

    await TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: WebAuthnService, useValue: webauthnMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SignupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display the verified phone number', () => {
    expect(component).toBeTruthy();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Create your account');
    expect(compiled.textContent).toContain('+15559990001');
  });

  it('should require first name, last name, and email before sending email OTP', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#firstName')).toBeTruthy();
    expect(compiled.querySelector('#lastName')).toBeTruthy();
    expect(compiled.querySelector('#email')).toBeTruthy();
  });

  it('should require passkey creation after email OTP verification and navigate to /dashboard on success', async () => {
    component.firstName = 'Jordan';
    component.lastName = 'Lee';
    component.email = 'jordan@example.com';

    component.sendEmailOtp();
    expect(authServiceMock.requestSignupEmailOtp).toHaveBeenCalledWith('jordan@example.com');
    expect(component.step()).toBe('email-otp');

    component.emailOtp = '123456';
    component.verifyEmailOtp();
    expect(authServiceMock.verifySignupEmailOtp).toHaveBeenCalledWith(
      'Jordan',
      'Lee',
      'jordan@example.com',
      '123456'
    );
    expect(component.step()).toBe('passkey');
    expect(component.canSkipPasskey()).toBeFalse();

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.btn-create-passkey')).toBeTruthy();
    expect(compiled.querySelector('.btn-skip-passkey')).toBeNull();

    await component.createPasskey();
    expect(authServiceMock.getSignupPasskeyOptions).toHaveBeenCalled();
    expect(webauthnMock.createPasskey).toHaveBeenCalledWith(mockPasskeyOptions);
    expect(authServiceMock.completeSignupWithPasskey).toHaveBeenCalledWith(mockCreatedCredential);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should show user-error warning banner and allow skipping when navigator.credentials.create fails', async () => {
    component.step.set('passkey');
    webauthnMock.createPasskey.and.returnValue(
      Promise.reject(new DOMException('User cancelled', 'NotAllowedError'))
    );

    await component.createPasskey();
    fixture.detectChanges();

    expect(component.canSkipPasskey()).toBeTrue();
    expect(component.passkeyWarning()).toBe(PASSKEY_USER_ERROR_WARNING);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.warning-banner')?.textContent).toContain(
      PASSKEY_USER_ERROR_WARNING
    );
    expect(compiled.querySelector('.btn-skip-passkey')).toBeTruthy();

    component.skipPasskeyAndFinish();
    expect(authServiceMock.completeSignupSkippingPasskey).toHaveBeenCalled();
    expect(authServiceMock.setPasskeyWarning).toHaveBeenCalledWith(PASSKEY_USER_ERROR_WARNING);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should show server-error warning banner and allow skipping when passkey creation hits 500 error', async () => {
    component.step.set('passkey');
    authServiceMock.getSignupPasskeyOptions.and.returnValue(
      throwError(() => ({ status: 500, error: { error: 'Internal server error' } }))
    );

    await component.createPasskey();
    fixture.detectChanges();

    expect(component.canSkipPasskey()).toBeTrue();
    expect(component.passkeyWarning()).toBe(PASSKEY_SERVER_ERROR_WARNING);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.warning-banner')?.textContent).toContain(
      PASSKEY_SERVER_ERROR_WARNING
    );
    expect(compiled.querySelector('.btn-skip-passkey')).toBeTruthy();

    component.skipPasskeyAndFinish();
    expect(authServiceMock.completeSignupSkippingPasskey).toHaveBeenCalled();
    expect(authServiceMock.setPasskeyWarning).toHaveBeenCalledWith(PASSKEY_SERVER_ERROR_WARNING);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should autofill and verify signup email OTP via WebOTP navigator.credentials.get', async () => {
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve('123456'));
    component.firstName = 'Jordan';
    component.lastName = 'Lee';
    component.email = 'jordan@example.com';

    component.sendEmailOtp();
    await Promise.resolve();

    expect(webauthnMock.receiveOtp).toHaveBeenCalledWith('email', jasmine.any(AbortSignal));
    expect(authServiceMock.verifySignupEmailOtp).toHaveBeenCalledWith(
      'Jordan',
      'Lee',
      'jordan@example.com',
      '123456'
    );
    expect(component.step()).toBe('passkey');
  });
});
