#!/usr/bin/env python3
"""Check specification coverage and references, not application correctness."""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(path):
    return json.loads((ROOT / path).read_text())

contract = read('specs/question-data-contracts.json')
original = read('reference/questions.json')
report = read('reports/question-coverage.json')
acceptance = read('ACCEPTANCE.json')
providers = {p['id']: p for p in contract['providers']}
datasets = {d['id']: d for d in contract['datasets']}
projections = {p['id']: p for p in contract['projections']}
references = contract['documentation_references']
questions = contract['questions']

for key in ['providers', 'datasets', 'projections', 'questions']:
    ids = [v['id'] for v in contract[key]]
    assert len(ids) == len(set(ids)), f'Duplicate IDs: {key}'
assert len(questions) == sum(len(g['questions']) for g in original) == 24
expected = {f"{g['id']}-{n+1:02d}": q['q'] for g in original for n, q in enumerate(g['questions'])}
assert {q['id']: q['question'] for q in questions} == expected, 'Question drift'

for d in datasets.values():
    assert d['required_fields'] and d['normalization_rule'] and d['durable_storage'], d['id']
    assert set(d['provider_candidates']) <= providers.keys(), d['id']
    assert set(d['projection_ids']) <= projections.keys(), d['id']
    assert set(d['documentation_refs']) <= references.keys(), d['id']
    assert set(d['journal_tracks']) <= {'source', 'fact', 'commitment', 'movement', 'reservation'}, d['id']
    assert 'source' in d['journal_tracks'] and d['journal_event_families'], d['id']

intents = set()
for q in questions:
    assert q['intent'] not in intents, q['id']
    intents.add(q['intent'])
    assert set(q['required_datasets'] + q['optional_datasets']) <= datasets.keys(), q['id']
    assert not set(q['required_datasets']) & set(q['optional_datasets']), q['id']
    assert {'identity', 'coverage'} <= set(q['required_datasets']), q['id']
    assert set(q['projection_ids']) <= projections.keys(), q['id']
    assert 'P_COVERAGE' in q['projection_ids'], q['id']
    assert q['first_release_data_assessment'] in contract['first_release_assessment_definitions'], q['id']
    assert all(q[k] for k in ['blocking_data_gap', 'query_rule', 'access_path']), q['id']
    assert q['mcp_contract']['intent'] == q['intent'], q['id']
    assert q['mcp_contract']['tool'] == 'query_business', q['id']
    for kind in ['sufficient', 'missing']:
        assert q['test_contract'][kind]['given'] and q['test_contract'][kind]['expected'], (q['id'], kind)
    assert q['test_contract']['additional_cases'] and len(q['test_contract']['common_suite']) >= 8, q['id']
    group, question = q['reference_pointer'].split('/')[1], q['reference_pointer'].split('/')[3]
    assert original[int(group)]['questions'][int(question)]['q'] == q['question'], q['id']

for p in providers.values():
    assert set(p['documentation_refs']) <= references.keys(), p['id']
    assert all(p[k] for k in ['ingestion', 'external_prerequisites', 'documentation_status']), p['id']
    if p['release_scope'] == 'roadmap':
        assert p['documentation_status'] == 'not_audited', p['id']
    for mapping in p['field_mappings']:
        assert mapping['resource'] and mapping['mapping'] and mapping['note'], p['id']
        # "supplemental" groups the generic API event families documented by datasets.
        assert mapping['dataset'] in datasets or mapping['dataset'] == 'supplemental', p['id']

assert all('tenant_id' in p['keys'] and p['access_path'] and p['storage'] for p in projections.values())
assert {q['id'] for q in report['questions']} == set(expected)
assert report['counts'] == dict(Counter(q['first_release_data_assessment'] for q in questions))
assert {'QUERY-01', 'QUERY-02', 'SOURCE-01', 'SOURCE-02', 'SOURCE-03', 'SOURCE-04'} <= {c['id'] for c in acceptance['cases']}
for required in ['specs/QUESTION-DATA-COVERAGE.md', 'specs/CONNECTOR-CAPABILITIES.md', 'reports/question-coverage.json']:
    assert (ROOT/required).is_file(), required

print(f'PASS: {len(questions)} original questions, 24 unique intents, 48 minimum test examples.')
print(f'PASS: {len(datasets)} datasets, {len(projections)} tenant-scoped projections, {len(providers)} source entries, consistent links and coverage register.')
print('This checks the specification catalogue only. Product, API/MCP, recovery and live-provider tests remain unexecuted.')
