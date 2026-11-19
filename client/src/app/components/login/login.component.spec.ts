import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: jasmine.SpyObj<AuthService>;
  let routerMock: { navigate: jasmine.Spy };

  beforeEach(async () => {
    authServiceMock = jasmine.createSpyObj<AuthService>('AuthService', [
      'getAuthConfig',
      'sendOtp',
      'verifyOtp',
    ]);
    authServiceMock.getAuthConfig.and.returnValue(
      of({ authSandbox: { phone: '+15551234567', otp: '123456' } })
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
        },
      })
    );
    routerMock = { navigate: jasmine.createSpy('navigate') };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
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
});
