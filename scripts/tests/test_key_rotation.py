"""Fault-state tests; actual ciphertext/PG/MCP recovery is a separate integration proof."""
import json,pathlib,sys,tempfile,unittest,subprocess
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from host_runtime import compose_config,RuntimeConfigError,read_keyring,validate_keys
from key_rotation import rotate,read_marker,stop_interrupted_tool

class RotationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runtime=self.root/'.runtime';compose_config(self.runtime,True);self.identity=(self.runtime/'secrets/identity').read_bytes();self.old=(self.runtime/'secrets/data').read_bytes()
 def tearDown(self):self.temp.cleanup()
 def fake_run(self,root,*args,**kwargs):
  if 'scripts/rotate-data-key.ts'in args:
   mode,target=args[-2:];return json.dumps({'status':'passed','mode':mode,'target':target,'evidence_checked':3,'credentials_checked':2}).encode()
  return b''
 def contexts(self,side_effect=None):
  from contextlib import ExitStack
  stack=ExitStack();stack.enter_context(patch('database_identity.prepare'));stack.enter_context(patch('release_compatibility.check_database'));stack.enter_context(patch('release_compatibility.wait_for_traffic'));stack.enter_context(patch('key_rotation.stop_interrupted_tool'));stack.enter_context(patch('key_rotation.services',return_value=['postgres','api','worker','engine']));stack.enter_context(patch('key_rotation.cutoffs',return_value={'journal_count':55}));stack.enter_context(patch('key_rotation.sql',return_value=b'1'));stack.enter_context(patch('key_rotation.run',side_effect=side_effect or self.fake_run));return stack
 def test_failed_transform_preserves_both_keys_and_fence_then_resume_retires_old_only(self):
  def failing(root,*args,**kw):
   if args[-2:-1]==('transform',):raise RuntimeConfigError('injected maintenance failure')
   return self.fake_run(root,*args,**kw)
  with self.contexts(failing),self.assertRaisesRegex(RuntimeConfigError,'injected'):rotate(self.root)
  marker=read_marker(self.runtime);self.assertEqual(marker['phase'],'reencrypting');self.assertEqual((self.runtime/'secrets/data').read_bytes(),self.old);self.assertEqual(len(read_keyring(self.runtime)['keys']),2)
  with self.contexts():result=rotate(self.root,True)
  self.assertTrue(result['old_live_key_removed']);self.assertFalse((self.runtime/'secrets/data').exists());self.assertFalse((self.runtime/'maintenance.json').exists());self.assertEqual((self.runtime/'secrets/identity').read_bytes(),self.identity);validate_keys(self.runtime)
 def test_verification_failure_never_retires_key_or_restarts_writers(self):
  calls=[]
  def failing(root,*args,**kw):
   calls.append(args)
   if args[-2:-1]==('verify',):raise RuntimeConfigError('injected verification failure')
   return self.fake_run(root,*args,**kw)
  with self.contexts(failing),self.assertRaises(RuntimeConfigError):rotate(self.root)
  self.assertEqual((self.runtime/'secrets/data').read_bytes(),self.old);self.assertTrue((self.runtime/'maintenance.json').exists());self.assertFalse(any(args[:2]==('up','-d')and 'api'in args for args in calls))
 def test_resume_after_new_key_service_restart_does_not_require_obsolete_cutoff(self):
  def fail_restart(root,*args,**kw):
   if args[:2]==('up','-d')and 'api'in args:raise RuntimeConfigError('injected service restart failure')
   return self.fake_run(root,*args,**kw)
  with self.contexts(fail_restart),self.assertRaises(RuntimeConfigError):rotate(self.root)
  self.assertEqual(read_marker(self.runtime)['phase'],'resuming');self.assertFalse((self.runtime/'secrets/data').exists())
  with self.contexts(),patch('key_rotation.cutoffs',return_value={'journal_count':60}):self.assertEqual(rotate(self.root,True)['state'],'completed')
 def test_unready_API_keeps_rotation_checkpoint_after_safe_key_retirement(self):
  with self.contexts(),patch('release_compatibility.wait_for_traffic',side_effect=RuntimeConfigError('injected readiness failure')),self.assertRaisesRegex(RuntimeConfigError,'readiness'):rotate(self.root)
  self.assertEqual(read_marker(self.runtime)['phase'],'resuming');self.assertFalse((self.runtime/'secrets/data').exists());validate_keys(self.runtime)
  with self.contexts():self.assertEqual(rotate(self.root,True)['state'],'completed')
 def test_interrupted_container_cleanup_requires_exact_project_service_and_operation(self):
  config=compose_config(self.runtime);name=config['BB_PROJECT']+'-key-rotation';operation='00000000-0000-4000-8000-000000000001'
  container={'Name':'/'+name,'Id':'a'*64,'Config':{'Labels':{'com.docker.compose.project':config['BB_PROJECT'],'com.docker.compose.service':'tooling','com.blackbox.rotation':operation}}}
  response=subprocess.CompletedProcess([],0,json.dumps([container]).encode())
  with patch('key_rotation.subprocess.run',side_effect=[response,subprocess.CompletedProcess([],0)])as run:
   stop_interrupted_tool(self.root,config,operation)
   self.assertEqual(run.call_args_list[1].args[0],['docker','container','rm','--force','a'*64])
  for field in ['com.docker.compose.project','com.docker.compose.service','com.blackbox.rotation']:
   invalid=json.loads(json.dumps(container));invalid['Config']['Labels'][field]='unrelated'
   with patch('key_rotation.subprocess.run',return_value=subprocess.CompletedProcess([],0,json.dumps([invalid]).encode()))as run,self.assertRaises(RuntimeConfigError):
    stop_interrupted_tool(self.root,config,operation)
   self.assertEqual(run.call_count,1)
 def test_legacy_and_unrelated_fences_cannot_be_rotated_or_cleared(self):
  (self.runtime/'maintenance.json').write_text(json.dumps({'schema_version':1,'operation':'restore','phase':'fenced'}));(self.runtime/'maintenance.json').chmod(0o600)
  with self.contexts(),self.assertRaisesRegex(RuntimeConfigError,'Other maintenance'):rotate(self.root,True)
  (self.runtime/'maintenance.json').unlink();(self.runtime/'secrets/identity').unlink();(self.runtime/'secrets/keyring.json').unlink()
  config=self.runtime/'compose.env';config.write_text('\n'.join(line for line in config.read_text().splitlines()if not line.startswith('BB_KEY_LAYOUT='))+'\n')
  with self.contexts(),self.assertRaisesRegex(RuntimeConfigError,'Legacy preview'):rotate(self.root)
  self.assertEqual((self.runtime/'secrets/data').read_bytes(),self.old);self.assertFalse((self.runtime/'maintenance.json').exists())
if __name__=='__main__':unittest.main()
