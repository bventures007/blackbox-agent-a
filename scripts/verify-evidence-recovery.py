#!/usr/bin/env python3
"""Actual isolated content disposal, authenticated ledger and older-backup reconciliation."""
import argparse,datetime,json,pathlib,platform,time,uuid,subprocess
from backup_operations import enroll,generation,target,run,sql,cutoffs,services
from backup_restore import restore,copy_runtime_bundle
from backup_supervisor import stop as stop_supervisor
from evidence_policy import maintain,export_ledger
from host_runtime import create_file,protected_directory,RuntimeConfigError
from host_test_support import command,owner_from,API,mcp,commands
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18781);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
token=uuid.uuid4().hex[:12];source=ROOT/'work'/('policy-source-'+token);reconciled=ROOT/'work'/('policy-restored-'+token);manual=ROOT/'work'/('policy-no-ledger-'+token);vault=ROOT/'work'/('policy-vault-'+token)
checks=[];status='failed';started=time.monotonic();snapshot=None;generation_result=None
def mark(s):checks.append(s);print(s,flush=True)
def open_restored(directory,port):
 owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(directory)],interactive=True))
 api=API(port);api.ready();api.login(owner);return api
try:
 source.mkdir(mode=0o700);copy_runtime_bundle(ROOT,source);protected_directory(vault,True)
 owner=owner_from(command(source,['./blackbox','setup','--port',str(a.port)],interactive=True))
 command(source,['./blackbox','up']);api=API(a.port);api.ready();api.login(owner)
 code,example=api.call('/v1/example',{});assert code==200
 entity=sql(source,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip()
 answer=api.state({'entity_id':entity});arguments={'entity_id':entity,'recorded_cutoff':answer['recorded_cutoff']};evidence=answer['result']['evidence'][0]
 tenant=sql(source,'SELECT tenant_id FROM bb.workspaces;').decode().strip();blob=source/'.runtime/evidence'/tenant/evidence
 assert api.call('/v1/tools/get_evidence',{'evidence_id':evidence})[1]['status']=='available';snapshot=cutoffs(source)
 secret=enroll(source,vault);create_file(vault/'recovery.key',secret)
 stale=vault/'older-ledger.json';export_ledger(source,stale)
 generation_result=generation(source);backup=target(json.loads((source/'.runtime/backup.json').read_text()))/generation_result['generation']
 assert api.call('/v1/evidence/'+evidence+'/restrict',{'acknowledged':True})[0]==200
 ledger=vault/'current-ledger.json';export_ledger(source,ledger)
 assert api.call('/v1/tools/get_evidence',{'evidence_id':evidence})==(200,{'status':'unavailable'})
 assert blob.exists();blob.chmod(0o644)
 try:maintain(source);raise AssertionError('Unsafe evidence file removed')
 except RuntimeConfigError as error:assert 'Unsafe evidence file'in str(error)
 assert blob.exists()and set(services(source))=={'postgres'}
 assert sql(source,'SELECT count(*) FROM bb.evidence_restrictions;').strip()==b'1'
 mark('restriction_is_durable_before_removal_and_unsafe_file_leaves_persistent_fence')
 blob.chmod(0o600);result=maintain(source,resume=True);assert result['removed']==1 and not blob.exists()and cutoffs(source)==snapshot
 assert sql(source,'SELECT count(*) FROM bb.evidence_disposals;').strip()==b'1'
 api.ready();assert api.state(arguments)['result']==answer['result']
 mark('explicit_resume_removes_only_restricted_owned_file_and_preserves_business_cutoff')
 restore(ROOT,backup,reconciled,secret,a.port+2);restored=open_restored(reconciled,a.port+2)
 raw=lambda client:client.call('/v1/tools/get_evidence',{'evidence_id':evidence})
 assert raw(restored)==(200,{'status':'unavailable'})and(reconciled/'.runtime/evidence'/tenant/evidence).exists()
 cutoff=json.loads((reconciled/'.runtime/restore-state.json').read_text())['recoverable_cutoff']
 bad=vault/'wrong-mac.json';v=json.loads(ledger.read_text());v['mac']='0'*64;create_file(bad,json.dumps(v).encode())
 for candidate,expected in [(bad,'authentication'),(stale,'predates')]:
  try:maintain(reconciled,ledger=candidate,acknowledge_cutoff=cutoff);raise AssertionError('Invalid ledger accepted')
  except RuntimeConfigError as error:assert expected in str(error)
  assert not(reconciled/'.runtime/maintenance.json').exists()and raw(restored)==(200,{'status':'unavailable'})
 mark('older_restore_blocks_raw_and_wrong_MAC_or_stale_ledgers_cannot_open_it')
 result=maintain(reconciled,ledger=ledger,acknowledge_cutoff=cutoff)
 assert result['reconciled']and result['removed']==1 and not(reconciled/'.runtime/evidence'/tenant/evidence).exists()
 restored.ready();assert raw(restored)==(200,{'status':'unavailable'});assert restored.state(arguments)['result']==answer['result']
 assert sql(reconciled,'SELECT count(*) FROM bb.recovery_guards WHERE evidence_blocked OR NOT sources_blocked;').strip()==b'0'
 code,issued=restored.call('/v1/agents',{'name':'Policy restore SDK test'});assert code==200
 assert mcp(a.port+2,issued['key'],{'evidence_id':evidence},'get_evidence')=={'status':'unavailable'}
 assert mcp(a.port+2,issued['key'],arguments)['result']==answer['result']
 run(reconciled,'stop','api','worker','engine');command(reconciled,['./blackbox','up']);restored.ready()
 assert raw(restored)==(200,{'status':'unavailable'})and mcp(a.port+2,issued['key'],arguments)['result']==answer['result']
 mark('newer_authenticated_ledger_merges_purges_before_raw_guard_release_and_survives_restart_API_MCP')
 restore(ROOT,backup,manual,secret,a.port+4);manual_api=open_restored(manual,a.port+4);assert raw(manual_api)==(200,{'status':'unavailable'})
 try:maintain(manual,acknowledge_cutoff='wrong');raise AssertionError('Wrong cutoff accepted')
 except RuntimeConfigError:pass
 assert raw(manual_api)==(200,{'status':'unavailable'})
 maintain(manual,acknowledge_cutoff=cutoff);manual_api.ready();assert raw(manual_api)[1]['status']=='available'
 assert sql(manual,"SELECT count(*) FROM bb.security_audit WHERE action='evidence.restore_owner_cutoff_reconciled';").strip()==b'1'
 assert sql(manual,'SELECT count(*) FROM bb.recovery_guards WHERE evidence_blocked OR NOT sources_blocked;').strip()==b'0'
 mark('no_newer_ledger_keeps_raw_blocked_until_explicit_exact_owner_cutoff_reconciliation_sources_stay_blocked')
 status='passed'
finally:
 for directory in [source,reconciled,manual]:
  if(directory/'.runtime/compose.env').exists():
   try:stop_supervisor(directory);run(directory,'down','--remove-orphans')
   except Exception:checks.append('cleanup_failed_inspect_only_this_test_project')
 report={'kind':'fenced_evidence_disposal_and_older_backup_policy','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stages':[str(x.relative_to(ROOT))for x in [source,reconciled,manual]],'ports':[a.port,a.port+2,a.port+4],'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip(),'engine_image':subprocess.check_output(['docker','image','inspect','blackbox-a-engine:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'checks':checks,'commands':commands,'snapshot':snapshot,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Synthetic small corpus, not the performance smoke or real-provider retention certification','Same Mac with fresh isolated volumes; no distribution archive or second machine claim','No external-copy erasure guarantee; explicit no-ledger reconciliation cannot recover unknown later restrictions','Periodic automatic purge, full field inventory/provider mapping audit and independent acceptance remain separate work']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
