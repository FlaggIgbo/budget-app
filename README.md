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
- **Account Linking** — Connect bank accounts and credit cards
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
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   └── models/
│   │   └── assets/
│   └── package.json
├── server/                 # Node/Express application
│   ├── config/             # DB connection & environment
│   ├── controllers/
│   ├── models/             # Sequelize definitions
│   ├── routes/
│   ├── middleware/
│   ├── index.js            # Entry point
│   └── package.json
├── docker-compose.yml      # PostgreSQL instance
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL)
- npm or yarn

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

## License

> TBD
