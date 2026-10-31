#!/usr/bin/env python3
"""Fresh-directory host/Compose proof. Not a browser-download or release-package gate."""
import argparse,datetime,hashlib,http.cookiejar,json,os,pathlib,platform,pty,re,select,shutil,subprocess,time,urllib.error,urllib.request,uuid
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18751);p.add_argument('--node-image-commit',default='unrecorded');p.add_argument('--engine-image-commit',default='unrecorded');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
stage=root/'work'/('bootstrap-'+uuid.uuid4().hex[:12]);stage.mkdir(parents=True)
for name in ['blackbox','scripts/host_runtime.py','scripts/backup_operations.py','scripts/backup_codec.py','scripts/backup_restore.py','scripts/diagnostics.py','infra/compose/compose.yaml','infra/compose/init.sh']:
 target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,target)
shutil.copytree(root/'packages/database/migrations',stage/'packages/database/migrations')
base=f'http://127.0.0.1:{a.port}';checks=[];commands=[];status='failed';started=time.monotonic()

def redact(text):return re.sub(r'bb_(?:owner|agent|session|producer)_[A-Za-z0-9_-]+','[REDACTED]',text)
def command(args,expect=0,interactive=False):
 if interactive:
  master,slave=pty.openpty();proc=subprocess.Popen(args,cwd=stage,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);buffer=bytearray();deadline=time.monotonic()+180
  try:
   while True:
    if time.monotonic()>deadline:
     proc.kill();raise RuntimeError('Interactive host command timed out')
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:chunk=os.read(master,16384)
     except OSError:break
     if not chunk:break
     buffer.extend(chunk)
     if len(buffer)>2*1024*1024:proc.kill();raise RuntimeError('Host command output budget exceeded')
    elif proc.poll()is not None:break
   code=proc.wait(timeout=10);out=buffer.decode(errors='replace')
  finally:os.close(master)
 else:
  r=subprocess.run(args,cwd=stage,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180);code=r.returncode;out=r.stdout
 commands.append({'command':' '.join(args),'exit_code':code,'observed':redact(out)})
 if code!=expect:raise RuntimeError(f'Host command failed (exit {code}): '+redact(out[-1200:]))
 return out

def compose(*args):return ['docker','compose','--env-file','.runtime/compose.env','-f','infra/compose/compose.yaml',*args]
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));csrf=None

def call(path,body=None):
 headers={'Origin':base,'Content-Type':'application/json'}
 if csrf:headers['x-blackbox-csrf']=csrf
 req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
 try:
  with client.open(req,timeout=5)as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)

def login(key):
 global csrf
 code,value=call('/v1/login',{'key':key,'remember':True});assert code==200;csrf=value['csrf']

def state(entity):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  code,value=call('/v1/tools/get_business_state',{'entity_id':entity})
  if code==200:return value
  assert code==503 and value.get('error')=='projection_behind',(code,value.get('error'))
  time.sleep(.1)
 raise RuntimeError('Projection did not catch up')

def ready():
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  try:
   code,_=call('/v1/status')
   if code in [200,401]:return
  except (urllib.error.URLError,ConnectionError,TimeoutError):pass
  time.sleep(.2)
 raise RuntimeError('Fresh application did not become ready')

try:
 command(['./blackbox','up'],expect=1)
 assert not (stage/'.runtime/compose.env').exists();checks.append('ordinary_start_never_creates_configuration')
 output=command(['./blackbox','setup','--port',str(a.port)],interactive=True)
 keys=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',output);assert len(keys)==1;owner=keys[0]
 files={name:(stage/'.runtime'/name).read_bytes()for name in ['compose.env','secrets/data','secrets/internal']}
 command(['./blackbox','up']);ready();login(owner)
 code,sample=call('/v1/example',{});assert code==200 and sample['synthetic']
 before=state(sample['entity_id']);assert before['result']['captured_minor']==11900 and before['result']['refunded_minor']==2380
 checks.append('fresh_host_setup_login_and_persisted_example');print(checks[-1],flush=True)
 second=command(['./blackbox','setup'],interactive=True);assert 'Already initialized' in second and not re.findall(r'bb_owner_[A-Za-z0-9_-]+',second)
 assert all((stage/'.runtime'/name).read_bytes()==value for name,value in files.items())
 checks.append('repeated_setup_preserves_credentials_and_business_data')
 command(['./blackbox','down']);command(['./blackbox','up']);ready()
 assert state(sample['entity_id'])['result']==before['result'];checks.append('normal_stop_start_preserves_session_and_answer')
 key=stage/'.runtime/secrets/data';held=stage/'.runtime/secrets/data-suspended';key.rename(held)
 try:
  failed=command(['./blackbox','up'],expect=1);assert 'no replacement generated' in failed;assert not key.exists()
  command(['./blackbox','status']);command(['./blackbox','down'])
 finally:held.rename(key)
 command(['./blackbox','up']);ready();assert state(sample['entity_id'])['result']==before['result']
 checks.append('lost_key_fails_closed_stop_available_original_restore_recovers')
 reset=command(['./blackbox','reset-access'],interactive=True);fresh=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',reset);assert len(fresh)==1 and fresh[0]!=owner
 assert call('/v1/status')[0]==401;assert call('/v1/login',{'key':owner})[0]==401
 login(fresh[0]);assert state(sample['entity_id'])['result']==before['result']
 counts=command(compose('exec','-T','postgres','psql','-U','blackbox_migrate','-d','blackbox','-Atc',"SELECT (SELECT count(*) FROM bb.workspaces),(SELECT count(*) FROM bb.credentials WHERE purpose='owner' AND revoked_at IS NULL),(SELECT count(*) FROM bb.journal)"))
 workspace,owners,journal=map(int,counts.strip().split('|'));assert workspace==owners==1 and journal>0
 checks.append('host_reset_revokes_old_owner_session_preserves_single_owner_and_journal')
 status='passed';print('fresh_bootstrap_checks_passed',flush=True)
finally:
 try:command(['./blackbox','down'])
 except Exception:checks.append('cleanup_stop_failed_inspect_isolated_project')
 result={'kind':'fresh_directory_host_bootstrap','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'machine_seconds':round(time.monotonic()-started,3),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(root)),'port':a.port,'images':{'node':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip(),'engine':subprocess.check_output(['docker','image','inspect','blackbox-a-engine:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit},'checks':checks,'commands':commands,'limitations':['Fresh isolated directory on the same actual Apple Silicon Mac; not a second physical machine','Copied wrapper/config and existing prebuilt development images; not a versioned downloaded archive or DIST proof','No backup/key-rotation/upgrade/performance certification or independent review']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
