"""Adversarial tests for scope selection and pilot release evidence gates."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('delivery', ROOT / 'scripts/validate-delivery-profile.py')
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryProfileTests(unittest.TestCase):
    def setUp(self):
        read = lambda p: json.loads((ROOT / p).read_text())
        self.args = [read(p) for p in ['delivery-profile.json','ACCEPTANCE.json','reports/acceptance.json','integrations/register.json','benchmarks/performance-contract.json','specs/future/PLATFORM-ACCEPTANCE-v10.json']]

    def test_valid_seed_scope(self):
        active, selected = delivery.validate_profile(*self.args)
        self.assertIn('LOCAL-01', active)
        self.assertIn('shopify.orders', selected)
        self.assertNotIn('easybill.invoices', selected)

    def test_omitted_active_case_rejected(self):
        self.args[0]['required_acceptance_ids'].remove('LOCAL-01')
        with self.assertRaisesRegex(ValueError, 'partition'): delivery.validate_profile(*self.args)

    def test_scope_overlap_rejected(self):
        self.args[0]['deferred_acceptance_ids'].append('LOCAL-01')
        with self.assertRaisesRegex(ValueError, 'partition'): delivery.validate_profile(*self.args)

    def test_deferred_pass_cannot_inflate_completion(self):
        for row in self.args[2]['cases']:
            if row['id'] == 'AUTH-03': row['status']='passed'
        with self.assertRaisesRegex(ValueError, 'Deferred work'): delivery.validate_profile(*self.args)

    def test_capability_omission_rejected(self):
        self.args[0]['required_integration_rows'].remove('shopify.orders')
        with self.assertRaisesRegex(ValueError, 'every capability'): delivery.validate_profile(*self.args)

    def test_prior_oracle_rewrite_rejected(self):
        self.args[1]['cases'][0]['expected']='Accept a placeholder.'
        with self.assertRaisesRegex(ValueError, 'prior case'): delivery.validate_profile(*self.args)

    def test_pending_or_unsupported_skip_cannot_pass_release(self):
        for status in ['not_started','blocked_external','not_applicable']:
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, 'Pilot blocked'):
                delivery.release_result({'id':'LOCAL-01','release_gate':True},{'status':status})

    def test_pass_requires_actual_evidence_fields(self):
        with self.assertRaisesRegex(ValueError, 'Missing observed'):
            delivery.release_result({'id':'LOCAL-01','release_gate':True},{'status':'passed'})

    def test_only_selected_capabilities_gate_pilot(self):
        rows=[{'id':'shopify.orders'}, {'id':'easybill.invoices'}]
        states={'shopify.orders':True, 'easybill.invoices':False}
        delivery.require_capability_approval(rows,states,{'shopify.orders'},lambda row,state:state)
        with self.assertRaisesRegex(ValueError,'not independently approved'):
            delivery.require_capability_approval(rows,states,{'easybill.invoices'},lambda row,state:state)


class EvidenceFreshnessTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic evidence test')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.root / 'app.py').write_text('original implementation\n')
        self.commit()
        self.tested = self.git('rev-parse', 'HEAD')
        (self.root / 'reports').mkdir()
        (self.root / 'reports/result.txt').write_text('Synthetic fixture, not product evidence.\n')
        self.commit()
        self.result = {'tested_commit': self.tested, 'evidence_paths': ['reports/result.txt']}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.PIPE, text=True).strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'Synthetic fixture')

    def test_committed_report_can_follow_tested_code(self):
        delivery.verify_committed_evidence(self.root, self.result)

    def test_changed_code_invalidates_old_test_evidence(self):
        (self.root / 'app.py').write_text('changed implementation\n')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'stale'):
            delivery.verify_committed_evidence(self.root, self.result)

    def test_uncommitted_artifact_replacement_rejected(self):
        (self.root / 'reports/result.txt').write_text('Replaced evidence\n')
        with self.assertRaisesRegex(ValueError, 'Uncommitted evidence'):
            delivery.verify_committed_evidence(self.root, self.result)


if __name__ == '__main__':
    unittest.main()
