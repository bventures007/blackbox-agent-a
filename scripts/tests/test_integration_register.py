"""Synthetic regression tests for register controls, never connector evidence."""
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('register', SOURCE / 'scripts/integration-register.py')
register = importlib.util.module_from_spec(spec)
spec.loader.exec_module(register)


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('integrations/register.json', 'integrations/history.jsonl', 'specs/question-data-contracts.json'):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, dest)
        self.counter = 0
        self.row = 'policy.policy'
        self.run_git('init', '-q')
        self.run_git('config', 'user.name', 'Register test fixture')
        self.run_git('config', 'user.email', 'fixture@example.invalid')

    def run_git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True).stdout.decode().strip()

    def event(self, action, **values):
        self.counter += 1
        e = dict(id=f'fixture-{self.counter}', row=self.row, at='2026-10-31T12:00:00Z',
                 actor=dict(id='fixture-builder', name='Synthetic builder', kind='agent'),
                 action=action, note='Synthetic register-control test; no product verification.')
        e.update(values)
        return e

    def append(self, event):
        with (self.root / 'integrations/history.jsonl').open('a') as f:
            f.write(json.dumps(event) + '\n')

    def ref(self, path):
        return dict(path=path, sha256=hashlib.sha256((self.root / path).read_bytes()).hexdigest())

    def implement(self, missing=False, retention='permitted'):
        dataset_id = self.row.split('.')[1]
        dataset = next(d for d in json.loads((self.root / 'specs/question-data-contracts.json').read_text())['datasets'] if d['id'] == dataset_id)
        mapping = dict(row_id=self.row, source_revision='synthetic-v1', input_resources=['fixture'], grants=[],
                       identity_rule='Synthetic scoped fixture IDs', coverage_rule='Synthetic interval only',
                       retention=dict(decision=retention, basis='Synthetic test data only'),
                       fields={n:dict(status='source', source_path='fixture.'+n, normalization='Explicit synthetic values',
                                      missing_behavior='Return unknown') for n in dataset['required_fields']},
                       event_rules=[dict(event=e, tracks=dataset['journal_tracks'], rule='Synthetic control fixture') for e in dataset['journal_event_families']])
        if missing:
            name = next(iter(mapping['fields']))
            mapping['fields'][name].update(status='missing', reason='Deliberate negative fixture')
        (self.root / 'fixture-mapping.json').write_text(json.dumps(mapping))
        (self.root / 'fixture-code.txt').write_text('synthetic code version one\n')
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'Synthetic control fixture')
        commit = self.run_git('rev-parse', 'HEAD')
        e = self.event('implementation', commit=commit, contributors=['fixture-builder'],
                       work={k:'Synthetic fixture for '+k for k in register.STEPS},
                       code=[self.ref('fixture-code.txt'), self.ref('fixture-mapping.json')], mapping=self.ref('fixture-mapping.json'))
        self.append(e)
        return e

    def make_test_event(self, impl, kind='contract', result='passed'):
        path = f'fixture-test-{self.counter}-{kind}.txt'
        (self.root / path).write_text('Synthetic evidence for validator testing only.\n')
        e = self.event('test', revision=impl['id'], tested_commit=impl['commit'], kind=kind, result=result,
                       command='fixture-command (not a product test)', environment='isolated validator fixture',
                       case_ids=['fixture-control-case'], observed='Synthetic control fixture', artifact=self.ref(path))
        if kind == 'live':
            e.update(authorized_scope='Synthetic live-record schema fixture, not real access', source_revision='synthetic-v1')
        return e

    def approval(self, impl, missing=False, live=False):
        tests = []
        for kind in [*register.TESTS, *(['live'] if live else [])]:
            e = self.make_test_event(impl, kind)
            self.append(e)
            tests.append(e['id'])
        (self.root / 'fixture-review.txt').write_text('Synthetic independent review schema fixture only.\n')
        fields = json.loads((self.root / 'fixture-mapping.json').read_text())['fields']
        return self.event('review', revision=impl['id'], tested_commit=impl['commit'],
                          actor=dict(id='fixture-reviewer', name='Synthetic independent reviewer', kind='human'),
                          decision='approved', test_ids=tests,
                          acknowledged_unsupported_events=[],
                          acknowledged_missing_fields=[n for n, f in fields.items() if f['status']=='missing'] if missing else [],
                          artifact=self.ref('fixture-review.txt'))

    def test_seed_is_consistent_and_unapproved(self):
        plan, contract, history, states = register.validate(self.root)
        self.assertEqual(set(states), {r['id'] for r in plan['rows']})
        self.assertFalse(any(register.approved(r, states[r['id']]) for r in plan['rows']))
        self.assertIn('not started', register.render(plan, contract, history, states))

    def test_unfinished_seed_cannot_pass_release_gate(self):
        with self.assertRaisesRegex(ValueError, 'Release blocked'):
            register.validate(self.root, release=True)

    def test_independent_approval_requires_all_test_kinds(self):
        impl = self.implement()
        e = self.approval(impl)
        self.append(e)
        result = register.validate(self.root)
        row = next(r for r in result[0]['rows'] if r['id']==self.row)
        self.assertTrue(register.approved(row, result[3][self.row]))
        self.assertIn('approved by Synthetic independent reviewer', register.render(*result))

    def test_partial_coverage_stays_visible(self):
        impl = self.implement(missing=True)
        self.append(self.approval(impl, missing=True))
        self.assertIn('partial:', register.render(*register.validate(self.root)))

    def test_reviewer_must_acknowledge_missing_fields(self):
        impl = self.implement(missing=True)
        self.append(self.approval(impl))
        with self.assertRaisesRegex(ValueError, 'acknowledge'):
            register.validate(self.root)

    def test_unsupported_event_cannot_be_hidden_by_complete_fields(self):
        impl = self.implement()
        self.append(self.event('invalidate'))
        path = self.root / 'fixture-mapping.json'
        mapping = json.loads(path.read_text())
        mapping['event_rules'][0].update(tracks=[], unsupported_reason='Deliberate negative fixture')
        path.write_text(json.dumps(mapping))
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'Synthetic unsupported-event fixture')
        impl = self.event('implementation', commit=self.run_git('rev-parse', 'HEAD'), contributors=['fixture-builder'],
                          work={k:'Synthetic fixture' for k in register.STEPS},
                          code=[self.ref('fixture-code.txt'), self.ref('fixture-mapping.json')], mapping=self.ref('fixture-mapping.json'))
        self.append(impl)
        self.append(self.approval(impl))
        with self.assertRaisesRegex(ValueError, 'unsupported event'):
            register.validate(self.root)

    def test_author_cannot_self_approve(self):
        impl = self.implement()
        e = self.approval(impl)
        e['actor']['id'] = 'fixture-builder'
        self.append(e)
        with self.assertRaisesRegex(ValueError, 'self-approval'):
            register.validate(self.root)

    def test_later_failure_removes_current_approval(self):
        impl = self.implement()
        self.append(self.approval(impl))
        self.append(self.make_test_event(impl, result='failed'))
        result = register.validate(self.root)
        row = next(r for r in result[0]['rows'] if r['id']==self.row)
        self.assertFalse(register.approved(row, result[3][self.row]))

    def test_provider_approval_requires_separate_live_proof(self):
        self.row = 'easybill.invoices'
        impl = self.implement()
        self.append(self.approval(impl))
        with self.assertRaisesRegex(ValueError, 'Required tests'):
            register.validate(self.root)

    def test_retention_blocks_live_pass(self):
        self.row = 'dhl.tracking'
        impl = self.implement(retention='unresolved')
        self.append(self.make_test_event(impl, 'live'))
        with self.assertRaisesRegex(ValueError, 'retention'):
            register.validate(self.root)

    def test_test_record_requires_actual_command(self):
        impl = self.implement()
        e = self.make_test_event(impl)
        e['command'] = ''
        self.append(e)
        with self.assertRaisesRegex(ValueError, 'Reproducible'):
            register.validate(self.root)

    def test_commit_mismatch_rejected(self):
        impl = self.implement()
        e = self.make_test_event(impl)
        e['tested_commit'] = 'f'*40
        self.append(e)
        with self.assertRaisesRegex(ValueError, 'commit differs'):
            register.validate(self.root)

    def test_modified_evidence_rejected(self):
        impl = self.implement()
        e = self.make_test_event(impl)
        self.append(e)
        (self.root / e['artifact']['path']).write_text('altered evidence')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            register.validate(self.root)

    def test_code_change_requires_invalidation(self):
        self.implement()
        (self.root / 'fixture-code.txt').write_text('changed code')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            register.validate(self.root)
        self.append(self.event('invalidate'))
        result = register.validate(self.root)
        self.assertIsNone(result[3][self.row]['implementation'])

    def test_old_history_cannot_be_edited(self):
        impl = self.implement()
        path = self.root / 'integrations/history.jsonl'
        path.write_text(path.read_text().replace('Prepared the work register', 'Rewritten work register'))
        with self.assertRaisesRegex(ValueError, 'append-only'):
            register.validate(self.root, base=impl['commit'])

    def test_plan_change_needs_history(self):
        impl = self.implement()
        path = self.root / 'integrations/register.json'
        plan = json.loads(path.read_text())
        plan['rows'][0]['note'] = 'Changed scope explanation'
        path.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'plan_changed'):
            register.validate(self.root, base=impl['commit'])
        self.append(self.event('plan_changed', row=plan['rows'][0]['id'], authorization_or_decision='Synthetic decision fixture'))
        register.validate(self.root, base=impl['commit'])

    def test_field_mapping_must_cover_every_required_field(self):
        self.implement()
        mapping = json.loads((self.root / 'fixture-mapping.json').read_text())
        mapping['fields'].pop(next(iter(mapping['fields'])))
        contract = json.loads((self.root / 'specs/question-data-contracts.json').read_text())
        dataset = next(d for d in contract['datasets'] if d['id']=='policy')
        with self.assertRaisesRegex(ValueError, 'every required field'):
            register.check_mapping(mapping, {'id':self.row}, dataset)

    def test_artifact_path_cannot_escape_repository(self):
        with self.assertRaisesRegex(ValueError, 'escapes repository'):
            register.safe_path(self.root, '../outside.txt')

    def test_live_requirement_cannot_be_waived_in_plan(self):
        path = self.root / 'integrations/register.json'
        plan = json.loads(path.read_text())
        plan['rows'][0]['live_evidence_mode'] = 'internal'
        path.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'cannot be waived'):
            register.validate(self.root)


if __name__ == '__main__':
    unittest.main()
