#!/usr/bin/env python3
"""Real native worker/Rust/API/MCP/owner review/restart proof, using synthetic data."""
import argparse,datetime,json,pathlib,platform,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];records=[];status='failed';started=time.monotonic()
def run(*args):
 command=['python3','scripts/native-dev.py',*args];v=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 records.append({'command':' '.join(command),'exit_code':v.returncode,'observed':v.stdout});print(v.stdout,end='',flush=True)
 if v.returncode:raise RuntimeError('Derivation verification failed; no pass claimed.')
def test(phase):run('exec','node','--import','tsx','tests/derivation.ts',phase)
try:
 run('resume-worker');test('seed');run('pause-worker');test('prepare-retry');run('down');run('up');test('verify');run('down');run('up');test('cold');test('browser');status='passed'
finally:
 subprocess.run(['python3','scripts/native-dev.py','resume-worker'],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 report={'kind':'bounded_derivation_recovery','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'postgres':18,'ports':[19741,19742,19743]},'commands':records,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Synthetic persisted unsupported kinds/datasets; current database rejects future schema versions before journal acceptance, separate Rust/SQL admission checks reject them too','Transient failures call the real handler as bb_worker and deliberately advance only the synthetic next_at schedule; not a timed four-minute outage','Simulated pre-reader applied cursor/projection; no journal mutation','Actual orderly process restart; not SIGKILL or physical Mac sleep','No smoke performance, distribution, provider or independent review claim']};out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
