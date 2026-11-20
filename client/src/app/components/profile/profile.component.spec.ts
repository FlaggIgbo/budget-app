import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserService } from '../../services/user.service';
import { WebAuthnService } from '../../services/webauthn.service';
import { PushNotificationService } from '../../services/push-notification.service';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let userServiceMock: jasmine.SpyObj<UserService>;
  let webauthnMock: jasmine.SpyObj<WebAuthnService>;
  let pushServiceMock: {
    isSupported: ReturnType<typeof signal<boolean>>;
    permission: ReturnType<typeof signal<NotificationPermission>>;
    isSubscribed: ReturnType<typeof signal<boolean>>;
    subscriptionCount: ReturnType<typeof signal<number>>;
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    refreshStatus: jasmine.Spy;
    subscribe: jasmine.Spy;
    unsubscribe: jasmine.Spy;
    sendTestNotification: jasmine.Spy;
  };

  const mockPasskeyOptions = {
    challenge: 'profile-challenge',
    rp: { name: 'Budget App', id: 'localhost' },
    user: { id: 'dXNyXzE', name: '+15551234567', displayName: 'Alex Demo' },
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  };

  const mockCreatedCredential = {
    id: 'cred_profile_1',
    rawId: 'cred_profile_1',
    type: 'public-key',
    response: {
      clientDataJSON: 'Y2xpZW50',
      attestationObject: 'YXR0ZXN0',
      transports: ['internal'],
    },
  };

  beforeEach(async () => {
    userServiceMock = jasmine.createSpyObj<UserService>('UserService', [
      'getProfile',
      'requestEmailChangeOtp',
      'verifyEmailChangeOtp',
      'requestPhoneChangeOtp',
      'verifyPhoneChangeOtp',
      'getPasskeyRegisterOptions',
      'verifyPasskeyRegister',
      'deletePasskey',
      'logout',
    ]);
    userServiceMock.getProfile.and.returnValue(
      of({
        id: 'usr_1',
        firstName: 'Alex',
        lastName: 'Demo',
        phone: '+15551234567',
        email: 'alex@budgetapp.local',
        hasPasskey: false,
        passkeyCreatedAt: null,
      })
    );
    userServiceMock.requestEmailChangeOtp.and.returnValue(of({ ok: true }));
    userServiceMock.verifyEmailChangeOtp.and.returnValue(
      of({
        ok: true,
        user: {
          id: 'usr_1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15551234567',
          email: 'newalex@example.com',
          hasPasskey: false,
          passkeyCreatedAt: null,
        },
      })
    );
    userServiceMock.requestPhoneChangeOtp.and.returnValue(of({ ok: true }));
    userServiceMock.verifyPhoneChangeOtp.and.returnValue(
      of({
        ok: true,
        user: {
          id: 'usr_1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15559876543',
          email: 'alex@budgetapp.local',
          hasPasskey: false,
          passkeyCreatedAt: null,
        },
      })
    );
    userServiceMock.getPasskeyRegisterOptions.and.returnValue(
      of({ ok: true, options: mockPasskeyOptions })
    );
    userServiceMock.verifyPasskeyRegister.and.returnValue(
      of({
        ok: true,
        user: {
          id: 'usr_1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15551234567',
          email: 'alex@budgetapp.local',
          hasPasskey: true,
          passkeyCreatedAt: '2026-11-19T12:00:00.000Z',
        },
      })
    );
    userServiceMock.deletePasskey.and.returnValue(
      of({
        ok: true,
        user: {
          id: 'usr_1',
          firstName: 'Alex',
          lastName: 'Demo',
          phone: '+15551234567',
          email: 'alex@budgetapp.local',
          hasPasskey: false,
          passkeyCreatedAt: null,
        },
      })
    );
    webauthnMock = jasmine.createSpyObj<WebAuthnService>('WebAuthnService', [
      'createPasskey',
      'receiveOtp',
    ]);
    webauthnMock.createPasskey.and.returnValue(Promise.resolve(mockCreatedCredential));
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve(null));

    pushServiceMock = {
      isSupported: signal(true),
      permission: signal<NotificationPermission>('default'),
      isSubscribed: signal(false),
      subscriptionCount: signal(0),
      loading: signal(false),
      error: signal<string | null>(null),
      refreshStatus: jasmine.createSpy('refreshStatus').and.returnValue(Promise.resolve()),
      subscribe: jasmine.createSpy('subscribe').and.callFake(async () => {
        pushServiceMock.isSubscribed.set(true);
        pushServiceMock.permission.set('granted');
        pushServiceMock.subscriptionCount.set(1);
        return true;
      }),
      unsubscribe: jasmine.createSpy('unsubscribe').and.callFake(async () => {
        pushServiceMock.isSubscribed.set(false);
        pushServiceMock.subscriptionCount.set(0);
        return true;
      }),
      sendTestNotification: jasmine.createSpy('sendTestNotification').and.returnValue(
        Promise.resolve({
          ok: true,
          jobId: 'push_1',
          delivery: { status: 'completed', deliveredCount: 1, prunedCount: 0 },
        })
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: UserService, useValue: userServiceMock },
        { provide: WebAuthnService, useValue: webauthnMock },
        { provide: PushNotificationService, useValue: pushServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should display user name, phone number, and email with change buttons', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Alex Demo');
    expect(compiled.textContent).toContain('+15551234567');
    expect(compiled.textContent).toContain('alex@budgetapp.local');
    expect(compiled.querySelector('.btn-edit-phone')).toBeTruthy();
    expect(compiled.querySelector('.btn-edit-email')).toBeTruthy();
  });

  it('should allow adding a passkey when none exists and deleting it once registered', async () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.btn-add-passkey')).toBeTruthy();
    expect(compiled.querySelector('.btn-delete-passkey')).toBeNull();

    await component.addPasskey();
    fixture.detectChanges();

    expect(userServiceMock.getPasskeyRegisterOptions).toHaveBeenCalled();
    expect(webauthnMock.createPasskey).toHaveBeenCalledWith(mockPasskeyOptions);
    expect(userServiceMock.verifyPasskeyRegister).toHaveBeenCalledWith(mockCreatedCredential);
    expect(component.profile()?.hasPasskey).toBeTrue();
    expect(compiled.querySelector('.btn-add-passkey')).toBeNull();
    expect(compiled.querySelector('.btn-delete-passkey')).toBeTruthy();

    component.deletePasskey();
    fixture.detectChanges();

    expect(userServiceMock.deletePasskey).toHaveBeenCalled();
    expect(component.profile()?.hasPasskey).toBeFalse();
    expect(compiled.querySelector('.btn-add-passkey')).toBeTruthy();
    expect(compiled.querySelector('.btn-delete-passkey')).toBeNull();
  });

  it('should allow changing email address with OTP confirmation', () => {
    component.startContactChange('email');
    component.newEmail = 'newalex@example.com';
    component.sendContactOtp();

    expect(userServiceMock.requestEmailChangeOtp).toHaveBeenCalledWith('newalex@example.com');
    expect(component.editStep()).toBe('otp');

    fixture.detectChanges();
    const otpInput = (fixture.nativeElement as HTMLElement).querySelector(
      'input[name="contactOtpCode"]'
    );
    expect(otpInput?.getAttribute('inputmode')).toBe('numeric');
    expect(otpInput?.getAttribute('autocomplete')).toBe('one-time-code');

    component.contactOtpCode = '123456';
    component.verifyContactOtp();

    expect(userServiceMock.verifyEmailChangeOtp).toHaveBeenCalledWith(
      'newalex@example.com',
      '123456'
    );
    expect(component.profile()?.email).toBe('newalex@example.com');
    expect(component.editingContact()).toBeNull();
  });

  it('should allow changing phone number with OTP confirmation', () => {
    component.startContactChange('phone');
    component.newPhone = '+15559876543';
    component.sendContactOtp();

    expect(userServiceMock.requestPhoneChangeOtp).toHaveBeenCalledWith('+15559876543');
    expect(component.editStep()).toBe('otp');

    component.contactOtpCode = '123456';
    component.verifyContactOtp();

    expect(userServiceMock.verifyPhoneChangeOtp).toHaveBeenCalledWith('+15559876543', '123456');
    expect(component.profile()?.phone).toBe('+15559876543');
    expect(component.editingContact()).toBeNull();
  });

  it('should autofill profile email and phone OTPs via WebOTP with matching transport', async () => {
    webauthnMock.receiveOtp.and.returnValue(Promise.resolve('123456'));

    component.startContactChange('email');
    component.newEmail = 'newalex@example.com';
    component.sendContactOtp();
    await Promise.resolve();

    expect(webauthnMock.receiveOtp).toHaveBeenCalledWith('email', jasmine.any(AbortSignal));
    expect(userServiceMock.verifyEmailChangeOtp).toHaveBeenCalledWith(
      'newalex@example.com',
      '123456'
    );

    component.startContactChange('phone');
    component.newPhone = '+15559876543';
    component.sendContactOtp();
    await Promise.resolve();

    expect(webauthnMock.receiveOtp).toHaveBeenCalledWith('sms', jasmine.any(AbortSignal));
    expect(userServiceMock.verifyPhoneChangeOtp).toHaveBeenCalledWith('+15559876543', '123456');
  });

  it('should allow enabling, testing, and disabling native Web Push notifications', async () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(pushServiceMock.refreshStatus).toHaveBeenCalled();
    expect(compiled.querySelector('.btn-enable-push')).toBeTruthy();

    await component.enablePushNotifications();
    fixture.detectChanges();

    expect(pushServiceMock.subscribe).toHaveBeenCalled();
    expect(compiled.querySelector('.btn-test-push')).toBeTruthy();
    expect(compiled.querySelector('.btn-disable-push')).toBeTruthy();

    await component.sendTestPush();
    fixture.detectChanges();
    expect(pushServiceMock.sendTestNotification).toHaveBeenCalled();

    await component.disablePushNotifications();
    fixture.detectChanges();
    expect(pushServiceMock.unsubscribe).toHaveBeenCalled();
    expect(compiled.querySelector('.btn-enable-push')).toBeTruthy();
  });
});
