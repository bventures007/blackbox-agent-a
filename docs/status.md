# Implementation status

## Current state

Repository preparation is complete. Product implementation has not started. The source snapshot is a static prototype with simulated data. No production or provider acceptance case has run.

## Milestones

- [ ] M0 — product/architecture contract, ADRs, threat model, acceptance mapping
- [ ] M1 — authentication, tenant isolation, persistence, ingestion, core UI
- [ ] M2 — Golden Scenario, replay/restart, English/German
- [ ] M3 — real MCP and 24 shared query contracts
- [ ] Comparison checkpoint — M0–M3 plus local installation and report
- [ ] M4 — first real connector adapters and capability verification
- [ ] M5 — release profiles, recovery, upgrade and operation evidence

## Latest verification

Seed preparation only: JSON parsing, reference checksums, requirement counts and matching repository baseline. This is not evidence of a working product. All cases in ../reports/acceptance.json start as not_started.

## Next action

Read START-HERE.md and the full brief. Inspect the prototype and environment. Record capabilities in build-environment.md, create the product/architecture/ADR documents, and begin M1 after the minimum M0 decisions.

## External prerequisites

No credentials are required for the initial synthetic build. Later verify Shopify/Shopify Payments scopes/account access, easybill API access and DHL API/product eligibility. Record access and limitations per capability. Verify actual available Docker, Mac/Linux and MCP-client environments before claiming platform coverage.

## Update after each meaningful checkpoint

Record: current task; files/commit; actual start/test commands; observed results; open failures; external blockers; next concrete action. Keep the complete per-case execution record in ../reports/acceptance.json.
