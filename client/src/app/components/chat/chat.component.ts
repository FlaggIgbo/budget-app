import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChatService, ChatMessage, ChatContextSummary } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
  ],
  template: `
    <mat-toolbar class="top-toolbar">
      <div class="toolbar-inner">
        <a mat-button routerLink="/dashboard" class="back-link">
          <mat-icon>arrow_back</mat-icon>
          Dashboard
        </a>
        <div class="header-actions">
          <a mat-button routerLink="/accounts" class="nav-link">
            <mat-icon>account_balance</mat-icon>
            Accounts
          </a>
          <a mat-button routerLink="/profile" class="nav-link">
            <mat-icon>person_outline</mat-icon>
            Profile
          </a>
          <button mat-stroked-button class="btn-logout" (click)="logout()">
            <mat-icon>logout</mat-icon>
            Log out
          </button>
        </div>
      </div>
    </mat-toolbar>

    <div class="chat-page">
      <header class="page-header">
        <div class="header-icon">
          <mat-icon>auto_awesome</mat-icon>
        </div>
        <div class="header-text">
          <h1>AI Financial Assistant</h1>
          <p class="subtitle">
            Ask questions about your budget, spending categories, net worth, and stored bank
            statements
          </p>
        </div>
      </header>

      <div class="prompts-section">
        <span class="prompts-label">Suggested prompts:</span>
        <div class="prompt-chips">
          @for (prompt of suggestedPrompts; track prompt) {
            <button class="prompt-chip" type="button" (click)="useSuggestedPrompt(prompt)">
              <mat-icon class="chip-icon">help_outline</mat-icon>
              <span>{{ prompt }}</span>
            </button>
          }
        </div>
      </div>

      @if (contextSummary(); as ctx) {
        <mat-card appearance="outlined" class="context-card">
          <div class="context-title">
            <mat-icon>analytics</mat-icon>
            <span>Live Financial Context</span>
          </div>
          <div class="context-metrics">
            <div class="metric-pill">
              <span class="metric-label">Net Worth</span>
              <span class="metric-val">{{ ctx.netWorth | currency }}</span>
            </div>
            <div class="metric-pill">
              <span class="metric-label">Income</span>
              <span class="metric-val pos">{{ ctx.thisMonthIncome | currency }}</span>
            </div>
            <div class="metric-pill">
              <span class="metric-label">Expenses</span>
              <span class="metric-val neg">{{ ctx.thisMonthExpenses | currency }}</span>
            </div>
            <div class="metric-pill">
              <span class="metric-label">Top Category</span>
              <span class="metric-val">{{ ctx.topCategory }}</span>
            </div>
            <div class="metric-pill">
              <span class="metric-label">Statements ({{ ctx.storageProvider | uppercase }})</span>
              <span class="metric-val">{{ ctx.statementsCount }} files</span>
            </div>
          </div>
        </mat-card>
      }

      <mat-card appearance="outlined" class="chat-card">
        <div class="messages-container">
          <div class="messages-list">
            @for (msg of messages(); track msg.timestamp + msg.role) {
              <div
                class="message-bubble"
                [class.user]="msg.role === 'user'"
                [class.assistant]="msg.role === 'assistant'"
              >
                <div class="message-role">
                  <div class="role-avatar" [class.user-avatar]="msg.role === 'user'">
                    <mat-icon>{{ msg.role === 'user' ? 'person' : 'smart_toy' }}</mat-icon>
                  </div>
                  <span class="role-name">{{
                    msg.role === 'user' ? 'You' : 'Financial Assistant'
                  }}</span>
                </div>
                <p class="message-text">{{ msg.content }}</p>
              </div>
            }
          </div>

          @if (loading()) {
            <div class="thinking-state">
              <mat-progress-bar mode="indeterminate" class="chat-progress"></mat-progress-bar>
              <span class="thinking-label">
                <mat-icon class="pulse-icon">auto_awesome</mat-icon>
                Analyzing financial context…
              </span>
            </div>
          }

          @if (error(); as err) {
            <div class="error-banner">
              <mat-icon>error_outline</mat-icon>
              <span>{{ err }}</span>
            </div>
          }
        </div>

        <div class="chat-footer">
          <form (ngSubmit)="sendQuestion()" class="chat-form">
            <mat-form-field appearance="outline" class="question-field" subscriptSizing="dynamic">
              <mat-label>Ask about your finances…</mat-label>
              <input
                matInput
                id="chat-question-input"
                type="text"
                [(ngModel)]="question"
                name="question"
                placeholder="How should I budget this month?"
              />
            </mat-form-field>
            <button
              mat-flat-button
              type="submit"
              class="btn-send"
              [disabled]="loading() || !question.trim()"
            >
              <mat-icon>send</mat-icon>
              <span>Ask</span>
            </button>
          </form>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .top-toolbar {
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(226, 232, 240, 0.8);
        position: sticky;
        top: 0;
        z-index: 100;
        height: 64px;
      }
      .toolbar-inner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 820px;
        margin: 0 auto;
        padding: 0 1rem;
      }
      .back-link {
        font-weight: 500;
        color: #475569 !important;
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .nav-link {
        color: #475569 !important;
        font-weight: 500;
      }
      .btn-logout {
        border-color: rgba(203, 213, 225, 0.8) !important;
        color: #475569 !important;
        font-size: 0.875rem;
      }
      .btn-logout:hover {
        background: #f1f5f9 !important;
        color: #0f172a !important;
      }
      .chat-page {
        padding: 2.5rem 1.25rem 4rem;
        max-width: 820px;
        margin: 0 auto;
      }
      .page-header {
        display: flex;
        align-items: flex-start;
        gap: 1.25rem;
        margin-bottom: 1.75rem;
      }
      .header-icon {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
        flex-shrink: 0;
      }
      .header-icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .header-text h1 {
        margin: 0 0 0.35rem;
        font-size: 1.85rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        color: #0f172a;
      }
      .subtitle {
        color: #64748b;
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.5;
      }
      .prompts-section {
        margin-bottom: 1.5rem;
      }
      .prompts-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
        margin-bottom: 0.5rem;
      }
      .prompt-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .prompt-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.45rem 0.85rem;
        border-radius: 20px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .prompt-chip:hover {
        background: #eef2ff;
        border-color: #93c5fd;
        color: #1d4ed8;
        transform: translateY(-1px);
      }
      .chip-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #64748b;
      }
      .prompt-chip:hover .chip-icon {
        color: #2563eb;
      }
      .context-card {
        margin-bottom: 1.5rem;
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 16px !important;
        padding: 1rem 1.25rem;
      }
      .context-title {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
        margin-bottom: 0.75rem;
      }
      .context-title mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #2563eb;
      }
      .context-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .metric-pill {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.4rem 0.75rem;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .metric-label {
        font-size: 0.75rem;
        color: #64748b;
        font-weight: 500;
      }
      .metric-val {
        font-size: 0.95rem;
        font-weight: 700;
        color: #0f172a;
        font-variant-numeric: tabular-nums;
      }
      .metric-val.pos {
        color: #059669;
      }
      .metric-val.neg {
        color: #e11d48;
      }
      .chat-card {
        background: #ffffff !important;
        border: 1px solid rgba(226, 232, 240, 0.9) !important;
        border-radius: 20px !important;
        box-shadow:
          0 4px 6px -1px rgba(15, 23, 42, 0.03),
          0 2px 4px -2px rgba(15, 23, 42, 0.03) !important;
        overflow: hidden;
      }
      .messages-container {
        padding: 1.5rem;
      }
      .messages-list {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        min-height: 280px;
        max-height: 520px;
        overflow-y: auto;
        padding-right: 0.5rem;
      }
      .message-bubble {
        padding: 1rem 1.25rem;
        border-radius: 16px;
        max-width: 85%;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      }
      .message-bubble.assistant {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        align-self: flex-start;
      }
      .message-bubble.user {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: #ffffff;
        align-self: flex-end;
      }
      .message-role {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .role-avatar {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: #eef2ff;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .role-avatar mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .role-avatar.user-avatar {
        background: rgba(255, 255, 255, 0.15);
        color: #93c5fd;
      }
      .role-name {
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #64748b;
      }
      .message-bubble.user .role-name {
        color: #cbd5e1;
      }
      .message-text {
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .thinking-state {
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        background: #f8fafc;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
      }
      .chat-progress {
        margin-bottom: 0.5rem;
      }
      .thinking-label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.825rem;
        font-weight: 500;
        color: #2563eb;
      }
      .pulse-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(0.9);
        }
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1.15rem;
        border-radius: 12px;
        margin-top: 1rem;
        font-size: 0.9rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #b91c1c;
      }
      .chat-footer {
        padding: 1.25rem 1.5rem;
        background: #fafafa;
        border-top: 1px solid #f1f5f9;
      }
      .chat-form {
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }
      .question-field {
        flex: 1;
      }
      .btn-send {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
        color: #ffffff !important;
        font-weight: 600;
        height: 52px !important;
        padding: 0 1.5rem !important;
        border-radius: 12px !important;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25) !important;
      }
      .btn-send:hover:not([disabled]) {
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35) !important;
      }
    `,
  ],
})
export class ChatComponent {
  suggestedPrompts = [
    'How should I budget?',
    'Where can I reduce spending this month?',
    'Summarize my net worth and cash flow',
  ];

  question = '';
  loading = signal(false);
  error = signal<string | null>(null);
  contextSummary = signal<ChatContextSummary | null>(null);
  messages = signal<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I can analyze your linked Plaid accounts, PostgreSQL transactions, and bank statements stored in R2 / MinIO. Try asking "How should I budget?" below.',
      timestamp: '2026-11-17T12:00:00.000Z',
    },
  ]);

  constructor(
    private chatService: ChatService,
    private auth: AuthService
  ) {}

  useSuggestedPrompt(prompt: string) {
    this.question = prompt;
    this.sendQuestion();
  }

  sendQuestion() {
    const trimmed = this.question.trim();
    if (!trimmed) {
      return;
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const currentHistory = [...this.messages(), userMsg];
    this.messages.set(currentHistory);
    this.question = '';
    this.loading.set(true);
    this.error.set(null);

    this.chatService.askQuestion(trimmed, currentHistory).subscribe({
      next: (res) => {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: res.reply,
          timestamp: new Date().toISOString(),
        };
        this.messages.set([...this.messages(), assistantMsg]);
        if (res.contextSummary) {
          this.contextSummary.set(res.contextSummary);
        }
        this.loading.set(false);
      },
      error: (err) => {
        const message = err?.error?.error || 'Failed to get response from financial assistant';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => window.location.assign('/login'),
    });
  }
}
