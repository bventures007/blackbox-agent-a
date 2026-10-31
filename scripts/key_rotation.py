"""Host-authorized, resumable data-key rotation. Failures keep every application writer stopped."""
import json,os,re,secrets,time,uuid,subprocess,hashlib
from host_runtime import RuntimeConfigError,compose_config,read_keyring,key_filename,protected_read,create_file,validate_keys
from backup_operations import operation_lock,atomic_json,services,run,sql,stamp,cutoffs

PHASES={'preparing','fenced','reencrypting','verified','retiring','resuming'}
SERVICES={'postgres','api','worker','engine'}


def read_marker(runtime):
 value=json.loads(protected_read(runtime/'maintenance.json',16384))
 if value.get('schema_version')!=1 or value.get('operation')!='data_key_rotation' or value.get('phase')not in PHASES:
  raise RuntimeConfigError('No resumable data-key rotation. Other maintenance must use its own recovery procedure.')
 uuid.UUID(value['operation_id'])
 for field in ['old','new']:key_filename(value[field])
 if value['old']==value['new']or not re.fullmatch('data-[a-f0-9]{32}',value['new']) or not isinstance(value['prior_running'],list)or len(value['prior_running'])!=len(set(value['prior_running']))or not set(value['prior_running'])<=SERVICES:
  raise RuntimeConfigError('Invalid rotation checkpoint. Restore protected operational metadata.')
 return value


def sync_directory(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)


def stop_interrupted_tool(root,config,operation):
 name=config.get('BB_PROJECT','blackbox-a')+'-key-rotation'
 found=subprocess.run(['docker','container','inspect',name],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
 if found.returncode:
  # A failed inspect could also be a daemon failure; the following Compose fence
  # must succeed before any file/key mutation, so that case still fails closed.
  return
 if len(found.stdout)>1024*1024:raise RuntimeConfigError('Unexpected rotation container metadata size.')
 values=json.loads(found.stdout)
 if len(values)!=1:raise RuntimeConfigError('Unexpected rotation container identity.')
 value=values[0];labels=value.get('Config',{}).get('Labels',{})
 if value.get('Name')!='/'+name or labels.get('com.docker.compose.project')!=config.get('BB_PROJECT','blackbox-a') or labels.get('com.docker.compose.service')!='tooling' or labels.get('com.blackbox.rotation')!=operation or not re.fullmatch('[a-f0-9]{64}',value.get('Id','')):
  raise RuntimeConfigError('Rotation container identity does not match this checkpoint. No unrelated container was changed.')
 result=subprocess.run(['docker','container','rm','--force',value['Id']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
 if result.returncode:raise RuntimeConfigError('Interrupted rotation container could not be stopped. Runtime remains fenced.')


def transform_tool(root,config,marker,mode):
 return json.loads(run(root,'run','--rm','--no-deps','--name',config.get('BB_PROJECT','blackbox-a')+'-key-rotation','--label','com.blackbox.rotation='+marker['operation_id'],'--user',str(os.getuid())+':'+str(os.getgid()),'tooling','node','--import','tsx','scripts/rotate-data-key.ts',mode,marker['new'],timeout=330))


def rotate(root,resume=False):
 runtime=root/'.runtime';config=compose_config(runtime)
 with operation_lock(runtime):
  marker_path=runtime/'maintenance.json'
  ring=read_keyring(runtime)
  if not ring:raise RuntimeConfigError('Legacy preview keys couple entity identity to encryption. Rotation is refused to preserve identities; a deliberate legacy migration is required. Fresh installs use an independent identity key.')
  if (runtime/'native-pids.json').exists():raise RuntimeConfigError('Stop the native developer runtime before Compose key rotation.')
  if resume:
   marker=read_marker(runtime)
   stop_interrupted_tool(root,config,marker['operation_id'])
  else:
   if marker_path.exists():raise RuntimeConfigError('Unfinished host maintenance. Resume the recorded operation first.')
   if len(ring['keys'])!=1:raise RuntimeConfigError('Unexpected pending key material; restore the rotation checkpoint.')
   marker={'schema_version':1,'operation':'data_key_rotation','operation_id':str(uuid.uuid4()),'phase':'preparing','started_at':stamp(),'prior_running':services(root),'old':ring['active'],'new':'data-'+secrets.token_hex(16)}
   atomic_json(marker_path,marker)
  old,new=marker['old'],marker['new']
  if ring['active']not in [old,new]or not set(ring['keys'])<=set([old,new]):raise RuntimeConfigError('Rotation checkpoint disagrees with the current keyring.')
  # Reassert fencing on every resume, including interruption during service restart.
  run(root,'stop','api','worker','engine');run(root,'up','-d','postgres')
  deadline=time.monotonic()+60
  while True:
   try:
    run(root,'exec','-T','postgres','pg_isready','-h','127.0.0.1','-U','blackbox_migrate','-d','blackbox');sql(root,'SELECT 1;');break
   except RuntimeConfigError:
    if time.monotonic()>deadline:raise
    time.sleep(.2)
  if marker['phase']=='resuming':
   # Services may have accepted work after the verified switch but before fence unlink.
   # Re-fence and verify their new-key writes; do not require the old business cutoff.
   marker['resumed_after_service_restart']=True;marker['cutoffs']=cutoffs(root)
  if 'cutoffs'not in marker:marker['cutoffs']=cutoffs(root)
  if cutoffs(root)!=marker['cutoffs']:raise RuntimeConfigError('Journal cutoff changed during the fenced rotation. Inspect the installation before resuming.')
  if ring['active']==old:
   marker['phase']='fenced';atomic_json(marker_path,marker)
   path=runtime/'secrets'/key_filename(new)
   if new not in ring['keys']:
    if path.exists()or path.is_symlink():
     if len(protected_read(path,32))!=32:raise RuntimeConfigError('Invalid pending rotation key. Restore original material.')
    else:create_file(path,secrets.token_bytes(32))
    ring={**ring,'keys':[old,new],'checksums':{**ring['checksums'],new:hashlib.sha256(protected_read(path,32)).hexdigest()}};atomic_json(runtime/'secrets/keyring.json',ring)
   validate_keys(runtime)
   marker['phase']='reencrypting';atomic_json(marker_path,marker)
   marker['transform']=transform_tool(root,config,marker,'transform')
  verified=transform_tool(root,config,marker,'verify')
  if verified.get('status')!='passed'or verified.get('mode')!='verify'or verified.get('target')!=new:raise RuntimeConfigError('Rotation verifier did not confirm the target key.')
  if cutoffs(root)!=marker['cutoffs']:raise RuntimeConfigError('Journal cutoff changed during rotation verification.')
  marker['verification']=verified;marker['phase']='verified';atomic_json(marker_path,marker)
  # Every referenced ciphertext and provider secret has been authenticated under the new key.
  atomic_json(runtime/'secrets/keyring.json',{**ring,'active':new,'keys':[new],'checksums':{new:ring['checksums'][new]}})
  marker['phase']='retiring';atomic_json(marker_path,marker)
  (runtime/'secrets'/key_filename(old)).unlink(missing_ok=True);sync_directory(runtime/'secrets');validate_keys(runtime)
  operation=str(uuid.UUID(marker['operation_id']))
  sql(root,"INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) SELECT tenant_id,'"+operation+"'::uuid,'"+operation+"'::uuid,'data_key.rotation_verified' FROM bb.workspaces ON CONFLICT(tenant_id,audit_id) DO NOTHING;")
  marker['phase']='resuming';atomic_json(marker_path,marker)
  if marker['prior_running']:run(root,'up','-d',*marker['prior_running'])
  if 'postgres'not in marker['prior_running']:run(root,'stop','postgres')
  result={'schema_version':1,'state':'completed','operation_id':operation,'started_at':marker['started_at'],'completed_at':stamp(),'active_key_id':new,'verification':verified,'old_live_key_removed':True,'old_backup_generations_unchanged':True,'identity_key_changed':False}
  atomic_json(runtime/'key-rotation-status.json',result);marker_path.unlink();sync_directory(runtime)
  return result
