# Local browser interface

The production UI uses React 19.3.1 and Vite 8.3.5, pinned in the lockfile. Build with `pnpm build:web`; Fastify serves only its generated index and allowlisted hashed JS/CSS/font assets. There is no Vite server in the installed runtime. Development Vite is fixed to loopback port 19744. Fonts are packaged locally; neither Google Fonts nor an external language model is contacted.

The supplied visual language is retained: 218px dark-green navigation, paper background, Manrope headings and DM Sans body, lime selection, five colored recorder tracks, evidence drawers and responsive navigation. Reference assets remain unchanged. Production counts and events come from the authorized PostgreSQL journal and service observations. Bundled synthetic example inputs are ingested through the same durable ingest/outbox/Rust path; expected fixture answers are never shipped to the browser.

Owner sessions are HttpOnly/SameSite cookies. State-changing API calls carry a session-bound CSRF token. Local storage contains only the selected interface locale. Agent/producer keys are shown once in a dismissible dialog and never stored by the browser. Technical source content is rendered as text with an explicit untrusted-content label; there is no HTML interpretation.

The model-free Questions & Answers page exposes all 24 typed intents with item/entity, currency, business time and recorded-cutoff controls. Monetary formatting changes presentation only; every result value and inference comes from Rust. Exact source identifiers and original content retain their language. User-facing navigation, instructions and question templates have English and German resources. Technical event/schema identifiers are shown where useful for provenance; semantic result translations are still being completed.

Journal filters use bounded fixed-cutoff pagination; signatures bind workspace, principal and complete filter parameters. Filters include track, event type, connection, entity and effective-time interval. The read-only MCP schema exposes the same filters. Invalid cross-principal cursors return 400 without revealing records.

System observations refresh every five seconds while visible. The API proves an authorized database read, probes the actual private engine endpoint and reports its committed/applied cursor. Worker heartbeat is sampled independently of provider success. An unmeasured MCP client is unknown. Logs use exact severity filters and bounded newest-first pagination, exclude other workspaces, and sanitize again at read time. Explicit diagnostic export pseudonymizes IDs and contains at most 1,000 sanitized rows. It never uploads data. This is an incremental diagnostics implementation, not DIAG-01–08 completion: durable collector indexing, debug expiry, full correlation, retry aggregation and complete retention proof remain open.

Source onboarding/synchronization, controlled review decisions, backup enrollment and operational settings are being implemented separately. Corresponding screens disclose current limitations. This interface increment is not a completed P4 installation or handover.

Primary implementation references: [React](https://react.dev/learn), [Vite](https://vite.dev/guide/).
