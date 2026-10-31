import io,os,pathlib,sys,tarfile,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from backup_codec import ArchiveWriter,inspect_archive,BackupFormatError,new_recovery,encrypt,decrypt,recovery_key
ROOT=pathlib.Path(__file__).resolve().parents[2]
class BackupCodecTest(unittest.TestCase):
 def archive(self):
  stream=io.BytesIO();writer=ArchiveWriter(stream);writer.add('secrets/data',b'synthetic key data');writer.add('database/00000000.bin',b'synthetic database');writer.finish({'cutoff':22});return stream.getvalue()
 def test_manifest_and_member_integrity(self):
  raw=self.archive();manifest=inspect_archive(io.BytesIO(raw));self.assertEqual(manifest['metadata']['cutoff'],22)
  modified=raw.replace(b'synthetic database',b'corrupted database',1)
  with self.assertRaises(BackupFormatError):inspect_archive(io.BytesIO(modified))
  with self.assertRaises(BackupFormatError):inspect_archive(io.BytesIO(raw[:-10000]))
 def test_reject_extension_links_paths_and_duplicates_before_writing(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('secrets/data',tarfile.SYMTYPE),('pax',tarfile.XHDTYPE)]:
   stream=io.BytesIO()
   with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT)as archive:
    info=tarfile.TarInfo(name);info.type=kind;info.size=0;archive.addfile(info)
   with self.assertRaises(BackupFormatError):inspect_archive(io.BytesIO(stream.getvalue()))
  writer=ArchiveWriter(io.BytesIO());writer.add('secrets/data',b'x')
  with self.assertRaises(BackupFormatError):writer.add('secrets/data',b'x')
 def test_pinned_age_roundtrip_wrong_key_tamper_and_truncation(self):
  secret,recipient=new_recovery(ROOT);wrong,_=new_recovery(ROOT)
  with tempfile.TemporaryDirectory()as folder:
   path=pathlib.Path(folder)/'test.age'
   with path.open('xb')as f,encrypt(ROOT,recipient,f)as stream:stream.write(self.archive())
   cipher=path.read_bytes();self.assertNotIn(b'synthetic database',cipher);self.assertNotIn(secret,cipher)
   with path.open('rb')as f,decrypt(ROOT,secret,f)as stream:self.assertEqual(inspect_archive(stream)['metadata']['cutoff'],22)
   with self.assertRaises(BackupFormatError):
    with path.open('rb')as f,decrypt(ROOT,wrong,f)as stream:inspect_archive(stream)
   for corrupt in [cipher[:-1],cipher[:len(cipher)//2],cipher[:-5]+bytes([cipher[-5]^1])+cipher[-4:]]:
    path.write_bytes(corrupt)
    with self.assertRaises(BackupFormatError):
     with path.open('rb')as f,decrypt(ROOT,secret,f)as stream:inspect_archive(stream)
 def test_only_native_recovery_identity_accepted(self):
  for value in [b'AGE-PLUGIN-ANYTHING',b'../../key',b'-----BEGIN RSA PRIVATE KEY-----',b'AGE-SECRET-KEY-PQ-1'+b'A'*50+b'\nAGE-SECRET-KEY-PQ-1'+b'B'*50]:
   with self.assertRaises(BackupFormatError):recovery_key(value)
if __name__=='__main__':unittest.main()
