# Budget App API

Node.js + Express + Sequelize + PostgreSQL REST API.

## Setup

```bash
npm install
cp .env.example .env   # Edit TELLER_APPLICATION_ID, etc.
npm run dev
```

Requires PostgreSQL (e.g. `docker compose up -d` from project root).

## Tests

```bash
npm test
```

Requires a running PostgreSQL instance. Uses `DATABASE_URL` or `DB_*` env vars from `.env`.

Tests cover:
- **Health & Config** — `/api/health`, `/api/config`
- **Auth** — `/api/auth/send-otp`, `/api/auth/verify-otp` (sandbox credentials)
