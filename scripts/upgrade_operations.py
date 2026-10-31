"""Populated schema8/schema10 -> schema11 upgrade. Never downgrades or resets a volume.

The new versioned host bundle is placed in the existing installation directory
before invoking this module. Runtime storage is preserved. Images are explicit
immutable identities, not whatever happens to occupy a development tag.
"""
import fcntl,hashlib,json,os,pathlib,re,shutil,subprocess,time,uuid
from contextlib import contextmanager
from host_runtime import RuntimeConfigError,compose_config,protected_read,protected_directory,create_file,compose_environment,read_compose
from backup_operations import operation_lock,atomic_json,services,run,sql,stamp,cutoffs,compose
from release_images import pins,validate,require_available,save,verify_target
from release_compatibility import read_manifest,migration_rows,require_prefix,check_upgrade_source,check_database,apply_migration,runtime_for_schema

PHASES={'preparing','probing_source','backup','backup_verified','migrating','verifying','resuming'}

def require_backup_context(root,context):
 """Internal capability: the caller holds this installation's actual flock FD."""
 fd=context.get('lease_fd');expected=(root/'.runtime/.operation.lock').stat()
 try:actual=os.fstat(fd)
 except (TypeError,OSError):raise RuntimeConfigError('Upgrade backup requires the live maintenance lease.')from None
 if (actual.st_dev,actual.st_ino)!=(expected.st_dev,expected.st_ino):raise RuntimeConfigError('Foreign upgrade maintenance lease.')
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 marker=read_marker(root)
 if marker['operation_id']!=context.get('operation_id')or marker['phase']!='backup'or marker['source_schema']!=context.get('source_schema'):
  raise RuntimeConfigError('Upgrade backup checkpoint mismatch.')
 if set(services(root))-{'postgres'}:raise RuntimeConfigError('Upgrade backup requires stopped application services.')
 check_upgrade_source(root,context['source_schema'])

def read_marker(root):
 value=json.loads(protected_read(root/'.runtime/maintenance.json',65536))
 if value.get('schema_version')!=1 or value.get('operation')!='upgrade'or value.get('phase')not in PHASES:
  raise RuntimeConfigError('No matching resumable upgrade. Use the recorded operation recovery procedure.')
 uuid.UUID(value['operation_id'])
 if value.get('source_schema')not in [8,10,11]or not isinstance(value.get('prior_running'),list)or len(value['prior_running'])!=len(set(value['prior_running']))or not set(value['prior_running'])<={'postgres','api','worker','engine'}:
  raise RuntimeConfigError('Invalid upgrade checkpoint.')
 validate(value['source_images']);validate(value['target_images'])
 return value

def fingerprint_files(root):
 # Keep a concrete recovery copy of every executable host file/migration used.
 from backup_restore import runtime_bundle_files
 result={}
 for name in runtime_bundle_files(root):
  path=root/name
  if path.is_symlink()or not path.is_file()or path.stat().st_size>64*1024*1024:raise RuntimeConfigError('Unsafe or missing target bundle file.')
  result[name]=hashlib.sha256(path.read_bytes()).hexdigest()
 return result

def preserve_bundle(root,operation):
 files=fingerprint_files(root);directory=root/'.runtime/upgrade-bundles'/operation
 protected_directory(directory.parent,True)
 from itertools import islice
 if len(list(islice(directory.parent.iterdir(),9)))>=8:raise RuntimeConfigError('Eight upgrade recovery bundles are already retained. Review and archive an older verified bundle before starting another upgrade; no automatic deletion.')
 directory.mkdir(mode=0o700)
 for name,digest in files.items():
  destination=directory/name;destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  create_file(destination,(root/name).read_bytes())
  if hashlib.sha256(protected_read(destination,64*1024*1024)).hexdigest()!=digest:raise RuntimeConfigError('Target bundle changed while preserving it.')
 atomic_json(directory/'manifest.json',files)
 return hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()

def verify_bundle(root,marker):
 directory=root/'.runtime/upgrade-bundles'/marker['operation_id']
 files=json.loads(protected_read(directory/'manifest.json',65536))
 if hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()!=marker['bundle_sha256']or files!=fingerprint_files(root):raise RuntimeConfigError('Target bundle changed. Restore the exact protected upgrade bundle before resuming; never substitute newer files.')
 for name,digest in files.items():
  if hashlib.sha256(protected_read(directory/name,64*1024*1024)).hexdigest()!=digest:raise RuntimeConfigError('Protected target bundle copy changed. Use the recorded versioned release artifact.')

def source_images(root):
 images=[]
 for service in ['api','engine']:
  identifiers=run(root,'ps','--all','--quiet',service).decode().strip().splitlines()
  if len(identifiers)!=1 or not re.fullmatch('[a-f0-9]{12,64}',identifiers[0]):raise RuntimeConfigError('Original API/engine container identity is unavailable. Use isolated recovery instead of guessing source images.')
  result=subprocess.run(['docker','container','inspect','--format','{{.Image}}',identifiers[0]],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20)
  if result.returncode:raise RuntimeConfigError('Original image identity could not be inspected.')
  images.append(result.stdout.decode().strip())
 return pins(*images)

def phase(root,marker,name):
 marker['phase']=name;marker['updated_at']=stamp();atomic_json(root/'.runtime/maintenance.json',marker)
 log_phase(root,marker['operation_id'],name)

def log_phase(root,operation,name):
 if name not in PHASES|{'completed','failed'}:raise RuntimeConfigError('Unknown upgrade diagnostic phase.')
 # Fixed code and phase only, never backup paths, credentials or query results.
 try:
  path=root/'.runtime/logs/wrapper.jsonl'
  if path.exists()and path.stat().st_size>8*1024*1024:path.replace(path.with_suffix('.jsonl.1'))
  fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
  from host_runtime import _validate_file
  now=stamp()
  with os.fdopen(fd,'w')as stream:
   _validate_file(os.fstat(stream.fileno()),path.name)
   stream.write(json.dumps({'schema_version':1,'record_id':str(uuid.uuid4()),'component':'wrapper','event_name':'wrapper.upgrade.'+name,'message':'Upgrade phase: '+name,'operation_id':operation,'occurred_at':now,'observed_at':now,'level':'ERROR'if name=='failed'else'INFO','instance_id':operation,'scope':'installation','service_version':'0.1.0'})+'\n')
 except OSError:pass # The durable maintenance checkpoint remains authoritative.

def journal_cutoffs(snapshot):
 # Projection generation metadata can change; journal positions never do.
 return {**snapshot,'heads':[{k:v for k,v in head.items()if k not in ['projection_generation','projection_rule']}for head in snapshot['heads']]}

def journal_digest(root):
 # Stream the complete immutable row representation; no business rows on disk or stdout.
 statement="COPY (SELECT to_jsonb(j)::text FROM bb.journal j ORDER BY tenant_id,sequence) TO STDOUT;"
 process=subprocess.Popen(compose(root,'exec','-T','postgres','psql','-X','-U','blackbox_migrate','-d','blackbox','-v','ON_ERROR_STOP=1','-q','-c',statement),env=compose_environment(root/'.runtime'),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 import threading
 timer=threading.Timer(300,process.kill);timer.start();digest=hashlib.sha256();size=0
 try:
  while data:=process.stdout.read(1024*1024):
   size+=len(data)
   if size>16*1024**3:raise RuntimeConfigError('Upgrade journal verification exceeds its bounded scan budget.')
   digest.update(data)
  if process.wait(timeout=10):raise RuntimeConfigError('Journal verification failed; upgrade remains fenced.')
  return {'sha256':digest.hexdigest(),'bytes':size,'cutoffs':journal_cutoffs(cutoffs(root))}
 finally:
  timer.cancel();process.stdout.close()
  if process.poll()is None:process.kill()
  process.wait()

def verify_invariants(root):
 bad=sql(root,"SELECT EXISTS(SELECT 1 FROM bb.heads h WHERE h.applied>h.committed OR h.committed<>(SELECT coalesce(max(sequence),0) FROM bb.journal j WHERE j.tenant_id=h.tenant_id)) OR EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='bb'::regnamespace AND NOT convalidated) OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='bb'::regnamespace AND relname IN ('journal','evidence','credentials','source_jobs','record_versions','current_records') AND (NOT relrowsecurity OR NOT relforcerowsecurity));")
 if bad.strip()!=b'f':raise RuntimeConfigError('Journal/schema/isolation invariant failed. Upgrade remains fenced.')

def check_migration_progress(root,marker,manifest):
 rows=migration_rows(root);require_prefix(rows,manifest)
 if len(rows)<marker['source_schema']:raise RuntimeConfigError('Migration history went backwards.')
 expected=runtime_for_schema(manifest,len(rows))
 metadata=json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('contract',contract,'state',state)),'[]'::json) FROM bb.runtime_contract;"))
 if len(metadata)!=1 or metadata[0].get('contract')!=expected or metadata[0].get('state')not in ['active','fenced']:
  raise RuntimeConfigError('Interrupted migration has an unknown runtime contract; no changes were made.')
 return rows

def probe(root,mode):
 # The script is supplied by the pinned new host, but runs in the selected old/new
 # tooling image so the corresponding engine contract is tested on real data.
 script=(root/'scripts/upgrade-probe.mjs').read_bytes()
 marker=read_marker(root);project=read_compose(root/'.runtime').get('BB_PROJECT','blackbox-a')
 result=json.loads(run(root,'run','--rm','--no-deps','--name',project+'-upgrade-probe','--label','com.blackbox.upgrade='+marker['operation_id'],'--user',str(os.getuid())+':'+str(os.getgid()),'tooling','node','--input-type=module','-',mode,input=script,timeout=330))
 if result.get('status')!='passed':raise RuntimeConfigError('Representative Rust answers did not verify.')
 return result

def stop_interrupted_probe(root,marker):
 project=read_compose(root/'.runtime').get('BB_PROJECT','blackbox-a');name=project+'-upgrade-probe'
 found=subprocess.run(['docker','container','inspect',name],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20)
 if found.returncode:return # The mandatory subsequent Compose fence detects daemon failures.
 if len(found.stdout)>1024*1024:raise RuntimeConfigError('Unexpected upgrade probe metadata size.')
 values=json.loads(found.stdout)
 if len(values)!=1:raise RuntimeConfigError('Unexpected upgrade probe identity.')
 value=values[0];labels=value.get('Config',{}).get('Labels',{})
 if value.get('Name')!='/'+name or labels.get('com.docker.compose.project')!=project or labels.get('com.docker.compose.service')!='tooling' or labels.get('com.blackbox.upgrade')!=marker['operation_id'] or not re.fullmatch('[a-f0-9]{64}',value.get('Id','')):
  raise RuntimeConfigError('Interrupted probe does not belong to this upgrade. No unrelated container was changed.')
 removed=subprocess.run(['docker','container','rm','--force',value['Id']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
 if removed.returncode:raise RuntimeConfigError('Interrupted upgrade probe could not be stopped.')

def verify_generation(root,marker,secret):
 from backup_restore import verified_backup
 from backup_operations import target
 config=json.loads(protected_read(root/'.runtime/backup.json',16384));path=target(config)/marker['backup']['generation']
 with verified_backup(root,path,secret)as(_,manifest,_,digest):
  if digest!=marker['backup']['ciphertext_sha256']or journal_cutoffs(manifest['metadata']['snapshot'])!=marker['journal']['cutoffs']or manifest['metadata']['compatibility']['schema']!=marker['source_schema']:
   raise RuntimeConfigError('Pre-upgrade backup does not match the fenced source cutoff.')
 return {'generation':marker['backup']['generation'],'ciphertext_sha256':digest,'recoverable_cutoff':manifest['metadata']['recoverable_cutoff']}

@contextmanager
def upgrade_lease(root):
 with operation_lock(root/'.runtime')as lease:
  try:yield lease
  except Exception:
   # Preserve the resumable phase while still holding the same exclusive lease.
   # Never serialize arbitrary exception text into diagnostics or checkpoints.
   try:
    marker=read_marker(root);marker['last_failure_at']=stamp();marker['error_code']='upgrade_incomplete'
    atomic_json(root/'.runtime/maintenance.json',marker);log_phase(root,marker['operation_id'],'failed')
   except (OSError,RuntimeConfigError,ValueError,KeyError):pass
   raise

def upgrade(root,secret,*,node_image=None,engine_image=None,resume=False):
 runtime=root/'.runtime';compose_config(runtime);manifest=read_manifest(root)
 if(runtime/'native-pids.json').exists():raise RuntimeConfigError('Stop the native developer runtime before a Compose upgrade.')
 if shutil.disk_usage(runtime).free<max(1024**3,int(shutil.disk_usage(runtime).total*.02)):raise RuntimeConfigError('Critical host free space; upgrade not started.')
 with upgrade_lease(root)as lease:
  if resume:
   marker=read_marker(root);verify_bundle(root,marker)
   stop_interrupted_probe(root,marker)
  else:
   if(runtime/'maintenance.json').exists():raise RuntimeConfigError('Unfinished host maintenance; resume it first.')
   target=pins(node_image,engine_image);verify_target(target,manifest)
   from database_identity import prepare
   prior_running=services(root);prepare(root);rows=migration_rows(root);require_prefix(rows,manifest);source_schema=len(rows);check_upgrade_source(root,source_schema)
   if not(runtime/'backup.json').exists():raise RuntimeConfigError('Configure an encrypted backup destination and save its recovery key before upgrading.')
   operation=str(uuid.uuid4());original=source_images(root);require_available(original)
   marker={'schema_version':1,'operation':'upgrade','operation_id':operation,'phase':'preparing','started_at':stamp(),'prior_running':prior_running,'source_schema':source_schema,'source_images':original,'target_images':target,'bundle_sha256':preserve_bundle(root,operation)}
   phase(root,marker,'preparing')
  require_available(marker['source_images']);require_available(marker['target_images'])
  from backup_supervisor import stop as stop_supervisor
  stop_supervisor(root)
  # A retry never trusts timers or a prior claim that writers have stopped.
  run(root,'stop','api','worker','engine')
  from database_identity import prepare
  prepare(root)
  if marker['phase']in ['preparing','probing_source']:
   save(runtime,marker['source_images']);check_upgrade_source(root,marker['source_schema'])
   phase(root,marker,'probing_source');run(root,'up','-d','engine')
   marker['source_probe']=probe(root,'capture');run(root,'stop','engine')
   marker['journal']=journal_digest(root);verify_invariants(root);phase(root,marker,'backup')
  if marker['phase']=='backup':
   save(runtime,marker['source_images']);check_upgrade_source(root,marker['source_schema'])
   if journal_digest(root)!=marker['journal']:raise RuntimeConfigError('Source journal changed after fencing; no migration is allowed.')
   if 'backup'not in marker:
    from backup_operations import generation
    marker['backup']=generation(root,upgrade_context={'lease_fd':lease,'operation_id':marker['operation_id'],'source_schema':marker['source_schema']});phase(root,marker,'backup')
   marker['verified_backup']=verify_generation(root,marker,secret)
   phase(root,marker,'backup_verified')
  if marker['phase']in ['backup_verified','migrating']:
   verify_generation(root,marker,secret)
   if journal_digest(root)!=marker['journal']:raise RuntimeConfigError('Journal changed during migration preparation.')
   phase(root,marker,'migrating')
   rows=check_migration_progress(root,marker,manifest)
   sql(root,"UPDATE bb.runtime_contract SET state='fenced',changed_at=now();")
   for migration in manifest['migrations'][len(rows):]:
    apply_migration(root,migration);marker['last_migration']=migration['file'];phase(root,marker,'migrating')
   save(runtime,marker['target_images']);phase(root,marker,'verifying')
  if marker['phase']=='verifying':
   check_migration_progress(root,marker,manifest)
   require_prefix(migration_rows(root),manifest,complete=True)
   # API/MCP and worker remain stopped. Only the private engine is started for
   # validation; its normal runtime checks still apply without a bypass mode.
   sql(root,"UPDATE bb.runtime_contract SET state='active',changed_at=now();")
   save(runtime,marker['target_images']);check_database(root);verify_invariants(root)
   run(root,'up','-d','engine');marker['target_probe']=probe(root,'compare');run(root,'stop','engine')
   if journal_digest(root)!=marker['journal']:raise RuntimeConfigError('Immutable journal changed during upgrade verification.')
   run(root,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-evidence.ts',timeout=330)
   phase(root,marker,'resuming')
  # After this durable phase a previous start may have served authorized work.
  # Do not demand the old cutoff or rerun migrations on a resume here.
  save(runtime,marker['target_images']);check_database(root);verify_invariants(root)
  if marker['prior_running']:run(root,'up','-d',*marker['prior_running'])
  if 'api'in marker['prior_running']:
   from release_compatibility import wait_for_traffic
   wait_for_traffic(root)
  if 'postgres'not in marker['prior_running']:run(root,'stop','postgres')
  result={'schema_version':1,'state':'completed','operation_id':marker['operation_id'],'started_at':marker['started_at'],'completed_at':stamp(),'source_schema':marker['source_schema'],'target_schema':manifest['install']['schema'],'backup':marker['verified_backup'],'journal':marker['journal'],'source_probe':marker['source_probe'],'target_probe':marker['target_probe'],'images':marker['target_images'],'rollback':'isolated_pre_upgrade_restore_only'}
  atomic_json(runtime/'upgrade-status.json',result);(runtime/'maintenance.json').unlink()
  log_phase(root,marker['operation_id'],'completed')
  fd=os.open(runtime,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
  if 'api'in marker['prior_running']:
   from backup_supervisor import start
   start(root)
  return result
