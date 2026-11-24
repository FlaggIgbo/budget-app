# 0001. Record Architecture Decisions

## Metadata
- **Status**: Accepted
- **Date**: 2026-11-24
- **Deciders**: Engineering Team
- **Consulted**: Core Contributors
- **Informed**: All Team Members

---

## Context & Problem Statement
Budget App coordinates multiple complex subsystems: an Angular PWA frontend, Express REST APIs, PostgreSQL data persistence, Redis caching/session stores, RabbitMQ asynchronous job workers, and external Plaid/Gemini integrations. Architectural choices need explicit documentation to avoid regression, misaligned assumptions, and knowledge silos.

## Decision Drivers
- Need for clear architectural history regarding data consistency, queue semantics, and caching.
- Alignment across backend, frontend, and infrastructure domains.
- Lightweight and Git-tracked process.

## Considered Options
- **Option 1**: Architecture Decision Records (ADRs) kept in `docs/adr/`.
- **Option 2**: External wiki / Notion / Confluence.
- **Option 3**: PR descriptions and code comments only.

## Decision Outcome
Chosen Option: **Option 1 (ADRs in `docs/adr/`)**, because ADRs in Git ensure decisions live alongside application code, stay versioned across releases, and participate in peer review.

## Consequences
### Positive Impacts
- Systematic record of architectural rationale and trade-offs.
- Streamlined code reviews and developer onboarding.

### Negative Impacts / Trade-offs
- Requires ongoing maintenance when architectural patterns or dependencies are superseded.
