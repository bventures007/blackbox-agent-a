#!/usr/bin/env python3
"""Validate active pilot scope; --release checks recorded evidence, not its truth."""
import argparse
import importlib.util
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('integration_register', ROOT / 'scripts/integration-register.py')
register_tools = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(register_tools)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(root, path):
    return json.loads((root / path).read_text())


def unique(values, label):
    require(isinstance(values, list) and all(isinstance(v, str) for v in values), f'{label}: expected IDs')
    require(len(values) == len(set(values)), f'{label}: duplicate ID')
    return set(values)


def validate_profile(profile, acceptance, report, register, benchmark, preserved):
    require(profile['active_profile'] == acceptance['active_profile'] == report['active_profile'] == 'local_pilot', 'Active profile drift')
    cases = {c['id']: c for c in acceptance['cases']}
    results = {c['id']: c for c in report['cases']}
    require(len(cases) == len(acceptance['cases']) and len(results) == len(report['cases']), 'Duplicate case/result')
    active = unique(profile['required_acceptance_ids'], 'Active acceptance')
    deferred = unique(profile['deferred_acceptance_ids'], 'Deferred acceptance')
    require(active and deferred and not active & deferred and active | deferred == cases.keys(), 'Active/deferred cases must partition all IDs')
    require(results.keys() == cases.keys(), 'Every acceptance ID needs one result record')
    for ident, case in cases.items():
        scope = 'local_pilot' if ident in active else 'deferred_future'
        require(case['delivery_scope'] == results[ident]['delivery_scope'] == scope, f'Scope drift: {ident}')
        require(case['stage'] == results[ident]['stage'], f'Stage drift: {ident}')
        require(results[ident]['status'] in acceptance['status_enum'], f'Unknown result status: {ident}')
        require(scope != 'deferred_future' or results[ident]['status'] == 'not_started', f'Deferred work is not active evidence: {ident}')
    old = {c['id']: c for c in preserved['cases']}
    for ident, original in old.items():
        require(ident in cases and {k:v for k,v in cases[ident].items() if k != 'delivery_scope'} == original, f'Preserve prior case semantics: {ident}')
    required = unique(profile['required_integration_rows'], 'Required integration rows')
    providers = unique(profile['required_integration_providers'], 'Required providers')
    require(unique(register['active_pilot_providers'], 'Register pilot providers') == providers, 'Generated register pilot scope drift')
    rows = {r['id']: r for r in register['rows']}
    require(required and providers and providers <= {r['provider'] for r in rows.values()}, 'Unknown/empty pilot providers')
    require(required == {r['id'] for r in rows.values() if r['provider'] in providers}, 'Pilot provider selection must include every capability row')
    require(profile['supported_connectivity_modes'] == ['local_standalone'], 'Pilot must remain local standalone')
    require(set(profile['deferred_connectivity_modes']) == {'local_gateway','public_server'}, 'Deferred mode declaration drift')
    require(profile['required_benchmark_profiles'] == ['smoke'], 'Pilot benchmark selection drift')
    require(set(profile['deferred_benchmark_profiles']) == {'reference_10m','scale_100m'}, 'Deferred benchmark declaration drift')
    require(set(benchmark['profiles']) == set(profile['required_benchmark_profiles'] + profile['deferred_benchmark_profiles']), 'Benchmark profile coverage drift')
    return active, required


def release_result(case, result):
    if not case.get('release_gate'):
        return
    status = result['status']
    if case['id'] == 'SEC-03' and status == 'not_applicable':
        require(result.get('observed_result') and result.get('evidence_paths'), 'Optional extraction absence needs recorded evidence')
    else:
        require(status == 'passed', f"Pilot blocked: {case['id']} is {status}")
        require(result.get('command') and result.get('environment') and result.get('observed_result'), f"Missing observed test evidence: {case['id']}")
    require(isinstance(result.get('tested_commit'), str) and re.fullmatch(r'[a-f0-9]{40}', result['tested_commit']), f"Tested full commit required: {case['id']}")
    require(isinstance(result.get('evidence_paths'), list) and result['evidence_paths'], f"Evidence paths required: {case['id']}")


def require_capability_approval(rows, states, selected, approval=register_tools.approved):
    by_id = {row['id']: row for row in rows}
    for ident in sorted(selected):
        require(approval(by_id[ident], states[ident]), f'Pilot blocked: {ident} is not independently approved')


def verify_committed_evidence(root, result):
    tested = result['tested_commit']
    subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',tested,'HEAD'], check=True, capture_output=True)
    changed = register_tools.git(root, 'diff', '--name-only', tested, 'HEAD').decode().splitlines()
    # Evidence/documentation commits may follow the tested code; changed code/contracts may not.
    allowed = lambda p: p.startswith(('reports/', 'docs/')) or p in {'README.md', 'reference/baseline.json'}
    require(all(allowed(p) for p in changed), 'Tests are stale relative to code or active contracts')
    for name in result['evidence_paths']:
        path = register_tools.safe_path(root, name)
        require(path.is_file() and path.stat().st_size > 0, f'Missing/empty evidence: {name}')
        require(register_tools.git(root, 'show', 'HEAD:' + name) == path.read_bytes(), f'Uncommitted evidence: {name}')


def validate(root=ROOT, release=False):
    profile = read(root, 'delivery-profile.json')
    a = read(root, 'ACCEPTANCE.json')
    r = read(root, 'reports/acceptance.json')
    reg, _, _, states = register_tools.validate(root)
    active, selected = validate_profile(profile, a, r, reg, read(root, 'benchmarks/performance-contract.json'), read(root, profile['preserved_platform_acceptance']))
    if release:
        require(not register_tools.git(root, 'status', '--porcelain').strip(), 'Commit the tested implementation and evidence before release verification')
        results = {x['id']:x for x in r['cases']}
        for case in a['cases']:
            if case['id'] in active and case.get('release_gate'):
                result = results[case['id']]
                release_result(case, result)
                verify_committed_evidence(root, result)
        require_capability_approval(reg['rows'], states, selected)
    return len(active), len(a['cases'])-len(active), len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', action='store_true', help='Require current pilot product evidence and selected independent capability approvals')
    args = parser.parse_args()
    try:
        active, deferred, rows = validate(release=args.release)
        print(f'Profile valid: {active} active pilot cases, {deferred} deferred cases, {rows} required capability rows.')
        print('This validates scope/evidence records; it does not execute or certify product tests.')
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'ERROR: {error}\n')


if __name__ == '__main__':
    main()
