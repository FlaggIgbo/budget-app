# 0002. Core Application Architecture: Web Push API, Scheduled Account Sync, and Redis Session Management

## Metadata
- **Status**: Accepted
- **Date**: 2026-11-24
- **Deciders**: Engineering Team
- **Consulted**: Security, Frontend, Backend Contributors
- **Informed**: All Team Members

---

## Context & Problem Statement
Budget App requires:
1. Native-like mobile user engagement and offline-capable notifications on mobile and desktop devices.
2. Fresh account balances and transaction data without requiring continuous manual refreshes by the user.
3. Secure authentication session management with automatic sign-out after inactivity to protect sensitive financial data.

## Architectural Decisions

### 1. PushSubscription & Push API for Progressive Web App (PWA)
- **Decision**: Implemented W3C `PushSubscription` and the `Push API` web libraries (backed by VAPID web-push on the server) to deliver background budget alerts, transaction notifications, and account sync updates.
- **Rationale**: Enables Progressive Web App (PWA) capabilities without native app store deployment overhead, ensuring re-engagement even when the browser tab is closed.

### 2. Cron-Based Polling for Accounts and Balances
- **Decision**: Currently utilizing scheduled background CRON tasks (`services/jobs`) to poll connected financial institutions (Plaid API) for updated account summaries and balances.
- **Rationale**: Keeps user account balances and net worth calculations synchronized on a predictable schedule while insulating the interactive REST API from external banking API latency and rate limits.

### 3. Redis-Backed Auth Session Tokens with Inactivity TTL
- **Decision**: Utilizing Redis key-value storage for authentication session tokens, configured with a time-to-live (TTL) expiration window that automatically invalidates inactive sessions.
- **Rationale**: Enforces automatic session termination after a specified duration for financial security, prevents stale credential reuse, and provides instant O(1) session invalidation upon explicit logout.

## Consequences
### Positive Impacts
- **PWA Experience**: Direct OS-level push notifications to mobile and desktop users via standard web primitives.
- **Predictable Sync**: Scheduled cron jobs batch-update financial data, reducing real-time API contention.
- **Financial-Grade Security**: Storing tokens in Redis with expiring TTL guarantees automated sign-out of idle users, minimizing exposure if a device is left unattended.

### Negative Impacts / Trade-offs & Future Work
- **Cron Polling Lag**: Balances update on cron intervals rather than instant event-driven bank webhooks (webhook ingestion planned as future milestone).
- **Redis Dependency**: Authentication verification requires healthy Redis availability; connection loss degrades auth checks unless fallback or high availability (Sentinel/Cluster) is active.
