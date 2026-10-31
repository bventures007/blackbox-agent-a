import datetime,hashlib,json,pathlib,sys,tempfile,unittest,uuid
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from backup_operations import atomic_json
from host_runtime import compose_config
from evidence_copies import inventory

class EvidenceCopiesTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runtime=self.root/'.runtime';compose_config(self.runtime,True)
  self.base=self.root/'backups';self.base.mkdir();self.managed=self.base/'managed';self.managed.mkdir(mode=0o700);b,m=self.base.stat(),self.managed.stat()
  self.config={'installation_id':str(uuid.uuid4()),'destination':str(self.base),'directory':'managed','destination_device':b.st_dev,'destination_inode':b.st_ino,'managed_device':m.st_dev,'managed_inode':m.st_ino}
  self.now=1800000000
 def tearDown(self):self.temp.cleanup()
 def generation(self,age=0):
  name=uuid.uuid4().hex+'.bb.age';file=self.managed/name;file.write_bytes(b'ciphertext');file.chmod(0o600)
  date=datetime.datetime.fromtimestamp(self.now-age,datetime.timezone.utc).isoformat()
  meta={'installation_id':self.config['installation_id'],'state':'completed','generation':name,'last_completed':date,'recoverable_cutoff':date,'bytes':10,'ciphertext_sha256':hashlib.sha256(b'ciphertext').hexdigest()};atomic_json(self.managed/(name+'.json'),meta);return file,meta
 def test_bounded_sanitized_generations_are_not_an_integrity_claim(self):
  self.assertEqual(inventory(self.root,self.now)['state'],'not_configured');atomic_json(self.runtime/'backup.json',self.config)
  for age in range(102):self.generation(age)
  value=inventory(self.root,self.now);self.assertEqual(value['state'],'available');self.assertEqual(value['total'],102);self.assertTrue(value['truncated']);self.assertEqual(len(value['generations']),100)
  self.assertNotIn(str(self.root),json.dumps(value));self.assertNotIn(self.config['installation_id'],json.dumps(value));self.assertTrue(all(set(v)=={'generation','recoverable_cutoff'}for v in value['generations']))
  with patch('evidence_copies.MAX_ENTRIES',1):self.assertEqual(inventory(self.root,self.now)['state'],'unavailable')
 def test_replaced_destination_symlink_wrong_size_and_malformed_metadata_fail_closed(self):
  atomic_json(self.runtime/'backup.json',self.config);file,meta=self.generation();self.assertEqual(inventory(self.root,self.now)['state'],'available')
  file.write_bytes(b'short');self.assertEqual(inventory(self.root,self.now)['state'],'unavailable');file.write_bytes(b'ciphertext')
  path=self.managed/(file.name+'.json');path.write_text('{');self.assertEqual(inventory(self.root,self.now)['state'],'unavailable');atomic_json(path,meta)
  file.unlink();file.symlink_to(self.runtime/'backup.json');self.assertEqual(inventory(self.root,self.now)['state'],'unavailable')
  self.managed.rename(self.base/'held');self.managed.mkdir(mode=0o700);self.assertEqual(inventory(self.root,self.now)['state'],'unavailable');self.assertEqual(list(self.managed.iterdir()),[])
if __name__=='__main__':unittest.main()
