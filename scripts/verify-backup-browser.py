#!/usr/bin/env python3
"""Focused UI follow-up using only a previously created synthetic backup stage."""
import argparse,datetime,json,os,pathlib,platform,pty,re,select,subprocess,time,urllib.request,urllib.error,http.client
from backup_operations import run,sql
from backup_supervisor import stop as stop_supervisor
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--stage',required=True);p.add_argument('--output',required=True);p.add_argument('--node-image-commit',required=True);p.add_argument('--host-source-commit',required=True);a=p.parse_args()
stage=(ROOT/a.stage).resolve()
if stage.parent!=ROOT/'work'or not re.fullmatch(r'backup-schedule-[a-f0-9]{12}',stage.name):raise SystemExit('Use this repository’s existing synthetic backup workflow stage.')
status='failed';records=[];browser=None
def redact(value):return re.sub(r'bb_(?:owner|agent|session|producer)_[A-Za-z0-9_-]+','[REDACTED]',value)
def command(args,interactive=False):
 if interactive:
  master,slave=pty.openpty();process=subprocess.Popen(args,cwd=stage,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);buffer=bytearray();deadline=time.monotonic()+180
  try:
   while True:
    if time.monotonic()>deadline:process.kill();raise RuntimeError('Protected terminal timeout')
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:value=os.read(master,16384)
     except OSError:break
     if not value:break
     buffer.extend(value)
     if len(buffer)>2*1024*1024:process.kill();raise RuntimeError('Protected output limit')
    elif process.poll()is not None:break
   code=process.wait(timeout=10);output=buffer.decode(errors='replace')
  finally:os.close(master)
 else:
  result=subprocess.run(args,cwd=stage,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180);code=result.returncode;output=result.stdout
 records.append({'command':' '.join(args),'exit_code':code,'observed':redact(output)})
 if code:raise RuntimeError('Host test command failed: '+redact(output[-1500:]))
 return output
try:
 run(stage,'up','-d','postgres')
 assert sql(stage,"SELECT count(*) FROM bb.connections WHERE provider IS DISTINCT FROM 'replay' OR config->>'example' IS DISTINCT FROM 'golden-v1';").strip()==b'0'
 reset=command(['./blackbox','reset-access'],interactive=True);keys=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',reset);assert len(keys)==1
 command(['./blackbox','up']);stop_supervisor(stage);deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  if json.loads((stage/'.runtime/supervisor.json').read_text()).get('observed_at')is None:break
  time.sleep(.2)
 else:raise RuntimeError('Test supervisor stop timeout')
 command(['./blackbox','backup']);command(['./blackbox','up'])
 envtext=(stage/'.runtime/compose.env').read_text();port=re.search(r'^BB_PORT=(\d+)$',envtext,re.M)[1]
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+port,timeout=2)as response:
    if response.status==200:break
  except (urllib.error.URLError,ConnectionError,TimeoutError,http.client.RemoteDisconnected):pass
  time.sleep(.2)
 else:raise RuntimeError('Browser target readiness timeout')
 result=subprocess.run(['node','--import','tsx','tests/backup-ui.ts'],cwd=ROOT,env={**os.environ,'TEST_OWNER_KEY':keys[0],'TEST_RUNTIME_DIR':str(stage/'.runtime'),'BLACKBOX_API_URL':'http://127.0.0.1:'+port},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=210)
 records.append({'command':'node --import tsx tests/backup-ui.ts [protected test environment]','exit_code':result.returncode,'observed':redact(result.stdout+result.stderr)})
 if result.returncode:raise RuntimeError('Actual focused browser verification failed')
 browser=json.loads(result.stdout);assert browser['status']=='passed';status='passed'
finally:
 try:stop_supervisor(stage);run(stage,'stop','api','worker','engine','postgres')
 except Exception:records.append({'cleanup':'failed; inspect this isolated project'})
 report={'kind':'focused_backup_EN_DE_browser_after_reconnection','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(ROOT)),'node_image_source_commit':a.node_image_commit,'host_runtime_source_commit':a.host_source_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'commands':records,'browser':browser,'limitations':['Focused visual/owner-browser request regression; broader operations proof remains at its separately recorded commit','Existing synthetic same-Mac isolated stage; not a downloaded artifact or independent review']}
 path=ROOT/a.output;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
