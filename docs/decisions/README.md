# Architecture decision records

Create a numbered ADR for material choices: self-hostable passkeys/sessions, local device enrollment/recovery and human/service MCP OAuth under specs/IDENTITY-ACCESS-AND-RECOVERY.md, tenant/RLS context, event ordering and replay, transactional ingestion/jobs, object storage, packaging, the Rust/TypeScript boundary, durable-to-RAM consistency, hot/cold indexes, memory limits and benchmark results. Record the problem, selected option, alternatives, implications for all three deployment modes and validation evidence. OIDC/password login is optional future scope, not a mandatory first-release adapter.

Use the default stack from BUILD-PROMPT-EN.txt. A deviation needs a concrete measurable reason, not an unexplained preference. This directory does not imply those choices are already implemented.
