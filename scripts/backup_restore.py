"""Fresh isolated restore; authenticate and inspect every archive member before writes."""
from contextlib import contextmanager
import hashlib,json,os,pathlib,re,shutil,stat,subprocess,time,uuid,threading
from backup_codec import decrypt,inspect_archive,BackupFormatError,MAX_ARCHIVE,MAX_MANIFEST,decode_json
from backup_operations import atomic_json,compose,run,sql,cutoffs,stamp,operation_lock
from host_runtime import parse_keyring,key_filename,validate_keys,compose_config,compose_environment,protected_directory,create_file,protected_read,RuntimeConfigError


def digest_file(file):
 file.seek(0);digest=hashlib.sha256()
 while data:=file.read(1024*1024):digest.update(data)
 file.seek(0);return digest.hexdigest()


@contextmanager
def verified_backup(root,path,secret):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb')as cipher:
  info=os.fstat(fd)
  if not stat.S_ISREG(info.st_mode)or not 0<info.st_size<MAX_ARCHIVE+MAX_MANIFEST+256*1024*1024:raise BackupFormatError('invalid_backup_file')
  digest=digest_file(cipher);small={};database=hashlib.sha256();database_bytes=0;chunks=0
  def inspect(name,value):
   nonlocal database_bytes,chunks
   if name.startswith('database/'):
    if name!=f'database/{chunks:08d}.bin':raise BackupFormatError('database_chunks_out_of_order')
    database.update(value);database_bytes+=len(value);chunks+=1
   elif name in ['installation.json','policy/redactions.json']or name.startswith('secrets/'):
    limit=1024 if name=='secrets/keyring.json'else 64 if name=='secrets/internal'else 32 if name.startswith('secrets/')else 8*1024*1024
    if len(value)>limit:raise BackupFormatError('backup_installation_material_oversized')
    small[name]=value
    if sum(n.startswith('secrets/')for n in small)>4:raise BackupFormatError('backup_installation_material_members_exceeded')
   elif name.startswith('evidence/'):
    _,tenant,evidence=name.split('/');uuid.UUID(tenant);uuid.UUID(evidence)
  with decrypt(root,secret,cipher)as stream:manifest=inspect_archive(stream,inspect)
  metadata=manifest['metadata']
  expected={'application':'0.1.0','postgres_major':17,'engine_rpc':1,'lifecycle':'lifecycle-v2','typed_records':'records-v3','questions':'questions-v9','backup_format':1}
  compatibility=metadata.get('compatibility',{})
  if {k:compatibility.get(k)for k in expected}!=expected or compatibility.get('schema')not in [5,6]or set(compatibility)!=set(expected)|{'schema'}:raise BackupFormatError('incompatible_backup_contract')
  required={'installation.json','policy/redactions.json','secrets/internal'}
  if not required<=small.keys()or not re.fullmatch(rb'[a-f0-9]{64}',small['secrets/internal']):raise BackupFormatError('backup_installation_material_invalid')
  ring=None
  if 'secrets/keyring.json'in small:
   try:ring=parse_keyring(decode_json(small['secrets/keyring.json']))
   except RuntimeConfigError:raise BackupFormatError('backup_keyring_invalid')from None
   if len(ring['keys'])!=1:raise BackupFormatError('backup_key_rotation_incomplete')
   expected_secrets={'secrets/internal','secrets/identity','secrets/keyring.json',*['secrets/'+key_filename(k)for k in ring['keys']]}
  else:expected_secrets={'secrets/internal','secrets/data'}
  if {n for n in small if n.startswith('secrets/')}!=expected_secrets:raise BackupFormatError('backup_key_material_members_invalid')
  material=[small['secrets/'+key_filename(k)]for k in ring['keys']]if ring else [small['secrets/data']]
  if any(len(k)!=32 for k in material):raise BackupFormatError('backup_data_key_invalid')
  if ring and (len(small['secrets/identity'])!=32 or small['secrets/identity']in material):raise BackupFormatError('backup_identity_key_invalid')
  if ring and (any(hashlib.sha256(small['secrets/'+key_filename(k)]).hexdigest()!=ring['checksums'][k]for k in ring['keys'])or hashlib.sha256(small['secrets/identity']).hexdigest()!=ring['identity_sha256']):raise BackupFormatError('backup_key_integrity_mismatch')
  installation=decode_json(small['installation.json'])
  if installation.get('compatibility')!=compatibility or installation.get('installation_id')!=metadata.get('installation_id'):raise BackupFormatError('backup_installation_manifest_mismatch')
  uuid.UUID(installation['installation_id'])
  if metadata.get('database_chunks')!=chunks or chunks<1 or metadata.get('database_bytes')!=database_bytes or metadata.get('database_sha256')!=database.hexdigest():raise BackupFormatError('backup_database_digest_mismatch')
  snapshot=metadata.get('snapshot',{})
  if snapshot.get('postgres_major')!=17 or not isinstance(snapshot.get('heads'),list)or not isinstance(snapshot.get('journal_count'),int):raise BackupFormatError('backup_cutoff_invalid')
  for head in snapshot['heads']:
   uuid.UUID(head['tenant_id'])
   if not 0<=int(head['applied'])<=int(head['committed']):raise BackupFormatError('backup_cutoff_invalid')
  if digest_file(cipher)!=digest or os.fstat(fd).st_size!=info.st_size:raise BackupFormatError('backup_changed_during_validation')
  yield cipher,manifest,small,digest


def copy_runtime_bundle(root,destination):
 files=['blackbox','scripts/host_runtime.py','scripts/key_rotation.py','scripts/backup_codec.py','scripts/backup_operations.py','scripts/backup_supervisor.py','scripts/backup_restore.py','scripts/diagnostics.py','infra/compose/compose.yaml','infra/compose/init.sh','vendor/age.lock.json']
 for name in files:
  target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,target)
 shutil.copytree(root/'packages/database/migrations',destination/'packages/database/migrations')
 tools=root/'bin' if (root/'bin/age').exists()else root/'.tools/age'
 shutil.copytree(tools,destination/'bin')


def restore(root,backup,destination,secret,port=18755):
 # No target, key or database writes until the complete ciphertext and manifest validate.
 started=time.monotonic();started_at=stamp();destination=destination.expanduser().absolute()
 if destination.exists()or destination.is_symlink():raise RuntimeConfigError('Restore requires a new destination. Existing data is never overwritten.')
 if destination.is_relative_to(root/'.runtime'):raise RuntimeConfigError('Restore destination must be outside the live runtime.')
 with verified_backup(root,backup,secret)as(cipher,manifest,small,digest):
  destination.mkdir(mode=0o700,parents=False);copy_runtime_bundle(root,destination)
  runtime=destination/'.runtime';compose_config(runtime,create=True,port=port)
  with operation_lock(runtime):
   marker={'schema_version':1,'operation':'restore','phase':'preparing_database','started_at':stamp(),'operation_id':str(uuid.uuid4()),'prior_running':[]}
   atomic_json(runtime/'maintenance.json',marker)
   try:
    run(destination,'up','-d','postgres');deadline=time.monotonic()+60
    while True:
     try:
      run(destination,'exec','-T','postgres','pg_isready','-h','127.0.0.1','-U','blackbox_migrate','-d','blackbox')
      sql(destination,'SELECT 1;');break
     except RuntimeConfigError:
      if time.monotonic()>deadline:raise
      time.sleep(.2)
    # Only the newly created, empty database may have its initialization schema removed.
    if int(sql(destination,'SELECT count(*) FROM bb.journal;'))or int(sql(destination,'SELECT count(*) FROM bb.workspaces;')):raise RuntimeConfigError('Fresh restore database unexpectedly contains data.')
    sql(destination,'DROP SCHEMA bb CASCADE;')
    marker['phase']='restoring_database_and_files';atomic_json(runtime/'maintenance.json',marker)
    # These freshly generated keys have never encrypted data; replace the complete set.
    # Legacy archives must retain their historical identity derivation, not a new identity.
    for name in ['data','identity','keyring.json']:(runtime/'secrets'/name).unlink(missing_ok=True)
    process=subprocess.Popen(compose(destination,'exec','-T','-e','PGOPTIONS=-c statement_timeout=300000 -c lock_timeout=5000','postgres','pg_restore','-U','blackbox_migrate','-d','blackbox','--no-owner','--single-transaction','--exit-on-error'),env=compose_environment(runtime),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    timer=threading.Timer(330,process.kill);timer.start();chunks=0
    try:
     def write(name,value):
      nonlocal chunks
      if name.startswith('database/'):
       if name!=f'database/{chunks:08d}.bin':raise BackupFormatError('database_chunks_out_of_order')
       process.stdin.write(value);chunks+=1
      elif name.startswith('evidence/'):
       _,tenant,evidence=name.split('/');uuid.UUID(tenant);uuid.UUID(evidence)
       directory=runtime/'evidence'/tenant;protected_directory(directory,True);create_file(directory/evidence,value)
      elif name.startswith('secrets/')and name!='secrets/internal':
       path=runtime/name
       # Generated keys have never encrypted application data in this fresh destination.
       temporary=runtime/'secrets'/('.restore-'+uuid.uuid4().hex);create_file(temporary,value);temporary.replace(path)
      # The new internal authentication/cursor secret deliberately stays rotated.
     cipher.seek(0)
     with decrypt(root,secret,cipher)as stream:second=inspect_archive(stream,write)
     process.stdin.close()
     if process.wait(timeout=10):raise RuntimeConfigError('PostgreSQL restore failed. Destination remains fenced.')
     if second!=manifest or digest_file(cipher)!=digest:raise BackupFormatError('backup_changed_during_restore')
    finally:
     timer.cancel();process.stdin.close()
     if process.poll()is None:process.kill()
     process.wait()
    directory_fd=os.open(runtime/'secrets',os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory_fd)
    finally:os.close(directory_fd)
    validate_keys(runtime)
    if cutoffs(destination)!=manifest['metadata']['snapshot']:raise BackupFormatError('restored_database_cutoff_mismatch')
    # This known additive migration supplies guards to the pre-guard development format.
    has_guard=sql(destination,"SELECT coalesce(to_regclass('bb.recovery_guards')::text,'');").strip()
    if not has_guard:sql(destination,'BEGIN;'+(root/'packages/database/migrations/006-recovery-guards.sql').read_text()+'COMMIT;')
    sql(destination,"""BEGIN;
      UPDATE bb.credentials SET revoked_at=now();
      UPDATE bb.connections SET state='paused';
      UPDATE bb.source_jobs SET state=CASE WHEN state='running' THEN 'queued' ELSE state END,lease_owner=NULL,leased_until=NULL,fence=fence+1;
      UPDATE bb.source_health SET collection_state='paused',error_code='restored_source_revalidation_required',next_action='reconnect_or_retry',observed_at=now();
      INSERT INTO bb.recovery_guards(tenant_id) SELECT tenant_id FROM bb.workspaces ON CONFLICT(tenant_id) DO UPDATE SET restored_at=now(),evidence_blocked=true,sources_blocked=true,policy_reconciled_at=NULL,sources_reconciled_at=NULL;
      INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) SELECT tenant_id,gen_random_uuid(),gen_random_uuid(),'restore.access_and_policy_fenced' FROM bb.workspaces;
      COMMIT;""")
    # Check fixed runtime identities cannot bypass RLS or own immutable journal tables.
    roles=json.loads(sql(destination,"SELECT json_agg(json_build_object('name',rolname,'superuser',rolsuper,'bypass',rolbypassrls)) FROM pg_roles WHERE rolname IN ('bb_api','bb_worker','bb_engine');"))
    if len(roles)!=3 or any(r['superuser']or r['bypass']for r in roles):raise BackupFormatError('restored_role_boundary_invalid')
    if int(sql(destination,"SELECT count(*) FROM bb.credentials WHERE revoked_at IS NULL;")):raise BackupFormatError('restored_access_not_fenced')
    run(destination,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-evidence.ts',timeout=330)
    create_file(runtime/'restore-policy.json',small['policy/redactions.json'])
    result={'schema_version':1,'state':'awaiting_owner_key','restore_started_at':started_at,'restored_at':stamp(),'source_installation_id':manifest['metadata']['installation_id'],'recoverable_cutoff':manifest['metadata']['recoverable_cutoff'],'backup_sha256':digest,'evidence_blocked':True,'sources_blocked':True,'machine_seconds_before_owner_input':round(time.monotonic()-started,3)}
    atomic_json(runtime/'restore-state.json',result)
    marker['phase']='awaiting_owner_key';atomic_json(runtime/'maintenance.json',marker)
    # Leave all HTTP/provider services stopped. Protected owner issuance is the next host step.
    return result
   except Exception:
    marker['phase']='failed';atomic_json(runtime/'maintenance.json',marker)
    try:run(destination,'stop','api','worker','engine','postgres')
    except Exception:pass
    raise


def finish_restore(root):
 """Protected host-only owner issuance. Never revives credentials from the archive."""
 import sys,urllib.request,urllib.error,http.client
 if not sys.stdout.isatty():raise RuntimeConfigError('Protected interactive terminal required to issue the restored owner key.')
 runtime=root/'.runtime';config=compose_config(runtime);started=time.monotonic()
 with operation_lock(runtime):
  state=json.loads(protected_read(runtime/'restore-state.json',16384))
  marker=json.loads(protected_read(runtime/'maintenance.json',16384))
  if marker.get('operation')!='restore':raise RuntimeConfigError('This installation has no resumable restore.')
  try:
   run(root,'stop','api','worker','engine')
   if int(sql(root,"SELECT count(*) FROM bb.workspaces w LEFT JOIN bb.recovery_guards g USING(tenant_id) WHERE g.tenant_id IS NULL OR NOT g.evidence_blocked OR NOT g.sources_blocked;")):raise RuntimeConfigError('Restore policy guards are incomplete.')
   sql(root,'UPDATE bb.credentials SET revoked_at=now();')
   marker['phase']='issuing_owner_key';atomic_json(runtime/'maintenance.json',marker)
   print('Restore validated. Save the newly issued owner key; old owner, agent and browser access has been revoked.',flush=True)
   print('Wiederherstellung geprüft. Speichere den neuen Eigentümerschlüssel; alte Eigentümer-, Agenten- und Browserzugriffe sind widerrufen.',flush=True)
   if subprocess.call(compose(root,'run','--rm','tooling','node','--import','tsx','scripts/setup.ts','reset'),env=compose_environment(runtime)):raise RuntimeConfigError('Restored owner issuance failed; services remain fenced.')
   from backup_supervisor import bind_owner_workspace,publish_status
   bind_owner_workspace(root);publish_status(root)
   marker['phase']='starting_restricted_runtime';atomic_json(runtime/'maintenance.json',marker)
   run(root,'up','-d','engine','api','worker')
   deadline=time.monotonic()+60;address='http://127.0.0.1:'+config.get('BB_PORT','18741')
   while True:
    try:
     with urllib.request.urlopen(address,timeout=2)as response:
      if response.status==200:break
    except (urllib.error.URLError,TimeoutError,ConnectionError,http.client.RemoteDisconnected):pass
    if time.monotonic()>deadline:raise RuntimeConfigError('Restored application did not become ready.')
    time.sleep(.2)
   state.update({'state':'restored_restricted','completed_at':stamp(),'machine_seconds_to_runtime_ready':state['machine_seconds_before_owner_input']+state.get('failed_finish_machine_seconds',0)+round(time.monotonic()-started,3),'evidence_blocked':True,'sources_blocked':True})
   atomic_json(runtime/'restore-state.json',state);(runtime/'maintenance.json').unlink()
   print('Restored local application: '+address,flush=True)
   print('Raw evidence and provider collection remain blocked until host policy/account reconciliation.',flush=True)
   print('Originalbelege und Anbieterabrufe bleiben bis zur Richtlinien- und Kontenprüfung am Host gesperrt.',flush=True)
   return state
  except Exception:
   state['failed_finish_machine_seconds']=state.get('failed_finish_machine_seconds',0)+round(time.monotonic()-started,3)
   atomic_json(runtime/'restore-state.json',state)
   marker['phase']='failed';atomic_json(runtime/'maintenance.json',marker)
   try:run(root,'stop','api','worker','engine')
   except Exception:pass
   raise
