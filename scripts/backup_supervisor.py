"""Explicitly launched host supervisor; no OS service and no browser shell access."""
import datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,sys,time,threading
from host_runtime import protected_directory,protected_read,create_file,_validate_file,RuntimeConfigError,compose_config
from backup_operations import atomic_json,operation_lock,services,target,generation,run,stamp,sql

POLL_SECONDS=15
RETRY_SECONDS=300
STATES={'not_configured','scheduled','running','failed','overdue','completed','maintenance_required'}

def timestamp(value):
 if not isinstance(value,str):return None
 try:
  parsed=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
  return parsed.timestamp()if parsed.tzinfo else None
 except (ValueError,OverflowError):return None

def prepare_control(runtime):
 for path in [runtime/'control',runtime/'control/status',runtime/'control/requests']:protected_directory(path,True)

def bind_owner_workspace(root):
 """Same immutable first workspace selected by protected setup; no browser binding."""
 import uuid
 value=sql(root,'SELECT tenant_id FROM bb.workspaces ORDER BY created_at LIMIT 1;').decode().strip()
 if not value:return
 value=str(uuid.UUID(value));path=root/'.runtime/owner-workspace.json'
 if path.exists():
  if load_json(path)!={'tenant_id':value}:raise RuntimeConfigError('Installation owner workspace differs from the protected binding.')
 else:create_file(path,json.dumps({'tenant_id':value}).encode())

def load_json(path):
 return json.loads(protected_read(path,32768))if path.exists()else{}

def policy_values(interval_seconds,daily,weekly):
 if isinstance(interval_seconds,bool)or not isinstance(interval_seconds,int)or not 1800<=interval_seconds<=604800:raise RuntimeConfigError('Backup interval must be 0.5 to 168 hours.')
 if any(isinstance(x,bool)or not isinstance(x,int)for x in [daily,weekly])or not 1<=daily<=90 or not 1<=weekly<=52:raise RuntimeConfigError('Retain 1–90 daily and 1–52 weekly generations.')
 return {'interval_seconds':interval_seconds,'daily_retention':daily,'weekly_retention':weekly}

def set_policy(root,interval_seconds,daily,weekly):
 runtime=root/'.runtime';compose_config(runtime)
 values=policy_values(interval_seconds,daily,weekly)
 with operation_lock(runtime):
  config=load_json(runtime/'backup.json')
  if not config:raise RuntimeConfigError('Enroll a backup destination first.')
  config.update(values);atomic_json(runtime/'backup.json',config);publish_status(root)

def status_value(root,now=None,heartbeat=None):
 now=time.time()if now is None else now;runtime=root/'.runtime';config=load_json(runtime/'backup.json');last=load_json(runtime/'backup-status.json')
 maintenance=(runtime/'maintenance.json').exists();active_operation=False
 if maintenance:
  lock=os.open(runtime/'.operation.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
  try:
   _validate_file(os.fstat(lock),'.operation.lock')
   try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:active_operation=True
  finally:os.close(lock)
 maintenance=maintenance and not active_operation
 cutoff=timestamp(last.get('recoverable_cutoff'));attempt=timestamp(last.get('last_attempt'))
 due=(cutoff+config['interval_seconds'])if cutoff is not None and config else now
 future=cutoff is not None and cutoff>now+300
 age=max(0,int(now-cutoff))if cutoff is not None else None
 available=False
 if config:
  try:target(config);available=True
  except (OSError,RuntimeConfigError,KeyError):pass
 state='not_configured'
 if config:
  state=last.get('state','scheduled')
  if state not in STATES:state='scheduled'
  if state in ['completed','configured']and now>=due:state='scheduled'
  if not available:state='failed'
  if age is None or age>config.get('maximum_age_seconds',86400):
   if state not in ['running','failed']:state='overdue'
  if maintenance:state='maintenance_required'
  if future:state='failed'
 result={'schema_version':1,'observed_at':datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat(),'configured':bool(config),'state':state,'destination_available':available,'same_device':bool(config.get('same_device',False)),'last_attempt':last.get('last_attempt'),'last_completed':last.get('last_completed'),'recoverable_cutoff':last.get('recoverable_cutoff'),'recoverable_age_seconds':age,'next_due_at':datetime.datetime.fromtimestamp(due,datetime.timezone.utc).isoformat()if config else None,'last_restore_test':last.get('last_restore_test'),'bytes':last.get('bytes'),'overdue':bool(config)and(age is None or age>config.get('maximum_age_seconds',86400)),'clock_anomaly':future,'interval_seconds':config.get('interval_seconds'),'daily_retention':config.get('daily_retention'),'weekly_retention':config.get('weekly_retention'),'retention_error':bool(last.get('retention_error')),'request_pending':(runtime/'control/requests/backup.json').exists(),'maintenance_required':maintenance,'scheduler_heartbeat':heartbeat or load_json(runtime/'supervisor.json').get('observed_at')}
 result['owner_workspace_id']=load_json(runtime/'owner-workspace.json').get('tenant_id')
 return result

def publish_status(root,now=None,heartbeat=None):
 runtime=root/'.runtime';prepare_control(runtime);value=status_value(root,now,heartbeat);atomic_json(runtime/'control/status/backup.json',value);return value

def due_now(config,last,now,manual=False):
 if manual:return True
 attempted=timestamp(last.get('last_attempt'));cutoff=timestamp(last.get('recoverable_cutoff'))
 if cutoff is not None and cutoff>now+300:return False
 if last.get('state')=='failed'and attempted is not None and now<attempted+RETRY_SECONDS:return False
 return cutoff is None or now>=cutoff+config['interval_seconds']

def retained_names(generations,daily,weekly):
 # Newest successful generation for each distinct UTC day / ISO week.
 ordered=sorted(generations,key=lambda value:value['completed'],reverse=True)
 keep=set();days=set();weeks=set()
 for value in ordered:
  at=datetime.datetime.fromtimestamp(value['completed'],datetime.timezone.utc);day=at.date();iso=at.isocalendar();week=(iso.year,iso.week)
  if day not in days and len(days)<daily:days.add(day);keep.add(value['name'])
  if week not in weeks and len(weeks)<weekly:weeks.add(week);keep.add(value['name'])
 if ordered:keep.add(ordered[0]['name'])
 return keep

def prune(root,config,newest):
 """Only finalized own generations; descriptor-bound names, no followed links."""
 managed=target(config);fd=os.open(managed,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  actual=os.fstat(fd)
  if actual.st_dev!=config['managed_device']or actual.st_ino!=config['managed_inode']:raise RuntimeConfigError('Backup target changed before retention.')
  names=os.listdir(fd)
  if len(names)>20000:raise RuntimeConfigError('Backup retention scan budget exceeded.')
  candidates=[]
  for name in names:
   if not re.fullmatch(r'[a-f0-9]{32}\.bb\.age\.json',name):continue
   meta_fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
   try:
    _validate_file(os.fstat(meta_fd),name)
    if os.fstat(meta_fd).st_size>32768:continue
    with os.fdopen(meta_fd,'rb',closefd=False)as file:value=json.loads(file.read(32769))
   finally:os.close(meta_fd)
   data_name=name[:-5];completed=timestamp(value.get('last_completed'))
   if value.get('installation_id')!=config['installation_id']or value.get('state')!='completed'or value.get('generation')!=data_name or completed is None:continue
   if not isinstance(value.get('bytes'),int)or not re.fullmatch(r'[a-f0-9]{64}',value.get('ciphertext_sha256','')):continue
   info=os.stat(data_name,dir_fd=fd,follow_symlinks=False);_validate_file(info,data_name)
   if info.st_size!=value['bytes']:continue
   candidates.append({'name':data_name,'completed':completed,'sha256':value['ciphertext_sha256'],'size':info.st_size})
  if newest not in {x['name']for x in candidates}:raise RuntimeConfigError('New completed generation missing from retention scan.')
  keep=retained_names(candidates,config['daily_retention'],config['weekly_retention'])|{newest};deleted=0;deadline=time.monotonic()+300
  for value in candidates:
   if value['name']in keep:continue
   file_fd=os.open(value['name'],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
   try:
    _validate_file(os.fstat(file_fd),value['name']);digest=hashlib.sha256()
    with os.fdopen(file_fd,'rb',closefd=False)as stream:
     while data:=stream.read(1024*1024):
      if time.monotonic()>deadline:raise RuntimeConfigError('Backup retention work deadline exceeded.')
      digest.update(data)
    if digest.hexdigest()!=value['sha256']:continue
   finally:os.close(file_fd)
   os.unlink(value['name'],dir_fd=fd);os.unlink(value['name']+'.json',dir_fd=fd);deleted+=1
  os.fsync(fd);return {'deleted':deleted,'retained':len(candidates)-deleted}
 finally:os.close(fd)

def recover_backup(root):
 runtime=root/'.runtime';compose_config(runtime)
 with operation_lock(runtime):
  marker=load_json(runtime/'maintenance.json')
  if marker.get('operation')!='backup'or marker.get('phase')not in ['pausing','fenced','resuming']:raise RuntimeConfigError('Only an interrupted backup fence can use this recovery command.')
  prior=marker.get('prior_running')
  if not isinstance(prior,list)or len(set(prior))!=len(prior)or any(x not in ['postgres','api','worker','engine']for x in prior):raise RuntimeConfigError('Invalid maintenance service state; inspect the protected checkpoint.')
  # Backup creation never mutates canonical data or live encryption keys.
  run(root,'stop','api','worker','engine')
  if prior:run(root,'up','-d',*prior)
  if 'postgres'not in prior:run(root,'stop','postgres')
  last=load_json(runtime/'backup-status.json');atomic_json(runtime/'backup-status.json',{**last,'state':'failed','error':'interrupted_backup_recovered'})
  (runtime/'maintenance.json').unlink();publish_status(root)

def request_present(runtime,now):
 temporary=runtime/'control/requests/backup.requesting'
 if temporary.exists():
  info=temporary.lstat();_validate_file(info,temporary.name)
  if now-info.st_mtime>600:temporary.unlink()
 path=runtime/'control/requests/backup.json'
 if not path.exists():return False
 value=load_json(path)
 import uuid
 if set(value)!={'schema_version','request_id','requested_at','principal_id','tenant_id'}or value['schema_version']!=1:raise RuntimeConfigError('Invalid narrow backup request.')
 for field in ['request_id','principal_id','tenant_id']:uuid.UUID(value[field])
 when=timestamp(value['requested_at'])
 if when is None or when>now+300:raise RuntimeConfigError('Invalid backup request time.')
 if now-when>600:path.unlink();return False
 return True

def tick(root,now=None):
 now=time.time()if now is None else now;runtime=root/'.runtime';heartbeat=stamp();atomic_json(runtime/'supervisor.json',{'observed_at':heartbeat,'pid':os.getpid()});publish_status(root,now,heartbeat)
 if(runtime/'maintenance.json').exists():return
 config=load_json(runtime/'backup.json')
 if not config:return
 last=load_json(runtime/'backup-status.json');manual=request_present(runtime,now)
 if not due_now(config,last,now,manual):return
 # Do not start stopped backends just because a schedule became due.
 if 'api'not in services(root):return
 try:
  generation(root)
 finally:
  if manual:(runtime/'control/requests/backup.json').unlink(missing_ok=True)
  publish_status(root)

def start(root):
 runtime=root/'.runtime';bind_owner_workspace(root);prepare_control(runtime);(runtime/'supervisor.stop').unlink(missing_ok=True);publish_status(root)
 subprocess.Popen([sys.executable,str(root/'scripts/backup_supervisor.py'),'--root',str(root)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)

def stop(root):
 atomic_json(root/'.runtime/supervisor.stop',{'requested_at':stamp()})

def supervise(root):
 runtime=root/'.runtime';compose_config(runtime);prepare_control(runtime)
 fd=os.open(runtime/'.supervisor.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 acquired=False;finished=threading.Event();heartbeat_thread=None
 try:
  _validate_file(os.fstat(fd),'.supervisor.lock')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  acquired=True
  # A bounded backup can take longer than the UI heartbeat window. Keep the
  # scheduler's liveness distinct from the generation's progress/outcome.
  def heartbeat():
   while not finished.is_set():
    try:
     now=stamp();atomic_json(runtime/'supervisor.json',{'observed_at':now,'pid':os.getpid()});publish_status(root,heartbeat=now)
    except Exception:pass
    finished.wait(10)
  heartbeat_thread=threading.Thread(target=heartbeat,daemon=True);heartbeat_thread.start()
  while not(runtime/'supervisor.stop').exists():
   try:tick(root)
   except Exception:
    # Detailed keys/paths/exception strings never enter host diagnostics.
    atomic_json(runtime/'supervisor-error.json',{'observed_at':stamp(),'error':'backup_supervisor_operation_failed'})
   for _ in range(POLL_SECONDS):
    if(runtime/'supervisor.stop').exists():break
    time.sleep(1)
 finally:
  finished.set()
  if heartbeat_thread:heartbeat_thread.join(timeout=15)
  if acquired:
   atomic_json(runtime/'supervisor.json',{'observed_at':None,'pid':None});publish_status(root)
  os.close(fd)

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=pathlib.Path);options=parser.parse_args();supervise(options.root.resolve())
