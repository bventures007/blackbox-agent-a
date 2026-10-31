"""Manifest boundaries and legacy schema attestation; real migrations tested separately."""
import hashlib,json,pathlib,shutil,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from release_compatibility import read_manifest,require_prefix,normalized_legacy_schema,upgrade_restored_schema,check_database,backup_compatibility
from host_runtime import RuntimeConfigError
ROOT=pathlib.Path(__file__).resolve().parents[2]

class ReleaseCompatibilityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
  shutil.copytree(ROOT/'release',self.root/'release');shutil.copytree(ROOT/'packages/database/migrations',self.root/'packages/database/migrations');self.manifest=read_manifest(self.root)
 def tearDown(self):self.temp.cleanup()
 def test_manifest_binds_every_migration_and_rejects_newer_changed_or_missing_files(self):
  files=self.root/'packages/database/migrations';first=files/self.manifest['migrations'][0]['file'];original=first.read_bytes();first.write_bytes(original+b'\n')
  with self.assertRaisesRegex(RuntimeConfigError,'checksum'):read_manifest(self.root)
  first.write_bytes(original);extra=files/'008-unexpected.sql';extra.write_text('SELECT 1;')
  with self.assertRaisesRegex(RuntimeConfigError,'unexpected'):read_manifest(self.root)
  extra.unlink();first.unlink()
  with self.assertRaises(RuntimeConfigError):read_manifest(self.root)
 def test_unknown_manifest_and_ambiguous_json_are_not_accepted(self):
  path=self.root/'release/compatibility.json'
  for value in ['{"manifest_version":1,"manifest_version":1}',json.dumps({**self.manifest,'manifest_version':2}),json.dumps({**self.manifest,'runtime':{**self.manifest['runtime'],'journal':99}}),json.dumps({**self.manifest,'install':{**self.manifest['install'],'schema':99}})]:
   path.write_text(value)
   with self.assertRaises(RuntimeConfigError):read_manifest(self.root)
 def test_partial_changed_and_newer_ledger_cannot_start_traffic(self):
  rows=self.manifest['migrations'];require_prefix(rows,self.manifest,True);require_prefix(rows[:6],self.manifest)
  for invalid in [None,[],rows[:6],rows+[{'file':'008-future.sql','sha256':'a'*64}],[{**rows[0],'sha256':'a'*64},*rows[1:]]]:
   with self.assertRaises(RuntimeConfigError):require_prefix(invalid,self.manifest,True)
 def test_fenced_or_unknown_runtime_contract_is_denied_even_with_valid_ledger(self):
  good={'contract':self.manifest['runtime'],'state':'active'}
  with patch('release_compatibility.migration_rows',return_value=self.manifest['migrations']),patch('backup_operations.sql',side_effect=[b'17',json.dumps([good]).encode()]):self.assertEqual(check_database(self.root),self.manifest)
  for invalid in [{**good,'state':'fenced'},{**good,'contract':{**self.manifest['runtime'],'journal':99}}]:
   with patch('release_compatibility.migration_rows',return_value=self.manifest['migrations']),patch('backup_operations.sql',side_effect=[b'17',json.dumps([invalid]).encode()]),self.assertRaisesRegex(RuntimeConfigError,'incompatible'):check_database(self.root)
 def test_schema_normalization_preserves_privilege_trigger_and_function_sql(self):
  body=b"CREATE FUNCTION bb.f() RETURNS text LANGUAGE sql AS $$SELECT '-- data';$$;\nGRANT SELECT ON bb.journal TO bb_runtime;\n"
  raw=b'-- Dumped from database version 17.6\n-- Dumped by pg_dump version 17.6\n\\restrict abc123\n'+body+b'\\unrestrict abc123\n'
  self.assertEqual(normalized_legacy_schema(raw),body)
  self.assertNotEqual(hashlib.sha256(normalized_legacy_schema(raw)).digest(),hashlib.sha256(normalized_legacy_schema(raw.replace(b'SELECT ON',b'ALL ON'))).digest())
 def test_generated_header_lookalikes_inside_SQL_function_bodies_are_preserved(self):
  body=b"CREATE FUNCTION bb.f() RETURNS text LANGUAGE sql AS $$\n-- Dumped from database version 99\n-- Dumped by pg_dump version 99\n\\restrict BODY1\n\\unrestrict BODY2\nSELECT 'retained';\n$$;\n"
  raw=b'-- Dumped from database version 17.6\n\\restrict HEADER\n'+body+b'\\unrestrict FOOTER\n'
  self.assertEqual(normalized_legacy_schema(raw),body)
 def test_unknown_legacy_schema_never_receives_invented_checksum_attestation(self):
  for version in [5,6]:
   with patch('release_compatibility.migration_rows',return_value=None),patch('backup_operations.run',return_value=b'CREATE TABLE unexpected();'),patch('backup_operations.sql')as sql,self.assertRaisesRegex(RuntimeConfigError,'complete schema fingerprint'):upgrade_restored_schema(self.root,version)
   sql.assert_not_called()
 def test_exact_legacy_schema_records_observation_not_historical_execution(self):
  raw=b'known complete schema fixture';manifest={**self.manifest,'legacy_schema':{'6':{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}}}
  with patch('release_compatibility.read_manifest',return_value=manifest),patch('release_compatibility.migration_rows',return_value=None),patch('backup_operations.run',return_value=raw),patch('backup_operations.sql')as sql,patch('release_compatibility.check_database'):
   upgrade_restored_schema(self.root,6)
  first,second,third,fourth,fifth=[c.args[1]for c in sql.call_args_list]
  self.assertEqual(first.count("'observed_legacy_schema'"),6);self.assertIn('pg_advisory_xact_lock',first);self.assertIn('007-runtime-contract.sql',second);self.assertTrue(second.endswith('COMMIT;'));self.assertIn('008-evidence-policy.sql',third);self.assertIn('009-evidence-provenance-and-cursors.sql',fourth);self.assertIn('010-unclassified-access-boundary.sql',fifth)
 def test_prior_backup_contracts_keep_exact_prior_runtime_and_prefix(self):
  old='63f6ffba3371cfc080f8702987120964ea6aea0979fc4949eccdf3d908e7fb11'
  for schema in [7,8]:
   value=backup_compatibility(self.root,schema)
   self.assertEqual(value['schema'],schema);self.assertEqual(value['release'],'0.1.0-pilot.'+str(schema-6));self.assertEqual(value['runtime_sha256'],old)
   self.assertNotEqual(value['runtime_sha256'],backup_compatibility(self.root)['runtime_sha256'])
   prior={k:v for k,v in self.manifest['runtime'].items()if k!='source_checkpoint'}
   with patch('release_compatibility.migration_rows',return_value=self.manifest['migrations'][:schema]),patch('backup_operations.sql',return_value=json.dumps([{'contract':prior,'state':'active'}]).encode()),patch('release_compatibility.apply_migration')as apply,patch('release_compatibility.check_database'):
    upgrade_restored_schema(self.root,schema)
   self.assertEqual([c.args[1]for c in apply.call_args_list],self.manifest['migrations'][schema:])
 def test_prior_schema_with_new_or_unknown_contract_is_not_guessed(self):
  for schema in [7,8]:
   with patch('release_compatibility.migration_rows',return_value=self.manifest['migrations'][:schema]),patch('backup_operations.sql',return_value=json.dumps([{'contract':self.manifest['runtime'],'state':'active'}]).encode()),patch('release_compatibility.apply_migration')as apply,self.assertRaisesRegex(RuntimeConfigError,'unknown'):
    upgrade_restored_schema(self.root,schema)
   apply.assert_not_called()
if __name__=='__main__':unittest.main()
