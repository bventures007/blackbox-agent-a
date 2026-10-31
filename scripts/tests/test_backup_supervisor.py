import datetime,hashlib,json,pathlib,sys,tempfile,unittest,uuid
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from backup_supervisor import due_now,retained_names,prune,status_value,prepare_control,tick,policy_values,request_present,recover_backup
from backup_operations import atomic_json,operation_lock
from host_runtime import RuntimeConfigError,compose_config

class BackupSupervisorTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.runtime=self.root/'.runtime';compose_config(self.runtime,True);prepare_control(self.runtime)
  base=self.root/'backups';base.mkdir();self.managed=base/'managed';self.managed.mkdir(mode=0o700);b,m=base.stat(),self.managed.stat()
  self.config={'installation_id':str(uuid.uuid4()),'destination':str(base),'directory':'managed','destination_device':b.st_dev,'destination_inode':b.st_ino,'managed_device':m.st_dev,'managed_inode':m.st_ino,'interval_seconds':84600,'maximum_age_seconds':86400,'daily_retention':7,'weekly_retention':4,'same_device':True};atomic_json(self.runtime/'backup.json',self.config)
 def tearDown(self):self.tmp.cleanup()
 def test_cutoff_schedule_wake_coalescing_retry_and_clock_jump(self):
  now=1800000000;cutoff=datetime.datetime.fromtimestamp(now-90000,datetime.timezone.utc).isoformat();last={'state':'completed','recoverable_cutoff':cutoff}
  self.assertTrue(due_now(self.config,last,now));self.assertFalse(due_now(self.config,last,now-90000+84599))
  self.assertFalse(due_now(self.config,{'state':'failed','last_attempt':datetime.datetime.fromtimestamp(now-20,datetime.timezone.utc).isoformat()},now))
  self.assertFalse(due_now(self.config,{'recoverable_cutoff':datetime.datetime.fromtimestamp(now+3600,datetime.timezone.utc).isoformat()},now))
  atomic_json(self.runtime/'backup-status.json',last)
  def completed(root):atomic_json(self.runtime/'backup-status.json',{'state':'completed','recoverable_cutoff':datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()})
  with patch('evidence_scheduler.tick'),patch('backup_supervisor.services',return_value=['api']),patch('backup_supervisor.generation',side_effect=completed)as call:
   tick(self.root,now);tick(self.root,now+15);self.assertEqual(call.call_count,1)
  self.assertEqual(status_value(self.root,now+90001)['state'],'overdue')
 def test_daily_weekly_retention_only_own_completed_generations(self):
  names={};foreign=self.managed/'do-not-touch.txt';foreign.write_text('unrelated')
  for day in range(1,32):
   name=uuid.uuid4().hex+'.bb.age';names[day]=name;data=('test generation '+str(day)).encode();path=self.managed/name;path.write_bytes(data);path.chmod(0o600)
   value={'installation_id':self.config['installation_id'],'state':'completed','generation':name,'last_completed':f'2026-01-{day:02d}T12:00:00Z','bytes':len(data),'ciphertext_sha256':hashlib.sha256(data).hexdigest()};atomic_json(self.managed/(name+'.json'),value)
  (self.managed/'unfinished.partial').write_text('incomplete')
  result=prune(self.root,self.config,names[31]);expected={names[day]for day in [11,18,25,26,27,28,29,30,31]}
  self.assertEqual({p.name for p in self.managed.glob('*.bb.age')},expected);self.assertEqual(result,{'deleted':22,'retained':9});self.assertEqual(foreign.read_text(),'unrelated');self.assertTrue((self.managed/'unfinished.partial').exists())
 def test_unsafe_retention_and_unmounted_target_delete_nothing(self):
  other=self.root/'outside.json';other.write_text('{}');link=self.managed/(uuid.uuid4().hex+'.bb.age.json');link.symlink_to(other)
  with self.assertRaises(OSError):prune(self.root,self.config,'missing.bb.age')
  self.assertEqual(other.read_text(),'{}');self.assertTrue(link.is_symlink())
  self.managed.rename(self.managed.with_name('held'));self.managed.mkdir(mode=0o700)
  with self.assertRaises(RuntimeConfigError):prune(self.root,self.config,'missing.bb.age')
  self.assertEqual(list(self.managed.iterdir()),[])
 def test_visible_status_contains_no_destination_or_recovery_material(self):
  value=status_value(self.root);self.assertTrue(value['same_device']);self.assertTrue(value['overdue']);self.assertNotIn(str(self.root),json.dumps(value));self.assertNotIn('recipient',value)
  atomic_json(self.runtime/'maintenance.json',{'operation':'backup','phase':'fenced','prior_running':[]})
  self.assertTrue(status_value(self.root)['maintenance_required'])
  with operation_lock(self.runtime):self.assertFalse(status_value(self.root)['maintenance_required'])
  with patch('backup_supervisor.run')as call,patch('database_identity.prepare'),patch('release_compatibility.check_database'):recover_backup(self.root)
  self.assertFalse((self.runtime/'maintenance.json').exists());self.assertEqual(json.loads((self.runtime/'backup-status.json').read_text())['state'],'failed')
 def test_narrow_request_expiry_and_bounded_policy(self):
  now=1800000000;path=self.runtime/'control/requests/backup.json';request={'schema_version':1,'request_id':str(uuid.uuid4()),'principal_id':str(uuid.uuid4()),'tenant_id':str(uuid.uuid4()),'requested_at':datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()};atomic_json(path,request)
  self.assertTrue(request_present(self.runtime,now));self.assertFalse(request_present(self.runtime,now+601));self.assertFalse(path.exists())
  atomic_json(path,{**request,'command':'arbitrary'})
  with self.assertRaises(RuntimeConfigError):request_present(self.runtime,now)
  for values in [(0,7,4),(84600,0,4),(84600,7,999),(True,7,4)]:
   with self.assertRaises(RuntimeConfigError):policy_values(*values)
if __name__=='__main__':unittest.main()
