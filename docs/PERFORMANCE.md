# Performance & Latency Bottlenecks

Use this document to log throughput, concurrency, and latency bottlenecks discovered across Budget App services (REST API, PostgreSQL queries, Redis cache, RabbitMQ workers), along with applied remedies and verification metrics.

---

## Summary Log

| ID | Date | Subsystem / Endpoint | Baseline (P95 / RPS) | Bottleneck Root Cause | Fix / Optimization | Post-Fix (P95 / RPS) | Status |
|----|------|----------------------|----------------------|-----------------------|--------------------|----------------------|--------|
| *PB-01* | *YYYY-MM-DD* | *e.g., GET /api/transactions* | *e.g., 650ms @ 30 RPS* | *e.g., Missing index on (user_id, date) + unpaginated eager join* | *e.g., Added composite index & cursor pagination* | *e.g., 45ms @ 350 RPS* | *Fixed* |
| *PB-02* | *YYYY-MM-DD* | *[Endpoint / Service]* | *[Baseline]* | *[Root Cause]* | *[Fix]* | *[Post-Fix]* | *Investigating* |

---

## Bottleneck Investigation Template

### [PB-XXXX] Title / Short Description

#### 1. Baseline Profile
- **Target Endpoint / Worker**: `[e.g. GET /api/banking/accounts or RabbitMQ transaction worker]`
- **Test Scenario**: `[e.g. 50 VUs ramp-up over 2m using load-tests/k6-test.js]`
- **Baseline Throughput**: `[e.g. 40 req/s]`
- **Baseline Latency**:
  - P50: `[e.g. 210ms]`
  - P95: `[e.g. 850ms]`
  - P99: `[e.g. 1800ms]`
- **Error Rate**: `[e.g. 3.5% (HTTP 504 gateway timeout)]`

#### 2. Root Cause Analysis
- **Observed Behavior**: `[PostgreSQL connection pool exhaustion, slow query, Redis cache miss storm, event loop blocking]`
- **Diagnostic Tool Used**: `[e.g., pg_stat_statements, EXPLAIN ANALYZE, clinic.js, k6 telemetry]`
- **Root Cause Details**:
  ```text
  [TODO: Insert diagnostic excerpt, EXPLAIN output, or flamegraph notes here]
  ```

#### 3. Optimization Applied
- **Changes Implemented**:
  - `[TODO: Description of indexing, query rewrite, Redis caching, worker batching, pool resizing]`
- **PR / Commit**: `[TODO: Link to commit or PR]`

#### 4. Post-Optimization Verification
- **Post-Fix Throughput**: `[e.g. 320 req/s (+700%)]`
- **Post-Fix Latency**:
  - P50: `[e.g. 25ms]`
  - P95: `[e.g. 55ms]`
  - P99: `[e.g. 110ms]`
- **Error Rate**: `[e.g. 0.0%]`
- **Regression Checks Passed**: `[Yes/No]`
