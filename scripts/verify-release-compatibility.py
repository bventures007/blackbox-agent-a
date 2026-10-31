#!/usr/bin/env python3
"""Actual fail-closed metadata/RPC checks on a freshly created synthetic MCP stage."""
import argparse,datetime,json,pathlib,re,subprocess,time
from backup_operations import run,sql,compose,cutoffs,operation_lock
from database_identity import prepare
from release_compatibility import read_manifest,check_database
from host_runtime import compose_environment
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--stage-record',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path);a=p.parse_args()
record=json.loads(a.stage_record.read_text());assert record['status']=='passed'and record['kind']=='actual_packaged_readonly_MCP_client'
root=ROOT/record['environment']['stage'];assert root.parent==ROOT/'work'and re.fullmatch('mcp-bridge-[a-f0-9]{12}',root.name)
manifest=read_manifest(root);checks=[];commands=[];status='failed';started=time.monotonic();original=None

def rejected(args,needle):
 result=subprocess.run(args,cwd=root,env=compose_environment(root/'.runtime')if args[:2]==['docker','compose']else None,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
 # Never persist raw container output, configuration or key material.
 assert result.returncode!=0 and needle.encode()in result.stdout,(args[-1],result.returncode,'expected_safe_error_missing')
 commands.append({'command':' '.join(args),'exit_code':result.returncode,'expected_safe_error':needle,'observed':True})

try:
 with operation_lock(root/'.runtime'):
  prepare(root);check_database(root)
 assert sql(root,'SELECT count(*) FROM bb.workspaces;').strip()==b'1'
 assert sql(root,"SELECT count(*) FROM bb.connections WHERE provider<>'replay';").strip()==b'0'
 original=json.loads(sql(root,'SELECT contract FROM bb.runtime_contract;'));before=cutoffs(root)
 def running():return run(root,'ps','--services','--status','running').decode().splitlines()
 assert not set(running())&{'api','worker','engine'}
 mutations=[
  ("UPDATE bb.schema_migrations SET sha256='"+'a'*64+"' WHERE version='001-foundation.sql';","UPDATE bb.schema_migrations SET sha256='"+manifest['migrations'][0]['sha256']+"' WHERE version='001-foundation.sql';",'migration history','changed_checksum'),
  ("INSERT INTO bb.schema_migrations(version,sha256) VALUES('008-future.sql','"+'b'*64+"');","DELETE FROM bb.schema_migrations WHERE version='008-future.sql';",'migration history','newer_schema'),
  ("UPDATE bb.runtime_contract SET state='fenced';","UPDATE bb.runtime_contract SET state='active';",'maintenance is fenced','persistent_fence'),
  ("UPDATE bb.runtime_contract SET contract=jsonb_set(contract,'{engine_rpc}','99');","UPDATE bb.runtime_contract SET contract='"+json.dumps(original)+"'::jsonb;",'Runtime contracts','unknown_protocol'),
 ]
 for mutate,restore,message,label in mutations:
  sql(root,mutate)
  try:
   rejected(['./blackbox','up'],message);assert not set(running())&{'api','worker','engine'}
   for service in ['api','worker','engine']:
    rejected(compose(root,'run','--rm','--no-deps','-T',service),'database_contract_incompatible_or_fenced')
   assert cutoffs(root)==before;checks.append(label+'_denies_host_API_worker_engine_before_traffic_without_journal_change')
  finally:sql(root,restore)
 check_database(root)
 result=subprocess.run(['./blackbox','up'],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90);assert result.returncode==0
 probe=json.loads(run(root,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-runtime-contract.ts'))
 assert probe['status']=='passed';checks.extend(probe['checks'])
 assert cutoffs(root)==before;checks.append('matching_runtime_starts_with_exact_unchanged_journal_cutoff')
 status='passed'
finally:
 if original:
  try:sql(root,"UPDATE bb.runtime_contract SET state='active',contract='"+json.dumps(original)+"'::jsonb;DELETE FROM bb.schema_migrations WHERE version='008-future.sql';UPDATE bb.schema_migrations SET sha256='"+manifest['migrations'][0]['sha256']+"' WHERE version='001-foundation.sql';")
  except Exception:checks.append('metadata_cleanup_failed_inspect_own_synthetic_stage')
 try:
  from backup_supervisor import stop
  stop(root);run(root,'stop','api','worker','engine','postgres')
 except Exception:checks.append('cleanup_stop_failed_inspect_own_synthetic_stage')
 report={'kind':'persisted_release_compatibility_gates','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsed_seconds':round(time.monotonic()-started,3),'environment':record['environment'],'checks':checks,'commands':commands,'limitations':['Synthetic owned database and exact prebuilt images; not a distribution archive','Checks metadata drift, runtime denial and current contract; full fenced upgrade, interrupted migration and changed-rule projection rebuild remain separate requirements','No live provider access or independent review approval']}
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
