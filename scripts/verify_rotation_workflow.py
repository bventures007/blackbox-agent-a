"""Actual interrupted rotation and old-generation restore proof, called by the recovery harness."""
import json,os,pathlib,re,signal,subprocess,time,uuid
from backup_operations import generation,target,run,sql,cutoffs,services
from backup_restore import restore
from host_runtime import read_keyring,key_filename,compose_config,RuntimeConfigError


def workflow(root,source,secret,api,arguments,command,mark,token):
 config=compose_config(source/'.runtime');runtime=source/'.runtime'
 proof=json.loads(run(source,'run','--rm','--no-deps','--user',str(os.getuid())+':'+str(os.getgid()),'tooling','node','--import','tsx','tests/key-rotation-fixture.ts','prepare',timeout=180))
 assert proof['additional_evidence']==256
 before=sql(source,"SELECT md5(coalesce(string_agg(j::text,'' ORDER BY tenant_id,sequence),'')) FROM bb.journal j;")
 metadata=sql(source,"SELECT md5(string_agg(e::text,'' ORDER BY tenant_id,evidence_id)) FROM bb.evidence e;")
 identity=(runtime/'secrets/identity').read_bytes();oldkey=(runtime/'secrets/data').read_bytes()
 old=generation(source);cipher=target(json.loads((runtime/'backup.json').read_text()))/old['generation']
 process=None
 log=runtime/'rotation-test-output.log';old_restore=root/'work'/('rotation-old-backup-'+token)
 try:
  with log.open('xb')as output:
   log.chmod(0o600);process=subprocess.Popen(['./blackbox','key','rotate'],cwd=source,stdout=output,stderr=output,start_new_session=True)
   deadline=time.monotonic()+120;changed=0;remaining=0
   while time.monotonic()<deadline and process.poll()is None:
    path=runtime/'maintenance.json'
    if path.exists():
     marker=json.loads(path.read_text())
     if marker.get('phase')=='reencrypting':
      changed=remaining=0
      for row in proof['proof']:
       for path in (runtime/'evidence'/row['tenant']).iterdir():
        if not re.fullmatch('[a-f0-9-]{36}',path.name):continue
        with path.open('rb')as stream:prefix=stream.read(80)
        if prefix.startswith(b'BBEVID02')and marker['new'].encode()in prefix:changed+=1
        else:remaining+=1
      if changed and remaining:
       # This named container is created only by this fresh synthetic installation.
       result=subprocess.run(['docker','pause',config['BB_PROJECT']+'-key-rotation'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
       assert result.returncode==0
       os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=10);break
    time.sleep(.05)
   else:
    if process.poll()is None:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=10)
    raise AssertionError('Did not observe actual partially rewritten ciphertexts before interruption')
  assert changed>0 and remaining>0 and (runtime/'secrets/data').read_bytes()==oldkey
  assert len(read_keyring(runtime)['keys'])==2
  denied=subprocess.run(['./blackbox','up'],cwd=source,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=30)
  assert denied.returncode!=0 and 'maintenance'in denied.stdout.lower()
  mark('actual_partial_ciphertext_rotation_SIGKILL_preserves_keys_and_blocks_startup')
  command(source,['./blackbox','key','resume'],timeout=360)
  assert not(runtime/'maintenance.json').exists()and not(runtime/'secrets/data').exists()
  ring=read_keyring(runtime);assert ring['active']!='data-v1'and len(ring['keys'])==1
  assert (runtime/'secrets/identity').read_bytes()==identity
  assert sql(source,"SELECT md5(coalesce(string_agg(j::text,'' ORDER BY tenant_id,sequence),'')) FROM bb.journal j;")==before
  assert sql(source,"SELECT md5(string_agg(e::text,'' ORDER BY tenant_id,evidence_id)) FROM bb.evidence e;")==metadata
  verification=json.loads(run(source,'run','--rm','--no-deps','tooling','node','--import','tsx','tests/key-rotation-fixture.ts','verify',input=json.dumps(proof).encode(),timeout=120));assert verification['status']=='passed'
  api.ready();assert api.state(arguments)['result']['captured_minor']==11900
  mark('resume_stops_only_owned_orphan_verifies_all_ciphertexts_and_credentials_then_retires_old_live_key')
  restore(root,cipher,old_restore,secret,18767)
  assert (old_restore/'.runtime/secrets/data').read_bytes()==oldkey
  assert (old_restore/'.runtime/secrets/identity').read_bytes()==identity
  old_verified=json.loads(run(old_restore,'run','--rm','--no-deps','tooling','node','--import','tsx','tests/key-rotation-fixture.ts','verify',input=json.dumps(proof).encode(),timeout=120));assert old_verified['status']=='passed'
  assert set(services(old_restore))=={'postgres'}
  mark('old_encrypted_generation_restores_original_keys_and_all_retained_content_after_live_retirement')
  return {'status':'passed','observed_changed_before_kill':changed,'observed_remaining_before_kill':remaining,'additional_evidence_objects':256,'approximate_additional_plaintext_bytes':32*1024*1024,'old_generation_restore_stage':str(old_restore.relative_to(root)),'verification':verification}
 finally:
  if process is not None and process.poll()is None:
   os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=10)
  marker=runtime/'maintenance.json'
  if marker.exists():
   checkpoint=json.loads(marker.read_text())
   if checkpoint.get('operation')=='data_key_rotation':
    from key_rotation import stop_interrupted_tool
    stop_interrupted_tool(source,config,checkpoint['operation_id'])
  if (old_restore/'.runtime/compose.env').exists():run(old_restore,'stop','api','worker','engine','postgres')
