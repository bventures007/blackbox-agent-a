#!/usr/bin/env python3
"""Validate an evidence-backed work register and render its human-readable view.

This validates records and references, not the truth of a test execution. Reviewers
must inspect evidence and reproduce tests. No dependencies beyond Python 3/Git.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACKS = ('source', 'fact', 'commitment', 'movement', 'reservation')
STEPS = ('mapping', 'transport', 'postgres', 'rust', 'query_mcp', 'operations')
TESTS = ('contract', 'pipeline', 'recovery', 'tenant_isolation')
MODES = ('local_standalone', 'local_gateway', 'public_server')
METHODS = {'polling', 'direct_webhook', 'gateway_webhook', 'import', 'internal', 'authenticated_push'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(root, path):
    return json.loads((root / path).read_text())


def safe_path(root, value):
    require(isinstance(value, str) and value and not Path(value).is_absolute(), 'Expected relative artifact path')
    path = (root / value).resolve()
    require(path.is_relative_to(root.resolve()), 'Artifact escapes repository')
    return path


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, check=True)
    return result.stdout


def artifact(root, ref, commit=None):
    path = safe_path(root, ref['path'])
    require(re.fullmatch(r'[a-f0-9]{64}', ref['sha256']), 'Artifact requires SHA-256')
    data = git(root, 'show', f"{commit}:{ref['path']}") if commit else path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == ref['sha256'], f"Artifact digest mismatch: {ref['path']}")
    return data


def check_mapping(mapping, row, dataset):
    require(mapping['row_id'] == row['id'], 'Mapping belongs to another row')
    for key in ('source_revision', 'input_resources', 'identity_rule', 'coverage_rule'):
        require(mapping.get(key), f'Mapping requires {key}')
    require(isinstance(mapping.get('grants'), list), 'Mapping requires explicit grants list (may be empty internally)')
    retention = mapping['retention']
    require(retention['decision'] in ('permitted', 'restricted', 'unresolved') and retention['basis'], 'Retention basis required')
    fields = mapping['fields']
    require(set(fields) == set(dataset['required_fields']), 'Mapping must account for every required field')
    for name, field in fields.items():
        require(field['status'] in ('source', 'derived', 'missing'), f'Invalid field status: {name}')
        require(field.get('normalization') and field.get('missing_behavior'), f'Field semantics required: {name}')
        key = {'source': 'source_path', 'derived': 'rule', 'missing': 'reason'}[field['status']]
        require(field.get(key), f'Field requires {key}: {name}')
    rules = mapping['event_rules']
    require(len(rules) == len(dataset['journal_event_families']), 'Every event family needs one rule')
    require({r['event'] for r in rules} == set(dataset['journal_event_families']), 'Event family mapping incomplete')
    for rule in rules:
        require(set(rule['tracks']) <= set(dataset['journal_tracks']), 'Unexpected journal track')
        require(rule['rule'] and (rule['tracks'] or rule.get('unsupported_reason')), 'Explicit event mapping or unsupported reason required')
    sync = mapping['synchronization']
    for key in ('initial_import', 'cursor', 'reconciliation', 'deduplication', 'freshness'):
        require(isinstance(sync.get(key), str) and sync[key].strip(), f'Synchronization requires {key}')
    require(set(sync['modes']) == set(MODES), 'Declare all three synchronization modes')
    for mode, profile in sync['modes'].items():
        require(profile['status'] in ('supported', 'partial', 'unsupported'), 'Invalid mode status')
        methods = profile['methods']
        require(isinstance(methods, list) and len(methods) == len(set(methods)) and set(methods) <= METHODS, 'Invalid synchronization methods')
        require(bool(methods) == (profile['status'] != 'unsupported'), 'Unsupported modes have no methods; supported/partial modes need methods')
        for key in ('schedule', 'history_limit', 'authentication', 'recovery', 'limitations', 'reason'):
            require(isinstance(profile.get(key), str) and profile[key].strip(), f'Mode {mode} requires {key}')
        require('direct_webhook' not in methods or mode == 'public_server', 'Direct provider webhooks require public_server')
        require('gateway_webhook' not in methods or mode == 'local_gateway', 'Gateway webhooks require local_gateway')
    return sorted(name for name, value in fields.items() if value['status'] == 'missing')


def blank():
    return dict(owner=None, last=None, steps=[], implementation=None, mapping=None,
                missing=None, tests={}, review=None, blocker=None)


def required_tests(row):
    return set(TESTS) | ({'live'} if row['live_evidence_mode'] != 'internal' else set())


def required_modes(mapping, kind):
    return set(MODES) if kind == 'contract' else {
        mode for mode, profile in mapping['synchronization']['modes'].items()
        if profile['status'] != 'unsupported'
    }


def covers_modes(mapping, test):
    return required_modes(mapping, test['kind']) <= set(test.get('modes', []))


def approved(row, state):
    review = state['review']
    needed = required_tests(row)
    return bool(state['implementation'] and not state['blocker'] and review
                and review['decision'] == 'approved'
                and all(k in state['tests'] and state['tests'][k]['result'] == 'passed' for k in needed)
                and all(covers_modes(state['mapping'], state['tests'][k]) for k in needed)
                and {state['tests'][k]['id'] for k in needed} <= set(review['test_ids']))


def validate(root=ROOT, base=None, release=False):
    register = read_json(root, 'integrations/register.json')
    contract = read_json(root, register['contract'])
    require(register['steps'] == list(STEPS) and register['test_kinds'] == list(TESTS), 'Required steps/tests changed')
    providers = {p['id']: p for p in contract['providers']}
    datasets = {d['id']: d for d in contract['datasets']}
    rows = {r['id']: r for r in register['rows']}
    require(len(rows) == len(register['rows']), 'Duplicate capability row')
    require({r['provider'] for r in rows.values()} == set(providers), 'Every source/internal producer needs rows')
    for row in rows.values():
        require(row['dataset'] in datasets and row['provider'] in providers, 'Unknown catalogue reference')
        require(row['id'] == row['provider'] + '.' + row['dataset'], 'Stable provider.dataset ID required')
        require(row['scope'] == providers[row['provider']]['release_scope'], 'Source scope drift')
        require(row['live_evidence_mode'] in ('internal', 'real_file', 'authorized_producer', 'provider_account'), 'Invalid live mode')
        expected_mode = ('internal' if row['provider'] in ('runtime', 'policy', 'replay') else
                         'real_file' if row['provider'] == 'bank_csv' else
                         'authorized_producer' if row['provider'] == 'generic' else 'provider_account')
        require(row['live_evidence_mode'] == expected_mode, 'Live verification cannot be waived')
        require(set(row['transport_plan']) == set(MODES) and all(isinstance(v, str) and v.strip() for v in row['transport_plan'].values()), 'Every row needs three mode investigation obligations')
    for dataset in datasets.values():
        for provider in dataset['provider_candidates']:
            require(provider + '.' + dataset['id'] in rows, 'Missing source/dataset obligation')
    raw = (root / register['history']).read_bytes()
    require(raw.endswith(b'\n'), 'History must end with a newline')
    history = [json.loads(line) for line in raw.splitlines()]
    if base:
        require(re.fullmatch(r'[a-f0-9]{40}', base), 'Base must be a full commit SHA')
        previous = git(root, 'show', f'{base}:integrations/history.jsonl')
        require(raw.startswith(previous), 'History is append-only: existing records were edited/deleted')
        old = json.loads(git(root, 'show', f'{base}:integrations/register.json'))
        require({r['id'] for r in old['rows']} <= rows.keys(), 'Retain existing capability IDs')
        changes = [r['id'] for r in old['rows'] if rows[r['id']] != r]
        additions = rows.keys() - {r['id'] for r in old['rows']}
        changed = set(changes) | additions
        noted = {e.get('row') for e in history[len(previous.splitlines()):] if e.get('action') == 'plan_changed'}
        require(changed <= noted, 'Plan changes need appended plan_changed history entries')
    states = {key: blank() for key in rows}
    seen = set()
    last_time = None
    for event in history:
        require(event['id'] not in seen, 'Duplicate history ID')
        seen.add(event['id'])
        require(event['at'].endswith('Z'), 'Use UTC timestamps ending in Z')
        moment = datetime.fromisoformat(event['at'].replace('Z', '+00:00'))
        require(last_time is None or moment >= last_time, 'Append history in recorded-time order')
        last_time = moment
        actor = event['actor']
        require(actor['id'] and actor['name'] and actor['kind'] in ('human', 'agent', 'ci'), 'Real actor identity required')
        require(event.get('note'), 'Explain what was done and why')
        action = event['action']
        if action == 'catalogue_seeded':
            require(len(seen) == 1, 'Seed record must be first')
            continue
        row = rows[event['row']]
        state = states[row['id']]
        state['last'] = event
        if action == 'claim':
            state['owner'] = actor
        elif action == 'plan_changed':
            require(event.get('authorization_or_decision'), 'Explain the scope decision or owner instruction')
        elif action == 'progress':
            require(set(event['completed_steps']) <= set(STEPS), 'Unknown implementation step')
            require(not state['implementation'], 'Invalidate the previous revision before changing it')
            state['owner'], state['steps'] = actor, event['completed_steps']
        elif action == 'blocked':
            require(event.get('next_action'), 'Blocker needs a concrete next action')
            state['blocker'] = event
        elif action == 'unblocked':
            require(state['blocker'], 'No blocker to clear')
            state['blocker'] = None
        elif action == 'invalidate':
            state.update(implementation=None, mapping=None, missing=None, tests={}, review=None, steps=[])
        elif action == 'implementation':
            commit = event['commit']
            require(re.fullmatch(r'[a-f0-9]{40}', commit), 'Implementation requires a full tested revision SHA')
            require(set(event['work']) == set(STEPS) and all(event['work'].values()), 'All six implementation steps need explanations')
            require(event.get('contributors') and actor['id'] in event['contributors'], 'List all implementation contributor IDs, including the recording actor')
            require(event['code'], 'Implementation requires code/dependency file hashes')
            require(event['mapping'] in event['code'], 'Bind the exact mapping contract to the code revision')
            for ref in event['code']:
                artifact(root, ref, commit)
            mapping = json.loads(artifact(root, event['mapping'], commit))
            missing = check_mapping(mapping, row, datasets[row['dataset']])
            state.update(owner=actor, implementation=event, mapping=mapping, missing=missing,
                         steps=list(STEPS), tests={}, review=None)
        elif action in ('test', 'review'):
            impl = state['implementation']
            require(impl and event['revision'] == impl['id'], 'Evidence belongs to another/unimplemented revision')
            require(event['tested_commit'] == impl['commit'], 'Test/review commit differs from implementation')
            artifact(root, event['artifact'])
            if action == 'test':
                require(event['kind'] in set(TESTS) | {'live'}, 'Unknown test kind')
                require(event['result'] in ('passed', 'failed', 'blocked'), 'Unknown test result')
                require(event['command'] and event['environment'] and event['case_ids'] and event['observed'], 'Reproducible test details required')
                modes = event.get('modes')
                require(isinstance(modes, list) and modes and len(modes) == len(set(modes)) and set(modes) <= set(MODES), 'Test requires explicit valid modes')
                if event['kind'] == 'live':
                    require(row['live_evidence_mode'] != 'internal', 'Internal execution is not provider verification')
                    require(event.get('authorized_scope') and event.get('source_revision'), 'Actual authorized source scope required')
                    if event['result'] == 'passed':
                        require(state['mapping']['retention']['decision'] == 'permitted', 'Unresolved retention blocks live verification')
                state['tests'][event['kind']] = event
            else:
                require(event['decision'] in ('approved', 'changes_requested'), 'Invalid review decision')
                if event['decision'] == 'approved':
                    need = required_tests(row)
                    require(not state['blocker'], 'Cannot approve blocked work')
                    require(all(k in state['tests'] and state['tests'][k]['result'] == 'passed' for k in need), 'Required tests have not passed')
                    tests = [state['tests'][k] for k in need]
                    require(all(covers_modes(state['mapping'], t) for t in tests), 'Required synchronization modes lack test evidence')
                    require({t['id'] for t in tests} <= set(event['test_ids']), 'Approval must cite current test IDs')
                    require(actor['id'] not in set(impl['contributors']) | {t['actor']['id'] for t in tests}, 'Independent approval cannot be self-approval')
                    require(sorted(event['acknowledged_missing_fields']) == state['missing'], 'Reviewer must acknowledge all missing fields')
                    unsupported = sorted(r['event'] for r in state['mapping']['event_rules'] if not r['tracks'])
                    require(sorted(event['acknowledged_unsupported_events']) == unsupported, 'Reviewer must acknowledge all unsupported event families')
                    unsupported_modes = sorted(m for m, p in state['mapping']['synchronization']['modes'].items() if p['status'] == 'unsupported')
                    require(sorted(event['acknowledged_unsupported_modes']) == unsupported_modes, 'Reviewer must acknowledge all unsupported modes')
                state['review'] = event
        else:
            raise ValueError(f'Unknown history action: {action}')
    for row_id, state in states.items():
        if state['implementation']:
            for ref in state['implementation']['code']:
                artifact(root, ref)  # Current files must still match the verified revision.
        if release and rows[row_id]['scope'] == 'first_release':
            require(approved(rows[row_id], state), f'Release blocked: {row_id} is not independently approved')
    return register, contract, history, states


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ').replace('<', '&lt;').replace('>', '&gt;')


def render(register, contract, history, states):
    providers = {p['id']: p for p in contract['providers']}
    datasets = {d['id']: d for d in contract['datasets']}
    rows = register['rows']
    done = sum(approved(r, states[r['id']]) for r in rows)
    lines = ['# Integration implementation register', '',
             '> Generated from integrations/register.json, integrations/history.jsonl and the data contracts. Do not edit this view by hand.', '',
             f"**{len(providers)} sources/internal producers · {len(rows)} capability rows · {done} independently approved.**", '',
             f"Prepared on {register['created_at']} by {register['prepared_by']['name']}. Progress is derived from the recorded work history.", '',
             'This is the central work list. Planned support is not a working connection. An approval applies only to the explicit field subset, source revision and test environment recorded below. Partial coverage never becomes a complete business answer.', '',
             '[How to use and update this register](integrations/README.md) · [Append-only work history](integrations/history.jsonl) · [Machine-readable plan](integrations/register.json)', '',
             'The five tracks are Source, Fact, Commitment, Movement and Reservation. They are logical journal tracks; physical SQL tables follow the journal contract. Each event uses only the applicable tracks.', '',
             '## Source overview', '',
             '| Source | Scope | Capabilities | Implemented | Test suites passed | Independently approved |',
             '| --- | --- | ---: | ---: | ---: | ---: |']
    for pid, provider in providers.items():
        subset = [r for r in rows if r['provider'] == pid]
        implemented = sum(bool(states[r['id']]['implementation']) for r in subset)
        tested = sum(all(k in states[r['id']]['tests'] and states[r['id']]['tests'][k]['result'] == 'passed' for k in TESTS) for r in subset)
        count = sum(approved(r, states[r['id']]) for r in subset)
        lines.append(f"| [{cell(provider['name'])}](#source-{pid}) | {provider['release_scope']} | {len(subset)} | {implemented} | {tested} | {count} |")
    lines += ['', '## Per-source work list', '',
              'Track initials: **S** Source · **F** Fact · **C** Commitment · **M** Movement · **R** Reservation. “—” means no event in this data contract requires that track. Step counts are work claims, not test passes. Tests show the four required suites. Live evidence is separate.', '']
    for pid, provider in providers.items():
        lines += [f'<a id="source-{pid}"></a>', f"### {provider['name']}", '',
                  f"**Scope:** {provider['release_scope']}. **Documentation:** {provider['documentation_status']}.", '',
                  f"**Input:** {provider['ingestion']}", '', f"**Prerequisites:** {provider['external_prerequisites']}", '']
        if provider['release_scope'] == 'roadmap':
            lines += ['All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.', '']
        lines += ['| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |',
                  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
        for row in (r for r in rows if r['provider'] == pid):
            state = states[row['id']]
            flags = ['✓' if t in datasets[row['dataset']]['journal_tracks'] else '—' for t in TRACKS]
            ntests = sum(k in state['tests'] and state['tests'][k]['result'] == 'passed' for k in TESTS)
            build = 'implemented' if state['implementation'] else 'in progress' if state['steps'] else 'not started'
            coverage = ('unknown' if state['missing'] is None else 'partial: ' + ', '.join(state['missing']) if state['missing'] else 'all required fields mapped')
            if state['mapping']:
                unsupported = [r['event'] for r in state['mapping']['event_rules'] if not r['tracks']]
                if unsupported:
                    coverage += '; unsupported events: ' + ', '.join(unsupported)
            live = ('not applicable (internal)' if row['live_evidence_mode'] == 'internal' else state['tests'].get('live', {}).get('result', 'not verified'))
            review = state['review']
            confirmation = (f"approved by {review['actor']['name']} on {review['at']}" if approved(row, state) else 'pending')
            if state['blocker']:
                confirmation = 'BLOCKED: ' + state['blocker']['note']
            owner = state['owner']['name'] if state['owner'] else 'unassigned'
            if state['last']:
                owner += ' / ' + state['last']['at']
            values = [f"[{row['id']}](#data-{row['dataset']})", *flags, f'{build} ({len(state["steps"])}/6); {coverage}', f'{ntests}/4', live, confirmation, owner]
            lines.append('| ' + ' | '.join(cell(v) for v in values) + ' |')
        lines += ['', '#### Synchronization by capability', '',
                  'Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.', '',
                  '| Capability | Local standalone | Local + gateway | Public backend |',
                  '| --- | --- | --- | --- |']
        for row in (r for r in rows if r['provider'] == pid):
            mapping = states[row['id']]['mapping']
            values = [row['id']]
            for mode in MODES:
                if mapping:
                    p = mapping['synchronization']['modes'][mode]
                    values.append(f"{p['status']}: {', '.join(p['methods']) or 'none'}; schedule: {p['schedule']}; history: {p['history_limit']}; limits: {p['limitations']}; reason: {p['reason']}")
                else:
                    values.append('unverified — ' + row['transport_plan'][mode])
            lines.append('| ' + ' | '.join(cell(v) for v in values) + ' |')
        relevant = [e for e in history if e.get('row', '').startswith(pid + '.')]
        if relevant:
            lines += ['', '<details><summary>Who did what, when, and with which evidence</summary>', '',
                      '| Time / actor | Capability / action | What changed / test | Evidence / commit |',
                      '| --- | --- | --- | --- |']
            for e in relevant:
                ref = e.get('artifact', e.get('mapping'))
                link = f"[{ref['path']}]({ref['path']})" if ref else '—'
                details = f"{e.get('kind', '')} {e.get('result', e.get('decision', ''))} {e['note']}"
                if e.get('work'):
                    details += '; ' + '; '.join(f'{key}: {value}' for key, value in e['work'].items())
                if e.get('command'):
                    details += f"; command: {e['command']}; environment: {e['environment']}; cases: {', '.join(e['case_ids'])}"
                    details += '; modes: ' + ', '.join(e.get('modes', []))
                    details += '; observed: ' + e['observed']
                evidence = f"{link}; {e.get('tested_commit', e.get('commit', ''))}"
                lines.append('| ' + ' | '.join(cell(x) for x in [e['at'] + ' / ' + e['actor']['name'], e.get('row', '') + ' / ' + e['action'], details, evidence]) + ' |')
            lines += ['', '</details>']
        lines += ['']
    lines += ['## What must enter each data contract', '',
              'Every capability above links here. These are required canonical inputs, not a claim that every provider supplies every field. Provider candidate paths are in [the source audit](specs/CONNECTOR-CAPABILITIES.md) and [the JSON crosswalk](specs/question-data-contracts.json). Each implemented row must add its own complete, verified field mapping.', '',
              '**Shared route:** authorized receipt → immutable PostgreSQL journal and transactional outbox → committed cursor → deterministic Rust reducer → bounded RAM indexes and durable checkpoints → the same API/MCP query service. RAM is never updated ahead of the durable commit. Historical evidence stays addressable; cold data has an indexed fallback.', '']
    for did, dataset in datasets.items():
        questions = [q['id'] for q in contract['questions'] if did in q['required_datasets'] + q['optional_datasets']]
        lines += [f'<a id="data-{did}"></a>', f'### {did}', '',
                  '- Required fields: ' + ', '.join(f'`{x}`' for x in dataset['required_fields']) + '.',
                  '- Journal events: ' + ', '.join(f'`{x}`' for x in dataset['journal_event_families']) + '.',
                  '- Applicable tracks: ' + ', '.join(dataset['journal_tracks']) + '.',
                  '- PostgreSQL: ' + dataset['durable_storage'],
                  '- Rust / RAM: ' + ', '.join(dataset['projection_ids']) + '; see the projection definitions in the JSON crosswalk.',
                  '- Normalization: ' + dataset['normalization_rule'],
                  '- Open proof: ' + dataset['open_dependency'],
                  '- Question coverage: ' + ', '.join(questions) + '.', '']
    lines += ['## Verification boundary', '',
              'Register checks prove structural consistency, immutable evidence references and recorded approval requirements. They do not prove that a person really ran a test or that an external account exposes every field. Inspect evidence and reproduce tests. Git branch protection / required checks must be configured separately by a repository administrator; this file alone cannot prevent an administrator from bypassing the workflow.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('check', 'render', 'append'))
    parser.add_argument('--base', help='Full previous commit SHA; enforce append-only history')
    parser.add_argument('--release', action='store_true', help='Require independently approved first-release rows')
    parser.add_argument('--event', type=Path, help='JSON event or array of events to append')
    args = parser.parse_args()
    path = ROOT / 'integrations/history.jsonl'
    original = path.read_bytes()
    try:
        if args.command == 'append':
            require(args.event is not None, '--event is required')
            supplied = json.loads(args.event.read_text())
            events = supplied if isinstance(supplied, list) else [supplied]
            path.write_bytes(original + b''.join((json.dumps(e, separators=(',', ':')) + '\n').encode() for e in events))
        data = validate(ROOT, args.base, args.release)
        output = render(*data)
        view = ROOT / 'INTEGRATIONS.md'
        if args.command in ('render', 'append'):
            view.write_text(output)
        else:
            require(view.read_text() == output, 'INTEGRATIONS.md is stale; run the render command')
        print(f"Register valid: {len(data[0]['rows'])} rows, {len(data[2])} history records. This is not connector-test evidence.")
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        if args.command == 'append':
            path.write_bytes(original)
        print(f'ERROR: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
