const { getEnvConfig } = require('../../config/env.config');
const bankService = require('../banking/bank.service');
const storageService = require('../infrastructure/storage.service');
const sentryService = require('../infrastructure/sentry.service');

// ============================================================================
// LLM FINANCIAL ASSISTANT SERVICE (GEMINI STUB)
// Answers user questions about their finances (e.g., "How should I budget?")
// by combining structured PostgreSQL data (accounts, balances, transactions)
// with bank statements stored in MinIO / Cloudflare R2.
// ============================================================================

// Gather structured financial data from PostgreSQL and bank statements from MinIO / R2
async function gatherUserFinancialContext(userId) {
  const [netWorth, dashboardSummary, statementsInfo] = await Promise.all([
    bankService.getNetWorth(userId),
    bankService.getDashboardSummary(userId, 3),
    storageService.listUserStatements(userId),
  ]);

  return {
    netWorth,
    dashboardSummary,
    statements: statementsInfo.statements || [],
    storageProvider: statementsInfo.provider,
  };
}

// Ask the Gemini-powered financial assistant a question about the user's finances
async function askFinancialAssistant(userId, question, conversationHistory = []) {
  const trimmedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!trimmedQuestion) {
    return { error: 'Question is required', status: 400 };
  }

  try {
    const { geminiApiKey } = getEnvConfig();
    const context = await gatherUserFinancialContext(userId);

    // TODO: Do NOT install a third-party AI SDK — call the Gemini HTTPS REST API directly using
    // native `fetch()` with `x-goog-api-key: geminiApiKey` (`process.env.GEMINI_API_KEY`):
    //   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
    //   Headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey }
    // Ground the prompt in `context.netWorth`, `context.dashboardSummary`, and parsed bank statements
    // from `context.statements` (MinIO in dev / Cloudflare R2 in production).
    const netWorthVal = context.netWorth?.netWorth ?? 0;
    const monthlyIncome = context.dashboardSummary?.quickStats?.thisMonthIncome ?? 0;
    const monthlyExpenses = context.dashboardSummary?.quickStats?.thisMonthExpenses ?? 0;
    const topCategory =
      context.dashboardSummary?.spendingByCategory?.[0]?.category || 'None recorded yet';

    const reply =
      `[LLM Assistant Stub] Based on your PostgreSQL & ${context.storageProvider.toUpperCase()} statement data: ` +
      `your current net worth is $${netWorthVal.toFixed(2)}, with $${monthlyIncome.toFixed(2)} in monthly income ` +
      `and $${monthlyExpenses.toFixed(2)} in monthly expenses (top spending category: ${topCategory}). ` +
      `Configure GEMINI_API_KEY to enable live AI responses for: "${trimmedQuestion}"`;

    return {
      todo: true,
      geminiConfigured: Boolean(geminiApiKey),
      question: trimmedQuestion,
      reply,
      contextSummary: {
        netWorth: netWorthVal,
        thisMonthIncome: monthlyIncome,
        thisMonthExpenses: monthlyExpenses,
        topCategory,
        statementsCount: context.statements.length,
        storageProvider: context.storageProvider,
      },
      historyLength: Array.isArray(conversationHistory) ? conversationHistory.length : 0,
    };
  } catch (err) {
    sentryService.captureException(err, {
      service: 'llm.service',
      action: 'askFinancialAssistant',
      userId,
    });
    throw err;
  }
}

module.exports = {
  gatherUserFinancialContext,
  askFinancialAssistant,
};
