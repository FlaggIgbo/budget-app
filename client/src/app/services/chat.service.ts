import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatContextSummary {
  netWorth: number;
  thisMonthIncome: number;
  thisMonthExpenses: number;
  topCategory: string;
  statementsCount: number;
  storageProvider: string;
}

export interface ChatAskResponse {
  todo?: boolean;
  geminiConfigured?: boolean;
  question?: string;
  reply?: string;
  contextSummary?: ChatContextSummary;
  historyLength?: number;
  queued?: boolean;
  queueId?: number;
  message?: string;
}

// ============================================================================
// CHAT SERVICE (LLM FINANCIAL ASSISTANT)
// Sends user budgeting & finance questions to the backend LLM service, which
// combines PostgreSQL account/transaction data with MinIO/R2 bank statements.
// ============================================================================
@Injectable({ providedIn: 'root' })
export class ChatService {
  constructor(private api: ApiService) {}

  // POST /api/chat/ask -> Ask a question about the user's financial data
  askQuestion(question: string, history: ChatMessage[] = []): Observable<ChatAskResponse> {
    return this.api.post<ChatAskResponse>('/chat/ask', {
      question,
      history,
    });
  }

  // TODO: Add streaming SSE/WebSocket method (`streamQuestion`) once Gemini streaming
  // is enabled on the backend for real-time token-by-token responses.
}
