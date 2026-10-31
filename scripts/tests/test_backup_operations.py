import json,os,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from backup_operations import atomic_json,atomic_json_at,operation_lock,target,fence,generation
from host_runtime import RuntimeConfigError,compose_config
from unittest.mock import patch
class BackupOperationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.runtime=self.root/'.runtime';self.runtime.mkdir(mode=0o700)
 def tearDown(self):self.tmp.cleanup()
 def test_key_rejection_records_failed_attempt_without_touching_prior_generation(self):
  compose_config(self.runtime,True)
  atomic_json(self.runtime/'backup.json',{'interval_seconds':84600,'destination':str(self.root/'unavailable'),'directory':'managed'})
  prior={'state':'completed','last_completed':'2026-10-31T00:00:00Z','recoverable_cutoff':'2026-10-31T00:00:00Z','generation':'prior-good.bb.age'}
  atomic_json(self.runtime/'backup-status.json',prior)
  (self.runtime/'secrets/data').write_bytes(os.urandom(32))
  with patch('backup_operations.run')as container,self.assertRaisesRegex(RuntimeConfigError,'integrity mismatch'):generation(self.root)
  container.assert_not_called();status=json.loads((self.runtime/'backup-status.json').read_text())
  self.assertEqual(status['state'],'failed');self.assertEqual(status['generation'],prior['generation']);self.assertEqual(status['last_completed'],prior['last_completed']);self.assertEqual(status['error'],'backup_key_material_invalid');self.assertIsNotNone(status['last_attempt'])
  visible=json.loads((self.runtime/'control/status/backup.json').read_text());self.assertEqual(visible['state'],'failed')
 def test_unmounted_or_replaced_destination_never_falls_back(self):
  base=self.root/'destination';base.mkdir();managed=base/'managed';managed.mkdir(mode=0o700);b,m=base.stat(),managed.stat()
  config={'destination':str(base),'directory':'managed','destination_device':b.st_dev,'destination_inode':b.st_ino,'managed_device':m.st_dev,'managed_inode':m.st_ino}
  self.assertEqual(target(config),managed)
  base.rename(self.root/'unmounted');base.mkdir();(base/'managed').mkdir(mode=0o700)
  with self.assertRaises(RuntimeConfigError):target(config)
  self.assertEqual(list((base/'managed').iterdir()),[])
 def test_maintenance_lock_and_pending_native_fail_closed(self):
  with operation_lock(self.runtime):
   with self.assertRaises(RuntimeConfigError):
    with operation_lock(self.runtime):pass
  (self.runtime/'native-pids.json').write_text('{}')
  with self.assertRaisesRegex(RuntimeConfigError,'native developer'):
   with fence(self.root,'backup'):pass
  self.assertFalse((self.runtime/'maintenance.json').exists())
 def test_resume_requires_actual_compatible_API_before_releasing_backup_fence(self):
  with patch('backup_operations.services',return_value=['postgres','engine','api','worker']),patch('backup_operations.run'),patch('database_identity.prepare'),patch('release_compatibility.check_database'),patch('release_compatibility.wait_for_traffic',side_effect=RuntimeConfigError('injected readiness failure'))as ready,self.assertRaisesRegex(RuntimeConfigError,'readiness'):
   with fence(self.root,'backup'):pass
  ready.assert_called_once_with(self.root);self.assertEqual(json.loads((self.runtime/'maintenance.json').read_text())['phase'],'resuming')
 def test_status_write_is_private_and_directory_fd_bound(self):
  path=self.runtime/'status.json';atomic_json(path,{'state':'running'});self.assertEqual(path.stat().st_mode&0o777,0o600)
  path.unlink();(self.root/'foreign').write_text('preserved');path.symlink_to(self.root/'foreign')
  with self.assertRaises(RuntimeConfigError):atomic_json(path,{'state':'bad'})
  self.assertEqual((self.root/'foreign').read_text(),'preserved')
  directory=self.root/'destination';directory.mkdir(mode=0o700);fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
  try:
   directory.rename(self.root/'held');directory.mkdir()
   atomic_json_at(fd,'complete.json',{'state':'completed'})
   self.assertFalse((directory/'complete.json').exists());self.assertEqual(json.loads((self.root/'held/complete.json').read_text())['state'],'completed')
  finally:os.close(fd)
if __name__=='__main__':unittest.main()
