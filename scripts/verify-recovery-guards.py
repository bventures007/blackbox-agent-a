#!/usr/bin/env python3
"""Persisted guard subset; requires the synthetic first-slice fixture."""
import argparse,datetime,json,pathlib,platform,subprocess
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(args):
 r=subprocess.run(args,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);records.append({'command':' '.join(args),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Recovery guard verification failed')
try:
 run(['python3','scripts/native-dev.py','pause-worker'])
 run(['python3','scripts/native-dev.py','exec','node','--import','tsx','tests/recovery-guards.ts']);status='passed'
finally:
 try:run(['python3','scripts/native-dev.py','resume-worker'])
 finally:
  output={'kind':'persisted_recovery_guards','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native PostgreSQL18.4, Node25.9; actual worker/API non-owner database roles'},'commands':records,'limitations':['Recovery guard subset; full encrypted database restore not yet proved','No independent review or PILOT/OPS acceptance approval']}
  path=root/a.output;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(output,indent=2)+'\n')
