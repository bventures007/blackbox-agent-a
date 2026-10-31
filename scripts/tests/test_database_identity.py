"""Fault injection complements the destructive, isolated real-volume recovery proof."""
import json,pathlib,subprocess,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from host_runtime import compose_config,RuntimeConfigError
from backup_operations import atomic_json,fence
from backup_supervisor import recover_backup
from database_identity import names,marker,volume,control_identity,prepare,docker

class DatabaseIdentityTests(unittest.TestCase):
 def setUp(self):
  guard=patch('release_compatibility.read_manifest');guard.start();self.addCleanup(guard.stop)
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runtime=self.root/'.runtime';compose_config(self.runtime,True)
  self.identity={'system_identifier':'1234567890123456789','database_oid':16384,'postgres_major':17}
  project,name=names(self.root)
  self.value={'version':1,'project':project,'volume':name,**self.identity,'recorded_at':'2026-10-31T00:00:00+00:00'}
  self.metadata={'Name':name,'Driver':'local','Labels':{'com.docker.compose.project':project,'com.docker.compose.volume':'postgres'}}
 def tearDown(self):self.temp.cleanup()
 def save(self,value=None):atomic_json(self.runtime/'database-identity.json',value or self.value)
 def test_unconfigured_start_and_missing_volume_never_start_postgres(self):
  with patch('backup_operations.run')as run,self.assertRaisesRegex(RuntimeConfigError,'identity is missing'):prepare(self.root)
  run.assert_not_called();self.save()
  with patch('backup_operations.run')as run,patch('database_identity.volume',return_value=None),self.assertRaisesRegex(RuntimeConfigError,'volume is missing'):prepare(self.root)
  run.assert_not_called()
 def test_missing_marker_with_existing_state_cannot_be_setup_again(self):
  for state in ['owner-workspace.json','restore-state.json','evidence/retained']:
   path=self.runtime/state;path.write_text('{}')
   with patch('backup_operations.run')as run,self.assertRaisesRegex(RuntimeConfigError,'Existing installation state'):prepare(self.root,True)
   run.assert_not_called();path.unlink()
 def test_foreign_volume_and_unavailable_daemon_are_not_absent_volumes(self):
  name=self.value['volume']
  for bad in [{**self.metadata,'Driver':'nfs'},{**self.metadata,'Labels':{}},{**self.metadata,'Name':'foreign'}]:
   with patch('database_identity.docker',side_effect=[(name+'\n').encode(),json.dumps([bad]).encode()]),self.assertRaisesRegex(RuntimeConfigError,'does not belong'):volume(self.root)
  with patch('database_identity.docker',return_value=b''):self.assertIsNone(volume(self.root))
  with patch('database_identity.docker',side_effect=RuntimeConfigError('daemon unavailable')),self.assertRaisesRegex(RuntimeConfigError,'daemon unavailable'):volume(self.root)
 def test_control_inspection_is_pinned_readonly_and_rejects_warnings_or_bad_files(self):
  config=self.root/'infra/compose/compose.yaml';config.parent.mkdir(parents=True);config.write_text('    image: postgres:17@sha256:'+'a'*64+'\n')
  with patch('database_identity.volume',return_value=self.metadata),patch('database_identity.docker',return_value=b'17\nDatabase system identifier: 1234567890123456789\n')as call:
   self.assertEqual(control_identity(self.root),self.identity['system_identifier'])
   args=call.call_args.args;self.assertIn('--read-only',args);self.assertIn('none',args);self.assertIn('type=volume,source='+self.value['volume']+',target=/data,readonly',args);self.assertTrue(call.call_args.kwargs['strict_stderr'])
  for invalid in [b'18\nDatabase system identifier: 1234567890123456789\n',b'17\n',b'17\nDatabase system identifier: 123\n']:
   with patch('database_identity.volume',return_value=self.metadata),patch('database_identity.docker',return_value=invalid),self.assertRaises(RuntimeConfigError):control_identity(self.root)
  with patch('database_identity.subprocess.run',return_value=subprocess.CompletedProcess([],0,b'17',b'warning: CRC mismatch')),self.assertRaises(RuntimeConfigError):docker('run',strict_stderr=True)
 def test_cluster_replacement_is_denied_before_start_and_database_replacement_before_traffic(self):
  self.save()
  with patch('database_identity.control_identity',return_value='9999999999999999999'),patch('backup_operations.run')as run,self.assertRaisesRegex(RuntimeConfigError,'cluster identity changed'):prepare(self.root)
  run.assert_not_called()
  with patch('database_identity.control_identity',return_value=self.identity['system_identifier']),patch('database_identity.ready'),patch('database_identity.live_identity',return_value={**self.identity,'database_oid':99999}),patch('backup_operations.run')as run,self.assertRaisesRegex(RuntimeConfigError,'Live database identity'):prepare(self.root)
  run.assert_called_once_with(self.root,'up','-d','postgres')
 def test_fresh_marker_is_private_and_only_created_for_empty_verified_database(self):
  with patch('database_identity.volume',return_value=None),patch('database_identity.control_identity',return_value=self.identity['system_identifier']),patch('database_identity.ready'),patch('database_identity.live_identity',return_value=self.identity),patch('backup_operations.run'),patch('backup_operations.sql',return_value=b'0'):
   self.assertEqual(prepare(self.root,True)['system_identifier'],self.identity['system_identifier'])
  path=self.runtime/'database-identity.json';self.assertEqual(path.stat().st_mode&0o777,0o600);self.assertEqual(marker(self.root)['database_oid'],16384);path.unlink()
  with patch('database_identity.volume',return_value=None),patch('database_identity.ready'),patch('database_identity.live_identity',return_value=self.identity),patch('backup_operations.run'),patch('backup_operations.sql',return_value=b'1'),self.assertRaisesRegex(RuntimeConfigError,'already contains records'):prepare(self.root,True)
  self.assertFalse(path.exists())
 def test_foreign_or_world_readable_marker_cannot_be_adopted(self):
  self.save({**self.value,'project':'foreign'})
  with self.assertRaises(RuntimeConfigError):marker(self.root)
  self.save();(self.runtime/'database-identity.json').chmod(0o644)
  with self.assertRaises(RuntimeConfigError):marker(self.root)
 def test_backup_failure_keeps_fence_and_recovery_rechecks_identity(self):
  with patch('backup_operations.services',return_value=['postgres','api']),patch('backup_operations.run')as run,patch('database_identity.prepare',side_effect=RuntimeConfigError('identity mismatch')),self.assertRaisesRegex(RuntimeConfigError,'identity mismatch'):
   with fence(self.root,'backup'):self.fail('Unverified database reached backup code')
  self.assertEqual([c.args[1:]for c in run.call_args_list],[('stop','api','worker','engine')])
  path=self.runtime/'maintenance.json';self.assertEqual(json.loads(path.read_text())['phase'],'database_verification_failed')
  with patch('backup_supervisor.run')as run,patch('database_identity.prepare',side_effect=RuntimeConfigError('identity mismatch')),self.assertRaises(RuntimeConfigError):recover_backup(self.root)
  self.assertTrue(path.exists());run.assert_called_once_with(self.root,'stop','api','worker','engine')

if __name__=='__main__':unittest.main()
