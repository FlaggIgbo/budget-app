import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { WebAuthnService } from '../../services/webauthn.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: jasmine.SpyObj<AuthService>;
  let webauthnMock: jasmine.SpyObj<WebAuthnService>;
  let routerMock: { navigate: jasmine.Spy };

  const mockPasskeyLoginOptions = {
    challenge: 'login-challenge-123',
    rpId: 'localhost',
    timeout: 60000,
    allowCredentials: [{ id: 'cred_123', type: 'public-key' as const }],
  };

  const mockAssertionCredential = {
    id: 'cred_123',
    rawId: 'cred_123',
    type: 'public-key',
    response: {
      clientDataJSON: 'Y2xpZW50',
      authenticatorData: 'YXV0aA',
      signature: 'c2ln',
      userHandle: null,
    },
  };

  beforeEach(async () => {
    authServiceMock = jasmine.createSpyObj<AuthService>('AuthService', [
      'getAuthConfig',
      'getPasskeyLoginOptions',
      'verifyPasskeyLogin',
      'sendOtp',
      'verifyOtp',
    ]);
    authServiceMock.getAuthConfig.and.returnValue(
      of({ authSandbox: { phone: '+15551234567', otp: '123456' } })
    );
    authServiceMock.getPasskeyLoginOptions.and.returnValue(
      of({ ok: true, hasPasskey: false, phone: '+15551234567' })
    );
    authServiceMock.verifyPasskeyLogin.and.returnValue(
      of({
        ok: true,
        user: {
          id: '1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15551234567',
          email: 'alex@budgetapp.local',
          hasPasskey: true,
        },
      })
    );
    authServiceMock.sendOtp.and.returnValue(of({ ok: true }));
    authServiceMock.verifyOtp.and.returnValue(
      of({
        ok: true,
        requiresSignup: false,
        user: {
          id: '1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15551234567',
          email: 'alex@budgetapp.local',
          hasPasskey: false,
        },
      })
    );
    webauthnMock = jasmine.createSpyObj<WebAuthnService>('WebAuthnService', [
      'getPasskey',
      'receiveOtp',
    ]);
    webauthnMock.getPasskey.and.returnValue(Promise.resolve(mockAssertionCredential));
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve(null));
    routerMock = { navigate: jasmine.createSpy('navigate') };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: WebAuthnService, useValue: webauthnMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render login form with title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Budget App');
  });

  it('should show phone input in initial step', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#phone')).toBeTruthy();
    expect(compiled.querySelector('label[for="phone"]')?.textContent).toContain('Phone number');
  });

  it('should show development test account banner in non-production mode', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const banner = compiled.querySelector('.sandbox-banner');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('+15551234567');
    expect(banner?.textContent).toContain('123456');
  });

  it('should hide development test account banner when server reports production', () => {
    authServiceMock.getAuthConfig.and.returnValue(
      of({
        environment: 'production',
        authSandbox: { phone: '+15551234567', otp: '123456' },
      })
    );
    const prodFixture = TestBed.createComponent(LoginComponent);
    prodFixture.detectChanges();
    const compiled = prodFixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.sandbox-banner')).toBeNull();
  });

  it('should authenticate via navigator.credentials.get() when phone number has an associated passkey', async () => {
    authServiceMock.getPasskeyLoginOptions.and.returnValue(
      of({
        ok: true,
        hasPasskey: true,
        phone: '+15551234567',
        options: mockPasskeyLoginOptions,
      })
    );

    component.phone = '+15551234567';
    await component.continueWithPhone();

    expect(authServiceMock.getPasskeyLoginOptions).toHaveBeenCalledWith('+15551234567');
    expect(webauthnMock.getPasskey).toHaveBeenCalledWith(mockPasskeyLoginOptions);
    expect(authServiceMock.verifyPasskeyLogin).toHaveBeenCalledWith(
      '+15551234567',
      mockAssertionCredential
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should fall back to SMS OTP when phone number has no registered passkey', async () => {
    component.phone = '+15559990001';
    await component.continueWithPhone();

    expect(authServiceMock.getPasskeyLoginOptions).toHaveBeenCalledWith('+15559990001');
    expect(webauthnMock.getPasskey).not.toHaveBeenCalled();
    expect(authServiceMock.sendOtp).toHaveBeenCalledWith('+15559990001');
    expect(component.step()).toBe('otp');
  });

  it('should offer retry and SMS fallback when passkey authentication is cancelled', async () => {
    authServiceMock.getPasskeyLoginOptions.and.returnValue(
      of({
        ok: true,
        hasPasskey: true,
        phone: '+15551234567',
        options: mockPasskeyLoginOptions,
      })
    );
    webauthnMock.getPasskey.and.returnValue(
      Promise.reject(new DOMException('Cancelled', 'NotAllowedError'))
    );

    component.phone = '+15551234567';
    await component.continueWithPhone();
    fixture.detectChanges();

    expect(component.step()).toBe('passkey');
    expect(component.error()).toContain('Passkey authentication');
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.btn-retry-passkey')).toBeTruthy();
  });

  it('should navigate to /dashboard when existing user verifies phone OTP', () => {
    component.phone = '+15551234567';
    component.otp = '123456';
    component.verifyOtp();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should navigate to /signup when phone OTP succeeds for a new user without an account', () => {
    authServiceMock.verifyOtp.and.returnValue(
      of({
        ok: true,
        requiresSignup: true,
        phone: '+15559990001',
        signupToken: 'tok_signup_123',
      })
    );

    component.phone = '+15559990001';
    component.otp = '123456';
    component.verifyOtp();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/signup']);
  });

  it('should autofill and verify SMS OTP via WebOTP navigator.credentials.get', async () => {
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve('123456'));
    component.phone = '+15551234567';
    component.sendOtp();

    await Promise.resolve();

    expect(webauthnMock.receiveOtp).toHaveBeenCalledWith('sms', jasmine.any(AbortSignal));
    expect(authServiceMock.verifyOtp).toHaveBeenCalledWith('+15551234567', '123456');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
