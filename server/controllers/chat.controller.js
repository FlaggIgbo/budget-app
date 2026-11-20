const llmService = require('../services/ai/llm.service');

// ============================================================================
// CHAT CONTROLLER (LLM FINANCIAL ASSISTANT ENDPOINTS)
// Answers user questions about their finances using PostgreSQL + MinIO/R2 data
// ============================================================================

// POST /api/chat/ask -> Ask the financial assistant a question (e.g., "How should I budget?")
exports.askQuestion = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const question = req.body?.question || req.body?.prompt;
    const history = req.body?.history || [];

    const result = await llmService.askFinancialAssistant(req.user.id, question, history);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
};
