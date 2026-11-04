# Budget App API

Express + Node.js backend connecting to PostgreSQL and Teller.io.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

API runs on port `4000`.

## API Endpoints

- `GET /api/health` — Check server status
- `GET /api/config` — Get Teller settings
- `POST /api/otp/request` — Send login code
- `POST /api/otp/verify` — Verify code and log in
- `POST /api/auth/logout` — Log out
- `GET /api/auth/me` — Get current user
- `GET /api/profile` — Get profile info
- `GET /api/bank/net-worth` — Calculate net worth
- `GET /api/bank/dashboard-summary` — Get monthly summary & stats
- `GET /api/bank/enrollments` — List connected banks
- `POST /api/bank/exchange-token` — Save bank connection
- `DELETE /api/bank/enrollments/:id` — Disconnect bank
