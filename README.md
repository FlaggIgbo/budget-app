# Budget App

A simple budgeting app to track your net worth, income, expenses, and linked bank accounts.

## Features

- **Net Worth** — See total assets, liabilities, and overall net worth.
- **Cash Flow** — Monthly income vs. expenses chart and quick statistics.
- **Spending by Category** — Visual breakdown of expenses for the current month.
- **Bank Accounts** — Link and disconnect bank accounts via Teller.io.
- **Easy Login** — Phone number + verification code login with built-in test credentials.

## Tech Stack

- **Frontend**: Angular 19
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via Sequelize ORM)
- **Bank Integration**: Teller.io

## Quick Start

### 1. Start PostgreSQL Database

```bash
docker compose up -d
```

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

- **Phone**: `555-555-5555`
- **Code**: `123456`

## Testing & Linting

Run all checks from the root directory:

```bash
npm test        # Run server and client tests
npm run lint    # Check code style
npm run format  # Format files with Prettier
```

## TODO / Roadmap

- [ ] **Automated Bank-to-Budget Sync & Zero-Downtime Rule Engine**
  - **Overview**: Ingest real bank/credit card transactions automatically, run deduplication, and classify them into budget buckets.
  - **Daily Utility**: Connect to bank aggregation webhooks/APIs, normalize raw merchant strings (e.g., `"TST* NOMANS LIC NY"` &rarr; `"Nomans"`, `"Dining Out"`), and push structured events into the database.
  - **System Design Concepts**:
    - **Idempotent Write Pipeline**: Content-hash deduplication (`account_id` + `amount` + `raw_date` + `merchant_pattern`) to prevent duplicate postings from re-delivered or out-of-order webhooks.
    - **Outbox Pattern & Async Enrichment**: Commit raw transaction payloads to an append-only log before dispatching to asynchronous categorization workers.
    - **Dynamic Rule Engine**: Editable categorization rules (merchant matching, price thresholds, split categories) that re-evaluate transactions without service restarts.
