#!/usr/bin/env python3
"""Run actual owner repair, retained-input retry, browser and persisted recovery checks."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Owner review verification failed')
def native(*cmd):run(['python3','scripts/native-dev.py',*cmd])
def test(phase):native('exec','node','--import','tsx','tests/reviews.ts',phase)
try:
 native('pause-worker');native('exec','node','--import','tsx','tests/review-operations.ts');test('seed')
 native('down');native('up');native('pause-worker');test('verify');test('remove')
 native('down');native('up');native('pause-worker');test('verify');native('resume-worker');status='passed'
finally:
 result={'kind':'synthetic_owner_review','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native Postgres.app 18.4 / Node 25.9.0 / Rust 1.90.0 / Chrome 156'},'commands':records,'limitations':['Synthetic evidence, not live merchant incidents','Prior parser failure injected as retained encrypted quarantine to test current reprocessing','Lifecycle/failed-derivation review and remaining operational requirements are separate unfinished work','No independent review, installation or performance certification']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
