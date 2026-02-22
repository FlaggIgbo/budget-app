import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BankAccountsComponent } from './bank-accounts.component';
import { TellerService } from '../../services/teller.service';
import { AuthService } from '../../services/auth.service';

describe('BankAccountsComponent', () => {
  let component: BankAccountsComponent;
  let fixture: ComponentFixture<BankAccountsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BankAccountsComponent],
      providers: [
        provideRouter([]),
        {
          provide: TellerService,
          useValue: {
            getConfig: () => of({ tellerApplicationId: 'app_test', tellerEnvironment: 'sandbox' }),
            listEnrollments: () => of([]),
          },
        },
        { provide: AuthService, useValue: { logout: () => of({ ok: true }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankAccountsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render header with title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Bank Accounts');
  });

  it('should render connect bank button when Teller is configured', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const btn = compiled.querySelector('.btn-connect');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain('Connect bank account');
  });

  it('should render link back to dashboard', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('a[routerLink="/dashboard"]')).toBeTruthy();
  });
});
