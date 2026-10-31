#!/usr/bin/env python3
"""Actual isolated host scheduling, owner browser action and interrupted-backup proof."""
import argparse,datetime,hashlib,http.client,http.cookiejar,json,os,pathlib,platform,pty,re,secrets,select,signal,subprocess,time,urllib.error,urllib.request,uuid
from backup_restore import copy_runtime_bundle
from backup_operations import enroll,services,target,run,sql
from backup_supervisor import stop as stop_supervisor
from host_runtime import protected_directory,create_file
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18761);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
token=uuid.uuid4().hex[:12];stage=ROOT/'work'/('backup-schedule-'+token);stage.mkdir(mode=0o700);copy_runtime_bundle(ROOT,stage)
base=f'http://127.0.0.1:{a.port}';client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));csrf=None;checks=[];commands=[];status='failed';started=time.monotonic();browser_result=None;crash=None
def redact(text):return re.sub(r'bb_(?:owner|agent|session|producer)_[A-Za-z0-9_-]+','[REDACTED]',text)
def command(args,interactive=False,expected=0):
 if interactive:
  master,slave=pty.openpty();process=subprocess.Popen(args,cwd=stage,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);buffer=bytearray();deadline=time.monotonic()+180
  try:
   while True:
    if time.monotonic()>deadline:process.kill();raise RuntimeError('Protected terminal command timeout')
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:chunk=os.read(master,16384)
     except OSError:break
     if not chunk:break
     buffer.extend(chunk)
     if len(buffer)>2*1024*1024:process.kill();raise RuntimeError('Protected terminal output limit')
    elif process.poll()is not None:break
   code=process.wait(timeout=10);text=buffer.decode(errors='replace')
  finally:os.close(master)
 else:
  result=subprocess.run(args,cwd=stage,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180);code=result.returncode;text=result.stdout
 commands.append({'command':' '.join(args),'exit_code':code,'observed':redact(text)})
 if code!=expected:raise RuntimeError('Host proof command failed: '+redact(text[-1500:]))
 return text
def call(path,body=None,bearer=None,no_csrf=False):
 headers={'Origin':base,'Content-Type':'application/json'}
 if csrf and not no_csrf:headers['x-blackbox-csrf']=csrf
 if bearer:headers['Authorization']='Bearer '+bearer
 request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
 try:
  with client.open(request,timeout=3)as response:return response.status,json.load(response)
 except urllib.error.HTTPError as error:return error.code,json.load(error)
def wait_api():
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  try:
   if call('/v1/status')[0]in [200,401]:return
  except (urllib.error.URLError,ConnectionError,TimeoutError,http.client.RemoteDisconnected):pass
  time.sleep(.2)
 raise RuntimeError('API readiness timeout')
def wait_status(predicate,timeout=180):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  path=stage/'.runtime/backup-status.json'
  if path.exists():
   value=json.loads(path.read_text())
   if predicate(value):return value
  time.sleep(.2)
 raise RuntimeError('Scheduled backup status timeout')
def stop_and_wait():
 stop_supervisor(stage);deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  path=stage/'.runtime/supervisor.json'
  if path.exists()and json.loads(path.read_text()).get('observed_at')is None:return
  time.sleep(.2)
 raise RuntimeError('Host supervisor did not stop')
def mark(value):checks.append(value);print(value,flush=True)
try:
 text=command(['./blackbox','setup','--port',str(a.port)],interactive=True);keys=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',text);assert len(keys)==1;owner=keys[0]
 command(['./blackbox','up']);wait_api();code,value=call('/v1/login',{'key':owner});assert code==200;csrf=value['csrf']
 assert call('/v1/backups')[1]['state']=='not_configured';assert call('/v1/backups/request',{})[0]==409
 code,sample=call('/v1/example',{});assert code==200
 code,issued=call('/v1/agents',{'name':'Synthetic backup denial probe'});assert code==200;agent=issued['key']
 assert call('/v1/backups',bearer=agent)[0]==403;assert call('/v1/backups/request',{},bearer=agent)[0]==403
 assert call('/v1/backups/request',{},no_csrf=True)[0]==403
 assert call('/v1/backups/request',{'destination':'/arbitrary','command':'not-permitted'})[0]==400
 mark('owner_only_CSRF_protected_narrow_request_denies_agents_unenrolled_and_arbitrary_parameters')
 backup_base=ROOT/'work'/('schedule-destination-'+token);backup_base.mkdir(mode=0o700)
 secret=enroll(stage,backup_base);vault=ROOT/'work/recovery-test-vault';protected_directory(vault,True);create_file(vault/('schedule-'+token+'.key'),secret);del secret
 first=wait_status(lambda value:value.get('state')=='completed');wait_api()
 code,visible=call('/v1/backups');assert code==200 and visible['configured']and visible['scheduler_alive']and visible['same_device']and not visible['overdue']
 assert visible['daily_retention']==7 and visible['weekly_retention']==4 and visible['interval_seconds']==84600
 assert 'recipient'not in visible and str(backup_base)not in json.dumps(visible)
 mark('running_host_supervisor_creates_first_real_encrypted_generation_without_login_or_recovery_secret')
 other_tenant=str(uuid.uuid4());other_principal=str(uuid.uuid4());other_key='bb_owner_'+secrets.token_urlsafe(32);other_hash=hashlib.sha256(other_key.encode()).hexdigest()
 sql(stage,f"BEGIN; INSERT INTO bb.workspaces(tenant_id,name) VALUES('{other_tenant}','Synthetic unauthorized owner workspace'); INSERT INTO bb.heads(tenant_id) VALUES('{other_tenant}'); INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES('{other_tenant}',gen_random_uuid(),'{other_principal}','owner','{other_hash}','Synthetic backup isolation'); COMMIT;")
 code,value=call('/v1/login',{'key':other_key});assert code==200;csrf=value['csrf']
 code,other_status=call('/v1/backups');assert code==200 and other_status['state']=='unknown'and 'last_completed'not in other_status
 assert call('/v1/backups/request',{})[0]==409
 code,value=call('/v1/login',{'key':owner});assert code==200;csrf=value['csrf']
 mark('second_workspace_owner_cannot_read_installation_backup_metadata_or_request_host_backup')
 result=subprocess.run(['node','--import','tsx','tests/backup-ui.ts'],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':base,'TEST_RUNTIME_DIR':str(stage/'.runtime'),'TEST_OWNER_KEY':owner},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=210)
 commands.append({'command':'node --import tsx tests/backup-ui.ts [protected test environment]','exit_code':result.returncode,'observed':redact(result.stdout+result.stderr)})
 if result.returncode:raise RuntimeError('Actual backup browser proof failed')
 browser_result=json.loads(result.stdout);assert browser_result['status']=='passed'
 second=wait_status(lambda value:value.get('state')=='completed'and value.get('generation')!=first['generation'])
 config=json.loads((stage/'.runtime/backup.json').read_text());managed=target(config)
 assert not(managed/first['generation']).exists()and(managed/second['generation']).is_file()
 mark('actual_EN_DE_browser_action_creates_new_generation_then_retention_removes_superseded_same_day_generation')
 held=backup_base.with_name(backup_base.name+'-disconnected');backup_base.rename(held);backup_base.mkdir()
 try:
  assert call('/v1/backups/request',{})[0]==200
  failed=wait_status(lambda value:value.get('state')=='failed')
  assert failed['generation']==second['generation']and failed['last_completed']==second['last_completed']
  assert not list(backup_base.iterdir());assert(held/config['directory']/second['generation']).is_file()
  assert call('/v1/backups')[1]['destination_available']is False
 finally:backup_base.rmdir();held.rename(backup_base)
 mark('unmounted_destination_failure_preserves_last_success_and_never_uses_empty_mountpoint')
 assert call('/v1/backups/request',{})[0]==200
 third=wait_status(lambda value:value.get('state')=='completed'and value.get('generation')!=second['generation']);wait_api()
 stop_and_wait();prior=set(services(stage))
 # Kill the actual backup wrapper and its own subprocess group after its durable fence.
 crash=subprocess.Popen(['./blackbox','backup'],cwd=stage,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  marker=stage/'.runtime/maintenance.json'
  if marker.exists()and json.loads(marker.read_text()).get('phase')=='fenced':break
  if crash.poll()is not None:raise RuntimeError('Backup finished before interruption point')
  time.sleep(.02)
 else:raise RuntimeError('Backup fence timeout')
 os.killpg(crash.pid,signal.SIGKILL);assert crash.wait(timeout=10)==-signal.SIGKILL
 command(['./blackbox','up'],expected=1)
 command(['./blackbox','backup','recover']);wait_api();assert set(services(stage))==prior
 assert not(stage/'.runtime/maintenance.json').exists()
 recovered=json.loads((stage/'.runtime/backup-status.json').read_text());assert recovered['state']=='failed'and recovered['generation']==third['generation']
 assert(managed/third['generation']).is_file()
 code,answer=call('/v1/tools/get_business_state',{'entity_id':sample['entity_id']});assert code==200 and answer['result']['captured_minor']==11900 and answer['result']['refunded_minor']==2380
 mark('actual_host_backup_process_kill_blocks_start_until_explicit_recovery_and_preserves_answer_and_last_backup')
 command(['./blackbox','up']);wait_api()
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  if call('/v1/backups')[1]['scheduler_alive']:break
  time.sleep(.2)
 else:raise RuntimeError('Supervisor restart not visible')
 status='passed'
finally:
 if crash and crash.poll()is None:os.killpg(crash.pid,signal.SIGKILL);crash.wait()
 try:stop_supervisor(stage);run(stage,'stop','api','worker','engine','postgres')
 except Exception:checks.append('cleanup_stop_failed_inspect_this_isolated_project')
 report={'kind':'persisted_backup_schedule_owner_UI_retention_and_interruption','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(ROOT)),'port':a.port,'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'machine_seconds':round(time.monotonic()-started,3),'checks':checks,'commands':commands,'browser':browser_result,'limitations':['Short synthetic execution; multi-day scheduling/wake and calendar retention boundaries additionally use deterministic unit tests','Not actual Mac sleep/wake, 250-MiB recovery, upgrade, key rotation, policy reconciliation or independent approval','Same-machine copied runtime with prebuilt development images; not a downloaded distribution artifact']}
 out=ROOT/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='commands'}),flush=True)
