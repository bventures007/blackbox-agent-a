# Independent comparison protocol

Both repositories receive the same initial commit. Preserve that baseline and build independently. Repository A/B are labels, not different feature scopes or architectures. Do not inspect the competing implementation during the build.

1. Record each agent/model/version and execution environment in build-environment.md. Give both comparable budgets, hardware, permissions and provider access; disclose differences.
2. Use independent working directories, database/volume names and secrets. If both run locally, configure separate ports and Compose project names. A repository name alone does not isolate Docker volumes or ports.
3. Preserve the M0–M3 plus local-installer checkpoint as a tested commit. Record it in reports/checkpoint.md and the tested commit for every acceptance result. Keep later work so the same checkpoint remains reviewable.
4. Review each from a fresh checkout. Use REVIEW-PROMPT-EN.txt, ACCEPTANCE.json and independently varied data. Do not trust screenshots or the builder's pass claim alone.
5. Apply SCORECARD.json only at the same scope. Report pending external/operations checks separately. A disqualifier overrides a high weighted score.
6. Select one primary foundation. Adopt specific reviewed improvements from the other later; do not automatically merge the two systems or their databases.

Required comparison output: tested commits; install results; correctness and tenant-isolation findings; design fidelity; effort to add a source/question; restore/upgrade evidence when in scope; weighted score and release blockers. The owner chooses after this review.

The v8 contract retains the same early checkpoint: complete core browser workflow plus local Compose installation. Native Mac packaging, the optional-use public gateway and deployment migration belong to M5 and may remain unfinished at the checkpoint. A full-release comparison must exercise those features and the per-capability connectivity evidence; do not compare one agent at the checkpoint with another at full scope.

Baseline v9 adds core historical-import onboarding and data-readiness behavior at the same comparison checkpoint. Evaluate selected versus accessible history, real progress and counts, central Sources health and per-answer dependencies with synthetic provider-shaped fixtures. Missing real merchant access must not excuse missing core behavior; actual provider verification remains M4 and native/gateway scope remains M5.

Baseline v10 fixes the owner-approved identity model equally for both builds: passkeys, protected local opening, owner/reader human roles and distinct read-only agents. Compare core bootstrap, grants, recovery, revocation and protocol tests at M0–M3 plus local installation. Separate virtual-authenticator results from M5 native Keychain/real-Mac proof and external MCP-client evidence. Both builders receive the same simplified role contract; it does not relax tenant isolation or other existing gates.
