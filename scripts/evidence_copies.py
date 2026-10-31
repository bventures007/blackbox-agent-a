"""Bounded metadata inventory of enrolled backups; never an archive integrity claim."""
import datetime,json,os,re,time
from backup_operations import target
from host_runtime import _validate_file,protected_read,RuntimeConfigError
from backup_codec import decode_json,BackupFormatError

MAX_ENTRIES=20000
MAX_VISIBLE=100

def inventory(root,now=None):
 from backup_supervisor import timestamp
 now=time.time()if now is None else now
 result={'observed_at':datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat(),'state':'not_configured','generations':[],'total':0,'truncated':False}
 config_path=root/'.runtime/backup.json'
 if not config_path.exists():return result
 try:
  config=json.loads(protected_read(config_path,32768));managed=target(config)
  fd=os.open(managed,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:
   info=os.fstat(fd)
   if info.st_dev!=config['managed_device']or info.st_ino!=config['managed_inode']:raise RuntimeConfigError('Backup inventory target changed.')
   with os.scandir(fd)as entries:
    candidates=[];deadline=time.monotonic()+5
    for number,entry in enumerate(entries,1):
     if number>MAX_ENTRIES or time.monotonic()>deadline:raise RuntimeConfigError('Backup inventory scan budget exceeded.')
     name=entry.name
     if not re.fullmatch(r'[a-f0-9]{32}\.bb\.age\.json',name):continue
     meta=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
     try:
      value_info=os.fstat(meta);_validate_file(value_info,name)
      if value_info.st_size>32768:raise RuntimeConfigError('Backup inventory metadata oversized.')
      with os.fdopen(meta,'rb',closefd=False)as stream:raw=stream.read(32769)
      if len(raw)>32768:raise RuntimeConfigError('Backup inventory metadata oversized.')
      value=decode_json(raw)
     finally:os.close(meta)
     if not isinstance(value,dict):raise RuntimeConfigError('Backup inventory metadata invalid.')
     data_name=name[:-5];completed=timestamp(value.get('last_completed'));cutoff=timestamp(value.get('recoverable_cutoff'))
     if value.get('installation_id')!=config['installation_id']or value.get('state')!='completed'or value.get('generation')!=data_name:continue
     if completed is None or cutoff is None or cutoff>completed or completed>now+300 or type(value.get('bytes'))is not int or value['bytes']<=0 or not isinstance(value.get('ciphertext_sha256'),str)or not re.fullmatch('[a-f0-9]{64}',value['ciphertext_sha256']):raise RuntimeConfigError('Backup inventory metadata invalid.')
     data=os.open(data_name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
     try:
      info=os.fstat(data);_validate_file(info,data_name)
      if info.st_size!=value['bytes']:raise RuntimeConfigError('Backup inventory size differs.')
     finally:os.close(data)
     candidates.append({'generation':data_name[:-7],'recoverable_cutoff':value['recoverable_cutoff']})
    candidates.sort(key=lambda v:timestamp(v['recoverable_cutoff']),reverse=True)
    result.update({'state':'available','generations':candidates[:MAX_VISIBLE],'total':len(candidates),'truncated':len(candidates)>MAX_VISIBLE})
  finally:os.close(fd)
 except (OSError,RuntimeConfigError,BackupFormatError,ValueError,KeyError,TypeError):
  result.update({'state':'unavailable','generations':[],'total':None,'truncated':False})
 return result
