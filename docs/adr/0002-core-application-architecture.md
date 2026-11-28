# 0002. Core Application Architecture: Web Push API, Event-Driven Plaid Webhooks, RabbitMQ Event Bus, and Redis Session Management

## Metadata
- **Status**: Accepted (Updated)
- **Date**: 2026-11-28
- **Deciders**: Engineering Team
- **Consulted**: Security, Frontend, Backend Contributors
- **Informed**: All Team Members

---

## Context & Problem Statement
Budget App requires:
1. Native-like mobile user engagement and offline-capable notifications on mobile and desktop devices.
2. Fresh account balances and transaction data driven by real-time banking events without blocking interactive REST API reads or relying on periodic cron polling.
3. Secure authentication session management with automatic sign-out after inactivity to protect sensitive financial data.

## Architectural Decisions

### 1. PushSubscription & Push API for Progressive Web App (PWA)
- **Decision**: Implemented W3C `PushSubscription` and the `Push API` web libraries (backed by VAPID web-push on the server) to deliver background budget alerts, transaction notifications, and account sync updates.
- **Rationale**: Enables Progressive Web App (PWA) capabilities without native app store deployment overhead, ensuring re-engagement even when the browser tab is closed.

### 2. Event-Driven Plaid Webhooks & RabbitMQ Domain Event Bus (Replacing Cron Polling)
- **Decision**: Removed the in-process daily cron scheduler and synchronous inline Plaid syncs on `GET` endpoints. Instead, Plaid webhooks (`POST /api/bank/webhooks/plaid`, verified via `Plaid-Verification` ES256 JWT + SHA-256 body hash), user logins, and bank enrollments emit domain events onto a durable RabbitMQ topic exchange (`budget_app.events`). Dedicated RabbitMQ consumers (`budget_app.bank_sync_jobs` and `budget_app.push_notifications` + DLQ) subscribe independently to relevant routing keys (`user.logged_in`, `plaid.webhook.sync_updates_available`, `plaid.webhook.item_error`, `bank.enrollment.created`, `bank.sync.completed`, `push.notification.requested`).
- **Rationale**: Decouples producers from consumers, insulates interactive `GET` endpoints so they read purely from PostgreSQL, eliminates duplicate cron execution across multi-replica deployments, and delivers near-real-time updates when banks report new transactions.

### 3. Redis-Backed Auth Session Tokens with Inactivity TTL
- **Decision**: Utilizing Redis key-value storage for authentication session tokens, configured with a time-to-live (TTL) expiration window that automatically invalidates inactive sessions.
- **Rationale**: Enforces automatic session termination after a specified duration for financial security, prevents stale credential reuse, and provides instant O(1) session invalidation upon explicit logout.

## Consequences
### Positive Impacts
- **PWA Experience**: Direct OS-level push notifications to mobile and desktop users via standard web primitives.
- **True Event-Driven Decoupling**: Bank sync workers emit `bank.sync.completed` without knowing about the push notification service; Plaid webhooks trigger incremental syncs immediately; `GET` endpoints stay fast by reading only from PostgreSQL.
- **Financial-Grade Security**: Storing tokens in Redis with expiring TTL guarantees automated sign-out of idle users, and Plaid webhook JWT verification prevents forged sync triggers.

### Negative Impacts / Trade-offs & Future Work
- **RabbitMQ & Redis Dependencies**: Event-driven sync/push pipelines require healthy RabbitMQ availability, and authentication verification requires Redis availability.
- **Public Webhook Endpoint**: Receiving live Plaid webhooks requires configuring a publicly reachable HTTPS `PLAID_WEBHOOK_URL`.
