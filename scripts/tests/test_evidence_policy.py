import datetime,hashlib,hmac,json,os,pathlib,sys,tempfile,unittest,uuid
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from evidence_policy import canonical,verified_ledger,remove_owned_file,merge_ledger,purge_fenced,ZERO
from host_runtime import RuntimeConfigError

class EvidencePolicyTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.key=b'k'*32
  self.payload={'version':1,'identity_sha256':hashlib.sha256(self.key).hexdigest(),'exported_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'policies':[],'provider_limits':[],'restrictions':[]}
 def tearDown(self):self.temp.cleanup()
 def envelope(self,p=None):
  p=p or self.payload;return canonical({'payload':p,'mac':hmac.new(self.key,b'blackbox-evidence-ledger-v1\0'+canonical(p),hashlib.sha256).hexdigest()})
 def test_ledger_authentication_binds_identity_content_and_format(self):
  self.assertEqual(verified_ledger(self.root,self.envelope(),self.key),self.payload)
  for raw,key in [(self.envelope(),b'x'*32),(self.envelope().replace(b'"version":1',b'"version":2'),self.key),(self.envelope({**self.payload,'unexpected':'content'}),self.key),(self.envelope({**self.payload,'exported_at':'2099-01-01T00:00:00Z'}),self.key)]:
   with self.assertRaises(RuntimeConfigError):verified_ledger(self.root,raw,key)
 def test_authenticated_malformed_or_personal_records_are_still_rejected(self):
  row={'tenant_id':str(uuid.uuid4()),'evidence_id':str(uuid.uuid4()),'restriction_id':str(uuid.uuid4()),'principal_id':ZERO,'reason':'owner_restriction','restricted_at':self.payload['exported_at']}
  good={**self.payload,'restrictions':[row]};self.assertEqual(verified_ledger(self.root,self.envelope(good),self.key),good)
  for rows in [[row,row],[{**row,'reason':'secret@example.test'}],[{**row,'evidence_id':'../../other'}],[{**row,'note':'personal content'}],[{**row,'tenant_id':None}]]:
   with self.assertRaises(RuntimeConfigError):verified_ledger(self.root,self.envelope({**self.payload,'restrictions':rows}),self.key)
 def test_safe_disposal_refuses_symlinks_hardlinks_nonprivate_or_foreign_paths(self):
  directory=self.root/'evidence';directory.mkdir(mode=0o700);file=directory/'object';file.write_bytes(b'encrypted');file.chmod(0o600)
  link=directory/'symlink';link.symlink_to(file)
  with self.assertRaises(RuntimeConfigError):remove_owned_file(directory,link.name)
  hard=directory/'hard';os.link(file,hard)
  with self.assertRaises(RuntimeConfigError):remove_owned_file(directory,file.name)
  hard.unlink();file.chmod(0o644)
  with self.assertRaises(RuntimeConfigError):remove_owned_file(directory,file.name)
  file.chmod(0o600);self.assertEqual(remove_owned_file(directory,file.name),'removed');self.assertEqual(remove_owned_file(directory,file.name),'already_absent');self.assertTrue(link.is_symlink())
 def test_changed_existing_policy_cannot_be_overwritten_by_import(self):
  with patch('evidence_policy.sql',return_value=b'1')as sql,self.assertRaisesRegex(RuntimeConfigError,'conflict'):merge_ledger(self.root,self.payload)
  self.assertEqual(sql.call_count,1)
 def test_purge_commits_intent_before_unlink_and_resumes_absent_file(self):
  tenant=str(uuid.uuid4());evidence=str(uuid.uuid4());directory=self.root/'.runtime/evidence'/tenant;directory.mkdir(parents=True,mode=0o700);directory.parent.chmod(0o700);file=directory/evidence;file.write_bytes(b'encrypted');file.chmod(0o600)
  events=[]
  def sql(root,statement):
   events.append(statement)
   if 'FROM bb.evidence_restrictions r' in statement:
    if events.count(statement)>1:return b'[]'
    return json.dumps([{'tenant_id':tenant,'evidence_id':evidence}]).encode() if "('"+ZERO+"'::uuid"in statement else b'[]'
   return b'0'
  with patch('evidence_policy.sql',side_effect=sql):result=purge_fenced(self.root)
  self.assertEqual(result['removed'],1);self.assertFalse(file.exists());self.assertIn('evidence.expiry_intent',events[0]);self.assertTrue(any('INSERT INTO bb.evidence_disposals'in s for s in events))
  events.clear()
  with patch('evidence_policy.sql',side_effect=sql):result=purge_fenced(self.root)
  self.assertEqual(result['already_absent'],1)
if __name__=='__main__':unittest.main()
