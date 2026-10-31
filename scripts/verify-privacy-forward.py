#!/usr/bin/env python3
"""Exact prior schema8 fixture -> authenticated isolated schema10 recovery.

This is a restore compatibility test, not a populated in-place upgrade.
"""
import argparse,datetime,hashlib,json,os,pathlib,platform,shutil,subprocess,time,uuid
from backup_restore import restore
from backup_operations import run,sql,cutoffs
from backup_supervisor import stop as stop_supervisor
from evidence_policy import maintain
from host_runtime import create_file,RuntimeConfigError
from host_test_support import API,command,owner_from,mcp,commands
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--prior-bundle',required=True);p.add_argument('--output',required=True);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
prior=pathlib.Path(a.prior_bundle).absolute();token=uuid.uuid4().hex[:12];source=ROOT/'work'/('privacy-prior-'+token);destination=ROOT/'work'/('privacy-forward-'+token);vault=ROOT/'work'/('privacy-vault-'+token);checks=[];status='failed';started=time.monotonic()
fixture=json.loads((prior/'fixture-manifest.json').read_text())
for name,digest in fixture['files'].items():assert hashlib.sha256((prior/name).read_bytes()).hexdigest()==digest
assert json.loads((prior/'release/compatibility.json').read_text())['install']['schema']==8
try:
 shutil.copytree(prior,source);source.chmod(0o700);vault.mkdir(mode=0o700)
 owner=owner_from(command(source,['./blackbox','setup','--port','18803'],interactive=True));command(source,['./blackbox','up'])
 # Stop only the fixture's supervisor: legacy material must remain present for its archive.
 command(source,['python3','-c',"import sys,pathlib;sys.path.insert(0,'scripts');from backup_supervisor import stop;stop(pathlib.Path.cwd())"])
 api=API(18803);api.ready();api.login(owner);assert api.call('/v1/example',{})[0]==200
 entity=sql(source,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();answer=api.state({'entity_id':entity});arguments={'entity_id':entity,'recorded_cutoff':answer['recorded_cutoff']};before=cutoffs(source)
 fixture_code=r'''
import pg from 'pg';import{randomUUID,createHash}from'node:crypto';import{join}from'node:path';import{encryptEvidence,durableReplace}from'./packages/auth/key-material.ts';
const pool=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});
try{const row=(await pool.query("SELECT tenant_id,connection_id FROM bb.journal LIMIT 1")).rows[0],tenant=row.tenant_id,connection=row.connection_id;
const evidence=randomUUID(),plan=randomUUID(),run=randomUUID(),job=randomUUID(),canary='synthetic-private-page@example.test';
const raw=Buffer.from(JSON.stringify({synthetic_unclassified:true}));await durableReplace(join(process.env.EVIDENCE_DIR,tenant,evidence),await encryptEvidence(tenant,evidence,raw));
await pool.query("INSERT INTO bb.evidence(tenant_id,evidence_id,sha256)VALUES($1,$2,$3)",[tenant,evidence,createHash('sha256').update(raw).digest('hex')]);
await pool.query("INSERT INTO bb.evidence_context(tenant_id,evidence_id,evidence_class)VALUES($1,$2,'legacy_unclassified')",[tenant,evidence]);
await pool.query("INSERT INTO bb.import_plans(tenant_id,plan_id,connection_id,revision,selected_by,parameters,capabilities,provider_revision)VALUES($1,$2,$3,1,$4,'{}',ARRAY['orders'],'synthetic-legacy')",[tenant,plan,connection,randomUUID()]);
await pool.query("INSERT INTO bb.import_runs(tenant_id,run_id,connection_id,plan_id,kind,state,phase,cursor)VALUES($1,$2,$3,$4,'initial','paused','import_records',$5)",[tenant,run,connection,plan,canary]);
await pool.query("INSERT INTO bb.source_jobs(tenant_id,job_id,connection_id,plan_id,capability,kind,run_id,state,checkpoint)VALUES($1,$2,$3,$4,'orders','initial',$5,'paused',$6)",[tenant,job,connection,plan,run,{from:'2026-01-01T00:00:00Z',through:'2026-02-01T00:00:00Z',stage:'recent',after:canary,pages:3}]);
console.log(JSON.stringify({tenant,evidence,job,run}));}finally{await pool.end();}
'''
 old=json.loads(run(source,'run','--rm','--no-deps','--user',str(os.getuid())+':'+str(os.getgid()),'tooling','node','--import','tsx','--input-type=module','-e',fixture_code))
 assert api.call('/v1/tools/get_evidence',{'evidence_id':old['evidence']})[1]['status']=='available'
 backup_code="import sys,pathlib,json;sys.path.insert(0,'scripts');from backup_operations import enroll,generation,target;from host_runtime import create_file,RuntimeConfigError;r=pathlib.Path.cwd();v=pathlib.Path(sys.argv[1]);key=enroll(r,v);create_file(v/'recovery.key',key);g=generation(r);c=json.loads((r/'.runtime/backup.json').read_text());create_file(v/'generation.json',json.dumps({'backup':str(target(c)/g['generation'])}).encode())"
 command(source,['python3','-c',backup_code,str(vault)],timeout=240)
 archive=pathlib.Path(json.loads((vault/'generation.json').read_text())['backup']);secret=(vault/'recovery.key').read_bytes()
 restore(ROOT,archive,destination,secret,18805);del secret
 owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(destination)],interactive=True));api=API(18805);api.ready();api.login(owner)
 assert sql(destination,'SELECT count(*) FROM bb.schema_migrations;').strip()==b'10'
 assert cutoffs(destination)['journal_count']==before['journal_count']
 checkpoint=json.loads(sql(destination,"SELECT checkpoint FROM bb.source_jobs WHERE job_id='"+old['job']+"';"))
 assert checkpoint=={'from':'2026-01-01T00:00:00Z','through':'2026-02-01T00:00:00Z','stage':'recent','after':None,'pages':0}
 assert sql(destination,'SELECT count(*) FROM bb.import_runs WHERE cursor IS NOT NULL;').strip()==b'0'
 assert sql(destination,"SELECT count(*) FROM bb.security_audit WHERE action='source.legacy_cursor_discarded';").strip()==b'1'
 assert sql(destination,"SELECT count(*) FROM bb.evidence_retention WHERE evidence_id='"+old['evidence']+"' AND (retained OR accessible);").strip()==b'0'
 checks.append('exact_schema8_archive_forward_migration_discards_plaintext_cursors_preserves_fixed_scope_and_audits')
 cutoff=json.loads((destination/'.runtime/restore-state.json').read_text())['recoverable_cutoff'];result=maintain(destination,acknowledge_cutoff=cutoff);api.ready()
 assert result['removed']==1 and not(destination/'.runtime/evidence'/old['tenant']/old['evidence']).exists()
 assert sql(destination,"SELECT count(*) FROM bb.evidence_disposals WHERE evidence_id='"+old['evidence']+"';").strip()==b'1'
 assert api.call('/v1/tools/get_evidence',{'evidence_id':old['evidence']})==(200,{'status':'unavailable'})
 assert api.state(arguments)['result']==answer['result'];code,agent=api.call('/v1/agents',{'name':'Forward privacy test'});assert code==200
 assert mcp(18805,agent['key'],arguments)['result']==answer['result']
 assert mcp(18805,agent['key'],{'evidence_id':old['evidence']},'get_evidence')=={'status':'unavailable'}
 checks.append('unclassified_older_original_removed_with_durable_intent_before_guard_release_business_API_MCP_unchanged')
 # Constraints prevent old/incorrect writers from persisting plaintext after migration.
 for statement in ["UPDATE bb.source_jobs SET checkpoint=jsonb_set(checkpoint,'{after}','\"private\"') WHERE job_id='"+old['job']+"';", "UPDATE bb.import_runs SET cursor='private' WHERE run_id='"+old['run']+"';"]:
  try:sql(destination,statement);raise AssertionError('Plaintext cursor accepted')
  except RuntimeConfigError:pass
 checks.append('database_rejects_plaintext_operational_cursor_writes');status='passed'
finally:
 for directory in [source,destination]:
  if(directory/'.runtime/compose.env').exists():
   try:stop_supervisor(directory);run(directory,'down','--remove-orphans')
   except Exception:checks.append('cleanup_failed_inspect_only_owned_project')
 report={'kind':'schema8_to10_privacy_isolated_restore','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'ports':[18803,18805],'stages':[str(x.relative_to(ROOT))for x in [source,destination]],'prior_fixture':fixture,'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit},'checks':checks,'commands':commands,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Small synthetic PostgreSQL17 corpus, not smoke RTO or full field/provider inventory','Isolated backup restore, not populated in-place upgrade or distribution','No live provider or independent review claim']}
 (ROOT/a.output).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
