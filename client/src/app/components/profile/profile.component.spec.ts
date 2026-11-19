import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserService } from '../../services/user.service';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let userServiceMock: jasmine.SpyObj<UserService>;

  beforeEach(async () => {
    userServiceMock = jasmine.createSpyObj<UserService>('UserService', [
      'getProfile',
      'requestEmailChangeOtp',
      'verifyEmailChangeOtp',
      'requestPhoneChangeOtp',
      'verifyPhoneChangeOtp',
      'logout',
    ]);
    userServiceMock.getProfile.and.returnValue(
      of({
        id: 'usr_1',
        firstName: 'Alex',
        lastName: 'Demo',
        phone: '+15551234567',
        email: 'alex@budgetapp.local',
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
        },
      })
    );

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: UserService, useValue: userServiceMock },
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

  it('should allow changing email address with OTP confirmation', () => {
    component.startContactChange('email');
    component.newEmail = 'newalex@example.com';
    component.sendContactOtp();

    expect(userServiceMock.requestEmailChangeOtp).toHaveBeenCalledWith('newalex@example.com');
    expect(component.editStep()).toBe('otp');

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
});
