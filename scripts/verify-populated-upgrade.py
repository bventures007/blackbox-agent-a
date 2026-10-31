#!/usr/bin/env python3
"""Actual populated upgrade, refused inputs, SIGKILL/resume and backup recovery."""
import argparse,datetime,hashlib,json,os,pathlib,platform,shutil,subprocess,time,uuid
from host_test_support import command,owner_from,API,mcp,commands
from backup_operations import run,sql,cutoffs,target
from backup_restore import runtime_bundle_files,restore
from backup_supervisor import stop
from backup_codec import new_recovery
from host_runtime import create_file
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--prior-bundle',required=True);p.add_argument('--node-image',required=True);p.add_argument('--engine-image',required=True);p.add_argument('--output',required=True);a=p.parse_args()
prior=pathlib.Path(a.prior_bundle).absolute();fixture=json.loads((prior/'fixture-manifest.json').read_text())
for name,digest in fixture['files'].items():assert hashlib.sha256((prior/name).read_bytes()).hexdigest()==digest
assert json.loads((prior/'release/compatibility.json').read_text())['install']['schema']==8
token=uuid.uuid4().hex[:12];stage=ROOT/'work'/('upgrade-'+token);recovered=ROOT/'work'/('upgrade-recovery-'+token);vault=ROOT/'work'/('upgrade-vault-'+token)
checks=[];status='failed';started=time.monotonic();process=None;summary={}
try:
 shutil.copytree(prior,stage);stage.chmod(0o700);vault.mkdir(mode=0o700)
 owner=owner_from(command(stage,['./blackbox','setup','--port','18811'],interactive=True));command(stage,['./blackbox','up']);api=API(18811);api.ready();api.login(owner);assert api.call('/v1/example',{})[0]==200
 command(stage,['python3','-c',"import pathlib,sys;sys.path.insert(0,'scripts');from backup_supervisor import stop;stop(pathlib.Path.cwd())"])
 entity=sql(stage,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();answer=api.state({'entity_id':entity});arguments={'entity_id':entity,'recorded_cutoff':answer['recorded_cutoff']};before=cutoffs(stage)
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
 assert not(stage/'.runtime/maintenance.json').exists();assert cutoffs(stage)==before;assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'8'
 checks.append('mismatched_compiled_target_image_refused_before_checkpoint_or_migration')
 wrong,_=new_recovery(ROOT);create_file(vault/'wrong.key',wrong);del wrong
 command(stage,['python3','-c',driver,str(vault/'wrong.key'),a.node_image,a.engine_image],expect=1,timeout=300)
 checkpoint=json.loads((stage/'.runtime/maintenance.json').read_text());assert checkpoint['phase']=='backup' and 'backup'in checkpoint and 'verified_backup'not in checkpoint
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'8';assert cutoffs(stage)==before
 command(stage,['./blackbox','up'],expect=1);checks.append('wrong_valid_recovery_identity_blocks_migration_and_startup_preserves_completed_generation')
 interrupt="""import pathlib,sys,time;sys.path.insert(0,'scripts');import upgrade_operations as u
r=pathlib.Path.cwd();original=u.phase
def phase(root,marker,name):
 original(root,marker,name)
 if name=='migrating' and marker.get('last_migration','').startswith('009-'):
  (root/'.runtime/kill-ready').write_text('ready');time.sleep(600)
u.phase=phase
u.upgrade(r,pathlib.Path(sys.argv[1]).read_bytes(),resume=True)
"""
 with (vault/'interrupted-driver.log').open('wb')as output:
  process=subprocess.Popen(['python3','-c',interrupt,str(vault/'recovery.key')],cwd=stage,stdout=output,stderr=output);deadline=time.monotonic()+300
  while not(stage/'.runtime/kill-ready').exists():
   if process.poll()is not None:raise RuntimeError('Upgrade exited before interruption point; private test log retained.')
   if time.monotonic()>deadline:raise RuntimeError('Upgrade interruption checkpoint deadline exceeded.')
   time.sleep(.1)
  process.kill();assert process.wait()==-9;process=None
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'9';assert sql(stage,'SELECT state FROM bb.runtime_contract;').strip()==b'fenced'
 command(stage,['./blackbox','up'],expect=1);checks.append('actual_SIGKILL_after_committed_migration009_keeps_database_and_host_fenced')
 resume="import pathlib,sys,json;sys.path.insert(0,'scripts');from upgrade_operations import upgrade;print(json.dumps(upgrade(pathlib.Path.cwd(),pathlib.Path(sys.argv[1]).read_bytes(),resume=True)))"
 changed=stage/'scripts/upgrade-probe.mjs';original=changed.read_bytes();changed.write_bytes(original+b'\n// synthetic changed bundle\n')
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],expect=1)
 assert sql(stage,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'9';changed.write_bytes(original)
 checks.append('changed_target_bundle_refused_before_resuming_migrations')
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],timeout=300)
 api.ready();api.login(owner);assert api.state(arguments)['result']==answer['result'];code,agent=api.call('/v1/agents',{'name':'Upgrade verification'});assert code==200
 assert mcp(18811,agent['key'],arguments)['result']==answer['result'];assert cutoffs(stage)==before
 summary=json.loads((stage/'.runtime/upgrade-status.json').read_text());assert summary['source_probe']['answers_sha256']==summary['target_probe']['answers_sha256']
 command(stage,['./blackbox','down']);command(stage,['./blackbox','up']);api.ready();api.login(owner);assert api.state(arguments)['result']==answer['result'];assert mcp(18811,agent['key'],arguments)['result']==answer['result']
 checks.append('resume_migrates_remaining_prefix_preserves_journal_and_representative_answers_API_SDK_MCP_and_restart')
 config=json.loads((stage/'.runtime/backup.json').read_text());archive=target(config)/summary['backup']['generation']
 restore(ROOT,archive,recovered,(vault/'recovery.key').read_bytes(),18813)
 recovered_owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(recovered)],interactive=True));other=API(18813);other.ready()
 assert other.call('/v1/login',{'key':owner,'remember':True})[0]==401
 other.login(recovered_owner);assert other.state(arguments)['result']==answer['result'];code,key=other.call('/v1/agents',{'name':'Recovered upgrade verification'});assert code==200
 assert mcp(18813,key['key'],arguments)['result']==answer['result'];assert cutoffs(recovered)==before
 checks.append('actual_isolated_pre_upgrade_backup_restore_preserves_recorded_cutoff_and_revokes_stale_owner_access')
 status='passed'
finally:
 if process and process.poll()is None:process.kill();process.wait()
 for directory in [stage,recovered]:
  if(directory/'.runtime/compose.env').exists():
   try:stop(directory);run(directory,'down','--remove-orphans')
   except Exception:checks.append('cleanup_failed_inspect_only_owned_project')
 report={'kind':'populated_schema8_to10_upgrade','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'ports':[18811,18813],'stages':[str(d.relative_to(ROOT))for d in [stage,recovered]],'node_image':a.node_image,'engine_image':a.engine_image,'prior_fixture':fixture},'checks':checks,'upgrade_result':summary,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Synthetic small corpus; not smoke performance or restore RTO','A deliberate test pause after committed migration009 allows actual SIGKILL; no product pause hook','Unchanged reducer/projection versions; changed-rule atomic rebuild remains unimplemented','No live provider, distribution or independent review claim']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':status,'checks':checks,'output':a.output}),flush=True)
