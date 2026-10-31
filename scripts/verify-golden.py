#!/usr/bin/env python3
"""Real signed replay producer -> journal/Rust/API/MCP Golden verification, native developer runtime."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Golden verification failed')
def native(*cmd):run(['python3','scripts/native-dev.py',*cmd])
def test(phase):native('exec','node','--import','tsx','tests/golden.ts',phase)
try:
 test('seed');native('down');native('up');test('verify')
 for phase in ['corrupt','remove','remove']:test(phase);native('down');native('up');test('verify')
 status='passed'
finally:
 report={'kind':'synthetic_golden_persisted','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Native Postgres.app 18.4 / Node 25.9.0 / Rust 1.90.0; isolated loopback developer stack'},'commands':records,'limitations':['Synthetic producer, not merchant evidence','No full question/coverage/performance certification','Native developer path, not Compose installation certification']}
 path=root/args.output;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n')
