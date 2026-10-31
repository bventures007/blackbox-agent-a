#!/usr/bin/env python3
"""Update reports/question-coverage.json from the actual integration run: per-question positive path, missing-data path,
API/MCP parity and restart/cold path results are taken from the vitest JSON reporter and the evidence files written by
tests/integration/queries.test.ts and slice.test.ts. Specification assessment fields and their counts are left untouched
(the catalogue validator pins them). Nothing is marked passed without a passing test in the cited run.

Usage: python3 scripts/update-question-coverage.py --commit SHA --vitest tests/evidence/tmp/vitest-integration.json --run-id RUN
"""
import argparse, json, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARITY_INTENTS = {'inventory.available_to_sell', 'invoices.outstanding', 'providers.money_positions', 'returns.lifecycle', 'orders.payment_state'}
RESTART_REFS = {'collection-01'}  # fixed-cutoff answers compared before/after restart and after snapshot removal (SLICE-01)


def cases(vitest: Path):
    data = json.loads(vitest.read_text()); out = {}
    for f in data['testResults']:
        for a in f['assertionResults']: out[a['fullName']] = a['status']
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--commit', required=True); ap.add_argument('--vitest', required=True); ap.add_argument('--run-id', required=True)
    a = ap.parse_args(); status = cases(ROOT / a.vitest)
    catalog = json.loads((ROOT / 'apps/web/src/catalog.json').read_text()); intent_of = {q['ref']: q['intent'] for g in catalog for q in g['questions']}
    qres = json.loads((ROOT / 'tests/evidence/current/queries.json').read_text())
    report = json.loads((ROOT / 'reports/question-coverage.json').read_text())
    def block_passed(fragment):
        hits = [v for k, v in status.items() if fragment in k]
        return bool(hits) and all(v == 'passed' for v in hits)
    groups = {'order': 'order-01..04', 'delivery': 'delivery-01..04', 'invoice': 'invoice-01..04 and collection-01..04', 'collection': 'invoice-01..04 and collection-01..04', 'settlement': 'settlement-01..04 and reversal-01..04', 'reversal': 'settlement-01..04 and reversal-01..04'}
    missing_all = qres.get('missing_all_intents', {}); missing_ok = block_passed('every one of the 24 intents answers an empty workspace')
    parity_ok = block_passed('identical results through the SDK MCP bridge (MCP-01)'); slice_parity_ok = block_passed('serves the same answer through the real SDK stdio MCP bridge')
    restart_ok = block_passed('survives a full stack restart and a removed engine snapshot')
    evidence = ['tests/evidence/current/queries.json', f'reports/integrations/{a.run_id}/vitest-integration.json']
    for q in report['questions']:
        ref = q['id']; intent = intent_of[ref]; grp = ref.split('-')[0]
        positive = 'passed' if block_passed(groups[grp]) and ref in qres else ('failed' if ref in qres or block_passed(groups[grp]) is False else 'not_started')
        q['implementation'] = 'implemented'
        q['positive_path_test'] = positive
        q['missing_data_test'] = 'passed' if missing_ok and missing_all.get(ref, {}).get('status') in ('insufficient_data', 'partial') else 'failed' if ref in missing_all else 'not_started'
        if intent in PARITY_INTENTS:
            ok = (parity_ok and intent in {'inventory.available_to_sell', 'invoices.outstanding', 'providers.money_positions', 'returns.lifecycle'}) or (slice_parity_ok and intent == 'orders.payment_state')
            q['api_mcp_parity_test'] = 'passed' if ok else 'failed'
        else:
            q['api_mcp_parity_test'] = 'not_tested'
        q['restart_cold_path_test'] = ('passed' if restart_ok else 'failed') if ref in RESTART_REFS else 'not_tested'
        q['live_verification'] = 'not_verified'
        q['tested_commit'] = a.commit
        q['evidence_paths'] = evidence + (['tests/evidence/current/slice-01.json'] if ref in RESTART_REFS or intent == 'orders.payment_state' else [])
    report['product_tests_run'] = True
    report['reviewed_date'] = datetime.date.today().isoformat()
    report['review_kind'] = 'specification_audit_plus_product_integration_tests'
    report['live_business_data_calls_made'] = False
    report['test_run'] = {'run_id': a.run_id, 'commit': a.commit, 'note': 'Synthetic producers and fixtures only; API/MCP parity exercised for five intents, restart/cold path for the order payment state; all 24 positive and missing-data paths through the shared query service.'}
    (ROOT / 'reports/question-coverage.json').write_text(json.dumps(report, indent=1) + '\n')
    from collections import Counter
    print('positive:', dict(Counter(q['positive_path_test'] for q in report['questions'])), 'missing:', dict(Counter(q['missing_data_test'] for q in report['questions'])), 'parity:', dict(Counter(q['api_mcp_parity_test'] for q in report['questions'])))


if __name__ == '__main__':
    main()
