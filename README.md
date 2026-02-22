# Budget App

A modern financial budgeting web application designed to help users take control of their finances — tracking spending, managing subscriptions, setting savings goals, and more.

## Features (Planned)

<!-- TODO: Build out the following features -->

- **Dashboard** — At-a-glance view of income, expenses, and net worth
- **Transaction Tracking** — Automatic categorization and manual entry of transactions
- **Budget Management** — Create and manage monthly budgets by category
- **Subscription Tracking** — Detect and manage recurring charges
- **Savings Goals** — Set, track, and visualize progress toward financial goals
- **Bill Reminders** — Alerts for upcoming bills and due dates
- **Spending Insights** — Charts and analytics to understand spending habits
- **Account Linking** — Connect bank accounts via [Teller.io](https://teller.io)
- **Reports & Export** — Generate financial reports and export data

## Tech Stack

**PEAN Stack** — PostgreSQL, Express, Angular, Node.js

- **PostgreSQL** — Relational database
- **Express** — REST API backend
- **Angular** — SPA frontend
- **Node.js** — Runtime

Additional: Sequelize ORM, JWT auth (planned), Docker for local Postgres

## Project Structure

```
budget-app/
├── client/                 # Angular application
│   ├── src/app/
│   │   ├── components/     # Login, Dashboard, Bank Accounts
│   │   ├── services/       # API, Auth, Teller
│   │   └── guards/
│   └── package.json
├── server/                 # Node/Express API
│   ├── controllers/
│   ├── models/             # User, Session, Enrollment, Account
│   ├── routes/
│   ├── test/               # API tests
│   └── package.json
├── docs/internal/         # Teller setup, etc.
├── .github/workflows/      # CI (tests on push)
├── docker-compose.yml
└── package.json            # Root scripts (test, etc.)
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL)
- npm or yarn

From the project root, install dependencies:

```bash
npm run install:all
```

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Backend (API)

```bash
cd server
cp .env.example .env   # Edit if needed
npm install
npm run dev
```

API runs at `http://localhost:4000`

### 3. Frontend (Angular)

```bash
cd client
npm install
ng serve
```

App runs at `http://localhost:4200` (proxies `/api` to backend)

### 4. Login (sandbox)

In sandbox/development, sign in with:

- **Phone:** `555-555-5555` (or `+15555555555`)
- **OTP:** `123456`

Sessions use HTTP-only cookies. Log out via the dashboard or bank accounts page.

## Format & Lint

```bash
npm run format     # Prettier
npm run lint       # Check lint
npm run lint:fix   # Auto-fix lint issues
```

These run automatically on commit via Husky + lint-staged.

## Testing

Run all tests (requires Docker for PostgreSQL):

```bash
npm test
```

Or run separately:

```bash
npm run test:server   # API tests (auth, health, config)
npm run test:client   # Angular component tests
```

Tests run automatically on push/PR via GitHub Actions. A pre-commit hook also runs tests before each commit.

## License

> TBD
