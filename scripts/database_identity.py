"""Bind the host installation to its own existing PostgreSQL volume and cluster.

Call prepare() under the host maintenance lock before starting application
services. A lost database is a recovery event, never an implicit empty setup.
"""
import datetime,json,os,re,subprocess,time
from host_runtime import RuntimeConfigError,read_compose,protected_read,create_file


def names(root):
 config=read_compose(root/'.runtime');project=config.get('BB_PROJECT','blackbox-a')
 return project,project+'_postgres'


def docker(*args,timeout=30,strict_stderr=False):
 result=subprocess.run(['docker',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 if result.returncode or (strict_stderr and result.stderr):raise RuntimeConfigError('Database inspection failed. Check Docker and the original installation volume; no replacement was created.')
 if len(result.stdout)>65536:raise RuntimeConfigError('Unexpected database inspection output size.')
 return result.stdout


def volume(root):
 project,name=names(root)
 found=docker('volume','ls','--filter','name=^'+name+'$','--format','{{.Name}}').decode().splitlines()
 if not found:return None
 if found!=[name]:raise RuntimeConfigError('Ambiguous installation database volume.')
 values=json.loads(docker('volume','inspect',name))
 if len(values)!=1:raise RuntimeConfigError('Unexpected database volume identity.')
 value=values[0];labels=value.get('Labels')or{}
 if value.get('Name')!=name or value.get('Driver')!='local' or labels.get('com.docker.compose.project')!=project or labels.get('com.docker.compose.volume')!='postgres':
  raise RuntimeConfigError('Database volume does not belong to this installation. No foreign volume was changed.')
 return value


def control_identity(root):
 # This read-only container cannot initialize PostgreSQL, mount host secrets,
 # expose a port, or inspect any volume other than the validated installation.
 if volume(root)is None:raise RuntimeConfigError('Installation database volume is missing. Restore a verified backup; normal startup never creates a replacement.')
 project,name=names(root)
 images=re.findall(r'^    image: (postgres:17@sha256:[a-f0-9]{64})$',(root/'infra/compose/compose.yaml').read_text(),re.MULTILINE)
 if len(images)!=1:raise RuntimeConfigError('Unsupported pinned PostgreSQL inspection image.')
 output=docker('run','--rm','--network','none','--read-only','--user','postgres','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--pids-limit','16','--cpus','0.25','--env','LC_ALL=C','--mount','type=volume,source='+name+',target=/data,readonly','--entrypoint','sh',images[0],'-c','set -eu; cat /data/PG_VERSION; pg_controldata -D /data',timeout=20,strict_stderr=True).decode()
 lines=output.splitlines();identifier=re.findall(r'^Database system identifier:\s+([0-9]{10,24})$',output,re.MULTILINE)
 if not lines or lines[0]!='17' or len(identifier)!=1:raise RuntimeConfigError('Database control files are missing, corrupt or incompatible. Restore the original database; no initialization attempted.')
 return identifier[0]


def marker(root):
 path=root/'.runtime/database-identity.json'
 if not path.exists()and not path.is_symlink():return None
 try:value=json.loads(protected_read(path,4096))
 except (ValueError,UnicodeError):raise RuntimeConfigError('Invalid protected database identity marker.')from None
 project,name=names(root)
 if not isinstance(value,dict)or set(value)!={'version','project','volume','system_identifier','database_oid','postgres_major','recorded_at'}or type(value['version'])is not int or value['version']!=1 or value['project']!=project or value['volume']!=name or not isinstance(value['system_identifier'],str)or not re.fullmatch('[0-9]{10,24}',value['system_identifier'])or type(value['database_oid'])is not int or value['database_oid']<=0 or type(value['postgres_major'])is not int or value['postgres_major']!=17 or not isinstance(value['recorded_at'],str):
  raise RuntimeConfigError('Invalid or foreign protected database identity. Restore the original marker or use isolated backup recovery.')
 return value


def assert_existing(root):
 expected=marker(root)
 if expected is None:raise RuntimeConfigError('Database identity has not been established. Run explicit setup for an empty install; recover legacy data through a verified isolated restore.')
 if control_identity(root)!=expected['system_identifier']:raise RuntimeConfigError('Database cluster identity changed. Startup is blocked; restore the original volume or a verified backup into a new installation.')
 return expected


def live_identity(root):
 from backup_operations import sql
 value=json.loads(sql(root,"SELECT json_build_object('system_identifier',(SELECT system_identifier::text FROM pg_control_system()),'database_oid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),'postgres_major',current_setting('server_version_num')::integer/10000);"))
 if value.get('postgres_major')!=17 or not re.fullmatch('[0-9]{10,24}',str(value.get('system_identifier','')))or type(value.get('database_oid'))is not int:raise RuntimeConfigError('Unexpected live PostgreSQL identity.')
 return value


def ready(root):
 from backup_operations import run,sql
 deadline=time.monotonic()+60
 while True:
  try:
   run(root,'exec','-T','postgres','pg_isready','-h','127.0.0.1','-U','blackbox_migrate','-d','blackbox');sql(root,'SELECT 1;');return
  except RuntimeConfigError:
   if time.monotonic()>deadline:raise
   time.sleep(.2)


def prepare(root,initialize=False):
 """Start only the verified PostgreSQL cluster; never start application traffic."""
 from backup_operations import run,sql
 from release_compatibility import read_manifest
 read_manifest(root)
 runtime=root/'.runtime';expected=marker(root)
 if expected:
  assert_existing(root)
 else:
  if not initialize:raise RuntimeConfigError('Database identity is missing. Run explicit setup for a new installation, or recover existing data from a verified backup.')
  if (runtime/'owner-workspace.json').exists()or (runtime/'restore-state.json').exists()or any((runtime/'evidence').iterdir()):
   raise RuntimeConfigError('Existing installation state has no database identity. Normal setup cannot replace it; use a verified isolated restore.')
  # Validate any pre-existing partially initialized volume before starting it.
  if volume(root)is not None:control_identity(root)
 run(root,'up','-d','postgres');ready(root);actual=live_identity(root)
 if expected:
  if any(actual[k]!=expected[k]for k in ['system_identifier','database_oid','postgres_major']):raise RuntimeConfigError('Live database identity differs from the protected installation marker. Application startup is blocked.')
 else:
  if int(sql(root,'SELECT count(*) FROM bb.workspaces;'))or int(sql(root,'SELECT count(*) FROM bb.journal;')):
   raise RuntimeConfigError('Unidentified database already contains records. No automatic adoption or replacement is allowed; use verified recovery.')
  if control_identity(root)!=actual['system_identifier']:raise RuntimeConfigError('Database identity changed during initial setup.')
  project,name=names(root);expected={'version':1,'project':project,'volume':name,**actual,'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  create_file(runtime/'database-identity.json',(json.dumps(expected,sort_keys=True)+'\n').encode())
  fd=os.open(runtime,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 return expected
