#!/usr/bin/env python3
"""Owned Compose proof of explicit failed-build retry, crash resume and restore."""
import argparse,datetime,hashlib,json,os,pathlib,platform,shutil,subprocess,time,uuid
from host_test_support import command,owner_from,API,mcp,commands
from backup_operations import run,sql,target,cutoffs
from backup_restore import runtime_bundle_files,restore
from backup_supervisor import stop
from upgrade_operations import journal_digest,journal_cutoffs
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--prior-bundle',required=True);p.add_argument('--node-image',required=True);p.add_argument('--engine-image',required=True);p.add_argument('--output',required=True);a=p.parse_args()
prior=pathlib.Path(a.prior_bundle).absolute();fixture=json.loads((prior/'fixture-manifest.json').read_text())
for name,digest in fixture['files'].items():assert hashlib.sha256((prior/name).read_bytes()).hexdigest()==digest
assert json.loads((prior/'release/compatibility.json').read_text())['install']['schema']==10
identity=uuid.uuid4().hex[:12];stage=ROOT/'work'/('projection-retry-'+identity);recovered=ROOT/'work'/('projection-retry-recovery-'+identity);vault=ROOT/'work'/('projection-retry-vault-'+identity)
status='failed';checks=[];started=time.monotonic();process=None
try:
 shutil.copytree(prior,stage);stage.chmod(0o700);vault.mkdir(mode=0o700)
 owner=owner_from(command(stage,['./blackbox','setup','--port','18817'],interactive=True));command(stage,['./blackbox','up']);api=API(18817);api.ready();api.login(owner);assert api.call('/v1/example',{})[0]==200
 command(stage,['python3','-c',"import pathlib,sys;sys.path.insert(0,'scripts');from backup_supervisor import stop;stop(pathlib.Path.cwd())"])
 entity=sql(stage,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();answer=api.state({'entity_id':entity});before=journal_digest(stage)
 command(stage,['python3','-c',"import pathlib,sys;sys.path.insert(0,'scripts');from backup_operations import enroll;from host_runtime import create_file;r=pathlib.Path.cwd();v=pathlib.Path(sys.argv[1]);create_file(v/'recovery.key',enroll(r,v))",str(vault)])
 for name in runtime_bundle_files(ROOT):
  destination=stage/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,destination)
 # A test-only hook stages a corrupt verified candidate before the real Rust
 # publisher runs. Runtime code and preserved release files are not modified.
 initial="""import pathlib,sys,json,uuid;sys.path.insert(0,'scripts');import upgrade_operations as u
r=pathlib.Path.cwd();original=u.probe

def probe(root,mode):
 if mode=='compare':
  build=str(uuid.uuid4())
  u.sql(root,"INSERT INTO bb.projection_builds(tenant_id,build_id,source_generation_id,source_rule,target_rule,source_cutoff,target_cutoff,state,verified_count)SELECT tenant_id,'"+build+"',projection_generation,projection_rule,'lifecycle-v3',committed,committed,'ready',1 FROM bb.heads;INSERT INTO bb.projections(tenant_id,generation_id,entity_id,applied,rule_version,state,checksum,verified_checksum)SELECT tenant_id,'"+build+"',entity_id,applied,'lifecycle-v3',state,'corrupt','corrupt' FROM bb.projections LIMIT 1;")
 return original(root,mode)
u.probe=probe
u.upgrade(r,pathlib.Path(sys.argv[1]).read_bytes(),node_image=sys.argv[2],engine_image=sys.argv[3])
"""
 command(stage,['python3','-c',initial,str(vault/'recovery.key'),a.node_image,a.engine_image],expect=1,timeout=330)
 assert json.loads((stage/'.runtime/maintenance.json').read_text())['phase']=='verifying';assert sql(stage,"SELECT state||':'||error_code FROM bb.projection_builds;").strip()==b'failed:candidate_corrupt';assert sql(stage,'SELECT projection_rule FROM bb.heads;').strip()==b'lifecycle-v2';assert journal_digest(stage)==before
 original_failed=sql(stage,'SELECT build_id FROM bb.projection_builds;').decode().strip()
 resume="import pathlib,sys;sys.path.insert(0,'scripts');from upgrade_operations import upgrade;upgrade(pathlib.Path.cwd(),pathlib.Path(sys.argv[1]).read_bytes(),resume=True,retry_failed_builds=len(sys.argv)>2)"
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],expect=1,timeout=330);assert sql(stage,'SELECT count(*) FROM bb.projection_builds;').strip()==b'1'
 checks.append('actual_corrupt_candidate_fails_and_plain_resume_cannot_create_retry')
 # Pause immediately before the first engine call, after the new grant and
 # immutable retry audit commit. Kill the real host process; resume must reclaim
 # only the labelled probe container and preserve/reuse that grant.
 interrupt="""import pathlib,sys,json,os;sys.path.insert(0,'scripts');import upgrade_operations as u
r=pathlib.Path.cwd();original=u.probe
def probe(root,mode):
 if mode!='compare':return original(root,mode)
 marker=u.read_marker(root);project=u.read_compose(root/'.runtime').get('BB_PROJECT','blackbox-a')
 hook=\"import{writeFile as retryWrite}from'node:fs/promises';const retryFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/v1/projection-build')){await retryWrite('/runtime/retry-grant-ready','ready',{mode:384});await new Promise(()=>{});}return retryFetch(url,options);};\\n\"
 script=hook.encode()+(root/'scripts/upgrade-probe.mjs').read_bytes()
 return json.loads(u.run(root,'run','--rm','--no-deps','--name',project+'-upgrade-probe','--label','com.blackbox.upgrade='+marker['operation_id'],'--user',str(os.getuid())+':'+str(os.getgid()),'tooling','node','--input-type=module','-',mode,input=script,timeout=330))
u.probe=probe
u.upgrade(r,pathlib.Path(sys.argv[1]).read_bytes(),resume=True,retry_failed_builds=True)
"""
 with (vault/'interrupted.log').open('wb')as output:
  process=subprocess.Popen(['python3','-c',interrupt,str(vault/'recovery.key')],cwd=stage,stdout=output,stderr=output);deadline=time.monotonic()+300
  while not(stage/'.runtime/retry-grant-ready').exists():
   if process.poll()is not None:raise RuntimeError('Retry exited before grant interruption; private log retained.')
   if time.monotonic()>deadline:raise RuntimeError('Retry interruption checkpoint deadline exceeded.')
   time.sleep(.1)
  process.kill();assert process.wait()==-9;process=None
 assert sql(stage,'SELECT count(*) FROM bb.projection_builds;').strip()==b'2';assert sql(stage,"SELECT count(*) FROM bb.security_audit WHERE action LIKE 'projection.failed_build_retried%';").strip()==b'1'
 replacement=sql(stage,"SELECT build_id FROM bb.projection_builds WHERE state='scanning';").decode().strip();assert replacement!=original_failed
 checks.append('actual_SIGKILL_after_retry_grant_and_immutable_audit_preserves_old_failed_candidate')
 # Make the replacement fail as well, with a deliberately older creation clock.
 # The prior authorization must remain consumed independently of timestamp order.
 sql(stage,"UPDATE bb.projection_builds SET state='ready',verified_count=1,created_at=created_at-interval '1 day' WHERE build_id='"+replacement+"';INSERT INTO bb.projections(tenant_id,generation_id,entity_id,applied,rule_version,state,checksum,verified_checksum)SELECT tenant_id,'"+replacement+"',entity_id,applied,'lifecycle-v3',state,'corrupt','corrupt' FROM bb.projections WHERE generation_id='00000000-0000-0000-0000-000000000000' LIMIT 1;")
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],expect=1,timeout=330)
 assert sql(stage,"SELECT count(*) FROM bb.projection_builds WHERE state='failed';").strip()==b'2'
 command(stage,['python3','-c',resume,str(vault/'recovery.key')],expect=1,timeout=330)
 assert sql(stage,'SELECT count(*) FROM bb.projection_builds;').strip()==b'2';assert journal_digest(stage)==before
 checks.append('replacement_failure_cannot_reuse_old_authorization_even_after_backward_creation_clock')
 command(stage,['python3','-c',resume,str(vault/'recovery.key'),'retry'],timeout=330)
 assert sql(stage,"SELECT count(*) FROM bb.projection_builds WHERE state='failed';").strip()==b'2';assert sql(stage,"SELECT count(*) FROM bb.projection_builds WHERE state='published';").strip()==b'1';assert sql(stage,"SELECT count(*) FROM bb.security_audit WHERE action LIKE 'projection.failed_build_retried%';").strip()==b'2';assert journal_digest(stage)==before
 api.ready();api.login(owner);assert api.state({'entity_id':entity,'interpretation_version':'lifecycle-v2'})['result']==answer['result'];code,agent=api.call('/v1/agents',{'name':'Repaired candidate reader'});assert code==200;assert mcp(18817,agent['key'],{'entity_id':entity})['rule_version']=='lifecycle-v3'
 checks.append('new_explicit_retry_publishes_fresh_generation_preserves_both_failed_candidates_and_API_SDK_MCP')
 # A current-format backup may retain a different workspace's failed candidate.
 # Restore must require the same explicit retry boundary before owner issuance.
 other=str(uuid.uuid4());failed=str(uuid.uuid4())
 sql(stage,"INSERT INTO bb.workspaces(tenant_id,name)VALUES('"+other+"','Synthetic restored failed candidate');INSERT INTO bb.heads(tenant_id,projection_rule)VALUES('"+other+"','lifecycle-v2');INSERT INTO bb.projection_builds(tenant_id,build_id,source_generation_id,source_rule,target_rule,source_cutoff,target_cutoff,state,error_code)VALUES('"+other+"','"+failed+"','00000000-0000-0000-0000-000000000000','lifecycle-v2','lifecycle-v3',0,0,'failed','candidate_corrupt');")
 command(stage,['python3','-c',"import pathlib,sys,json;sys.path.insert(0,'scripts');from backup_operations import generation;print(json.dumps(generation(pathlib.Path.cwd())))"],timeout=330)
 config=json.loads((stage/'.runtime/backup.json').read_text());archives=sorted(target(config).glob('*.bb.age'),key=lambda x:x.stat().st_mtime);archive=archives[-1];snapshot=journal_digest(stage)
 restore(ROOT,archive,recovered,(vault/'recovery.key').read_bytes(),18819)
 command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(recovered)],interactive=True,expect=1,timeout=330)
 assert json.loads((recovered/'.runtime/maintenance.json').read_text())['phase']=='failed';assert sql(recovered,"SELECT projection_rule FROM bb.heads WHERE tenant_id='"+other+"';").strip()==b'lifecycle-v2'
 recovered_owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(recovered),'--retry-failed-builds'],interactive=True,timeout=330));recovered_api=API(18819);recovered_api.ready();recovered_api.login(recovered_owner)
 assert recovered_api.state({'entity_id':entity})['rule_version']=='lifecycle-v3';assert journal_digest(recovered)==snapshot
 assert sql(recovered,"SELECT projection_rule FROM bb.heads WHERE tenant_id='"+other+"';").strip()==b'lifecycle-v3'
 checks.append('isolated_restore_requires_explicit_failed_build_retry_before_owner_issuance_without_journal_change')
 status='passed'
finally:
 if process and process.poll()is None:process.kill();process.wait()
 for directory in [stage,recovered]:
  if(directory/'.runtime/compose.env').exists():
   try:stop(directory);run(directory,'down','--remove-orphans')
   except Exception:checks.append('cleanup_failed_inspect_only_owned_project')
 report={'kind':'failed_projection_retry_recovery','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'ports':[18817,18819],'stages':[str(x.relative_to(ROOT))for x in [stage,recovered]],'images':{'node':a.node_image,'engine':a.engine_image},'prior_fixture':fixture},'checks':checks,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Synthetic candidate corruption and deliberate pause before first engine call; actual host SIGKILL','Synthetic backward creation timestamp, not a changed system clock','Small fixture, not smoke performance or independent approval']};output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':status,'checks':checks,'output':a.output}),flush=True)
