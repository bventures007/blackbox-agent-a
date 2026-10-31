#!/usr/bin/env python3
"""Allowlisted host diagnostics; works while API, database and runtime are stopped."""
import argparse,datetime,json,pathlib,re,sys,hashlib,secrets,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
LOGS=ROOT/'.runtime/logs'
LEVELS={'DEBUG':10,'INFO':20,'WARN':30,'ERROR':40}
EVENTS={'service.started':'Service started','journal.batch_committed':'Journal batch committed','engine.batch_applied':'Engine batch applied','query.served':'Business query served','worker.failed':'Worker operation failed','access.denied':'Access denied','source.fetched':'Provider page fetched','wrapper.command':'Host command started'}
EVENTS.update({'wrapper.upgrade.preparing': 'Upgrade preflight started', 'wrapper.upgrade.probing_source': 'Previous-version answers are being verified', 'wrapper.upgrade.backup': 'Pre-upgrade backup is being verified', 'wrapper.upgrade.backup_verified': 'Pre-upgrade backup verified', 'wrapper.upgrade.migrating': 'Serialized upgrade migrations are running', 'wrapper.upgrade.verifying': 'Upgraded journal and answers are being verified', 'wrapper.upgrade.resuming': 'Verified application is resuming', 'wrapper.upgrade.completed': 'Upgrade completed and verified', 'wrapper.upgrade.failed': 'Upgrade is incomplete; explicit recovery required'})
IDS=['record_id','tenant_id','connection_id','run_id','trace_id','operation_id','instance_id']
def sanitized(row):
 if row.get('schema_version')!=1 or row.get('event_name')not in EVENTS:return None
 out={'schema_version':1,'event_name':row['event_name'],'message':EVENTS[row['event_name']]}
 if row.get('level')not in LEVELS:return None
 out['level']=row['level']
 for k in ['occurred_at','observed_at']:
  try:out[k]=datetime.datetime.fromisoformat(row[k].replace('Z','+00:00')).isoformat()
  except (ValueError,KeyError,TypeError):return None
 for k in IDS:
  if isinstance(row.get(k),str)and re.fullmatch('[0-9a-f-]{36}',row[k]):out[k]=row[k]
 for k in ['duration_ms','record_count','committed_cursor','applied_cursor']:
  if isinstance(row.get(k),(int,float))and abs(row[k])<1e16:out[k]=row[k]
 if row.get('component')in ['api','worker','engine','mcp','wrapper']:out['component']=row['component']
 out['scope']='workspace'if'tenant_id'in out else'installation';out['service_version']='0.1.0'
 return out
parser=argparse.ArgumentParser();parser.add_argument('--level',choices=['debug','info','warn','error'],default='info');parser.add_argument('--since',default='1h');parser.add_argument('--component',choices=['api','worker','engine','mcp','wrapper']);parser.add_argument('--connection');parser.add_argument('--run');parser.add_argument('--format',choices=['text','json'],default='text');parser.add_argument('--follow',action='store_true');parser.add_argument('--output');a=parser.parse_args()
for val in [a.connection,a.run]:
 if val and not re.fullmatch('[0-9a-f-]{36}',val):parser.error('IDs must be opaque UUIDs')
now=datetime.datetime.now(datetime.timezone.utc)
if re.fullmatch(r'\d{1,3}[hmd]',a.since):cutoff=now-datetime.timedelta(seconds=int(a.since[:-1])*{'h':3600,'m':60,'d':86400}[a.since[-1]])
else:
 try:cutoff=datetime.datetime.fromisoformat(a.since.replace('Z','+00:00'))
 except ValueError:parser.error('Use an ISO UTC timestamp or duration such as 1h')
 if cutoff.tzinfo is None:parser.error('A timezone is required')
seen=set();rows=[];salt=secrets.token_bytes(32);size=0;truncated=False
try:
 while True:
  files=sorted(LOGS.glob('*.jsonl*'))
  for path in files:
   if path.is_symlink():continue
   with path.open()as stream:
    for line in stream:
     if len(line)>16384:continue
     try:r=sanitized(json.loads(line))
     except ValueError:continue
     if not r or r.get('record_id')in seen:continue
     if datetime.datetime.fromisoformat(r['occurred_at'])<cutoff or LEVELS[r['level']]<LEVELS[a.level.upper()]:continue
     if any(expected and r.get(k)!=expected for k,expected in [('component',a.component),('connection_id',a.connection),('run_id',a.run)]):continue
     seen.add(r.get('record_id'))
     if a.output:
      for k in IDS:
       if k in r:r[k]=hashlib.sha256(salt+r[k].encode()).hexdigest()[:20]
      size+=len(json.dumps(r).encode())
      if size>9*1024*1024:truncated=True;continue
      rows.append(r)
     elif a.format=='json':print(json.dumps(r),flush=True)
     else:print(r['occurred_at'],r['level'],r.get('component','unknown'),r['message'],flush=True)
  if not a.follow:break
  if len(seen)>100000:seen.clear()
  time.sleep(1)
except KeyboardInterrupt:pass
except OSError:print('diagnostics_unavailable: retained log files cannot be read',file=sys.stderr);sys.exit(2)
if a.output:
 output=pathlib.Path(a.output)
 with output.open('x')as f:
  import os
  os.chmod(output,0o600);json.dump({'format_version':1,'created_at':now.isoformat(),'categories':['sanitized_technical_logs'],'live_checks':'not_requested','truncated':truncated,'records':rows},f)
 print('Sanitized local export created; no upload. Bytes:',output.stat().st_size)
elif not seen:print('No retained matching records. This does not establish runtime health.',file=sys.stderr)
