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
            getAuthConfig: () => of({ authSandbox: { email: 'test@example.com', otp: '123456' } }),
            sendOtp: () => of({ ok: true }),
            verifyOtp: () => of({ ok: true, user: { id: '1', email: 'test@example.com' } }),
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

  it('should show email input in initial step', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#email')).toBeTruthy();
    expect(compiled.querySelector('label[for="email"]')?.textContent).toContain('Email address');
  });
});
