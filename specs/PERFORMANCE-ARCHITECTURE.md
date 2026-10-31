# Performance architecture: durable journal, compact Rust read engine

Status: required implementation direction and measurable targets, not measured capacity. This specification refines the default stack in BUILD-PROMPT-EN.txt and preserves every invariant in JOURNAL-AND-MCP.md. Both independent implementations receive the same contract.

## 1. Objective and workload

Order lookup, current business state, related-record navigation and agent tool calls must stay fast as journal history grows. Optimize these concrete operations rather than promising that every arbitrary historical scan is instantaneous.

An illustrative workload of 1,000 orders/day and 20–50 journal entries/order produces 7.3–18.25 million entries/year per tenant, before unrelated business events. These are planning assumptions, not measured merchant event counts. Record actual expansion from source deliveries to canonical/derived entries. Peak arrival rates, historical depth, active tenants and query concurrency matter separately.

The acceptance workload and proposed latency/memory budgets are in benchmarks/performance-contract.json. Distinguish an order, a source delivery, a journal entry, a projection row and an indexed value in every report. A benchmark with 100 million narrow integers is not evidence for 100 million complete business records in RAM.

## 2. Component boundary

- Keep React/Vite, Fastify, authentication, connector transport/orchestration and the MCP transport in TypeScript.
- Add a Rust engine for canonical deterministic business reducers, incremental projections, compact in-memory indexes, state calculations and bounded business queries. Package it as one internal service/binary, built and started by the same installer and Compose release.
- PostgreSQL remains the authoritative durable journal, transaction/outbox store and persistent checkpoint/projection store. It also supports indexed cold-history/evidence retrieval and bounded consistency metadata reads. It is not merely a startup file loader, and there is no independent authoritative RAM database.
- Keep raw payloads and attachments in evidence storage. Do not load every JSON payload, email or PDF into the hot engine.
- Use a versioned internal RPC contract between authorized application services and the engine. Start with a maintained HTTP/RPC implementation selected in an ADR; avoid a custom wire protocol. Authenticate the internal boundary, limit request sizes and do not publish the engine directly to customers.

Recommended additions: `apps/engine/` (Rust service), `crates/domain/` (pure deterministic business rules), `crates/projections/`, `crates/query/`, `crates/storage/`, a Cargo workspace and Cargo.lock. `packages/contracts/` defines shared wire schemas; generated or conformance-tested TypeScript/Rust types must agree. TypeScript application services authorize and orchestrate calls. Do not implement separate money/stock rules in TypeScript and Rust. Any TypeScript domain package is a facade/value-contract layer, not a competing financial reducer.

This replaces the earlier TypeScript-only domain default. A whole-product Rust rewrite is not required. An alternative engine design needs an ADR and equivalent correctness, memory, recovery and end-to-end benchmark evidence. Rust by itself is not proof of performance; validate the boundary with a small vertical slice before building the rest of the engine. Do not spend M0 building a general-purpose database.

## 3. Durable write, incremental projection, atomic visibility

The required flow is:

```text
verified source input
  -> committed PostgreSQL journal + durable dispatch metadata
  -> ordered/idempotent Rust projection updates
  -> versioned persisted projection/checkpoint
  -> atomically published compact RAM state
  -> authorized API/MCP response with applied cursor and freshness
```

A core journal-ingestion acknowledgement means the journal transaction is durably committed, with the configured PostgreSQL durability settings and storage guarantees documented. It does not imply that every read replica has already applied the change. Never acknowledge a write that exists only in RAM or disable fsync/synchronous durability to make the benchmark pass.

The optional public gateway has a separate gateway_received transport acknowledgement after its own durable queue commit (specs/WEBHOOK-GATEWAY.md). That receipt is not a backend journal cursor or an applied-state guarantee. Measure gateway admission, gateway backlog, canonical commit and engine lag separately; the existing durable-ingestion performance targets still measure actual backend journal commit.

Avoid independent dual writes to PostgreSQL and RAM. A crash between two best-effort writes must not lose acknowledged data or leave a permanently divergent answer. Drive the engine from committed journal positions and durable dispatch/catch-up state. Notifications are wake-up hints; a persistent cursor is the recovery mechanism. A transactional outbox and bounded cursor polling are sufficient initially. Logical decoding is optional and requires its own operational/deduplication design.

Apply entries idempotently using tenant/entry identity and the same reducer version. Commit durable projection changes and their applied cursor atomically; only then publish a consistent in-memory version. If a crash happens before RAM publication, recover the committed projection or replay the missing tail. If the implementation uses another checkpoint strategy, prove the same invariant. A reader must not observe a cursor claiming an event is applied while some associated balances or relationships still reflect the older state.

Preserve source-versus-derived event semantics. Derived assertions may extend the journal as required by JOURNAL-AND-MCP.md, but must not be re-counted as new independent cash/stock movements or produce endless derivation loops. Checkpoint and replay logic must account for them explicitly.

## 4. Read consistency and truthful freshness

Expose `applied_cursor`, `required_cursor` or captured journal cutoff, reducer version, source freshness, and a consistency/status field. Source-system freshness is distinct from engine processing lag: a current engine cannot fix a disconnected provider.

Support at least:

- `at_least_cursor`: a caller can require the cursor returned by a previous ingestion or snapshot operation. Wait only within a bounded deadline, route to a caught-up engine, use a correct durable read path, or return an explicit `projection_behind`/retry response. Never silently serve an older state as satisfying the request.
- `latest_committed`: capture the tenant's committed journal high-water mark at request start and satisfy that cutoff. A small indexed metadata read is allowed. The performance benchmark includes this consistency check, authorization and RPC overhead.
- `as_of`: honor effective-time and recorded-time/snapshot semantics from JOURNAL-AND-MCP.md. Historical state may use snapshots and bounded replay; do not reinterpret a current-state cache as a historical answer.

An optional stale/last-projected mode must be explicitly requested and labeled; it cannot be used to pass the default latency targets. A cached fast answer is not acceptable if it conceals missing committed events. Pagination must retain its snapshot boundary while newer versions are published.

## 5. Hot working set and cold history

Keep current order/customer/invoice/payment/shipment relationships, open obligations, active reservations, recent activity and commonly used summaries in memory. Address lookups by `(tenant_id, entity_type, entity_id)` or a correctly namespaced provider identity. Maintain direct entity-to-history/evidence locators. Looking up one order must not scan the full journal or perform one database query per related row.

Use compact numeric IDs, contiguous typed buffers, interned/dictionary-encoded repeated values and incremental per-entity state. Consider Arrow-style columnar buffers for scan/aggregate workloads where useful; small indexed point lookups need a suitable direct index rather than a mandatory column scan. Measure compression/decompression cost, string cardinality and index overhead. Avoid one large JSON object graph per historical event.

Precompute useful bounded summaries, such as open receivables by customer, provider balances and daily totals, with explicit currency, tenant, time semantics and version. Do not aggregate superseded snapshots or incompatible currencies. Changes must update affected state incrementally, not replay all history for every query.

The hot set must have configurable global and per-tenant budgets. Evict or page inactive data, hydrate cold entities on demand and retain complete history through indexed durable storage. No tenant can require all other tenants to warm up before its own indexed lookup works. Historical data growth must not force proportional unbounded RAM growth.

Snapshots and memory mapping can reduce restart work, but mapped files and the OS page cache still consume real resources. Report process RSS, container/cgroup memory where applicable, mapped/committed memory, allocator overhead, page faults, cache residency and transient peak memory. If RocksDB or another embedded cache is selected, treat it as rebuildable acceleration and account for all of its caches, filters and buffers; it is not a second business source of truth.

## 6. PostgreSQL remains deliberately designed

Require access-path-specific indexes, including tenant/entity/sequence lookups and tenant/sequence journal traversal. Choose additional effective-time/provider-ID indexes from actual query plans. Avoid storing every searchable field only inside opaque JSON. Use keyset pagination, bounded results and batched reads. Measure query plans with EXPLAIN (ANALYZE, BUFFERS), including rows examined, waits and I/O; capture lock/contention metrics during ingestion.

Partition only when measurements justify it and document the effect on unique constraints, foreign keys and query pruning. A time partition must not make an order-ID lookup scan every time partition. Preserve a direct lookup/locator path. PostgreSQL caches and indexes may already serve simple point lookups efficiently; benchmark an indexed PostgreSQL reference path to measure whether the extra engine actually improves the targeted workload.

The reference path must use identical business outputs and realistic indexes. It is a diagnostic comparison, not permission to maintain duplicate domain logic or run unsafe ad hoc SQL through MCP.

## 7. Restart, scale and isolation

Persist consistent, versioned snapshots/checkpoints with tenant scope, applied cursor, reducer/schema version, integrity checks and atomic publication. On startup, load a compatible snapshot or durable projection and apply only the committed tail. Reject corrupt/incompatible snapshots and rebuild affected partitions from the journal. A full rebuild must remain possible but must not be the normal restart path.

Do not block the entire service on reading every historical entry into RAM. Provide readiness by tenant/partition, bounded cold-read behavior and visible recovery status. Test engine termination before/after projection commit and RAM publication, process restart, lost cache, corrupted snapshot and rebuild while new entries arrive. Never mark old cached data as current during recovery.

For hosted mode, partition tenants across engines and route queries to an engine able to satisfy the required cursor. Define ownership/leases, failover and duplicate processing behavior. A fresh replica must report its actual applied position. Do not duplicate the entire fleet's historical data into every API process. For Mac/small-server mode, one engine process and explicit smaller memory/concurrency budgets must work with the same semantics.

RLS cannot protect data already copied into a process. Every in-memory key, snapshot, index, RPC and result needs explicit tenant scope. The application verifies current membership/scopes; do not let a stale cache preserve revoked permission. Query cancellation, per-tenant quotas, maximum page sizes and bounded concurrent scans prevent one tenant or agent from exhausting the service.

## 8. Measurement contract

Use the machine-readable benchmark contract. Proposed target profiles are engineering goals, not published capacity claims. Run a short development profile, a required 10-million-entry profile on documented reference hardware, and a separate 100-million-entry scale experiment. If hardware is unavailable, supply the runnable harness and report not run/blocked; do not extrapolate a pass from a smaller dataset or provision paid infrastructure without owner authorization.

Measure full API/MCP tool latency through authentication, authorization, serialization, internal RPC, consistency barrier, query execution and response decoding. LLM generation and public-internet latency are separate measurements, not hidden additions to the local tool SLO. Report p50/p95/p99, throughput, failure/retry rate, timeouts and correctness under concurrent ingestion. Fast rejections, stale responses and truncated partial answers do not count as successful fast queries.

Separate hot lookup, cold lookup, history page, bounded aggregate, full scan, raw evidence download, cold start and snapshot restart. Do not imply the point-lookup target covers every analytical query. Randomize keys over a representative working set; avoid a single repeated order that only exercises response caching. Include one large tenant, high-cardinality IDs/strings, late/duplicate events, long histories, cache misses, expired authorization and all five tracks.

For the 100-million experiment, report two separate results: (1) a complete durable dataset with a bounded hot set and correct cold access; (2) an optional compact in-memory representation experiment stating precisely which columns, indexes and records are resident. Include raw evidence size, excluded columns, encoded bytes/value, resident indexes, total process/host memory and ingestion/recovery costs. Neither result may be mislabeled as the other.

## 9. References for implementation decisions

- [PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html): index leading columns and query predicates must align.
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html): inspect actual plans, cardinalities and buffers rather than blaming the database by default.
- [PostgreSQL durability](https://www.postgresql.org/docs/current/wal-reliability.html): durable acknowledgement depends on storage and flush guarantees.
- [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html): consumers still need deduplication/recovery and replication-slot operational controls.
- [Apache Arrow format](https://arrow.apache.org/docs/format/Columnar.html): compact typed columnar layout helps particular workloads; it does not supply application mutation/consistency semantics.
- [RocksDB memory accounting](https://github.com/meta/rocksdb/wiki/Memory-usage-in-RocksDB): memory includes more than the configured block cache.

These references motivate design choices; they do not establish that this unbuilt application meets any performance target. Verify current dependency versions and measure the implementation.
