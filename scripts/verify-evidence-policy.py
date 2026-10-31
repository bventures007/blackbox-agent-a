#!/usr/bin/env python3
"""Actual native policy API/MCP/database/restart and browser proof; host removal is separate."""
import argparse,datetime,json,pathlib,platform,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();commands=[];status='failed'
def run(*args):
 result=subprocess.run(['python3','scripts/native-dev.py',*args],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);commands.append({'command':'python3 scripts/native-dev.py '+' '.join(args),'exit_code':result.returncode,'observed':result.stdout});print(result.stdout,end='',flush=True)
 if result.returncode:raise RuntimeError('Evidence policy integration check failed')
try:
 run('exec','node','--import','tsx','tests/evidence-policy.ts','seed');run('down');run('up');run('exec','node','--import','tsx','tests/evidence-policy.ts','verify');run('exec','node','--import','tsx','tests/evidence-policy-browser.ts');status='passed'
finally:
 value={'kind':'evidence_policy_API_MCP_RLS_restart_browser','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native PostgreSQL18 development / Node / Rust / Chrome'},'commands':commands,'limitations':['Synthetic provider ceiling is host seeded, not live provider certification','Expiry uses an explicitly aged synthetic receipt; real time is not accelerated','Physical deletion, authenticated older-backup reconciliation and distribution use separate proof','No independent acceptance or full field inventory audit']};output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n')
