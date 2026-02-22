/**
 * Express app - exported for testing.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

app.use(cookieParser());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [/^http:\/\/localhost(:\d+)?$/];
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/config', (req, res) => {
  const isSandbox =
    process.env.TELLER_ENVIRONMENT === 'sandbox' || process.env.NODE_ENV === 'development';
  res.json({
    tellerApplicationId: process.env.TELLER_APPLICATION_ID || '',
    tellerEnvironment: process.env.TELLER_ENVIRONMENT || 'sandbox',
    ...(isSandbox && {
      authSandbox: { phone: '555-555-5555', otp: '123456' },
    }),
  });
});

// DB-dependent routes (health, auth, teller)
require('./models');
require('./routes/index.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/teller.routes')(app);

app.use(require('./middleware/errorHandler'));

module.exports = app;
