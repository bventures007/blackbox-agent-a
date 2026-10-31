"""Exact installation contracts; never infer historical migration execution."""
import hashlib,json,re
from host_runtime import RuntimeConfigError
SUPPORTED_RUNTIME_SHA256="dfa4fd04235e890f3efa3cab151057eb97818ec8e8a2f5098950fe144d985038"


def read_manifest(root):
 path=root/'release/compatibility.json'
 if path.is_symlink()or not path.is_file()or path.stat().st_size>65536:raise RuntimeConfigError('Release compatibility manifest is missing or unsafe. Restore the exact release bundle.')
 def unique(pairs):
  value={}
  for key,item in pairs:
   if key in value:raise RuntimeConfigError('Ambiguous release compatibility manifest.')
   value[key]=item
  return value
 try:value=json.loads(path.read_text(),object_pairs_hook=unique)
 except (ValueError,UnicodeError):raise RuntimeConfigError('Invalid release compatibility manifest.')from None
 if not isinstance(value,dict)or value.get('manifest_version')!=1 or value.get('install',{}).get('postgres_major')!=17 or value.get('install',{}).get('schema')!=11 or not isinstance(value.get('runtime'),dict):raise RuntimeConfigError('Unsupported release installation contract. Use its matching host wrapper.')
 if hashlib.sha256(json.dumps(value['runtime'],sort_keys=True,separators=(',',':')).encode()).hexdigest()!=SUPPORTED_RUNTIME_SHA256:raise RuntimeConfigError('Unknown runtime formats for this host release. No migration or traffic is allowed.')
 migrations=value.get('migrations',[])
 if not isinstance(migrations,list)or len(migrations)!=11:raise RuntimeConfigError('Incomplete release migration manifest.')
 files=sorted((root/'packages/database/migrations').glob('*.sql'))
 if [p.name for p in files]!=[m.get('file')for m in migrations]:raise RuntimeConfigError('Release migrations are missing, newer or unexpected. Use the exact release bundle.')
 for index,(path,entry)in enumerate(zip(files,migrations),1):
  if set(entry)!={'file','sha256'}or not re.fullmatch(f'{index:03d}-[a-z0-9-]+[.]sql',path.name)or path.is_symlink()or path.stat().st_size>2*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise RuntimeConfigError('Release migration checksum mismatch. No migration or traffic is allowed.')
 return value


def migration_rows(root):
 from backup_operations import sql
 if not sql(root,"SELECT coalesce(to_regclass('bb.schema_migrations')::text,'');").strip():return None
 return json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('file',version,'sha256',sha256) ORDER BY version),'[]'::json) FROM bb.schema_migrations;"))


def require_prefix(rows,manifest,complete=False):
 expected=manifest['migrations']
 if not isinstance(rows,list)or not rows or rows!=expected[:len(rows)]or (complete and len(rows)!=len(expected)):
  raise RuntimeConfigError('Database migration history is missing, changed, incomplete or newer than this release. Use the explicit fenced upgrade or isolated restore; never downgrade populated data.')


def check_database(root):
 from backup_operations import sql
 manifest=read_manifest(root);require_prefix(migration_rows(root),manifest,complete=True)
 if int(sql(root,"SELECT current_setting('server_version_num')::integer/10000;"))!=manifest['install']['postgres_major']:raise RuntimeConfigError('Unsupported installation PostgreSQL major version.')
 rows=json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('contract',contract,'state',state)),'[]'::json) FROM bb.runtime_contract;"))
 if rows!=[{'contract':manifest['runtime'],'state':'active'}]:raise RuntimeConfigError('Runtime contracts are incompatible or maintenance is fenced. Resume the matching host operation before starting traffic.')
 return manifest


def check_upgrade_source(root,source_schema,state='active'):
 """Exact known populated source, using the target bundle's immutable prefix."""
 from backup_operations import sql
 manifest=read_manifest(root);rows=migration_rows(root)
 if source_schema not in [8,10,11]or state not in ['active','fenced']:
  raise RuntimeConfigError('Unsupported populated upgrade source. Use isolated verified recovery for older formats.')
 require_prefix(rows,manifest)
 if len(rows)!=source_schema:raise RuntimeConfigError('Upgrade source schema disagrees with the checkpoint.')
 if int(sql(root,"SELECT current_setting('server_version_num')::integer/10000;"))!=17:raise RuntimeConfigError('Populated upgrades require the pinned PostgreSQL17 installation.')
 expected=runtime_for_schema(manifest,source_schema)
 found=json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('contract',contract,'state',state)),'[]'::json) FROM bb.runtime_contract;"))
 if found!=[{'contract':expected,'state':state}]:raise RuntimeConfigError('Unknown or mixed populated source runtime. No upgrade is allowed.')
 return manifest


def normalized_legacy_schema(raw):
 # Only generated header/footer lines are volatile; SQL bodies are byte-preserved.
 lines=raw.splitlines(keepends=True);last=next((i for i in range(len(lines)-1,-1,-1)if lines[i].strip()),-1)
 output=[];header=True
 for index,line in enumerate(lines):
  if index==last and re.fullmatch(rb'\\unrestrict [A-Za-z0-9]+\n',line):continue
  if header:
   if re.fullmatch(rb'\\restrict [A-Za-z0-9]+\n',line)or re.fullmatch(rb'-- Dumped (?:from database|by pg_dump) version [^\n]+\n',line):continue
   if line.strip()and not line.startswith(b'--'):header=False
  output.append(line)
 return b''.join(output)


def runtime_for_schema(manifest,schema):
 if schema==11:return manifest['runtime']
 if schema not in [7,8,9,10]:raise RuntimeConfigError('Unknown historical runtime schema.')
 prior=json.loads(json.dumps(manifest['runtime']))
 prior.pop('projection_build');prior.pop('lifecycle_readers')
 prior['reducers']['lifecycle']=prior['projections']['lifecycle']='lifecycle-v2'
 if schema<9:prior.pop('source_checkpoint')
 expected='63f6ffba3371cfc080f8702987120964ea6aea0979fc4949eccdf3d908e7fb11'if schema<9 else'f44009de0ee45cf3b5d92fa8f5360099077a62fa7d3bf680384b03e1aa2090b6'
 if hashlib.sha256(json.dumps(prior,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=expected:raise RuntimeConfigError('Historical runtime reader changed.')
 return prior


def backup_compatibility(root, schema=None):
 manifest=read_manifest(root);schema=manifest['install']['schema']if schema is None else schema
 if schema not in [7,8,10,11]:raise RuntimeConfigError('Unsupported backup schema contract.')
 runtime=runtime_for_schema(manifest,schema)
 release='0.1.0-pilot.'+str({7:1,8:2,10:3,11:4}[schema])
 return {'application':'0.1.0','postgres_major':manifest['install']['postgres_major'],'schema':schema,'engine_rpc':runtime['engine_rpc'],'lifecycle':runtime['reducers']['lifecycle'],'typed_records':runtime['reducers']['typed_records'],'questions':runtime['reducers']['questions'],'backup_format':runtime['backup'],'release':release,'runtime_sha256':hashlib.sha256(json.dumps(runtime,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'migrations_sha256':hashlib.sha256(json.dumps(manifest['migrations'][:schema],sort_keys=True,separators=(',',':')).encode()).hexdigest()}


def upgrade_restored_schema(root,source_schema):
 """Only a new fenced restore may attest known legacy schema and migrate forward."""
 from backup_operations import sql,run
 manifest=read_manifest(root);rows=migration_rows(root)
 if source_schema not in [5,6,7,8,10,11]:raise RuntimeConfigError('Unsupported backup schema; destination remains fenced.')
 if source_schema==11:
  require_prefix(rows,manifest,complete=True);check_database(root);return
 if source_schema in [7,8,10]:
  require_prefix(rows,manifest)
  if len(rows)!=source_schema:raise RuntimeConfigError('Backup schema declaration disagrees with its migration history.')
  metadata=json.loads(sql(root,"SELECT coalesce(json_agg(json_build_object('contract',contract,'state',state)),'[]'::json) FROM bb.runtime_contract;"))
  prior_runtime=runtime_for_schema(manifest,source_schema)
  if metadata!=[{'contract':prior_runtime,'state':'active'}]:raise RuntimeConfigError('Restored runtime contract is unknown or fenced.')
  for migration in manifest['migrations'][source_schema:]:apply_migration(root,migration)
  check_database(root);return
 if rows is not None:require_prefix(rows,manifest)
 if rows is not None and len(rows)!=source_schema:raise RuntimeConfigError('Backup schema declaration disagrees with its migration history.')
 def verify_shape(version):
  raw=run(root,'exec','-T','postgres','pg_dump','-U','blackbox_migrate','-d','blackbox','--schema-only','--schema=bb','--exclude-table=bb.schema_migrations','--no-owner')
  canonical=normalized_legacy_schema(raw);known=manifest['legacy_schema'][str(version)]
  if len(canonical)!=known['bytes']or hashlib.sha256(canonical).hexdigest()!=known['sha256']:raise RuntimeConfigError('Restored legacy schema does not match the supported complete schema fingerprint. Destination remains fenced.')
 # Check the original complete schema before any forward migration.
 verify_shape(source_schema)
 if source_schema==5:
  source=(root/'packages/database/migrations/006-recovery-guards.sql').read_text()
  if rows is not None:
   migration=manifest['migrations'][5];source+="INSERT INTO bb.schema_migrations(version,sha256) VALUES('"+migration['file']+"','"+migration['sha256']+"');"
  sql(root,'BEGIN;SELECT pg_advisory_xact_lock(18741002);'+source+'COMMIT;')
 if source_schema==5:verify_shape(6)
 if rows is None:
  source="CREATE TABLE bb.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),provenance text NOT NULL DEFAULT 'applied');"
  for migration in manifest['migrations'][:6]:
   source+="INSERT INTO bb.schema_migrations(version,sha256,provenance) VALUES('"+migration['file']+"','"+migration['sha256']+"','observed_legacy_schema');"
  sql(root,'BEGIN;SELECT pg_advisory_xact_lock(18741002);'+source+'COMMIT;')
 for migration in manifest['migrations'][6:]:apply_migration(root,migration)
 check_database(root)


def apply_migration(root,migration):
 from backup_operations import sql
 sql(root,'BEGIN;SELECT pg_advisory_xact_lock(18741002);'+(root/'packages/database/migrations'/migration['file']).read_text()+"INSERT INTO bb.schema_migrations(version,sha256) VALUES('"+migration['file']+"','"+migration['sha256']+"');COMMIT;")


def wait_for_traffic(root):
 """Health acknowledgement before a successful start; no owner key is needed."""
 import time,urllib.request,urllib.error,http.client
 from host_runtime import read_compose
 config=read_compose(root/'.runtime');read_manifest(root)
 address='http://127.0.0.1:'+config.get('BB_PORT','18741')+'/v1/status';deadline=time.monotonic()+45
 while True:
  try:
   try:response=urllib.request.urlopen(address,timeout=2)
   except urllib.error.HTTPError as error:response=error
   with response:
    if response.status in [200,401]:
     if response.headers.get('x-blackbox-contract')!=SUPPORTED_RUNTIME_SHA256:raise RuntimeConfigError('Running API does not match this release contract. Use the matching images and explicit upgrade.')
     return
  except (urllib.error.URLError,TimeoutError,ConnectionError,http.client.RemoteDisconnected):pass
  if time.monotonic()>deadline:raise RuntimeConfigError('Compatible application did not become ready. Check the exact release images, engine contract and local diagnostics; no traffic was accepted as ready.')
  time.sleep(.2)
