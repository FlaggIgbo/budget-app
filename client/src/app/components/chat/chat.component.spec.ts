import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ChatComponent } from './chat.component';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: ChatService,
          useValue: {
            askQuestion: (q: string) =>
              of({
                todo: true,
                geminiConfigured: false,
                question: q,
                reply: 'Stub budgeting response',
                contextSummary: {
                  netWorth: 1000,
                  thisMonthIncome: 3000,
                  thisMonthExpenses: 1500,
                  topCategory: 'Groceries',
                  statementsCount: 0,
                  storageProvider: 'minio',
                },
                historyLength: 1,
              }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            logout: () => of({ ok: true }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render AI Financial Assistant header', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('AI Financial Assistant');
  });

  it('should send a question and append assistant response', () => {
    component.question = 'How should I budget?';
    component.sendQuestion();
    fixture.detectChanges();

    const msgs = component.messages();
    expect(msgs.length).toBe(3);
    expect(msgs[1].content).toBe('How should I budget?');
    expect(msgs[2].content).toContain('Stub budgeting response');
  });
});
