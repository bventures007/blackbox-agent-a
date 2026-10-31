#!/usr/bin/env python3
"""Actual isolated persistent cleanup supervisor, owner boundary and restart proof."""
import argparse,datetime,hashlib,json,os,pathlib,platform,secrets,subprocess,time,uuid
from backup_restore import copy_runtime_bundle
from backup_operations import atomic_json,run,sql,cutoffs
from backup_supervisor import stop as stop_supervisor
from evidence_scheduler import iso
from host_runtime import create_file
from host_test_support import command,owner_from,API,mcp,commands,redact
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18789);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
token=uuid.uuid4().hex[:12];stage=ROOT/'work'/('evidence-schedule-'+token);runtime=stage/'.runtime';checks=[];status='failed';started=time.monotonic();snapshot=None
def mark(value):checks.append(value);print(value,flush=True)
def wait_file(name,predicate,timeout=180):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  file=runtime/name
  if file.exists():
   value=json.loads(file.read_text())
   if predicate(value):return value
  time.sleep(.2)
 raise RuntimeError('Scheduled evidence operation timeout: '+name)
def stop():
 stop_supervisor(stage);wait_file('supervisor.json',lambda v:v.get('observed_at')is None,30)
def make_due():
 value=json.loads((runtime/'evidence-sweep.json').read_text());value['last_checked_at']=iso(time.time()-7200);atomic_json(runtime/'evidence-sweep.json',value)
try:
 stage.mkdir(mode=0o700);copy_runtime_bundle(ROOT,stage)
 owner=owner_from(command(stage,['./blackbox','setup','--port',str(a.port)],interactive=True));command(stage,['./blackbox','up'])
 api=API(a.port);api.ready();api.login(owner)
 wait_file('evidence-sweep.json',lambda v:v.get('state')=='scheduled');stop()
 assert not(runtime/'backup.json').exists()and not(runtime/'evidence-policy-status.json').exists()
 assert api.call('/v1/example',{})[0]==200
 entity=sql(stage,"SELECT entity_id FROM bb.journal WHERE record_type='source'ORDER BY sequence LIMIT 1;").decode().strip()
 answer=api.state({'entity_id':entity});arguments={'entity_id':entity,'recorded_cutoff':answer['recorded_cutoff']};evidence=answer['result']['evidence'][0]
 tenant=sql(stage,'SELECT tenant_id FROM bb.workspaces;').decode().strip();blob=runtime/'evidence'/tenant/evidence
 code,issued=api.call('/v1/agents',{'name':'Synthetic cleanup SDK check'});assert code==200
 assert API(a.port).call('/v1/evidence-policy')[0]==401
 assert api.call('/v1/evidence-policy',bearer=issued['key'])[0]==403
 other=str(uuid.uuid4());key='bb_owner_'+secrets.token_urlsafe(32);hashed=hashlib.sha256(key.encode()).hexdigest()
 sql(stage,"BEGIN;INSERT INTO bb.workspaces(tenant_id,name)VALUES('"+other+"','Synthetic other owner');INSERT INTO bb.heads(tenant_id)VALUES('"+other+"');INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES('"+other+"',gen_random_uuid(),gen_random_uuid(),'owner','"+hashed+"','Synthetic cleanup isolation');COMMIT;")
 other_api=API(a.port);other_api.login(key)
 assert other_api.call('/v1/evidence-policy')[1]['maintenance']=={'state':'unavailable','scheduler_alive':False,'status_stale':True}
 snapshot=cutoffs(stage)
 assert api.call('/v1/evidence/'+evidence+'/restrict',{'acknowledged':True})[0]==200
 assert blob.exists()and api.call('/v1/tools/get_evidence',{'evidence_id':evidence})==(200,{'status':'unavailable'})
 make_due();command(stage,['./blackbox','up'])
 first=wait_file('evidence-policy-status.json',lambda v:v.get('removed')==1);api.ready()
 assert not blob.exists()and not(runtime/'backup.json').exists()and cutoffs(stage)==snapshot
 assert api.state(arguments)['result']==answer['result']and mcp(a.port,issued['key'],arguments)['result']==answer['result']
 assert mcp(a.port,issued['key'],{'evidence_id':evidence},'get_evidence')=={'status':'unavailable'}
 visible=api.call('/v1/evidence-policy')[1]['maintenance'];assert visible['scheduler_alive']and visible['last_completed']==first['completed_at']
 assert str(stage)not in json.dumps(visible)and tenant not in json.dumps(visible)
 mark('actual_persistent_supervisor_removes_restricted_file_without_backup_configuration_preserves_API_MCP_and_owner_boundary')
 stop();directory=runtime/'evidence'/tenant
 orphan=directory/str(uuid.uuid4());temporary=directory/(str(uuid.uuid4())+'.'+uuid.uuid4().hex+'.tmp')
 unknown=runtime/'evidence'/str(uuid.uuid4());unknown.mkdir(mode=0o700);untouched=unknown/str(uuid.uuid4())
 for file in [orphan,temporary,untouched]:create_file(file,b'synthetic abandoned ciphertext')
 atomic_json(runtime/'evidence-policy-status.json',{**first,'completed_at':iso(time.time()-172800)})
 make_due();command(stage,['./blackbox','up'])
 second=wait_file('evidence-policy-status.json',lambda v:v.get('orphan_files_removed')==2);api.ready()
 assert not orphan.exists()and not temporary.exists()and untouched.exists()
 assert sql(stage,"SELECT count(*) FROM bb.security_audit WHERE action='evidence.orphan_cleanup_intent';").strip()==b'2'
 assert cutoffs(stage)==snapshot and api.state(arguments)['result']==answer['result']
 mark('due_daily_scan_removes_audited_known_workspace_orphans_and_preserves_unknown_workspace_files')
 stop();command(stage,['./blackbox','up']);api.ready()
 wait_file('supervisor.json',lambda v:v.get('observed_at')is not None);time.sleep(16)
 assert json.loads((runtime/'evidence-policy-status.json').read_text())==second
 assert mcp(a.port,issued['key'],arguments)['result']==answer['result']and cutoffs(stage)==snapshot
 mark('restart_coalesces_completed_cleanup_and_keeps_fixed_cutoff_answer')
 result=subprocess.run(['node','--import','tsx','tests/evidence-policy-browser.ts'],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':api.base,'TEST_RUNTIME_DIR':str(runtime),'TEST_OWNER_KEY':owner,'TEST_HOST_SCHEDULER':'1'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120)
 commands.append({'command':'node --import tsx tests/evidence-policy-browser.ts [protected test environment]','exit_code':result.returncode,'observed':redact(result.stdout)})
 if result.returncode:raise RuntimeError('Actual scheduled cleanup browser verification failed')
 mark('actual_EN_DE_owner_policy_and_scheduled_cleanup_browser_no_external_requests_or_mobile_overflow')
 status='passed'
finally:
 if(runtime/'compose.env').exists():
  try:stop_supervisor(stage);run(stage,'down','--remove-orphans')
  except Exception:checks.append('cleanup_failed_inspect_only_this_test_project')
 report={'kind':'automatic_evidence_cleanup_owner_boundary_restart_browser','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(ROOT)),'port':a.port,'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip(),'engine_image':subprocess.check_output(['docker','image','inspect','blackbox-a-engine:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'checks':checks,'snapshot':snapshot,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Scheduler timestamps explicitly aged in protected synthetic fixtures; not actual multi-day passage or physical Mac sleep/wake','Small synthetic corpus, not performance smoke, distribution, live-provider policy certification or independent review','Copied runtime with recorded prebuilt development images; not a downloaded installer','Affected backup-generation disclosure and complete field/provider inventory remain separate work']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
