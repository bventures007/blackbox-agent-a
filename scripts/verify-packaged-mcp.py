#!/usr/bin/env python3
"""Actual SDK -> host wrapper -> least-privilege container -> API/Rust proof."""
import argparse,datetime,http.client,json,os,pathlib,platform,pty,re,select,shutil,subprocess,sys,time,urllib.error,urllib.request,uuid
from backup_restore import copy_runtime_bundle
from backup_operations import run
from backup_supervisor import stop as stop_supervisor
from host_runtime import read_compose
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18763);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
stage=ROOT/'work'/('mcp-bridge-'+uuid.uuid4().hex[:12]);stage.mkdir(mode=0o700);copy_runtime_bundle(ROOT,stage)
status='failed';records=[];sdk=None
def redact(value):return re.sub(r'bb_(?:owner|agent|session|producer)_[A-Za-z0-9_-]+','[REDACTED]',value)
def command(args,interactive=False):
 if interactive:
  master,slave=pty.openpty();process=subprocess.Popen(args,cwd=stage,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);buffer=bytearray();deadline=time.monotonic()+180
  try:
   while True:
    if time.monotonic()>deadline:process.kill();raise RuntimeError('Protected setup timeout')
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:value=os.read(master,16384)
     except OSError:break
     if not value:break
     buffer.extend(value)
     if len(buffer)>2*1024*1024:process.kill();raise RuntimeError('Setup output budget exceeded')
    elif process.poll()is not None:break
   code=process.wait(timeout=10);output=buffer.decode(errors='replace')
  finally:os.close(master)
 else:
  result=subprocess.run(args,cwd=stage,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180);code=result.returncode;output=result.stdout
 records.append({'command':' '.join(args),'exit_code':code,'observed':redact(output)})
 if code:raise RuntimeError('Test host command failed: '+redact(output[-1500:]))
 return output
try:
 output=command(['./blackbox','setup','--port',str(a.port)],interactive=True);keys=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',output);assert len(keys)==1
 command(['./blackbox','up']);deadline=time.monotonic()+60;base=f'http://127.0.0.1:{a.port}'
 while time.monotonic()<deadline:
  try:
   with urllib.request.urlopen(base,timeout=2)as response:
    if response.status==200:break
  except (urllib.error.URLError,ConnectionError,TimeoutError,http.client.RemoteDisconnected):pass
  time.sleep(.2)
 else:raise RuntimeError('Fresh MCP backend readiness timeout')
 config=read_compose(stage/'.runtime')
 shim=stage/'.runtime/client-path';shim.mkdir(mode=0o700)
 (shim/'python3').symlink_to(sys.executable);(shim/'docker').symlink_to(shutil.which('docker'))
 assert not(shim/'node').exists()and not(shim/'rustc').exists()and not(shim/'cargo').exists()
 result=subprocess.run(['node','--import','tsx','tests/packaged-mcp.ts'],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':base,'TEST_OWNER_KEY':keys[0],'TEST_STAGE':str(stage),'TEST_PROJECT':config['BB_PROJECT'],'TEST_BRIDGE_PATH':str(shim)},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
 records.append({'command':'node --import tsx tests/packaged-mcp.ts [protected synthetic test environment]','exit_code':result.returncode,'observed':redact(result.stdout+result.stderr)})
 if result.returncode:raise RuntimeError('Packaged actual SDK MCP verification failed')
 sdk=json.loads(result.stdout);assert sdk['status']=='passed';status='passed'
finally:
 try:stop_supervisor(stage);run(stage,'stop','api','worker','engine','postgres')
 except Exception:records.append({'cleanup':'failed; inspect this isolated test project'})
 report={'kind':'actual_packaged_readonly_MCP_client','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(ROOT)),'port':a.port,'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip(),'client':'Actual MCP TypeScript SDK1.32.2 stdio Client','bridge_host_PATH':'Only Python3 and Docker; no Node/Rust tools available on bridge PATH'},'commands':records,'sdk':sdk,'limitations':['Same physical Mac, fresh synthetic isolated copied runtime with prebuilt development images','Host Node runs only the independent SDK test client; this is not a clean-Mac or browser-downloaded distribution proof','No third-party model wording, live provider access, full performance/operations gate or independent reviewer approval']}
 path=ROOT/a.output;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
