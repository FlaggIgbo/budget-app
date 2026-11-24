import controller = require('../controllers/chat.controller');
import requireAuth = require('../middleware/requireAuth');

// LLM Financial Assistant chat routes
export = (app) => {
  app.post('/api/chat/ask', requireAuth, controller.askQuestion);
};
