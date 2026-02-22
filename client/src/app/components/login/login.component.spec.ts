import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { TellerService } from '../../services/teller.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            sendOtp: () => of({ ok: true }),
            verifyOtp: () => of({ ok: true, user: { id: '1', phone: '+15555555555' } }),
          },
        },
        {
          provide: TellerService,
          useValue: {
            getConfig: () => of({ authSandbox: { phone: '555-555-5555', otp: '123456' } }),
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

  it('should format phone as XXX-XXX-XXXX', () => {
    expect(component.formatPhone('5555555555')).toBe('555-555-5555');
    expect(component.formatPhone('5551234567')).toBe('555-123-4567');
  });
});
