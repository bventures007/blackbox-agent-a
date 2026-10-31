import hashlib,json,pathlib,sys,tempfile,unittest,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from backup_codec import ArchiveWriter,encrypt,new_recovery,BackupFormatError,decode_json
from backup_restore import verified_backup,restore
from host_runtime import RuntimeConfigError
ROOT=pathlib.Path(__file__).resolve().parents[2]
class BackupRestoreTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.secret,self.recipient=new_recovery(ROOT)
 def tearDown(self):self.tmp.cleanup()
 def backup(self,materials=None,**changes):
  compatibility={'application':'0.1.0','postgres_major':17,'schema':5,'engine_rpc':1,'lifecycle':'lifecycle-v2','typed_records':'records-v3','questions':'questions-v9','backup_format':1}
  identity=str(uuid.uuid4());database=b'PGDMP synthetic validation bytes'
  metadata={'installation_id':identity,'compatibility':compatibility,'snapshot':{'postgres_major':17,'heads':[],'journal_count':0},'database_chunks':1,'database_bytes':len(database),'database_sha256':hashlib.sha256(database).hexdigest()};metadata.update(changes)
  path=self.root/(uuid.uuid4().hex+'.age')
  with path.open('xb')as output,encrypt(ROOT,self.recipient,output)as stream:
   archive=ArchiveWriter(stream);archive.add('database/00000000.bin',database)
   for name,value in (materials or {'data':b'x'*32,'internal':b'a'*64}).items():archive.add('secrets/'+name,value)
   archive.add('policy/redactions.json',b'{}');archive.add('installation.json',json.dumps({'installation_id':identity,'compatibility':compatibility}).encode());archive.finish(metadata)
  return path
 def test_verified_metadata_and_database_chunk_hash(self):
  path=self.backup()
  with verified_backup(ROOT,path,self.secret)as(_,manifest,small,digest):
   self.assertEqual(manifest['metadata']['database_chunks'],1);self.assertEqual(len(small['secrets/data']),32);self.assertEqual(len(digest),64)
  for changes in [{'database_sha256':'0'*64},{'database_bytes':1},{'database_chunks':2},{'compatibility':{'schema':999}}]:
   with self.assertRaises(BackupFormatError):
    with verified_backup(ROOT,self.backup(**changes),self.secret):pass
 def test_rotated_keyring_material_is_complete_bounded_and_independent(self):
  key='data-'+uuid.uuid4().hex;ring={'version':1,'active':key,'keys':[key],'identity':'independent-v1'}
  material={key:b'x'*32,'internal':b'a'*64,'identity':b'y'*32,'keyring.json':json.dumps(ring).encode()}
  with verified_backup(ROOT,self.backup(materials=material),self.secret)as(_,manifest,small,digest):
   self.assertNotIn('secrets/data',small);self.assertEqual(small['secrets/'+key],b'x'*32)
  for invalid in [{k:v for k,v in material.items()if k!=key},{**material,'identity':b'x'*32},{**material,'data':b'z'*32},{**material,'keyring.json':json.dumps({**ring,'keys':[key,'data-v1']}).encode()}]:
   with self.assertRaises(BackupFormatError):
    with verified_backup(ROOT,self.backup(materials=invalid),self.secret):pass
 def test_invalid_backup_cannot_create_target_and_existing_target_is_never_changed(self):
  path=self.backup(database_bytes=1);destination=self.root/'fresh'
  with self.assertRaises(BackupFormatError):restore(ROOT,path,destination,self.secret)
  self.assertFalse(destination.exists())
  destination.mkdir();(destination/'keep').write_text('original')
  with self.assertRaises(RuntimeConfigError):restore(ROOT,self.backup(),destination,self.secret)
  self.assertEqual((destination/'keep').read_text(),'original')
 def test_symlink_ciphertext_and_ambiguous_metadata_rejected(self):
  path=self.backup();link=self.root/'linked';link.symlink_to(path)
  with self.assertRaises(OSError):
   with verified_backup(ROOT,link,self.secret):pass
  for value in [b'{"schema":1,"schema":2}',b'{"value":NaN}',b'{"value":Infinity}']:
   with self.assertRaises(BackupFormatError):decode_json(value)
if __name__=='__main__':unittest.main()
