# Budget App

A simple budgeting app to track your net worth, income, expenses, and linked bank accounts.

## Features

- **Net Worth** — See total assets, liabilities, and overall net worth.
- **Cash Flow** — Monthly income vs. expenses chart and quick statistics.
- **Spending by Category** — Visual breakdown of expenses for the current month.
- **Bank Accounts** — Link and disconnect bank accounts via Plaid (supports `sandbox` and `development` in localhost dev, and `production` in live).
- **Phone OTP Login & Redis 1h Sessions** — Phone number + SMS verification code login with 1-hour session tokens stored in Redis, plus verified email linking on your Profile for personal finance summaries.
- **Priority RabbitMQ Sync Queue** — Enqueues high-priority balance/transaction sync jobs when a user logs in and normal-priority jobs from a daily CRON scheduler.
- **AI Financial Assistant (`/chat`)** — Ask budgeting and cash-flow questions grounded in your PostgreSQL financial data and bank statements stored in MinIO / Cloudflare R2 (`GEMINI_API_KEY`).

## Tech Stack

- **Frontend**: Angular 19 + Angular Material (Material 3)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via Sequelize ORM)
- **Session & OTP Store**: Redis (5-min OTP TTL, 1-hour Session TTL)
- **Job Queue**: RabbitMQ (Priority Queue for login-triggered & daily CRON sync jobs)
- **Object Storage**: MinIO (local S3-compatible dev cluster) / Cloudflare R2 (production bank statements)
- **Bank Integration**: Plaid (Plaid Link + REST API)
- **Observability**: Sentry error logging stubs (`SENTRY_DSN`)

## Quick Start

### 1. Start Local Infrastructure (PostgreSQL, Redis, RabbitMQ, MinIO)

```bash
npm run infra:up
# or: docker compose up -d
```

Services started:
- **PostgreSQL**: `localhost:5432` (`postgres:postgres`, DB: `budget_app`)
- **Redis**: `localhost:6379` (OTP codes & 1-hour auth session tokens)
- **RabbitMQ**: `localhost:5672` (AMQP) / `http://localhost:15672` (Management UI: `guest` / `guest`)
- **MinIO S3 API**: `http://localhost:9000` (Bucket: `budget-statements`)
- **MinIO Web Console**: `http://localhost:9001` (`minioadmin` / `minioadmin`)

### 2. Start the Backend API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

API runs at `http://localhost:4000`.

### 3. Start the Frontend

```bash
cd client
npm install
npm start
```

App runs at `http://localhost:4200`.

## Test Login (Sandbox)

Use these test credentials on the login page:

- **Phone**: `+15551234567`
- **Code**: `123456`

## Testing, Linting & Screenshot Automation

Run all checks from the root directory:

```bash
npm test              # Run server and client unit tests
npm run test:e2e      # Run Playwright end-to-end browser flow (saves video recording)
npm run screenshots   # Regenerate component and page visual screenshot baselines
npm run lint          # Check code style
npm run format        # Format files with Prettier
```

## TODO / Roadmap

- [ ] **Automated Bank-to-Budget Sync & Zero-Downtime Rule Engine**
  - **Overview**: Ingest real bank/credit card transactions automatically, run deduplication, and classify them into budget buckets.
  - **Daily Utility**: Connect to bank aggregation webhooks/APIs, normalize raw merchant strings (e.g., `"TST* NOMANS LIC NY"` &rarr; `"Nomans"`, `"Dining Out"`), and push structured events into the database.
  - **System Design Concepts**:
    - **Idempotent Write Pipeline**: Content-hash deduplication (`account_id` + `amount` + `raw_date` + `merchant_pattern`) to prevent duplicate postings from re-delivered or out-of-order webhooks.
    - **Outbox Pattern & Async Enrichment**: Commit raw transaction payloads to an append-only log before dispatching to asynchronous categorization workers.
    - **Dynamic Rule Engine**: Editable categorization rules (merchant matching, price thresholds, split categories) that re-evaluate transactions without service restarts.
