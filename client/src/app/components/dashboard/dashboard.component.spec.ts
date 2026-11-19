import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { BankService } from '../../services/bank.service';
import { AuthService } from '../../services/auth.service';
import { PwaService } from '../../services/pwa.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let passkeyWarningSignal: ReturnType<typeof signal<string | null>>;
  let clearPasskeyWarningSpy: jasmine.Spy;
  let canInstallSignal: ReturnType<typeof signal<boolean>>;
  let promptInstallSpy: jasmine.Spy;

  beforeEach(async () => {
    passkeyWarningSignal = signal<string | null>(null);
    clearPasskeyWarningSpy = jasmine.createSpy('clearPasskeyWarning').and.callFake(() => {
      passkeyWarningSignal.set(null);
    });
    canInstallSignal = signal<boolean>(false);
    promptInstallSpy = jasmine
      .createSpy('promptInstall')
      .and.returnValue(Promise.resolve('accepted'));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            passkeyWarning: passkeyWarningSignal.asReadonly(),
            clearPasskeyWarning: clearPasskeyWarningSpy,
          },
        },
        {
          provide: PwaService,
          useValue: {
            canInstall: canInstallSignal.asReadonly(),
            isInstalled: signal(false).asReadonly(),
            promptInstall: promptInstallSpy,
          },
        },
        {
          provide: BankService,
          useValue: {
            getHealthStatus: () => of({ status: 'ok' }),
            logout: () => of({ ok: true }),
            getNetWorth: () =>
              of({
                netWorth: 1000,
                totalAssets: 1500,
                totalLiabilities: 500,
                accounts: [],
              }),
            getDashboardSummary: () =>
              of({
                incomeVsExpenses: [],
                spendingByCategory: [],
                recentTransactions: [],
                quickStats: {
                  thisMonthIncome: 0,
                  thisMonthExpenses: 0,
                  lastMonthIncome: 0,
                  lastMonthExpenses: 0,
                  ytdIncome: 0,
                  ytdExpenses: 0,
                  momIncomeChangePct: 0,
                  momExpensesChangePct: 0,
                },
              }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render dashboard title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Budget App');
  });

  it('should render link to bank accounts', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const link = compiled.querySelector('a[routerLink="/accounts"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Connect bank or credit card');
  });

  it('should render logout button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.btn-logout')).toBeTruthy();
  });

  it('should display passkey warning banner when set and allow dismissing it', () => {
    passkeyWarningSignal.set(
      'Ideally, you should create a passkey. You can do this on the profile page.'
    );
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const banner = compiled.querySelector('.passkey-warning-banner');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Ideally, you should create a passkey');

    component.dismissPasskeyWarning();
    fixture.detectChanges();
    expect(clearPasskeyWarningSpy).toHaveBeenCalled();
    expect(compiled.querySelector('.passkey-warning-banner')).toBeNull();
  });

  it('should show Install App button only when PWA install prompt is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.btn-install-app')).toBeNull();

    canInstallSignal.set(true);
    fixture.detectChanges();

    const installBtn = compiled.querySelector('.btn-install-app') as HTMLButtonElement | null;
    expect(installBtn).toBeTruthy();
    installBtn?.click();
    expect(promptInstallSpy).toHaveBeenCalled();
  });
});
