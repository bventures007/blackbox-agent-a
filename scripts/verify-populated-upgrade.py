#!/usr/bin/env python3
"""Actual populated upgrade, refused inputs, SIGKILL/resume and backup recovery."""
import argparse,datetime,hashlib,json,os,pathlib,platform,shutil,subprocess,time,uuid
from host_test_support import command,owner_from,API,mcp,commands
from backup_operations import run,sql,cutoffs,target
from backup_restore import runtime_bundle_files,restore
from backup_supervisor import stop
from upgrade_operations import journal_cutoffs
from backup_codec import new_recovery
from host_runtime import create_file
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--prior-bundle',required=True);p.add_argument('--node-image',required=True);p.add_argument('--engine-image',required=True);p.add_argument('--output',required=True);a=p.parse_args()
prior=pathlib.Path(a.prior_bundle).absolute();fixture=json.loads((prior/'fixture-manifest.json').read_text())
for name,digest in fixture['files'].items():assert hashlib.sha256((prior/name).read_bytes()).hexdigest()==digest
source_schema=json.loads((prior/'release/compatibility.json').read_text())['install']['schema'];assert source_schema in [8,10,11]
token=uuid.uuid4().hex[:12];stage=ROOT/'work'/('upgrade-'+token);recovered=ROOT/'work'/('upgrade-recovery-'+token);vault=ROOT/'work'/('upgrade-vault-'+token)
checks=[];status='failed';started=time.monotonic();process=None;summary={}
try:
 shutil.copytree(prior,stage);stage.chmod(0o700);vault.mkdir(mode=0o700)
 owner=owner_from(command(stage,['./blackbox','setup','--port','18811'],interactive=True));command(stage,['./blackbox','up']);api=API(18811);api.ready();api.login(owner);assert api.call('/v1/example',{})[0]==200
 command(stage,['python3','-c',"import pathlib,sys;sys.path.insert(0,'scripts');from backup_supervisor import stop;stop(pathlib.Path.cwd())"])
 seed="""import pg from 'pg';import{randomUUID}from'node:crypto';import{ingest}from'/app/packages/application/ingest.ts';import{pool}from'/app/packages/database/index.ts';
const db=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});try{const tenant=(await db.query('SELECT tenant_id FROM bb.workspaces LIMIT 1')).rows[0].tenant_id;const connection=randomUUID(),entity=randomUUID(),shipment=randomUUID(),economic=randomUUID(),dispatch=randomUUID();await db.query("INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor)VALUES($1,$2,'generic',$3)",[tenant,connection,randomUUID()]);const e=(id,kind,amount,extra={})=>({id:randomUUID(),entity_id:id,kind,amount_minor:amount,currency:'EUR',economic_id:randomUUID(),occurred_at:'2026-10-31T09:00:00Z',test:false,...extra});await ingest(tenant,connection,[e(entity,'order.accepted',10000),e(entity,'payment.captured',2000,{economic_id:economic}),e(entity,'payment.captured',1000,{economic_id:economic,occurred_at:'2026-10-31T09:00:00.100Z'}),e(shipment,'shipment.dispatched',0,{economic_id:dispatch,occurred_at:'2026-10-31T09:00:00.100Z',quantity:'1',details:{item_id:randomUUID(),location_id:randomUUID(),unit:'piece'}}),e(shipment,'shipment.delivered',0,{details:{related_id:dispatch}})],{synthetic_rule_upgrade:true});console.log(JSON.stringify({entity,shipment}));}finally{await db.end();await pool.end();}"""
 defect=json.loads(run(stage,'run','--rm','--no-deps','tooling','node','--import','tsx','--input-type=module','-',input=seed.encode()))
 assert api.state({'entity_id':defect['entity']})['result']['captured_minor']==(1000 if source_schema==11 else 2000)
 assert api.state({'entity_id':defect['shipment']})['result']['shipment_status']==('dispatched' if source_schema==11 else 'delivered')
 entity=sql(stage,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();answer=api.state({'entity_id':entity});prior_rule=answer['rule_version'];arguments={'entity_id':entity,'recorded_cutoff':answer['recorded_cutoff']};before=journal_cutoffs(cutoffs(stage))
 code="import pathlib,sys;sys.path.insert(0,'scripts');from backup_operations import enroll;from host_runtime import create_file;r=pathlib.Path.cwd();v=pathlib.Path(sys.argv[1]);create_file(v/'recovery.key',enroll(r,v))"
 command(stage,['python3','-c',code,str(vault)])
 # Emulate placing a new host bundle over an installation without copying,
 # replacing or reinitializing any runtime data, credentials, volume or port.
 for name in runtime_bundle_files(ROOT):
  destination=stage/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,destination)
 driver="import pathlib,sys,json;sys.path.insert(0,'scripts');from upgrade_operations import upgrade;r=pathlib.Path.cwd();result=upgrade(r,pathlib.Path(sys.argv[1]).read_bytes(),node_image=sys.argv[2],engine_image=sys.argv[3]);print(json.dumps(result))"
 # Deliberately pair the current Node with the exact old engine. This must fail
 # before a maintenance checkpoint or any migration, not after schema changes.
 old_engine=json.loads(subprocess.check_output(['docker','container','inspect',json.loads((stage/'.runtime/database-identity.json').read_text())['project']+'-engine-1']))[0]['Image']
 command(stage,['python3','-c',driver,str(vault/'recovery.key'),a.node_image,old_engine],expect=1)
 assert not(stage/'.runtime/maintenance.json').exists();assert journal_cutoffs(cutoffs(stage))==before;assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==str(source_schema).encode()
 checks.append('mismatched_compiled_target_image_refused_before_checkpoint_or_migration')
 wrong,_=new_recovery(ROOT);create_file(vault/'wrong.key',wrong);del wrong
 command(stage,['python3','-c',driver,str(vault/'wrong.key'),a.node_image,a.engine_image],expect=1,timeout=300)
 checkpoint=json.loads((stage/'.runtime/maintenance.json').read_text());assert checkpoint['phase']=='backup' and 'backup'in checkpoint and 'verified_backup'not in checkpoint
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==str(source_schema).encode();assert journal_cutoffs(cutoffs(stage))==before
 command(stage,['./blackbox','up'],expect=1);checks.append('wrong_valid_recovery_identity_blocks_migration_and_startup_preserves_completed_generation')
 interrupt="""import pathlib,sys,time;sys.path.insert(0,'scripts');import upgrade_operations as u
r=pathlib.Path.cwd();original=u.phase
def phase(root,marker,name):
 original(root,marker,name)
 if name=='migrating' and marker.get('last_migration','').startswith({8:'009-',10:'011-',11:'012-'}[int(sys.argv[2])]):
  (root/'.runtime/kill-ready').write_text('ready');time.sleep(600)
u.phase=phase
u.upgrade(r,pathlib.Path(sys.argv[1]).read_bytes(),resume=True)
"""
 with (vault/'interrupted-driver.log').open('wb')as output:
  process=subprocess.Popen(['python3','-c',interrupt,str(vault/'recovery.key'),str(source_schema)],cwd=stage,stdout=output,stderr=output);deadline=time.monotonic()+300
  while not(stage/'.runtime/kill-ready').exists():
   if process.poll()is not None:raise RuntimeError('Upgrade exited before interruption point; private test log retained.')
   if time.monotonic()>deadline:raise RuntimeError('Upgrade interruption checkpoint deadline exceeded.')
   time.sleep(.1)
  process.kill();assert process.wait()==-9;process=None
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==str({8:9,10:11,11:12}[source_schema]).encode();assert sql(stage,'SELECT state FROM bb.runtime_contract;').strip()==b'fenced'
 command(stage,['./blackbox','up'],expect=1);checks.append('actual_SIGKILL_after_committed_additive_migration_keeps_database_and_host_fenced')
 resume="import pathlib,sys,json;sys.path.insert(0,'scripts');from upgrade_operations import upgrade;print(json.dumps(upgrade(pathlib.Path.cwd(),pathlib.Path(sys.argv[1]).read_bytes(),resume=True)))"
 changed=stage/'scripts/upgrade-probe.mjs';original=changed.read_bytes();changed.write_bytes(original+b'\n// synthetic changed bundle\n')
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],expect=1)
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==str({8:9,10:11,11:12}[source_schema]).encode();changed.write_bytes(original)
 checks.append('changed_target_bundle_refused_before_resuming_migrations')
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],timeout=300)
 api.ready();api.login(owner);assert api.state({**arguments,'interpretation_version':prior_rule})['result']==answer['result'];code,agent=api.call('/v1/agents',{'name':'Upgrade verification'});assert code==200
 assert mcp(18811,agent['key'],{**arguments,'interpretation_version':prior_rule})['result']==answer['result'];assert journal_cutoffs(cutoffs(stage))==before
 assert api.state({'entity_id':defect['entity']})['result']['captured_minor']==1000
 assert api.state({'entity_id':defect['shipment']})['result']['shipment_status']=='dispatched'
 assert mcp(18811,agent['key'],{'entity_id':defect['entity']})['result']['captured_minor']==1000
 checks.append('current_reader_preserves_correct_money_and_delivery_with_prior_interpretation_retained'if source_schema==11 else'changed_rule_corrects_money_revision_and_premature_delivery_at_same_cutoff_with_prior_reader_retained')
 summary=json.loads((stage/'.runtime/upgrade-status.json').read_text());assert summary['source_probe']['answers_sha256']==summary['target_probe']['answers_sha256']
 command(stage,['./blackbox','down']);command(stage,['./blackbox','up']);api.ready();api.login(owner);assert api.state({**arguments,'interpretation_version':prior_rule})['result']==answer['result'];assert mcp(18811,agent['key'],{**arguments,'interpretation_version':prior_rule})['result']==answer['result']
 checks.append('resume_migrates_remaining_prefix_preserves_journal_and_representative_answers_API_SDK_MCP_and_restart')
 config=json.loads((stage/'.runtime/backup.json').read_text());archive=target(config)/summary['backup']['generation']
 restore(ROOT,archive,recovered,(vault/'recovery.key').read_bytes(),18813)
 recovered_owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(recovered)],interactive=True));other=API(18813);other.ready()
 assert other.call('/v1/login',{'key':owner,'remember':True})[0]==401
 other.login(recovered_owner);assert other.state({**arguments,'interpretation_version':prior_rule})['result']==answer['result'];code,key=other.call('/v1/agents',{'name':'Recovered upgrade verification'});assert code==200
 assert mcp(18813,key['key'],{**arguments,'interpretation_version':prior_rule})['result']==answer['result'];assert journal_cutoffs(cutoffs(recovered))==before
 assert other.state({'entity_id':defect['entity']})['result']['captured_minor']==1000
 assert other.state({'entity_id':defect['shipment']})['result']['shipment_status']=='dispatched'
 checks.append('actual_isolated_pre_upgrade_backup_restore_preserves_recorded_cutoff_and_revokes_stale_owner_access')
 status='passed'
finally:
 if process and process.poll()is None:process.kill();process.wait()
 for directory in [stage,recovered]:
  if(directory/'.runtime/compose.env').exists():
   try:stop(directory);run(directory,'down','--remove-orphans')
   except Exception:checks.append('cleanup_failed_inspect_only_owned_project')
 report={'kind':'populated_versioned_lifecycle_upgrade','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'ports':[18811,18813],'stages':[str(d.relative_to(ROOT))for d in [stage,recovered]],'node_image':a.node_image,'engine_image':a.engine_image,'prior_fixture':fixture},'checks':checks,'upgrade_result':summary,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Synthetic small corpus; not smoke performance or restore RTO','A deliberate test pause after a committed migration allows actual SIGKILL; no product pause hook','Representative prior-version equality plus actual changed-rule adversarial values; not independent acceptance review','No live provider, distribution or independent review claim']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':status,'checks':checks,'output':a.output}),flush=True)
