# [ADR-XXXX] Title of Architectural Decision

## Metadata
- **Status**: [ Proposed | Accepted | Rejected | Deprecated | Superseded by ADR-XXXX ]
- **Date**: YYYY-MM-DD
- **Deciders**: [Names / Handles]
- **Consulted**: [Security, Infra, Product stakeholders]
- **Informed**: [Engineering Team]

---

## Context & Problem Statement
<!-- 
Describe the problem statement, background context, and system requirements.
For Budget App: consider PostgreSQL schemas, Redis caching, RabbitMQ message brokers, Plaid webhooks, AI assistant integration, etc.
-->
[TODO: Explain the context, forces, and problem statement]

## Decision Drivers
<!-- 
Key drivers influencing this choice (e.g. data consistency, queue backpressure, webhook idempotency, P95 latency).
-->
- [TODO: Driver 1, e.g., Idempotent ingestion of banking transactions]
- [TODO: Driver 2, e.g., Cache hit ratio on user balance aggregations]
- [TODO: Driver 3, e.g., Security & compliance for financial credentials]

## Considered Options
<!-- 
List alternative options evaluated.
-->
- **Option 1**: [Description, pros, cons]
- **Option 2**: [Description, pros, cons]
- **Option 3**: [Description, pros, cons]

## Decision Outcome
Chosen Option: **[Option X]**, because:
[TODO: Succinct rationale explaining the trade-offs and reasons for selecting this option]

## Consequences
<!-- 
What becomes easier or harder as a result of this decision?
-->
### Positive Impacts
- [TODO: e.g., Eliminates duplicate transaction postings from Plaid webhooks]
- [TODO: e.g., Reduces PostgreSQL connection contention during batch imports]

### Negative Impacts / Trade-offs
- [TODO: e.g., Additional message serialization overhead in RabbitMQ]

### Operational / Migration Impact
- [TODO: e.g., Requires database migration script with zero-downtime column backfill]

## Validation & Benchmarks
<!-- 
How is this validated? (e.g. k6 load test results, chaos injection, Playwright E2E suites)
-->
- [TODO: Validation criteria, e.g., k6 test verifies 200 concurrent webhook deliveries without 5xx errors]

## References & Related Artifacts
- [TODO: Links to PRs, issues, design docs, or benchmarks]
