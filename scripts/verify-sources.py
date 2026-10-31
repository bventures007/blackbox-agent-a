#!/usr/bin/env python3
"""Actual synthetic HTTP, PostgreSQL, Rust, browser, MCP and restart source verification."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Source verification failed')
def native(*cmd):run(['python3','scripts/native-dev.py',*cmd])
def test(name):native('exec','node','--import','tsx','tests/'+name+'.ts')
try:
 native('pause-worker');test('source-operations');native('down');native('up');native('pause-worker')
 test('source-recovery');test('source-conflicts');test('source-browser');native('resume-worker');test('source-auto');status='passed'
finally:
 result={'kind':'synthetic_source_operations','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native Postgres.app 18.4 / Node 25.9.0 / Rust 1.90.0 / Chrome 156'},'commands':records,'limitations':['Synthetic provider fixtures, not authorized live merchant coverage','Current source flow covers orders/payments/refunds; other selected Shopify capabilities remain in implementation','No independent review, full source-health acceptance, distribution or performance certification']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
