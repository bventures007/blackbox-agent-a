"""Host backup operations. Caller owns protected configuration and maintenance authority."""
from contextlib import contextmanager
import datetime,fcntl,hashlib,json,os,pathlib,re,secrets,stat,subprocess,time,uuid,threading
from backup_codec import ArchiveWriter,BackupFormatError,encrypt,decrypt,new_recovery,MAX_MEMBERS
from host_runtime import RuntimeConfigError,compose_config,compose_environment,read_compose,protected_directory,protected_read,create_file,_validate_file,read_keyring,key_filename


def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic_json(path,value):
 temporary=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
 create_file(temporary,(json.dumps(value,sort_keys=True)+'\n').encode())
 try:
  if path.is_symlink():raise RuntimeConfigError('Unsafe operational state path.')
  temporary.replace(path)
  fd=os.open(path.parent,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:
  temporary.unlink(missing_ok=True)


def atomic_json_at(directory_fd,name,value):
 temporary='.'+uuid.uuid4().hex+'.tmp'
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
 try:
  with os.fdopen(fd,'wb')as stream:
   stream.write((json.dumps(value,sort_keys=True)+'\n').encode());stream.flush();os.fsync(stream.fileno())
  os.rename(temporary,name,src_dir_fd=directory_fd,dst_dir_fd=directory_fd);os.fsync(directory_fd)
 finally:
  try:os.unlink(temporary,dir_fd=directory_fd)
  except FileNotFoundError:pass


@contextmanager
def operation_lock(runtime):
 protected_directory(runtime)
 fd=os.open(runtime/'.operation.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  _validate_file(os.fstat(fd),'.operation.lock')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeConfigError('Another host maintenance operation is active.')from None
  yield
 finally:os.close(fd)


def compose(root,*args):
 project=read_compose(root/'.runtime').get('BB_PROJECT','blackbox-a')
 return ['docker','compose','--project-name',project,'--env-file',str(root/'.runtime/compose.env'),'-f',str(root/'infra/compose/compose.yaml'),*args]


def run(root,*args,input=None,timeout=120):
 result=subprocess.run(compose(root,*args),env=compose_environment(root/'.runtime'),input=input,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
 if result.returncode:raise RuntimeConfigError('Host container operation failed; inspect local diagnostics.')
 return result.stdout


def sql(root,statement):
 # SQL is fixed operator code, never browser input. No secrets in process arguments.
 raw=run(root,'exec','-T','postgres','psql','-X','-U','blackbox_migrate','-d','blackbox','-v','ON_ERROR_STOP=1','-At',input=statement.encode())
 if len(raw)>16*1024*1024:raise RuntimeConfigError('Backup metadata budget exceeded.')
 return raw


def installation_id(runtime):
 path=runtime/'installation.json'
 if path.exists():
  value=json.loads(protected_read(path))
  if set(value)!={'installation_id'}:raise RuntimeConfigError('Invalid installation identity metadata.')
  uuid.UUID(value['installation_id']);return value['installation_id']
 value=str(uuid.uuid4());create_file(path,json.dumps({'installation_id':value}).encode());return value


def target(config):
 base=pathlib.Path(config['destination']);managed=base/config['directory']
 for path,prefix in [(base,'destination'),(managed,'managed')]:
  value=path.lstat()
  if not stat.S_ISDIR(value.st_mode)or value.st_dev!=config[prefix+'_device']or value.st_ino!=config[prefix+'_inode']:raise RuntimeConfigError('Backup destination unavailable or replaced. Reconnect the enrolled volume.')
 protected_directory(managed)
 return managed


def enroll(root,destination):
 runtime=root/'.runtime';compose_config(runtime)
 with operation_lock(runtime):
  if (runtime/'backup.json').exists():raise RuntimeConfigError('Backup destination already enrolled; recovery key is never shown again.')
  base=destination.expanduser().resolve(strict=True)
  if base.is_relative_to(runtime.resolve())or not base.is_dir()or base.stat().st_uid!=os.getuid():raise RuntimeConfigError('Choose an existing owned destination outside live runtime storage.')
  identity=installation_id(runtime);managed=base/('blackbox-'+identity)
  if managed.exists():raise RuntimeConfigError('Backup management directory already exists; choose a new destination.')
  secret,recipient=new_recovery(root)
  # Verify the independent recovery secret before retaining public material.
  probe=runtime/('.backup-probe-'+uuid.uuid4().hex)
  try:
   with probe.open('xb')as output:
    probe.chmod(0o600)
    with encrypt(root,recipient,output)as stream:stream.write(b'Blackbox backup key verification v1')
   with probe.open('rb')as source,decrypt(root,secret,source)as stream:
    if stream.read()!=b'Blackbox backup key verification v1':raise BackupFormatError('recovery_key_roundtrip_failed')
  finally:probe.unlink(missing_ok=True)
  protected_directory(managed,True)
  b,m=base.stat(),managed.stat()
  config={'schema_version':1,'installation_id':identity,'destination':str(base),'directory':managed.name,'destination_device':b.st_dev,'destination_inode':b.st_ino,'managed_device':m.st_dev,'managed_inode':m.st_ino,'recipient':recipient,'configured_at':stamp(),'interval_seconds':84600,'maximum_age_seconds':86400,'daily_retention':7,'weekly_retention':4,'same_device':b.st_dev==runtime.stat().st_dev}
  create_file(runtime/'backup.json',json.dumps(config).encode())
  atomic_json(runtime/'backup-status.json',{'state':'configured','protected':False,'last_completed':None,'next_due_at':stamp(),'same_device':config['same_device']})
  from backup_supervisor import publish_status
  publish_status(root)
  return secret


def services(root):
 raw=run(root,'ps','--all','--format','json').decode().strip()
 values=json.loads(raw)if raw.startswith('[')else[json.loads(line)for line in raw.splitlines()if line]
 return [v['Service']for v in values if v.get('State')=='running' and v['Service']in ['postgres','api','worker','engine']]


@contextmanager
def fence(root,operation):
 runtime=root/'.runtime';path=runtime/'maintenance.json'
 if path.exists():raise RuntimeConfigError('Unfinished maintenance. Use the explicit recovery procedure before startup.')
 if (runtime/'native-pids.json').exists():raise RuntimeConfigError('Stop this installation native developer runtime before coherent Compose backup.')
 prior=services(root)
 marker={'schema_version':1,'operation':operation,'operation_id':str(uuid.uuid4()),'started_at':stamp(),'phase':'pausing','prior_running':prior}
 atomic_json(path,marker)
 resumed=False;verified_database=False
 try:
  run(root,'stop','api','worker','engine')
  from database_identity import prepare
  prepare(root)
  from release_compatibility import check_database
  check_database(root);verified_database=True
  marker['phase']='fenced';atomic_json(path,marker)
  yield marker
 finally:
  if not verified_database:
   marker['phase']='database_verification_failed';atomic_json(path,marker)
  else:
   marker['phase']='resuming';atomic_json(path,marker)
   try:
    if prior:run(root,'up','-d',*prior)
    if 'postgres'not in prior:run(root,'stop','postgres')
    resumed=True
   finally:
    if resumed:path.unlink()


def cutoffs(root):
 return json.loads(sql(root,"SELECT json_build_object('postgres_major',current_setting('server_version_num')::integer/10000,'heads',(SELECT coalesce(json_agg(h ORDER BY tenant_id),'[]'::json) FROM bb.heads h),'journal_count',(SELECT count(*) FROM bb.journal));"))


def generation(root):
 from backup_supervisor import publish_status,prune
 runtime=root/'.runtime';compose_config(runtime,require_keys=False)
 with operation_lock(runtime):
  config=json.loads(protected_read(runtime/'backup.json',16384));started=stamp()
  try:compose_config(runtime)
  except RuntimeConfigError:
   previous=json.loads(protected_read(runtime/'backup-status.json',16384))if(runtime/'backup-status.json').exists()else{}
   atomic_json(runtime/'backup-status.json',{**previous,'state':'failed','last_attempt':started,'error':'backup_key_material_invalid'})
   publish_status(root);raise
  try:
   managed=target(config)
   directory_fd=os.open(managed,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  except (OSError,RuntimeConfigError):
   previous=json.loads(protected_read(runtime/'backup-status.json',16384)) if (runtime/'backup-status.json').exists() else {}
   atomic_json(runtime/'backup-status.json',{**previous,'state':'failed','last_attempt':started,'error':'backup_destination_unavailable'})
   publish_status(root)
   raise
  partial=uuid.uuid4().hex+'.partial';final=partial.removesuffix('.partial')+'.bb.age';fd=None
  metadata=None;success=None
  try:
   actual=os.fstat(directory_fd)
   if actual.st_dev!=config['managed_device']or actual.st_ino!=config['managed_inode']:raise RuntimeConfigError('Backup destination changed during enrollment check.')
   usage=os.statvfs(managed)
   if usage.f_bavail*usage.f_frsize<max(1024**3,int(usage.f_blocks*usage.f_frsize*.02)):raise RuntimeConfigError('Backup destination has critical free space.')
   prior_status=json.loads(protected_read(runtime/'backup-status.json',16384)) if (runtime/'backup-status.json').exists() else {}
   atomic_json(runtime/'backup-status.json',{**prior_status,'state':'running','last_attempt':started})
   publish_status(root)
   with fence(root,'backup'):
    snapshot=cutoffs(root)
    if snapshot['postgres_major']!=17:raise RuntimeConfigError('Unsupported PostgreSQL backup major version.')
    # Verify the live data key actually opens every retained evidence object before publication.
    run(root,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-evidence.ts',timeout=330)
    cutoff=stamp()
    fd=os.open(partial,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
    with os.fdopen(fd,'w+b',closefd=False)as output:
     with encrypt(root,config['recipient'],output)as encrypted:
      archive=ArchiveWriter(encrypted)
      dump=subprocess.Popen(compose(root,'exec','-T','-e','PGOPTIONS=-c statement_timeout=300000 -c lock_timeout=5000','postgres','pg_dump','-U','blackbox_migrate','-d','blackbox','--format=custom','--no-owner'),env=compose_environment(runtime),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
      dump_timer=threading.Timer(330,dump.kill);dump_timer.start()
      try:
       index=0;dump_hash=hashlib.sha256();dump_bytes=0
       while data:=dump.stdout.read(4*1024*1024):
        archive.add(f'database/{index:08d}.bin',data);index+=1;dump_hash.update(data);dump_bytes+=len(data)
       if dump.wait(timeout=10):raise RuntimeConfigError('Database dump failed; no generation published.')
      finally:
       dump_timer.cancel();dump.stdout.close()
       if dump.poll()is None:dump.kill()
       dump.wait()
      ring=read_keyring(runtime)
      if ring and len(ring['keys'])!=1:raise RuntimeConfigError('Incomplete key rotation cannot be backed up as an ordinary generation.')
      names=['internal',*[key_filename(k)for k in ring['keys']],'identity','keyring.json'] if ring else ['data','internal']
      for name in names:archive.add('secrets/'+name,protected_read(runtime/'secrets'/name,8192))
      if int(sql(root,'SELECT count(*) FROM bb.evidence;'))>MAX_MEMBERS-100:raise RuntimeConfigError('Evidence member budget exceeded.')
      rows=json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('tenant',tenant_id,'id',evidence_id,'retained',expires_at>now()) ORDER BY tenant_id,evidence_id),'[]'::json) FROM bb.evidence;"))
      if len(rows)>MAX_MEMBERS-100:raise RuntimeConfigError('Evidence member budget exceeded.')
      expired=[]
      for row in rows:
       tenant=str(uuid.UUID(row['tenant']));evidence=str(uuid.UUID(row['id']))
       if not row['retained']:expired.append({'tenant':tenant,'id':evidence});continue
       protected_directory(runtime/'evidence'/tenant)
       archive.add(f'evidence/{tenant}/{evidence}',protected_read(runtime/'evidence'/tenant/evidence,8*1024*1024))
      archive.add('policy/redactions.json',json.dumps({'schema_version':1,'expired_evidence':expired,'current_external_ledger_required':True}).encode())
      from release_compatibility import check_database,backup_compatibility
      check_database(root);compatibility=backup_compatibility(root)
      archive.add('installation.json',json.dumps({'installation_id':config['installation_id'],'compatibility':compatibility}).encode())
      if cutoffs(root)!=snapshot:raise RuntimeConfigError('Backup cutoff changed under maintenance fence.')
      metadata={'installation_id':config['installation_id'],'generation':final,'recoverable_cutoff':cutoff,'snapshot':snapshot,'compatibility':compatibility,'database_sha256':dump_hash.hexdigest(),'database_bytes':dump_bytes,'database_chunks':index,'policy_reconciliation_required':True}
      archive.finish(metadata)
     output.flush();os.fsync(fd);output.seek(0);digest=hashlib.sha256();size=0
     while data:=output.read(1024*1024):digest.update(data);size+=len(data)
    os.rename(partial,final,src_dir_fd=directory_fd,dst_dir_fd=directory_fd);os.fsync(directory_fd)
    success={'state':'completed','installation_id':config['installation_id'],'last_attempt':started,'last_completed':stamp(),'recoverable_cutoff':cutoff,'generation':final,'ciphertext_sha256':digest.hexdigest(),'bytes':size,'protected':True,'same_device':config['same_device'],'last_restore_test':prior_status.get('last_restore_test')}
    # Finalized ciphertext only. Unattended encryption is not a decryption/restore test.
    atomic_json_at(directory_fd,final+'.json',success)
   try:success['retention']=prune(root,config,final)
   except Exception:success['retention_error']=True
   atomic_json(runtime/'backup-status.json',success);publish_status(root)
   return success
  except Exception:
   previous=json.loads(protected_read(runtime/'backup-status.json',16384)) if (runtime/'backup-status.json').exists() else {}
   atomic_json(runtime/'backup-status.json',{**previous,'state':'failed','last_attempt':started,'error':'backup_failed','incomplete_generation':partial if success is None else None})
   publish_status(root)
   raise
  finally:
   if fd is not None:os.close(fd)
   os.close(directory_fd)
