import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: {
            getAuthConfig: () => of({ authSandbox: { phone: '+15551234567', otp: '123456' } }),
            sendOtp: () => of({ ok: true }),
            verifyOtp: () => of({ ok: true, user: { id: '1', phone: '+15551234567' } }),
          },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
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
});
