#!/usr/bin/env python3
"""Merge actual evidence into reports/acceptance.json. Input: a JSON file mapping case id -> {status, command, observed_result,
evidence_paths, blocker}. Every referenced evidence path must exist. `tested_commit` and `environment` are applied to every
updated case. Statuses are restricted to the report's status_enum; nothing here creates a pass without an observed result.

Usage: python3 scripts/update-acceptance.py --commit SHA --environment "..." --results work/acceptance-results.json
"""
import argparse, json, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--commit', required=True); ap.add_argument('--environment', required=True); ap.add_argument('--results', required=True)
    a = ap.parse_args()
    report_path = ROOT / 'reports' / 'acceptance.json'; report = json.loads(report_path.read_text())
    spec = json.loads((ROOT / report['specification']).read_text()); allowed = set(spec['status_enum']) if isinstance(spec.get('status_enum'), list) else set(spec['status_enum'].keys())
    results = json.loads((ROOT / a.results).read_text())
    cases = {c['id']: c for c in report['cases']}
    problems = []
    for cid, r in results.items():
        if cid not in cases: problems.append(f'unknown case {cid}'); continue
        if r['status'] not in allowed: problems.append(f'{cid}: status {r["status"]} not in {sorted(allowed)}'); continue
        for p in r.get('evidence_paths', []):
            if not (ROOT / p).exists(): problems.append(f'{cid}: evidence path missing: {p}')
        if r['status'] == 'passed' and not (r.get('observed_result') and r.get('command') and r.get('evidence_paths')): problems.append(f'{cid}: a pass needs command, observed_result and evidence_paths')
        if r['status'] == 'blocked_external' and not r.get('blocker'): problems.append(f'{cid}: a blocked case needs a blocker')
    if problems: print('\n'.join(problems)); sys.exit(1)
    for cid, r in results.items():
        c = cases[cid]
        c.update({'status': r['status'], 'tested_commit': a.commit if r['status'] != 'not_started' else None, 'command': r.get('command'), 'environment': a.environment if r['status'] != 'not_started' else None,
                  'observed_result': r.get('observed_result'), 'evidence_paths': r.get('evidence_paths', []), 'blocker': r.get('blocker')})
    from collections import Counter
    counts = Counter(c['status'] for c in report['cases'])
    report['note'] = f"Updated {datetime.datetime.now(datetime.timezone.utc).isoformat()} from actual evidence at commit {a.commit[:12]}; counts: " + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())) + '. delivery_scope distinguishes active pilot proof from deferred platform references; deferred work is not a pass.'
    report_path.write_text(json.dumps(report, indent=1) + '\n')
    print('acceptance.json updated:', dict(counts))


if __name__ == '__main__':
    main()
