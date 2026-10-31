#!/usr/bin/env python3
"""Actual older encrypted generation disclosure, bounded owner UI and lost-mount handling."""
import argparse,datetime,hashlib,json,os,pathlib,platform,subprocess,time,uuid
from backup_restore import copy_runtime_bundle,verified_backup
from backup_operations import atomic_json,enroll,generation,target,run,sql,cutoffs
from backup_supervisor import stop as stop_supervisor,publish_status
from evidence_scheduler import iso
from host_runtime import create_file
from host_test_support import command,owner_from,API,commands,redact
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18791);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
token=uuid.uuid4().hex[:12];stage=ROOT/'work'/('evidence-copies-'+token);runtime=stage/'.runtime';vault=ROOT/'work'/('evidence-copies-vault-'+token);checks=[];status='failed';started=time.monotonic();snapshot=None
def mark(value):checks.append(value);print(value,flush=True)
try:
 stage.mkdir(mode=0o700);vault.mkdir(mode=0o700);copy_runtime_bundle(ROOT,stage)
 owner=owner_from(command(stage,['./blackbox','setup','--port',str(a.port)],interactive=True));command(stage,['./blackbox','up'])
 api=API(a.port);api.ready();api.login(owner);stop_supervisor(stage);deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  if(runtime/'supervisor.json').exists()and json.loads((runtime/'supervisor.json').read_text()).get('observed_at')is None:break
  time.sleep(.2)
 else:raise RuntimeError('Synthetic supervisor stop timeout')
 assert api.call('/v1/example',{})[0]==200
 entity=sql(stage,"SELECT entity_id FROM bb.journal WHERE record_type='source'ORDER BY sequence LIMIT 1;").decode().strip();answer=api.state({'entity_id':entity});evidence=answer['result']['evidence'][0]
 tenant=sql(stage,'SELECT tenant_id FROM bb.workspaces;').decode().strip();snapshot=cutoffs(stage)
 secret=enroll(stage,vault);create_file(vault/'recovery.key',secret);result=generation(stage);api.ready()
 config=json.loads((runtime/'backup.json').read_text());archive=target(config)/result['generation'];before=hashlib.sha256(archive.read_bytes()).hexdigest()
 with verified_backup(stage,archive,secret)as(_,manifest,_,_):
  # The authenticated encrypted manifest proves this older generation contains
  # the original, unlike the deliberately metadata-only browser inventory.
  assert 'evidence/'+tenant+'/'+evidence in manifest['members']
 assert api.call('/v1/evidence/'+evidence+'/restrict',{'acknowledged':True})[0]==200
 publish_status(stage);code,visible=api.call('/v1/evidence-policy');assert code==200
 copies=visible['maintenance']['copies'];assert copies['state']=='available'and copies['total']==1 and copies['generations']==[{'generation':result['generation'][:-7],'recoverable_cutoff':result['recoverable_cutoff']}]
 assert datetime.datetime.fromisoformat(result['recoverable_cutoff'])<=datetime.datetime.fromisoformat(visible['latest_content_policy_change'].replace('Z','+00:00'))
 assert str(vault)not in json.dumps(visible)and config['recipient']not in json.dumps(visible)
 browser=subprocess.run(['node','--import','tsx','tests/evidence-policy-browser.ts'],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':api.base,'TEST_RUNTIME_DIR':str(runtime),'TEST_OWNER_KEY':owner,'TEST_EXPECT_BACKUP_WARNING':'1'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120)
 commands.append({'command':'node --import tsx tests/evidence-policy-browser.ts [protected test environment]','exit_code':browser.returncode,'observed':redact(browser.stdout)})
 if browser.returncode:raise RuntimeError('Actual affected-backup browser proof failed')
 assert hashlib.sha256(archive.read_bytes()).hexdigest()==before and cutoffs(stage)==snapshot
 assert api.call('/v1/tools/get_evidence',{'evidence_id':evidence})==(200,{'status':'unavailable'})
 mark('authenticated_older_archive_contains_original_owner_EN_DE_warning_matches_cutoff_no_implicit_backup_deletion_or_secret_path')
 held=vault.with_name(vault.name+'-disconnected');vault.rename(held);vault.mkdir(mode=0o700)
 try:
  cache=json.loads((runtime/'evidence-copy-inventory.json').read_text());cache['observed_at']=iso(time.time()-120);atomic_json(runtime/'evidence-copy-inventory.json',cache);publish_status(stage)
  unavailable=api.call('/v1/evidence-policy')[1]['maintenance']['copies'];assert unavailable['state']=='unavailable'and not unavailable['generations']and unavailable['total']is None
  assert not list(vault.iterdir())
 finally:vault.rmdir();held.rename(vault)
 assert hashlib.sha256(archive.read_bytes()).hexdigest()==before
 mark('replaced_mount_reports_unknown_inventory_and_writes_nothing_to_empty_destination')
 status='passed'
finally:
 if(runtime/'compose.env').exists():
  try:stop_supervisor(stage);run(stage,'down','--remove-orphans')
  except Exception:checks.append('cleanup_failed_inspect_only_this_test_project')
 report={'kind':'affected_backup_generation_disclosure','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(ROOT)),'port':a.port,'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'checks':checks,'snapshot':snapshot,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Small synthetic metadata/ciphertext/UI proof; not performance, distribution or independent review','Host status inventory reads bounded metadata/file sizes, not archive decryption; authenticated archive validation is an explicit test step','External/exported copies remain unknown; no universal erasure or provider-retention certification','Inventory cache timestamp explicitly aged for the mount-loss refresh, not an actual passage-of-time test']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
