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

## API Overview

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/health` | GET | No | Health check |
| `/api/config` | GET | No | Teller config (app ID, env) |
| `/api/auth/send-otp` | POST | No | Send OTP to phone |
| `/api/auth/verify-otp` | POST | No | Verify OTP, create session |
| `/api/auth/logout` | POST | No | Clear session |
| `/api/auth/me` | GET | Yes | Current user |
| `/api/profile` | GET | Yes | User profile |
| `/api/profile` | PATCH | Yes | Update profile |
| `/api/teller/net-worth` | GET | Yes | Net worth across linked accounts |
| `/api/teller/enrollments` | GET | Yes | List enrollments |
| `/api/teller/enrollments` | POST | Yes | Create enrollment (Teller Connect) |
| `/api/teller/enrollments/:id/accounts` | GET | Yes | Get accounts for enrollment |
| `/api/teller/accounts/:id/balances` | GET | Yes | Get account balances |
| `/api/teller/accounts/:id/transactions` | GET | Yes | Get transactions |
| `/api/teller/enrollments/:id` | DELETE | Yes | Disconnect enrollment |
