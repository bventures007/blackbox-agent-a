#!/usr/bin/env python3
"""Reproduce persisted 24-intent positive/missing/variation and fixed-cutoff cold recovery."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Question verification failed')
def native(*cmd):run(['python3','scripts/native-dev.py',*cmd])
def test(phase):native('exec','node','--import','tsx','tests/questions/pipeline.ts',phase)
try:
 test('seed');native('down');native('up');test('verify')
 for phase in ['corrupt','remove']:test(phase);native('down');native('up');test('verify')
 test('security');status='passed'
finally:
 result={'kind':'synthetic_all_24_questions','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native Postgres.app 18.4 / Node 25.9.0 / Rust 1.90.0'},'commands':records,'limitations':['Synthetic declared supplemental source scope, not merchant/provider coverage','No independent review or performance certification','UI and complete source lifecycle remain separate gates']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
