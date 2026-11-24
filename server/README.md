# Budget App API

Node.js + Express backend for the Budget App, backed by PostgreSQL (Sequelize), Redis, RabbitMQ, and S3-compatible object storage (MinIO locally, Cloudflare R2 in production).

## Setup

Ensure local infrastructure is running (`npm run infra:up` from the repository root), then:

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:4000` by default. See `.env.example` for all environment variables and optional integrations (Plaid, Gemini, SMTP, Twilio, Web Push VAPID keys, Sentry).

## Scripts

```bash
npm run dev     # Start server with file watching
npm start       # Start server
npm test        # Run Node test suite
```

## API Overview

Routes are organized by domain under `routes/` (plus public runtime config at `GET /api/config` in `app.ts`):

- **System** (`routes/index.routes.ts`) — Health check and service status
- **Authentication** (`routes/auth.routes.ts`) — Phone/email OTP, signup, sessions, and WebAuthn passkeys
- **Profile** (`routes/profile.routes.ts`) — User profile details, contact updates, and passkey management
- **Banking** (`routes/bank.routes.ts`) — Plaid linking, connected accounts, transactions, and financial summaries
- **AI Chat** (`routes/chat.routes.ts`) — Financial assistant conversations
- **Push Notifications** (`routes/push_service.routes.ts`) — Web Push subscriptions and notifications
