#!/usr/bin/env python3
"""Verify persisted inventory cohorts with actual HTTP, Rust, MCP and process recovery."""
import argparse,pathlib,subprocess,json,datetime,platform
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed'
def run(command):
 r=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':r.returncode,'observed':r.stdout});print(r.stdout,end='',flush=True)
 if r.returncode:raise RuntimeError('Inventory verification failed')
def native(*args):run(['python3','scripts/native-dev.py',*args])
def test(phase):native('exec','node','--import','tsx','tests/stock-source.ts',phase)
try:
 native('pause-worker');test('seed');native('exec','node','--import','tsx','tests/stock-browser.ts');native('down');native('up');native('pause-worker');test('verify');test('remove')
 native('down');native('up');native('pause-worker');test('verify');native('resume-worker');status='passed'
finally:
 result={'kind':'synthetic_shopify_inventory','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'runtime':'Isolated native PostgreSQL 18.4 / Node 25.9.0 / Rust 1.90.0'},'commands':records,'limitations':['No live provider, independent review, Compose distribution or performance certification','Current non-atomic inventory snapshots, not historical openings or cause-of-change events']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
