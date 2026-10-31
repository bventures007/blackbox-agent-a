# Deferred design reference — not a pilot requirement

Preserved from baseline-v10. This is a future option requiring a new owner decision, not authorization to implement it during the local pilot. References below describe the previous platform assignment; use the active root specifications and delivery-profile.json for current work. Passkey-only authentication is not a settled future decision.

# Optional public webhook gateway

Required implementation for M5; optional deployment/use for each customer. It enables provider push to a backend in a private network without inbound port forwarding. It is a separately deployable transport service, not a second journal, public admin proxy or business-query engine. Standalone mode remains independent of this service.

## Route and trust boundary

`provider → registered public HTTPS callback → verified durable gateway queue → backend-initiated authenticated connection → local canonical journal/outbox commit → Rust applied state`

The callback registered with Shopify/payment/carrier providers is the publicly reachable gateway HTTPS URL. It is never localhost, the private host address or the outgoing delivery connection. Document per-provider automatic/manual registration, subscription topics, validation challenges, rotation and removal. Do not promise push if that provider/product/account lacks it. The local backend initiates an authenticated TLS long-poll or WebSocket connection; choose and document one maintained implementation. No incoming local ports or consumer-router changes are needed. A development tunnel can aid testing but is not the durable production gateway or mandatory user setup.

Keep provider API/OAuth credentials at the connector backend, encrypted with recoverable keys outside the database. Gateway provisioning shares only the minimum material actually needed to validate deliveries. Some providers use app-wide secrets, certificates or different callback mechanisms; document scope and blast radius, and block an unsupported scheme instead of forwarding unverified input as trusted. The gateway sees provider payloads to verify/queue them; do not claim it is end-to-end encrypted against the gateway operator. TLS, encryption at rest, minimal metadata, access control and an explicit retention policy are required.

Gateway registration binds an authenticated workspace, connection, provider account and backend installation. Authenticate both provider→gateway and gateway→backend legs. A signed forwarding envelope or equivalent authenticated channel binds original bytes/hash, selected signature headers, receipt ID, verified connection, API/topic revision and receipt timestamp. Revalidate original provider evidence at the backend where possible. Never derive tenant routing from a payload tenant ID, guessed order ID or user-controlled callback query alone. Verify timestamp/replay rules where the provider defines them without inventing a timestamp guarantee for every provider. Reject signature failures, oversized payloads and unsupported encodings without logging secrets.

## Three different receipts

| State | Meaning | Durable owner |
| --- | --- | --- |
| `gateway_received` | Raw verified delivery and routing/envelope metadata have committed to the gateway queue; successful provider response is now permitted | Gateway |
| `journal_committed` | The local backend has committed canonical Source observation, dedup identity and transactional outbox; gateway acknowledgement includes stable backend commit evidence | Backend PostgreSQL |
| `engine_applied` | Rust has applied a consistent committed cutoff according to the performance/checkpoint contract | Backend Rust/projection state |

A provider HTTP success from the gateway proves only the first state. It never proves the other states, end-to-end processing or external-history completeness. Core direct-ingestion acknowledgements retain their canonical-commit meaning. Gateway receipt identifiers and backend journal cursors are distinct typed values.

Use a durable queue (PostgreSQL is the default, with separately named database/volumes and minimal queue schema). Exact raw body and validation metadata must survive restart. Do not require Redis/Kafka. Mutable queue rows may be leased, acknowledged and expired under policy; they are not immutable business records. Keep operational audit records without leaking sensitive payloads. An unacknowledged receipt remains queued within the explicit retention/quota policy. The local consumer acknowledges only after journal/outbox commit, never on RAM enqueue or HTTP delivery. Delete acknowledged payloads promptly under a documented short retention policy; retain bounded minimal delivery metadata as needed.

Delivery is at least once. Use leases/fencing, bounded batches/payload sizes, exponential reconnect/backoff with jitter and a persisted cursor or receipt set that cannot skip an unacknowledged gap. Multiple consumers or a lost acknowledgement must not produce two business effects. Dedup across direct webhook, gateway and reconciliation using the provider/account business identity; a gateway receipt ID alone is insufficient. Preserve event ordering metadata, but never rely on delivery order for financial/stock correctness. Quarantine poison messages, expose retry controls and retain their known gap; one tenant must not block another.

## Queue limits, retention and operations

Choose and document default byte/count/age limits, per-tenant quotas, capacity alerts, retry/lease limits, maximum payload size, acknowledged retention and unacknowledged retention before release. Make applicable provider delivery deadlines/retries explicit. Demonstrate capacity with the tested workload; do not promise unlimited buffering or zero loss across indefinite downtime. When durable admission fails or quota is exhausted, return the provider-appropriate retry/error response and emit visible health; never successfully acknowledge and silently drop. If an accepted unacknowledged receipt must expire under the declared policy, record the gap, alert the workspace, and reconcile where possible. A provider's finite retry/history window may make full recovery impossible; answers must then remain partial.

Customers must see where payloads are buffered, operator/data-retention responsibilities and what disconnect does. Gateway outages fall back to polling only for capabilities with a verified fallback; other capabilities become delayed/unsupported. Revocation stops delivery immediately within its documented bound. Rotation/reassignment must preserve pending tenant binding and reject old credentials; a retired workspace must never deliver into another one. Pause routing during workspace migration with writer fencing and an audited takeover protocol. Do not redirect queues just because a desktop profile URL changes.

Deliver separate Compose config, domain/TLS setup, health/readiness, redacted metrics/logs, backup/restore, upgrade, credential rotation and recovery instructions. Gateway deployment needs a genuinely public HTTPS address. Preparing this repository does not provision a public service or pay for hosting; missing DNS/host/account authorization must be reported as the exact blocked external verification.

## Required proof

GATEWAY-01 through GATEWAY-05 exercise external-style delivery with a private consumer, all crash/ack boundaries, duplicate/reordered delivery, tampering/wrong tenant/revocation, backlog/expiry/quota, health and recovery. Network-isolated synthetic tests must deny inbound connections to the backend while permitting outbound delivery consumption. An actual public callback/provider verification is separate authorized live evidence; localhost/container simulation is not proof of an internet registration. Test complete flows to PostgreSQL, Rust, browser and MCP, with exact payload evidence, financial invariants and three-state freshness. Reuse launch adapters; do not expand the launch-provider list.
