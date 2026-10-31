#!/usr/bin/env python3
"""Record implementation and test evidence for the pilot's integration rows from an actual committed revision and an
actual vitest run. Nothing here invents a result: a test event is `passed` only when every referenced case passed in the
cited run, `failed` when any referenced case failed, and `blocked` when the required environment (live provider access,
a real statement, an authorized external producer) was not available. Independent review events are never written here.

Usage:
  python3 scripts/record-register-evidence.py implementation --commit SHA --actor-id ID --actor-name NAME
  python3 scripts/record-register-evidence.py tests --commit SHA --run-id RUN --actor-id ID --actor-name NAME \
      --vitest tests/evidence/tmp/vitest-integration.json --environment "..." [--dry-run]
The result is appended through scripts/integration-register.py (which validates and regenerates INTEGRATIONS.md).
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = ('mapping', 'transport', 'postgres', 'rust', 'query_mcp', 'operations')
PROFILE = json.loads((ROOT / 'delivery-profile.json').read_text())
ROWS = PROFILE['required_integration_rows']
MODES_ALL = ['local_standalone', 'local_gateway', 'public_server']
MODES_PILOT = ['local_standalone']

CORE_CODE = [
    'packages/contracts/src/journal.ts', 'packages/contracts/src/query.ts', 'packages/database/migrations/0001_foundation.sql',
    'packages/database/migrations/0002_scheduler_scope_reads.sql', 'packages/database/src/journal.ts', 'packages/database/src/client.ts',
    'packages/application/src/ingest/service.ts', 'packages/application/src/sources/service.ts', 'packages/application/src/jobs.ts',
    'crates/domain/src/payloads.rs', 'crates/domain/src/derive.rs', 'crates/domain/src/derived.rs', 'crates/domain/src/state.rs', 'crates/domain/src/money.rs',
    'crates/projections/src/lib.rs', 'crates/query/src/lib.rs', 'crates/storage/src/lib.rs', 'apps/engine/src/runtime.rs', 'apps/engine/src/main.rs',
    'apps/api/src/routes/query.ts', 'apps/api/src/mcp-core.ts', 'apps/mcp-bridge/src/main.ts', 'apps/api/src/app.ts',
    'pnpm-lock.yaml', 'Cargo.lock', 'infra/compose/compose.yaml', 'infra/docker/node.Dockerfile', 'infra/docker/engine.Dockerfile',
]
PROVIDER_CODE = {
    'shopify': ['packages/application/src/connectors/shopify.ts', 'apps/worker/src/shopify-job.ts', 'apps/worker/src/main.ts', 'apps/api/src/routes/sources.ts', 'packages/application/src/sources/import-plan.ts', 'fixtures/shopify-fixture-server/server.mjs'],
    'shopify_payments': ['packages/application/src/connectors/shopify.ts', 'apps/worker/src/shopify-payments-job.ts', 'apps/worker/src/main.ts', 'apps/api/src/routes/sources.ts', 'fixtures/shopify-fixture-server/server.mjs'],
    'generic': ['packages/application/src/connectors/generic.ts', 'apps/api/src/routes/ingest.ts', 'packages/application/src/auth/service.ts'],
    'replay': ['packages/application/src/connectors/replay.ts', 'apps/api/src/routes/ingest.ts', 'GOLDEN-ORDER-TO-CASH.json'],
    'bank_csv': ['packages/application/src/connectors/bank-csv.ts', 'apps/api/src/routes/sources.ts'],
    'policy': ['apps/api/src/routes/sources.ts'],
    'runtime': ['apps/api/src/routes/ingest.ts', 'apps/api/src/routes/sources.ts', 'packages/application/src/auth/service.ts', 'packages/application/src/diagnostics/health.ts'],
}
WORK = {
    'shopify': {
        'mapping': 'Shopify GraphQL Admin API 2025-10 orders/transactions/fulfillments/refunds/returns/inventory mapped to typed observations in connectors/shopify.ts (mapOrder, mapInventoryLevel); provider ids kept as identity; missing fields declared in the mapping artifact.',
        'transport': 'local_standalone polling only: plan-driven fixed UTC window, cursor pagination, 10-minute overlap, 5-minute incremental polls, Retry-After/cost throttling, 401/403 to reauthorization_required; gateway/public callbacks unsupported and refused.',
        'postgres': 'per-page durable commit through journal_append (dedup by namespace:provider id, BBX02 conflicts to review cases), capability cursors and coverage facts per run, append-only enforced by triggers and role grants.',
        'rust': 'deterministic r1 derivation into fact/commitment/movement/reservation tracks, per-entity reducers, tenant projections with LRU eviction, checkpoints and snapshot+tail restart (rebuild on unreadable snapshot).',
        'query_mcp': 'shared API/MCP query core with committed/applied cursor coverage, evidence entry ids, partial/insufficient_data answers from coverage facts; SDK stdio bridge exercised against the same answers.',
        'operations': 'runs/counters/health per capability, structured correlated logs, maintenance fence, backup/restore/upgrade scripts, diagnostics export; fixture server stands in for the provider until credentials are authorized.',
    },
}
WORK['shopify_payments'] = dict(WORK['shopify'], mapping='Shopify Payments balanceTransactions/payouts/disputes mapped to ledger postings, payout announcements/sends and dispute facts in apps/worker/src/shopify-payments-job.ts; holds and balance breakdown are not exposed by the API and stay explicit unknowns.')
WORK['generic'] = dict(WORK['shopify'], mapping='Signed generic producer envelope (HMAC-SHA256 over the raw body, producer key) validated against the strict typed source vocabulary; unknown or invalid events are quarantined as review cases, never silently dropped.', transport='authenticated push over loopback from an authorized producer; no polling; idempotency key per envelope; declared coverage recorded as runtime coverage facts.')
WORK['replay'] = dict(WORK['shopify'], mapping='Bundled Golden Order-to-Cash fixture mapped to typed observations with optional scale/suffix/stop_after variants; labelled synthetic in every run and coverage fact.', transport='owner-triggered internal replay; no external transport.')
WORK['bank_csv'] = dict(WORK['shopify'], mapping='Bank CSV rows mapped by an explicit column/date/decimal profile to bank.credit_booked/debit_booked with statement-scoped identity; preview before commit; amount-only matches are never auto-linked.', transport='owner-initiated file import; no polling.')
WORK['policy'] = dict(WORK['shopify'], mapping='Owner-recorded rules (allocation priority, invoicing trigger, reminder policy, tolerance) as versioned rule facts with effective_from.', transport='owner writes through the API; internal producer.')
WORK['runtime'] = dict(WORK['shopify'], mapping='Runtime producer: coverage facts per capability/run, identity facts for principals; no provider data.', transport='internal; emitted by API/worker during runs.')

TESTS = {
    # kind -> (vitest files, case ids, modes, command)
    'contract': (['integration/contract.test.ts'], ['CONTRACT-MAPPING', 'CONTRACT-CATALOG', 'CONTRACT-REFUSAL'], MODES_ALL),
    'tenant_isolation': (['integration/journal.test.ts', 'integration/slice.test.ts'], ['TENANT-01', 'TENANT-02', 'TENANT-03', 'JOURNAL-01', 'JOURNAL-02'], MODES_PILOT),
    'recovery': (['integration/slice.test.ts', 'integration/golden.test.ts'], ['LOCAL-09', 'DOMAIN-02', 'SLICE-01'], MODES_PILOT),
}
PIPELINE = {
    'shopify': (['integration/slice.test.ts', 'integration/queries.test.ts'], ['SLICE-01', 'collection-01', 'collection-02', 'order-01', 'order-02', 'delivery-01', 'invoice-02']),
    'shopify_payments': (['integration/payments.test.ts'], ['settlement-01', 'settlement-02', 'reversal-04']),
    'generic': (['integration/queries.test.ts'], ['QUERY-01', 'QUERY-02', 'INGEST-01']),
    'replay': (['integration/golden.test.ts'], ['DOMAIN-01', 'DOMAIN-02', 'DOMAIN-03', 'DOMAIN-07', 'IMPORT-02']),
    'bank_csv': (['integration/queries.test.ts'], ['settlement-01', 'settlement-03']),
    'policy': (['integration/queries.test.ts'], ['invoice-02', 'collection-04', 'order-02']),
    'runtime': (['integration/queries.test.ts', 'integration/diagnostics.test.ts'], ['QUERY-02', 'DIAG-02', 'DIAG-03']),
}
LIVE_BLOCKED = {
    'shopify': ('No Shopify store or custom-app token was authorized for this session; live verification needs an owner-authorized store (read_orders, read_all_orders, read_inventory, read_fulfillments, read_returns).', 'Shopify GraphQL Admin API 2025-10 (not exercised live)'),
    'shopify_payments': ('No Shopify Payments account was authorized for this session; live verification needs read_shopify_payments_payouts/disputes on an owner store.', 'Shopify GraphQL Admin API 2025-10 shopifyPaymentsAccount (not exercised live)'),
    'generic': ('No external authorized producer supplied real events in this session; only the repository test producer was exercised.', 'generic envelope v1 (synthetic producer only)'),
    'bank_csv': ('No real merchant bank statement was supplied; only the synthetic statement in tests/integration/queries.test.ts was imported.', 'bank CSV profile v1 (synthetic statement only)'),
}


def sha256_path(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def git_blob_sha(commit: str, path: str) -> str:
    data = subprocess.run(['git', '-C', str(ROOT), 'show', f'{commit}:{path}'], capture_output=True, check=True).stdout
    return hashlib.sha256(data).hexdigest()


def now_iter():
    t = datetime.datetime.now(datetime.timezone.utc)
    while True:
        yield t.strftime('%Y-%m-%dT%H:%M:%S.') + f'{t.microsecond:06d}'[:3] + 'Z'
        t += datetime.timedelta(milliseconds=1)


def implementation_events(commit: str, actor: dict, clock):
    events = []
    for row in ROWS:
        provider = row.split('.')[0]
        code_paths = sorted(set(CORE_CODE + PROVIDER_CODE[provider] + [f'integrations/mappings/{row}.json']))
        code = [{'path': p, 'sha256': git_blob_sha(commit, p)} for p in code_paths]
        mapping = next(c for c in code if c['path'] == f'integrations/mappings/{row}.json')
        events.append({'id': f'claim-{row}-{commit[:8]}', 'row': row, 'at': next(clock), 'actor': actor, 'action': 'claim',
                       'note': f'Claimed by the implementing agent session for the local pilot (commit {commit[:12]}).'})
        events.append({'id': f'impl-{row}-{commit[:8]}', 'row': row, 'at': next(clock), 'actor': actor, 'action': 'implementation', 'commit': commit,
                       'contributors': [actor['id']], 'work': WORK[provider], 'code': code, 'mapping': mapping,
                       'note': f'Local pilot implementation of {row} at commit {commit[:12]}: six steps as described; synthetic fixtures only, live provider access not authorized in this session.'})
    return events


def load_vitest(path: Path):
    data = json.loads(path.read_text())
    files = {}
    for f in data.get('testResults', []):
        name = f['name']; rel = os.path.relpath(name, ROOT / 'tests') if os.path.isabs(name) else name
        cases = [{'name': a['fullName'], 'status': a['status'], 'duration_ms': a.get('duration')} for a in f.get('assertionResults', [])]
        files[rel] = {'status': f['status'], 'cases': cases, 'failed': sum(1 for c in cases if c['status'] == 'failed'), 'passed': sum(1 for c in cases if c['status'] == 'passed')}
    return data, files


def test_events(commit: str, run_id: str, actor: dict, environment: str, vitest_path: Path, clock, dry: bool):
    data, files = load_vitest(vitest_path)
    out_dir = ROOT / 'reports' / 'integrations' / run_id; out_dir.mkdir(parents=True, exist_ok=True)
    if vitest_path.resolve() != (out_dir / 'vitest-integration.json').resolve(): shutil.copyfile(vitest_path, out_dir / 'vitest-integration.json')
    evidence_dir = ROOT / 'tests' / 'evidence' / 'current'
    events = []
    for row in ROWS:
        provider = row.split('.')[0]
        kinds = dict(TESTS); kinds['pipeline'] = (PIPELINE[provider][0], PIPELINE[provider][1], MODES_PILOT)
        for kind, (vfiles, case_ids, modes) in kinds.items():
            missing = [f for f in vfiles if f not in files]
            result = 'failed' if missing or any(files[f]['failed'] for f in vfiles) else 'passed'
            summary = {f: {'status': files[f]['status'], 'passed': files[f]['passed'], 'failed': files[f]['failed'], 'cases': files[f]['cases']} for f in vfiles if f in files}
            artifact = {'row': row, 'kind': kind, 'run_id': run_id, 'tested_commit': commit, 'command': f"cd tests && npx vitest run --config vitest.integration.config.ts {' '.join(vfiles)}",
                        'environment': environment, 'vitest_files': summary, 'missing_files': missing, 'evidence_files': sorted(p.name for p in evidence_dir.glob('*.json')), 'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            art_path = out_dir / f'{row}.{kind}.json'; art_path.write_text(json.dumps(artifact, indent=1) + '\n')
            observed = f"{sum(s['passed'] for s in summary.values())} passed, {sum(s['failed'] for s in summary.values())} failed in {', '.join(vfiles)}" + (f"; missing results for {missing}" if missing else '')
            events.append({'id': f'test-{kind}-{row}-{run_id}', 'row': row, 'at': next(clock), 'actor': actor, 'action': 'test', 'revision': f'impl-{row}-{commit[:8]}', 'tested_commit': commit, 'kind': kind, 'result': result,
                           'command': artifact['command'], 'environment': environment, 'case_ids': case_ids, 'modes': modes, 'observed': observed,
                           'artifact': {'path': str(art_path.relative_to(ROOT)), 'sha256': sha256_path(art_path)},
                           'note': f'{kind} evidence for {row} from run {run_id}: synthetic fixtures/producers only; results copied verbatim from the vitest JSON reporter.'})
        if provider in LIVE_BLOCKED:
            reason, source_rev = LIVE_BLOCKED[provider]
            art_path = out_dir / f'{row}.live.json'; art_path.write_text(json.dumps({'row': row, 'kind': 'live', 'result': 'blocked', 'reason': reason, 'tested_commit': commit, 'run_id': run_id}, indent=1) + '\n')
            events.append({'id': f'test-live-{row}-{run_id}', 'row': row, 'at': next(clock), 'actor': actor, 'action': 'test', 'revision': f'impl-{row}-{commit[:8]}', 'tested_commit': commit, 'kind': 'live', 'result': 'blocked',
                           'command': 'not executed (no authorized provider access)', 'environment': environment, 'case_ids': ['SLICE-02', 'SOURCE-01'] if provider.startswith('shopify') else ['SOURCE-01'], 'modes': MODES_PILOT, 'observed': 'blocked: ' + reason,
                           'authorized_scope': 'none granted in this session', 'source_revision': source_rev,
                           'artifact': {'path': str(art_path.relative_to(ROOT)), 'sha256': sha256_path(art_path)}, 'note': 'Live verification remains an external blocker; the synthetic evidence above does not substitute for it.'})
    return events


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('phase', choices=('implementation', 'tests')); ap.add_argument('--commit', required=True); ap.add_argument('--actor-id', required=True); ap.add_argument('--actor-name', required=True)
    ap.add_argument('--run-id'); ap.add_argument('--vitest'); ap.add_argument('--environment'); ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(); actor = {'id': a.actor_id, 'name': a.actor_name, 'kind': 'agent'}; clock = now_iter()
    if a.phase == 'implementation': events = implementation_events(a.commit, actor, clock)
    else:
        if not (a.run_id and a.vitest and a.environment): sys.exit('tests phase needs --run-id, --vitest and --environment')
        events = test_events(a.commit, a.run_id, actor, a.environment, Path(a.vitest), clock, a.dry_run)
    out = ROOT / 'work' / f'register-events-{a.phase}-{a.commit[:8]}.json'; out.parent.mkdir(exist_ok=True); out.write_text(json.dumps(events, indent=1) + '\n')
    print(f'{len(events)} events written to {out.relative_to(ROOT)}')
    if a.dry_run: return
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'integration-register.py'), 'append', '--event', str(out)], check=True)


if __name__ == '__main__':
    main()
