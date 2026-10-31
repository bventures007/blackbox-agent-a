"""Failure boundaries; actual SIGKILL/migration/API/MCP proof is a separate suite."""
import copy,json,pathlib,sys,tempfile,unittest,uuid
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from host_runtime import RuntimeConfigError
from backup_operations import atomic_json,operation_lock,compose
from release_images import pins,validate,override,verify_target
from upgrade_operations import check_migration_progress,require_backup_context,upgrade_lease,log_phase
from release_compatibility import read_manifest
ROOT=pathlib.Path(__file__).resolve().parents[2]

class UpgradeBoundaryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runtime=self.root/'.runtime';self.runtime.mkdir(mode=0o700);(self.runtime/'logs').mkdir(mode=0o700)
  self.images=pins('sha256:'+'a'*64,'sha256:'+'b'*64);self.manifest=read_manifest(ROOT)
 def tearDown(self):self.temp.cleanup()
 def marker(self,phase='backup'):
  value={'schema_version':1,'operation':'upgrade','operation_id':str(uuid.uuid4()),'phase':phase,'source_schema':8,'prior_running':['postgres','api','engine','worker'],'source_images':self.images,'target_images':self.images}
  atomic_json(self.runtime/'maintenance.json',value);return value
 def test_pins_reject_tags_mixed_components_mounts_and_symlinks(self):
  for mutate in [lambda x:x['services']['api'].update(image='mutable:latest'),lambda x:x['services']['mcp'].update(image='sha256:'+'c'*64),lambda x:x['services']['engine'].update(volumes=['/:/host'])]:
   value=copy.deepcopy(self.images);mutate(value)
   with self.assertRaises(RuntimeConfigError):validate(value)
  atomic_json(self.runtime/'release-images.json',self.images)
  self.assertEqual(override(self.runtime),['-f',str(self.runtime/'release-images.json')])
  (self.runtime/'release-images.json').unlink();(self.root/'foreign').write_text(json.dumps(self.images));(self.runtime/'release-images.json').symlink_to(self.root/'foreign')
  with self.assertRaises(RuntimeConfigError):override(self.runtime)
 def test_target_contract_mismatch_stops_before_installation_mutation(self):
  bad=copy.deepcopy(self.manifest);bad['runtime']['source_checkpoint']=999
  with patch('release_images.require_available'),patch('release_images.image_contract',return_value=bad),self.assertRaisesRegex(RuntimeConfigError,'Migration refused'):verify_target(self.images,self.manifest)
 def test_resume_refuses_unknown_runtime_and_changed_migration_prefix(self):
  marker=self.marker('migrating');prior={k:v for k,v in self.manifest['runtime'].items()if k!='source_checkpoint'}
  for count,runtime in [(8,prior),(9,self.manifest['runtime']),(10,self.manifest['runtime'])]:
   with patch('upgrade_operations.migration_rows',return_value=self.manifest['migrations'][:count]),patch('upgrade_operations.sql',return_value=json.dumps([{'contract':runtime,'state':'fenced'}]).encode()):self.assertEqual(len(check_migration_progress(self.root,marker,self.manifest)),count)
  with patch('upgrade_operations.migration_rows',return_value=self.manifest['migrations'][:9]),patch('upgrade_operations.sql',return_value=json.dumps([{'contract':prior,'state':'fenced'}]).encode()),self.assertRaisesRegex(RuntimeConfigError,'unknown runtime'):check_migration_progress(self.root,marker,self.manifest)
  changed=copy.deepcopy(self.manifest['migrations'][:9]);changed[0]['sha256']='f'*64
  with patch('upgrade_operations.migration_rows',return_value=changed),patch('upgrade_operations.sql')as sql,self.assertRaises(RuntimeConfigError):check_migration_progress(self.root,marker,self.manifest)
  sql.assert_not_called()
 def test_fenced_backup_requires_same_live_lock_checkpoint_and_no_writers(self):
  marker=self.marker()
  with operation_lock(self.runtime)as lease:
   context={'lease_fd':lease,'operation_id':marker['operation_id'],'source_schema':8}
   with patch('upgrade_operations.services',return_value=['postgres']),patch('upgrade_operations.check_upgrade_source'):require_backup_context(self.root,context)
   with patch('upgrade_operations.services',return_value=['postgres','worker']),self.assertRaisesRegex(RuntimeConfigError,'stopped'):require_backup_context(self.root,context)
   with self.assertRaisesRegex(RuntimeConfigError,'checkpoint'):require_backup_context(self.root,{**context,'operation_id':str(uuid.uuid4())})
  with self.assertRaisesRegex(RuntimeConfigError,'live maintenance lease'):require_backup_context(self.root,context)
 def test_failed_upgrade_preserves_resumable_phase_and_sanitizes_error(self):
  marker=self.marker('migrating')
  with self.assertRaisesRegex(RuntimeError,'private@example.test'):
   with upgrade_lease(self.root):raise RuntimeError('private@example.test token=canary')
  value=json.loads((self.runtime/'maintenance.json').read_text());self.assertEqual(value['phase'],'migrating');self.assertEqual(value['error_code'],'upgrade_incomplete')
  lines=(self.runtime/'logs/wrapper.jsonl').read_text();self.assertNotIn('private@',lines);self.assertNotIn('canary',lines)
  row=json.loads(lines);self.assertEqual(row['event_name'],'wrapper.upgrade.failed');self.assertEqual(row['operation_id'],marker['operation_id']);self.assertEqual(row['level'],'ERROR')

if __name__=='__main__':unittest.main()
