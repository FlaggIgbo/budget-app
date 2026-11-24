# Budget App

A personal budgeting web application for tracking net worth, cash flow, spending, and linked bank accounts.

## Features

- **Net Worth & Cash Flow** — Track assets, liabilities, net worth, monthly income vs. expenses, and category spending breakdowns.
- **Bank Accounts** — Connect and manage bank accounts via Plaid with background balance and transaction syncing.
- **Authentication & Profile** — Phone and email OTP verification, WebAuthn passkeys, session management, and profile contact updates.
- **PWA, Offline Queue & Push Notifications** — Installable progressive web app with offline action queueing and Web Push notifications.
- **AI Financial Assistant** — Chat interface for budgeting and cash-flow questions grounded in your account data and bank statements.

## Tech Stack

- **Frontend**: Angular + Angular Material (PWA)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Sequelize ORM)
- **Cache & Sessions**: Redis
- **Background Jobs**: RabbitMQ
- **Object Storage**: MinIO (local dev) / Cloudflare R2 (production)
- **Integrations**: Plaid (banking), Gemini (AI chat), Web Push, optional Sentry error tracking

## Project Structure

- [`client/`](./client/README.md) — Angular frontend application
- [`server/`](./server/README.md) — Express REST API, background workers, and database models
- [`screenshots/`](./screenshots/README.md) — Playwright visual regression baselines

## Quick Start

### 1. Start Local Infrastructure

Starts PostgreSQL, Redis, RabbitMQ, and MinIO via Docker Compose:

```bash
npm run infra:up
# or: docker compose up -d
```

See `docker-compose.yml` for local ports and default dev credentials.

### 2. Start the Backend API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

API runs at `http://localhost:4000`. See `server/.env.example` for available configuration options.

### 3. Start the Frontend

```bash
cd client
npm install
npm start
```

App runs at `http://localhost:4200`.

## Test Login (Sandbox)

In local development mode, use these test credentials on the login page:

- **Phone**: `+15551234567`
- **Code**: `123456`

## Common Commands

Run from the repository root:

```bash
npm test              # Run server and client unit tests
npm run test:e2e      # Run Playwright end-to-end browser flow
npm run screenshots   # Regenerate component and page screenshot baselines
npm run lint          # Lint server and client code
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

---

## Performance & Bottlenecks

Track throughput and latency bottlenecks identified across API routes, database queries, Redis caching, and RabbitMQ workers:

- **Detailed Investigation Template & Log**: [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md)
- **Architecture Decision Records**: [`docs/adr/`](./docs/adr/)
- **Load & Chaos Harness**: [`load-tests/k6-test.js`](./load-tests/k6-test.js)

### Bottleneck Log

| Subsystem / Endpoint | Baseline (P95 / RPS) | Identified Bottleneck | Fix / Optimization | Post-Fix (P95 / RPS) | Status |
|----------------------|----------------------|-----------------------|--------------------|----------------------|--------|
| `GET /api/bank/transactions` | *TODO: e.g. 650ms @ 30 RPS* | *TODO: Full table scan on transactions* | *TODO: Composite index + cursor pagination* | *TODO: 45ms @ 350 RPS* | *Pending* |
| `POST /api/chat` | *TODO* | *TODO* | *TODO* | *TODO* | *Pending* |

