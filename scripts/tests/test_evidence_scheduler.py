import datetime,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from host_runtime import compose_config
from backup_operations import atomic_json
from evidence_scheduler import due,tick,publish,iso

class EvidenceSchedulerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runtime=self.root/'.runtime';compose_config(self.runtime,True);self.now=1800000000
 def tearDown(self):self.temp.cleanup()
 def test_hourly_checks_coalesce_wake_without_backup_configuration(self):
  self.assertFalse((self.runtime/'backup.json').exists())
  def cleaned(root):atomic_json(self.runtime/'evidence-policy-status.json',{'completed_at':iso(self.now)})
  with patch('evidence_scheduler.services',return_value=['api']),patch('evidence_scheduler.sql',return_value=b't')as sql,patch('evidence_scheduler.maintain',side_effect=cleaned)as cleanup:
   tick(self.root,self.now);tick(self.root,self.now+15);tick(self.root,self.now+3599);self.assertEqual(cleanup.call_count,1);self.assertEqual(sql.call_count,1)
   tick(self.root,self.now+3*86400);tick(self.root,self.now+3*86400+15);self.assertEqual(cleanup.call_count,2)
 def test_empty_start_avoids_fence_but_daily_orphans_are_swept(self):
  with patch('evidence_scheduler.services',return_value=['api']),patch('evidence_scheduler.sql',return_value=b'f'),patch('evidence_scheduler.maintain')as cleanup:
   tick(self.root,self.now);tick(self.root,self.now+3600);cleanup.assert_not_called();tick(self.root,self.now+86400);cleanup.assert_called_once()
 def test_stopped_or_fenced_installations_never_start_for_cleanup(self):
  with patch('evidence_scheduler.services',return_value=[]),patch('evidence_scheduler.sql')as sql:tick(self.root,self.now);sql.assert_not_called()
  atomic_json(self.runtime/'maintenance.json',{'operation':'backup'})
  with patch('evidence_scheduler.services')as services:tick(self.root,self.now);services.assert_not_called()
 def test_failure_backoff_and_future_clock_are_visible(self):
  with patch('evidence_scheduler.services',return_value=['api']),patch('evidence_scheduler.sql',side_effect=RuntimeError('offline')):
   with self.assertRaises(RuntimeError):tick(self.root,self.now)
  state=json.loads((self.runtime/'evidence-sweep.json').read_text());self.assertFalse(due(state,self.now+299));self.assertTrue(due(state,self.now+300));self.assertEqual(publish(self.root,self.now)['state'],'failed')
  self.assertFalse(due(state,self.now-3600));value=publish(self.root,self.now-3600);self.assertEqual(value['state'],'clock_anomaly');self.assertIsNone(value['next_check_at'])
  self.assertNotIn(str(self.root),json.dumps(value))
if __name__=='__main__':unittest.main()
