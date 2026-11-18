const controller = require('../controllers/chat.controller');
const requireAuth = require('../middleware/requireAuth');

// LLM Financial Assistant chat routes
module.exports = (app) => {
  app.post('/api/chat/ask', requireAuth, controller.askQuestion);
};
