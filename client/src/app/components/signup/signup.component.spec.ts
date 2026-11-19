import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { SignupComponent } from './signup.component';
import { AuthService } from '../../services/auth.service';

describe('SignupComponent', () => {
  let component: SignupComponent;
  let fixture: ComponentFixture<SignupComponent>;
  let authServiceMock: {
    pendingSignup: ReturnType<typeof signal<{ phone: string; signupToken: string } | null>>;
    getAuthConfig: jasmine.Spy;
    requestSignupEmailOtp: jasmine.Spy;
    completeSignup: jasmine.Spy;
    clearPendingSignup: jasmine.Spy;
  };
  let routerMock: { navigate: jasmine.Spy };

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
      completeSignup: jasmine.createSpy('completeSignup').and.returnValue(
        of({
          ok: true,
          user: {
            id: 'usr_new',
            firstName: 'Jordan',
            lastName: 'Lee',
            phone: '+15559990001',
            email: 'jordan@example.com',
          },
        })
      ),
      clearPendingSignup: jasmine.createSpy('clearPendingSignup'),
    };
    routerMock = { navigate: jasmine.createSpy('navigate') };

    await TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
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

  it('should advance to email OTP step and navigate to /dashboard upon completion', () => {
    component.firstName = 'Jordan';
    component.lastName = 'Lee';
    component.email = 'jordan@example.com';

    component.sendEmailOtp();
    expect(authServiceMock.requestSignupEmailOtp).toHaveBeenCalledWith('jordan@example.com');
    expect(component.step()).toBe('email-otp');

    component.emailOtp = '123456';
    component.completeSignup();
    expect(authServiceMock.completeSignup).toHaveBeenCalledWith(
      'Jordan',
      'Lee',
      'jordan@example.com',
      '123456'
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
