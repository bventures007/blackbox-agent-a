"""Fenced content disposal and independently authenticated policy/restriction export."""
import datetime,hashlib,hmac,json,os,pathlib,re,stat,time,uuid
from host_runtime import RuntimeConfigError,compose_config,protected_read,protected_directory,read_keyring,create_file
from backup_operations import operation_lock,atomic_json,services,run,sql,stamp,cutoffs
from key_rotation import sync_directory

MAX_LEDGER=8*1024*1024
ZERO='00000000-0000-0000-0000-000000000000'
CLASSES={'provider_response','typed_submission','imported_document','owner_assertion','legacy_unclassified'}
SHAPES={
 'policies':{'tenant_id','policy_id','connection_id','evidence_class','days','principal_id','reason','created_at'},
 'provider_limits':{'tenant_id','limit_id','connection_id','evidence_class','days','created_at'},
 'restrictions':{'tenant_id','evidence_id','restriction_id','principal_id','reason','restricted_at'},
}
TABLES={'policies':'evidence_policies','provider_limits':'evidence_provider_limits','restrictions':'evidence_restrictions'}

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def identity(root):
 runtime=root/'.runtime';ring=read_keyring(runtime)
 return protected_read(runtime/'secrets'/('identity'if ring else 'data'),32)

def known_ledgers(root):
 # These are protected host checkpoints, not arbitrary filesystem discovery.
 # A broken/corrupt candidate must not turn a known restriction into absence.
 values=[]
 for name in ['evidence-ledger-current.json','reconciliation-ledger.json']:
  path=root/'.runtime'/name
  if path.exists()or path.is_symlink():values.append(verified_ledger(root,protected_read(path,MAX_LEDGER)))
 return values

def combine_ledgers(payloads):
 if not payloads:return None
 first=payloads[0];value={k:first[k]for k in ['version','identity_sha256','exported_at']}
 for name in TABLES:
  rows={}
  for payload in payloads:
   if payload['identity_sha256']!=value['identity_sha256']:raise RuntimeConfigError('Policy ledger identity conflict.')
   for row in payload[name]:
    key=(row['tenant_id'],row['evidence_id']if name=='restrictions'else row['policy_id']if name=='policies'else row['limit_id'])
    if key in rows and rows[key]!=row:
     if name!='restrictions':raise RuntimeConfigError('Policy ledger record conflict; known history was preserved.')
     # Both intents deny the same object. Preserve a deterministic earliest
     # reason without dropping the denial when independent copies differ.
     rows[key]=min([rows[key],row],key=lambda r:(datetime.datetime.fromisoformat(r['restricted_at'].replace('Z','+00:00')),canonical(r)))
    else:rows[key]=row
   if len(rows)>50000:raise RuntimeConfigError('Combined policy ledger budget exceeded.')
  value[name]=[rows[k]for k in sorted(rows)]
 value['exported_at']=max((p['exported_at']for p in payloads),key=lambda s:datetime.datetime.fromisoformat(s.replace('Z','+00:00')))
 if len(canonical(value))>MAX_LEDGER-256:raise RuntimeConfigError('Combined policy ledger budget exceeded.')
 return value

def envelope(root,payload):
 return {'payload':payload,'mac':hmac.new(identity(root),b'blackbox-evidence-ledger-v1\0'+canonical(payload),hashlib.sha256).hexdigest()}

def assert_known_ledgers_applied(root):
 # Backup/export cannot publish old policy state over known later restrictions.
 # Applying them is a separate fenced operation, never a read-side mutation.
 for payload in known_ledgers(root):
  for name,table in TABLES.items():
   if not payload[name]:continue
   literal=json.dumps(payload[name]).replace("'","''");key='evidence_id'if name=='restrictions'else 'policy_id'if name=='policies'else 'limit_id'
   available='EXISTS(SELECT 1 FROM bb.workspaces w WHERE w.tenant_id=x.tenant_id)'
   if name!='restrictions':available+=' AND (x.connection_id IS NULL OR EXISTS(SELECT 1 FROM bb.connections c WHERE c.tenant_id=x.tenant_id AND c.connection_id=x.connection_id))'
   matches='t.tenant_id=x.tenant_id AND t.'+key+'=x.'+key
   if name!='restrictions':matches+=' AND to_jsonb(t)=to_jsonb(x)'
   missing=sql(root,'SELECT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::bb.'+table+",'"+literal+"'::jsonb) x WHERE "+available+' AND NOT EXISTS(SELECT 1 FROM bb.'+table+' t WHERE '+matches+'));')
   if missing.strip()==b't':raise RuntimeConfigError('Known policy ledger is not applied. Run ./blackbox evidence purge before backup or ledger export.')

def signed_ledger(root):
 assert_known_ledgers_applied(root)
 payload={'version':1,'identity_sha256':hashlib.sha256(identity(root)).hexdigest(),'exported_at':stamp()}
 # One PostgreSQL statement provides one snapshot across all policy tables.
 parts=[]
 for name,table in TABLES.items():
  columns=','.join(sorted(SHAPES[name]));parts.extend(["'"+name+"'","(SELECT coalesce(json_agg(x ORDER BY tenant_id),'[]'::json) FROM (SELECT "+columns+' FROM bb.'+table+' LIMIT 50001)x)'])
 payload.update(json.loads(sql(root,'SELECT json_build_object('+','.join(parts)+');')))
 if any(len(payload[name])>50000 for name in TABLES):raise RuntimeConfigError('Policy ledger export budget exceeded.')
 # Preserve authenticated records for newer scopes absent from an older restore.
 value=envelope(root,combine_ledgers([payload,*known_ledgers(root)]))
 if len(canonical(value))>MAX_LEDGER:raise RuntimeConfigError('Policy ledger export budget exceeded.')
 return value
def verified_ledger(root,raw,key=None):
 from backup_codec import decode_json
 if len(raw)>MAX_LEDGER:raise RuntimeConfigError('Policy ledger is oversized.')
 value=decode_json(raw)
 if not isinstance(value,dict)or set(value)!={'payload','mac'}or not isinstance(value['mac'],str)or not re.fullmatch('[a-f0-9]{64}',value['mac']):raise RuntimeConfigError('Invalid policy ledger envelope.')
 p=value['payload']
 if not isinstance(p,dict)or set(p)!={'version','identity_sha256','exported_at',*SHAPES}or type(p['version'])is not int or p['version']!=1:raise RuntimeConfigError('Unknown policy ledger format.')
 key=identity(root)if key is None else key
 if p['identity_sha256']!=hashlib.sha256(key).hexdigest()or not hmac.compare_digest(value['mac'],hmac.new(key,b'blackbox-evidence-ledger-v1\0'+canonical(p),hashlib.sha256).hexdigest()):raise RuntimeConfigError('Policy ledger authentication failed; raw content remains blocked.')
 def timestamp(v):
  if not isinstance(v,str)or len(v)>40:raise ValueError()
  d=datetime.datetime.fromisoformat(v.replace('Z','+00:00'))
  if d.tzinfo is None or d.timestamp()>time.time()+300:raise ValueError()
 try:
  timestamp(p['exported_at'])
  for name,shape in SHAPES.items():
   rows=p[name]
   if not isinstance(rows,list)or len(rows)>50000:raise ValueError()
   identities=set()
   for row in rows:
    if not isinstance(row,dict)or set(row)!=shape:raise ValueError()
    for k,v in row.items():
     if k.endswith('_id')and v is not None:
      if str(uuid.UUID(v))!=v:raise ValueError()
     if k.endswith('_at'):timestamp(v)
    if row['tenant_id']is None or any(row.get(k)is None for k in ['policy_id','limit_id','evidence_id','restriction_id','principal_id']if k in row):raise ValueError()
    if 'days'in row and(type(row['days'])is not int or not 1<=row['days']<=3650):raise ValueError()
    if 'evidence_class'in row and row['evidence_class']not in CLASSES|({None}if name=='policies'else set()):raise ValueError()
    if name=='provider_limits'and row['connection_id']is None:raise ValueError()
    if name=='policies'and row['reason']not in {'business_requirement','minimize_content','default_policy','restore_reconciliation'}:raise ValueError()
    if name=='restrictions'and row['reason']not in {'expired','owner_restriction','provider_restriction','restored_ledger'}:raise ValueError()
    ident=(row['tenant_id'],row['evidence_id']if name=='restrictions'else row['policy_id']if name=='policies'else row['limit_id'])
    if ident in identities:raise ValueError()
    identities.add(ident)
 except (TypeError,ValueError,OverflowError):raise RuntimeConfigError('Invalid policy ledger records.')from None
 return p

def merge_ledger(root,payload):
 # Authenticated records retain original intent/time. Unknown newer workspaces or
 # connections are absent from this old backup and cannot be invented by restore.
 for name,table in TABLES.items():
  rows=payload[name];columns=','.join(sorted(SHAPES[name]));literal=json.dumps(rows).replace("'","''")
  key='evidence_id'if name=='restrictions'else 'policy_id'if name=='policies'else 'limit_id'
  relation="jsonb_populate_recordset(NULL::bb."+table+",'"+literal+"'::jsonb)"
  mismatch=sql(root,'SELECT count(*) FROM '+relation+' x JOIN bb.'+table+' t ON t.tenant_id=x.tenant_id AND t.'+key+'=x.'+key+" WHERE (to_jsonb(t)-'disposed_at')<>to_jsonb(x);")
  # Restriction intent is monotone; different independently recorded first reasons
  # for an already-denied object do not undo that denial.
  if name!='restrictions'and int(mismatch):raise RuntimeConfigError('Policy ledger identity conflict; content remains blocked.')
  available='EXISTS(SELECT 1 FROM bb.workspaces w WHERE w.tenant_id=x.tenant_id)'
  if name!='restrictions':available+=' AND (x.connection_id IS NULL OR EXISTS(SELECT 1 FROM bb.connections c WHERE c.tenant_id=x.tenant_id AND c.connection_id=x.connection_id))'
  sql(root,'INSERT INTO bb.'+table+'('+columns+') SELECT '+','.join('x.'+k for k in sorted(SHAPES[name]))+' FROM '+relation+' x WHERE '+available+' ON CONFLICT(tenant_id,'+key+') DO NOTHING;')

def remove_owned_file(directory,name):
 if pathlib.Path(name).name!=name or name in ['.','..']:raise RuntimeConfigError('Unsafe evidence filename.')
 protected_directory(directory)
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  try:info=os.stat(name,dir_fd=fd,follow_symlinks=False)
  except FileNotFoundError:return 'already_absent'
  if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1 or info.st_uid!=os.getuid()or info.st_mode&0o177:raise RuntimeConfigError('Unsafe evidence file; no removal was attempted.')
  os.unlink(name,dir_fd=fd);os.fsync(fd);return 'removed'
 finally:os.close(fd)

def record_expiry_intents(root):
 assert_known_ledgers_applied(root)
 sql(root,"WITH added AS (INSERT INTO bb.evidence_restrictions(tenant_id,evidence_id,restriction_id,principal_id,reason) SELECT tenant_id,evidence_id,gen_random_uuid(),'"+ZERO+"','expired' FROM bb.evidence_retention WHERE NOT retained ON CONFLICT(tenant_id,evidence_id) DO NOTHING RETURNING *) INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) SELECT tenant_id,restriction_id,principal_id,'evidence.expiry_intent' FROM added;")

def purge_fenced(root):
 # Intent and audit commit before filesystem deletion. Reads already reject expiry.
 record_expiry_intents(root)

 removed=absent=0;cursor=(ZERO,ZERO);started=time.monotonic();count=0
 while True:
  rows=json.loads(sql(root,"SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT tenant_id,evidence_id FROM bb.evidence_restrictions r WHERE (tenant_id,evidence_id)>('"+cursor[0]+"'::uuid,'"+cursor[1]+"'::uuid) ORDER BY tenant_id,evidence_id LIMIT 256)x;"))
  if not rows:break
  completions=[]
  for row in rows:
   count+=1
   if count>100000 or time.monotonic()-started>300:raise RuntimeConfigError('Evidence disposal budget exceeded; resume the saved operation.')
   tenant=str(uuid.UUID(row['tenant_id']));evidence=str(uuid.UUID(row['evidence_id']));directory=root/'.runtime/evidence'/tenant
   if not directory.exists()and not directory.is_symlink():outcome='already_absent'
   else:outcome=remove_owned_file(directory,evidence)
   completions.append("('"+tenant+"','"+evidence+"','"+outcome+"')")
   removed+=outcome=='removed';absent+=outcome=='already_absent';cursor=(tenant,evidence)
  sql(root,'INSERT INTO bb.evidence_disposals(tenant_id,evidence_id,outcome)VALUES'+','.join(completions)+' ON CONFLICT(tenant_id,evidence_id)DO NOTHING;')
 # Only exact own encrypted-object/atomic-write names can be orphans. Unknown files stay.
 orphans=0;base=root/'.runtime/evidence';protected_directory(base)
 for directory in base.iterdir():
  if not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',directory.name):continue
  protected_directory(directory)
  # Unrecognized tenant directories are never authority to delete their files.
  if sql(root,"SELECT EXISTS(SELECT 1 FROM bb.workspaces WHERE tenant_id='"+directory.name+"');").strip()!=b't':continue
  import itertools
  files=iter(directory.iterdir())
  while batch:=list(itertools.islice(files,256)):
   candidates=[]
   for file in batch:
    match=re.fullmatch('([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:[.][a-f0-9]{32}[.]tmp)?',file.name)
    if not match:continue
    count+=1
    if count>200000 or time.monotonic()-started>300:raise RuntimeConfigError('Evidence orphan scan budget exceeded; resume the saved operation.')
    candidates.append((file.name,match[1]))
   if not candidates:continue
   ids=','.join("'"+v[1]+"'"for v in candidates)
   present=set(json.loads(sql(root,"SELECT coalesce(json_agg(evidence_id),'[]'::json) FROM bb.evidence WHERE tenant_id='"+directory.name+"' AND evidence_id IN ("+ids+");")))
   for name,evidence in candidates:
    if name.endswith('.tmp')or evidence not in present:
     # Deterministic opaque audit identity makes retries idempotent. Commit this
     # intent before unlink, including crash leftovers with no evidence row.
     audit=str(uuid.uuid5(uuid.UUID(directory.name),'evidence.orphan_cleanup:'+name))
     sql(root,"INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES('"+directory.name+"','"+audit+"','"+ZERO+"','evidence.orphan_cleanup_intent')ON CONFLICT(tenant_id,audit_id)DO NOTHING;")
     remove_owned_file(directory,name);orphans+=1
 return {'removed':removed,'already_absent':absent,'orphan_files_removed':orphans}

def maintain(root,resume=False,ledger=None,acknowledge_cutoff=None):
 runtime=root/'.runtime';compose_config(runtime)
 with operation_lock(runtime):
  path=runtime/'maintenance.json'
  if (runtime/'native-pids.json').exists():raise RuntimeConfigError('Stop native development processes before Compose evidence maintenance.')
  if resume:
   marker=json.loads(protected_read(path,16384))
   if marker.get('operation')!='evidence_policy'or marker.get('phase')not in ['preparing','fenced','purging','verified','resuming']:raise RuntimeConfigError('No resumable evidence policy operation.')
   uuid.UUID(marker['operation_id'])
   if not isinstance(marker['prior_running'],list)or not set(marker['prior_running'])<={'postgres','api','worker','engine'}:raise RuntimeConfigError('Invalid evidence maintenance checkpoint.')
   if ledger is not None or acknowledge_cutoff is not None:raise RuntimeConfigError('Resume uses its saved authenticated ledger and cutoff.')
  else:
   if path.exists():raise RuntimeConfigError('Unfinished host maintenance. Resume its matching operation.')
   # All owner decisions/ledger authentication finish before stopping services or mutations.
   supplied=verified_ledger(root,protected_read(ledger,MAX_LEDGER))if ledger else None
   restore=json.loads(protected_read(runtime/'restore-state.json',16384))if acknowledge_cutoff is not None else None
   if restore is not None and(restore.get('state')!='restored_restricted'or acknowledge_cutoff!=restore.get('recoverable_cutoff')):raise RuntimeConfigError('A restored restricted installation and its exact displayed recoverable cutoff are required.')
   if ledger and restore is None:raise RuntimeConfigError('Ledger reconciliation requires explicit acknowledgement of the restored backup cutoff.')
   if supplied and datetime.datetime.fromisoformat(supplied['exported_at'].replace('Z','+00:00'))<datetime.datetime.fromisoformat(acknowledge_cutoff.replace('Z','+00:00')):raise RuntimeConfigError('Ledger predates the restored backup cutoff. Supply a current ledger or explicitly reconcile without one.')
   known=known_ledgers(root);payload=combine_ledgers([*known,*([supplied]if supplied else[])])
   if payload and not supplied and not any(payload[name]for name in TABLES):payload=None
   if payload:atomic_json(runtime/'reconciliation-ledger.json',envelope(root,payload))
   marker={'schema_version':1,'operation':'evidence_policy','operation_id':str(uuid.uuid4()),'phase':'preparing','started_at':stamp(),'prior_running':services(root),'reconcile':restore is not None,'cutoff':acknowledge_cutoff,'ledger':payload is not None}
   atomic_json(path,marker)
  run(root,'stop','api','worker','engine')
  from database_identity import prepare
  from release_compatibility import check_database
  prepare(root);check_database(root)
  if marker['phase']=='resuming' or 'cutoffs'not in marker:marker['cutoffs']=cutoffs(root)
  if cutoffs(root)!=marker['cutoffs']:raise RuntimeConfigError('Journal changed during evidence maintenance; inspect before resuming.')
  marker['phase']='fenced';atomic_json(path,marker)
  if marker['ledger']:merge_ledger(root,verified_ledger(root,protected_read(runtime/'reconciliation-ledger.json',MAX_LEDGER)))
  marker['phase']='purging';atomic_json(path,marker);result=purge_fenced(root)
  run(root,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-evidence.ts',timeout=330)
  if cutoffs(root)!=marker['cutoffs']:raise RuntimeConfigError('Journal changed during evidence verification.')
  if marker['reconcile']:
   action='evidence.restore_known_ledger'if marker['ledger']else 'evidence.restore_owner_cutoff_reconciled'
   sql(root,"BEGIN;INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) SELECT tenant_id,'"+marker['operation_id']+"','"+ZERO+"','"+action+"' FROM bb.recovery_guards ON CONFLICT(tenant_id,audit_id)DO NOTHING;UPDATE bb.recovery_guards SET evidence_blocked=false,policy_reconciled_at=clock_timestamp();COMMIT;")
   restore=json.loads(protected_read(runtime/'restore-state.json',16384));restore.update({'evidence_blocked':False,'policy_reconciled_at':stamp(),'policy_reconciliation':'available_authenticated_ledger'if marker['ledger']else 'explicit_owner_cutoff'});atomic_json(runtime/'restore-state.json',restore)
  atomic_json(runtime/'evidence-ledger-current.json',signed_ledger(root))
  marker['phase']='resuming';atomic_json(path,marker)
  if marker['prior_running']:run(root,'up','-d',*marker['prior_running'])
  if 'api'in marker['prior_running']:
   from release_compatibility import wait_for_traffic
   wait_for_traffic(root)
  if 'postgres'not in marker['prior_running']:run(root,'stop','postgres')
  result.update({'completed_at':stamp(),'journal_unchanged':True,'reconciled':marker['reconcile'],'old_backup_copies_unchanged':True});atomic_json(runtime/'evidence-policy-status.json',result)
  path.unlink();sync_directory(runtime);return result

def export_ledger(root,destination):
 compose_config(root/'.runtime')
 with operation_lock(root/'.runtime'):
  if(root/'.runtime/maintenance.json').exists():raise RuntimeConfigError('Complete host maintenance before ledger export.')
  from database_identity import prepare
  from release_compatibility import check_database
  prepare(root);check_database(root)
  record_expiry_intents(root)
  value=signed_ledger(root);create_file(destination,canonical(value));sync_directory(destination.parent)
  return {'exported_at':value['payload']['exported_at'],'contains_raw_content':False}
