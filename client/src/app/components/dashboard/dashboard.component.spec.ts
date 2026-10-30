import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { TellerService } from '../../services/teller.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ status: 'ok' }) } },
        { provide: AuthService, useValue: { logout: () => of({ ok: true }) } },
        {
          provide: TellerService,
          useValue: {
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
});
