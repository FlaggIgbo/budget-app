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
- `POST /api/auth/send-otp` — Send login code
- `POST /api/auth/verify-otp` — Verify code and log in
- `POST /api/auth/logout` — Log out
- `GET /api/auth/me` — Get current user
- `GET /api/profile` — Get profile info
- `GET /api/teller/net-worth` — Calculate net worth
- `GET /api/teller/dashboard-summary` — Get monthly summary & stats
- `GET /api/teller/enrollments` — List connected banks
- `POST /api/teller/enrollments` — Save bank connection
- `DELETE /api/teller/enrollments/:id` — Disconnect bank
