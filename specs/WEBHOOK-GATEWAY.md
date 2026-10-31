# Webhook gateway — deferred

No webhook gateway is required or enabled in the local pilot. Use outbound polling/import/reconciliation under LOCAL-PILOT.md and SOURCE-SYNCHRONIZATION.md. A private running Mac has no public provider callback URL. Explain unsupported or incomplete capabilities instead of suggesting localhost can receive external webhooks.

The prior gateway design and its durability/security gates are preserved in future/WEBHOOK-GATEWAY.md and the deferred acceptance cases. They are options to evaluate after feedback, not automatic implementation work. Do not provision public hosting, DNS or a tunnel as a workaround. Keep gateway receipt, canonical commit and Rust applied state conceptually distinct if a later release implements the gateway.
