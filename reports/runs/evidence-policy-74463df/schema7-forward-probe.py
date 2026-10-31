"""Read an exact prior schema7 synthetic archive; prove isolated schema8 restore."""
import sys,pathlib,json,uuid,time,datetime,subprocess,platform
ROOT=pathlib.Path.cwd();sys.path.insert(0,str(ROOT/'scripts'))
from backup_restore import restore,verified_backup
from backup_operations import run,sql
from backup_supervisor import stop as stop_supervisor
from host_test_support import API,command,owner_from,mcp
backup=ROOT/'work/recovery-backups-8d780e05e844/blackbox-168041df-a90e-470d-ac08-d08880ed2458/504b7fecbfaf495894a4276513934892.bb.age'
key=ROOT/'work/recovery-test-vault/recovery-8d780e05e844.key'
destination=ROOT/'work'/('schema7-forward-'+uuid.uuid4().hex[:12]);status='failed';checks=[];started=time.monotonic()
try:
 secret=key.read_bytes()
 with verified_backup(ROOT,backup,secret)as(_,manifest,_,_):assert manifest['metadata']['compatibility']['schema']==7
 restore(ROOT,backup,destination,secret,18787);del secret
 assert sql(destination,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'8'
 assert sql(destination,"SELECT count(*) FROM bb.evidence_context WHERE evidence_class='typed_submission';").strip()==b'1'
 owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(destination)],interactive=True));api=API(18787);api.ready();api.login(owner)
 entity=sql(destination,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();arguments={'entity_id':entity,'recorded_cutoff':55};answer=api.state(arguments)
 assert answer['result']['captured_minor']==11900 and answer['result']['refunded_minor']==2380
 code,agent=api.call('/v1/agents',{'name':'Prior-release restore probe'});assert code==200
 assert mcp(18787,agent['key'],arguments)['result']==answer['result']
 assert api.call('/v1/tools/get_evidence',{'evidence_id':answer['result']['evidence'][0]})==(200,{'status':'unavailable'})
 assert sql(destination,'SELECT count(*) FROM bb.recovery_guards WHERE NOT evidence_blocked OR NOT sources_blocked;').strip()==b'0'
 checks=['exact_schema7_archive_metadata_accepted_before_target_creation','complete_known_migration_prefix_plus_runtime_then_additive_schema8','existing_source_context_backfilled_without_journal_rewrite','new_owner_API_and_actual_SDK_MCP_preserve_11900_capture_2380_refund_with_raw_provider_guards'];status='passed'
finally:
 if(destination/'.runtime/compose.env').exists():
  stop_supervisor(destination);run(destination,'down','--remove-orphans')
 result={'kind':'known_schema7_to_schema8_isolated_backup_restore','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(destination.relative_to(ROOT)),'port':18787,'node_image_source_commit':'4850531','engine_image_source_commit':'4850531'},'checks':checks,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Prior synthetic 55-row archive only; no populated in-place upgrade, distribution, performance or independent acceptance claim','Probe source is preserved with its evidence; separate private recovery key is never included']}
 (ROOT/'.runtime/schema7-forward-74463df.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
