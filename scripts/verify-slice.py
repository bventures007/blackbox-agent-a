#!/usr/bin/env python3
"""Repeatable synthetic P1 proof. Does not claim live-provider or release acceptance."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--native',action='store_true');p.add_argument('--output');args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
records=[]
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout})
 print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Verification failed: '+' '.join(command))
def native(*cmd):run(['python3','scripts/native-dev.py',*cmd])
def compose(*cmd):run(['docker','compose','--env-file','.runtime/compose.env','-f','infra/compose/compose.yaml',*cmd])
def test(phase):native('test',phase)if args.native else compose('run','--rm','tooling','node','--import','tsx','tests/slice.ts',phase)
def restart():
 if args.native:native('down');native('up')
 else:compose('restart','postgres','engine','api','worker')
status='failed'
try:
 run(['node','--import','tsx','--test','tests/contracts.test.ts'])
 test('seed');restart();test('verify')
 for phase in ['corrupt','remove']:test(phase);restart();test('verify')
 if args.native:
  native('pause-worker')
  try:test('lag')
  finally:native('resume-worker')
 else:
  compose('pause','worker')
  try:test('lag')
  finally:compose('unpause','worker')
 test('correction');status='passed'
finally:
 report={'schema_version':1,'kind':'synthetic_first_persisted_slice','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'native Postgres.app 18.4, Node 25.9.0, Rust 1.90.0'if args.native else 'Docker Compose pinned PostgreSQL 17, Node 24, Rust 1.90.0'},'limitations':['Synthetic HTTP source; no authorized Shopify store','P1 payment subset; not full Golden/24-question coverage','No independent review or release claim'],'commands':records}
 if args.output:
  output=root/args.output;output.parent.mkdir(exist_ok=True,parents=True);output.write_text(json.dumps(report,indent=2)+'\n')
