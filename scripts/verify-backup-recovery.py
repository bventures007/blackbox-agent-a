#!/usr/bin/env python3
"""Destructive ONLY to this run's freshly created synthetic installation.

Proves recovery without the original installation/volume/data key. This small
fixture is not the pilot smoke-corpus recovery-time or distribution gate.
"""
import argparse,datetime,hashlib,http.client,http.cookiejar,json,os,pathlib,platform,pty,re,select,shutil,subprocess,time,urllib.error,urllib.request,uuid
from backup_operations import enroll,generation,target,services,compose,sql,run,cutoffs
from backup_restore import restore,verified_backup
from backup_codec import new_recovery,BackupFormatError
from host_runtime import RuntimeConfigError,compose_config,protected_directory,create_file,read_keyring,key_filename
from backup_supervisor import stop as stop_supervisor

ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--rotate-data-key',action='store_true');p.add_argument('--source-port',type=int,default=18759);p.add_argument('--restore-port',type=int,default=18757);p.add_argument('--node-image-commit',required=True);p.add_argument('--engine-image-commit',required=True);a=p.parse_args()
token=uuid.uuid4().hex[:12];bootstrap=ROOT/'.runtime'/('recovery-bootstrap-'+token+'.json');destination=ROOT/'work'/('recovered-'+token)
rotation_proof=None;status='failed';checks=[];commands=[];source=None;removed=False;answer=None;restore_result=None;generation_result=None;evidence_count=None;recovery_elapsed=None;bootstrap_elapsed=None;operator_wait=0.;started=time.monotonic()

def redact(value):return re.sub(r'bb_(?:owner|agent|session|producer)_[A-Za-z0-9_-]+','[REDACTED]',value)

def command(directory,args,interactive=False,timeout=180,expect=0):
 if interactive:
  master,slave=pty.openpty();process=subprocess.Popen(args,cwd=directory,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);buffer=bytearray();deadline=time.monotonic()+timeout
  try:
   while True:
    if time.monotonic()>deadline:process.kill();raise RuntimeError('Protected terminal command timed out')
    ready,_,_=select.select([master],[],[],.2)
    if ready:
     try:chunk=os.read(master,16384)
     except OSError:break
     if not chunk:break
     buffer.extend(chunk)
     if len(buffer)>2*1024*1024:process.kill();raise RuntimeError('Protected terminal output budget exceeded')
    elif process.poll()is not None:break
   code=process.wait(timeout=10);output=buffer.decode(errors='replace')
  finally:os.close(master)
 else:
  result=subprocess.run(args,cwd=directory,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout);code=result.returncode;output=result.stdout
 commands.append({'command':redact(' '.join(args)),'exit_code':code,'observed':redact(output)})
 if code!=expect:raise RuntimeError('Test command failed: '+redact(output[-1600:]))
 return output

def owner_from(output):
 keys=re.findall(r'bb_owner_[A-Za-z0-9_-]{43}',output);assert len(keys)==1
 return keys[0]

class API:
 def __init__(self,port):
  self.base=f'http://127.0.0.1:{port}';self.jar=http.cookiejar.CookieJar();self.client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar));self.csrf=None
 def call(self,path,body=None,bearer=None,cookie=None):
  headers={'Origin':self.base,'Content-Type':'application/json'}
  if self.csrf:headers['x-blackbox-csrf']=self.csrf
  if bearer:headers['Authorization']='Bearer '+bearer
  if cookie:headers['Cookie']=cookie
  request=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
  try:
   with self.client.open(request,timeout=5)as response:return response.status,json.load(response)
  except urllib.error.HTTPError as error:return error.code,json.load(error)
 def login(self,key):
  code,value=self.call('/v1/login',{'key':key,'remember':True});assert code==200;self.csrf=value['csrf']
 def ready(self):
  deadline=time.monotonic()+60
  while time.monotonic()<deadline:
   try:
    if self.call('/v1/status')[0]in [200,401]:return
   except (urllib.error.URLError,ConnectionError,TimeoutError,http.client.RemoteDisconnected):pass
   time.sleep(.2)
  raise RuntimeError('Application readiness timeout')
 def state(self,arguments):
  deadline=time.monotonic()+20
  while time.monotonic()<deadline:
   code,value=self.call('/v1/tools/get_business_state',arguments)
   if code==200:return value
   assert code==503 and value.get('error')=='projection_behind',(code,value.get('error'));time.sleep(.1)
  raise RuntimeError('Projection catch-up timeout')

def mcp(port,key,arguments):
 script='''import {Client} from "@modelcontextprotocol/sdk/client/index.js";import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
const client=new Client({name:"isolated-recovery-proof",version:"1"});await client.connect(new StdioClientTransport({command:"node",args:["--import","tsx","packages/mcp/main.ts"],env:process.env}));try{const r=await client.callTool({name:"get_business_state",arguments:JSON.parse(process.env.TEST_ARGUMENTS)});if(r.isError)throw Error("mcp_recovery_query_failed");process.stdout.write(r.content[0].text);}finally{await client.close();}'''
 result=subprocess.run(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':f'http://127.0.0.1:{port}','PUBLIC_PORT':str(port),'BLACKBOX_AGENT_KEY':key,'TEST_ARGUMENTS':json.dumps(arguments)},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
 if result.returncode:raise RuntimeError('Actual SDK MCP recovery request failed')
 return json.loads(result.stdout)

def mark(name):checks.append(name);print(name,flush=True)

try:
 command(ROOT,['python3','scripts/verify-bootstrap.py','--port',str(a.source_port),'--node-image-commit',a.node_image_commit,'--engine-image-commit',a.engine_image_commit,'--output',str(bootstrap)],timeout=240)
 boot=json.loads(bootstrap.read_text());assert boot['status']=='passed'
 source=ROOT/boot['environment']['stage'];bootstrap_elapsed=boot['machine_seconds']
 assert source.parent==ROOT/'work' and re.fullmatch(r'bootstrap-[a-f0-9]{12}',source.name)
 # The copied runtime receives only public host tools; recovery material goes to a separate test vault.
 (source/'vendor').mkdir(exist_ok=True);shutil.copy2(ROOT/'vendor/age.lock.json',source/'vendor/age.lock.json');shutil.copytree(ROOT/'.tools/age',source/'bin')
 old_owner=owner_from(command(source,['./blackbox','reset-access'],interactive=True))
 command(source,['./blackbox','up']);api=API(a.source_port);api.ready();api.login(old_owner)
 entity=sql(source,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip()
 snapshot=cutoffs(source);assert len(snapshot['heads'])==1
 arguments={'entity_id':entity,'recorded_cutoff':int(snapshot['heads'][0]['committed']),'effective_at':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}
 answer=api.state(arguments);assert answer['result']['captured_minor']==11900 and answer['result']['refunded_minor']==2380
 code,issued=api.call('/v1/agents',{'name':'Synthetic original recovery proof'});assert code==200;old_agent=issued['key']
 old_cookie='; '.join(cookie.name+'='+cookie.value for cookie in api.jar)
 assert mcp(a.source_port,old_agent,arguments)['result']==answer['result']
 evidence_id=answer['result']['evidence'][0]
 code,evidence=api.call('/v1/tools/get_evidence',{'evidence_id':evidence_id});assert code==200 and evidence.get('status')!='unavailable'
 mark('saved_fixed_cutoff_API_and_actual_SDK_MCP_match_before_backup')
 # This proof drives generations directly; the scheduler has its own actual workflow suite.
 stop_supervisor(source);deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  supervisor=source/'.runtime/supervisor.json'
  if supervisor.exists()and json.loads(supervisor.read_text()).get('observed_at')is None:break
  time.sleep(.2)
 else:raise RuntimeError('Test supervisor did not stop')
 backup_base=ROOT/'work'/('recovery-backups-'+token);backup_base.mkdir(mode=0o700)
 secret=enroll(source,backup_base);vault=ROOT/'work/recovery-test-vault';protected_directory(vault,True);keyfile=vault/('recovery-'+token+'.key');create_file(keyfile,secret)
 managed=target(json.loads((source/'.runtime/backup.json').read_text()))
 primary_tenant=snapshot['heads'][0]['tenant_id']
 if a.rotate_data_key:
  from verify_rotation_workflow import workflow
  rotation_proof=workflow(ROOT,source,secret,api,arguments,command,mark,token);snapshot=cutoffs(source)
  assert mcp(a.source_port,old_agent,arguments)['result']==answer['result'];mark('existing_agent_SDK_MCP_preserves_full_fixed_cutoff_answer_after_data_key_rotation')
 prior_generations=set(managed.glob('*.bb.age'))
 # Wrong live key and corrupted retained evidence must prevent publication.
 run(source,'stop','api','worker','engine');prior=services(source)
 ring=read_keyring(source/'.runtime');keyname=key_filename(ring['active'])if ring else 'data';keypath=source/'.runtime/secrets'/keyname;correct_key=keypath.read_bytes();key_hash=hashlib.sha256(correct_key).hexdigest();internal_hash=hashlib.sha256((source/'.runtime/secrets/internal').read_bytes()).hexdigest()
 tenant=primary_tenant;blob=source/'.runtime/evidence'/tenant/evidence_id;original_blob=blob.read_bytes()
 provider_secret=None
 if a.rotate_data_key:
  provider_secret=json.loads(sql(source,"SELECT json_build_object('tenant',tenant_id,'connection',connection_id,'sealed',sealed) FROM bb.source_secrets ORDER BY tenant_id,connection_id LIMIT 1;"))
 for kind in ['wrong_data_key','tampered_retained_evidence']+(['tampered_provider_credential']if a.rotate_data_key else []):
  if kind=='wrong_data_key':keypath.write_bytes(os.urandom(32))
  elif kind=='tampered_retained_evidence':blob.write_bytes(original_blob[:-1]+bytes([original_blob[-1]^1]))
  else:sql(source,"UPDATE bb.source_secrets SET sealed=jsonb_set(sealed,'{tag}','\"AAAAAAAAAAAAAAAAAAAAAA==\"') WHERE tenant_id='"+provider_secret['tenant']+"' AND connection_id='"+provider_secret['connection']+"';")
  try:
   try:generation(source);raise AssertionError('Invalid evidence material accepted')
   except RuntimeConfigError:pass
   assert set(managed.glob('*.bb.age'))==prior_generations and services(source)==prior
   assert json.loads((source/'.runtime/backup-status.json').read_text())['state']=='failed'
  finally:
   keypath.write_bytes(correct_key);blob.write_bytes(original_blob)
   if provider_secret:sql(source,"UPDATE bb.source_secrets SET sealed='"+json.dumps(provider_secret['sealed']).replace("'","''")+"'::jsonb WHERE tenant_id='"+provider_secret['tenant']+"' AND connection_id='"+provider_secret['connection']+"';")
  mark(kind+'_prevents_backup_publication')
 del correct_key,original_blob
 run(source,'up','-d','postgres','engine','api','worker');api.ready();prior=services(source)
 generation_result=generation(source);cipher=managed/generation_result['generation'];assert services(source)==prior
 with verified_backup(ROOT,cipher,secret)as(_,manifest,_,digest):
  assert manifest['metadata']['snapshot']==snapshot and manifest['metadata']['compatibility']['schema']==6
  evidence_count=sum(name.startswith('evidence/')for name in manifest['members']);assert evidence_count>0
 assert digest==generation_result['ciphertext_sha256'];mark('coherent_backup_verifies_all_retained_evidence_and_preserves_running_services')
 # Both failures must occur before creating a destination or any Docker resources.
 wrong,_=new_recovery(ROOT)
 for kind in ['wrong_recovery_key','tampered_ciphertext']:
  failed_target=ROOT/'work'/('rejected-'+token+'-'+kind);candidate=cipher;candidate_secret=wrong
  if kind=='tampered_ciphertext':
   candidate=backup_base/'tampered.age';data=bytearray(cipher.read_bytes());data[-20]^=1;candidate.write_bytes(data);candidate.chmod(0o600);candidate_secret=secret
  try:
   try:restore(ROOT,candidate,failed_target,candidate_secret,a.restore_port);raise AssertionError('Invalid backup accepted')
   except BackupFormatError:pass
   assert not failed_target.exists();mark(kind+'_creates_no_destination')
  finally:
   if candidate!=cipher:candidate.unlink()
 # Scope the intentional loss test to exactly this script's new synthetic project.
 config=compose_config(source/'.runtime');project=config['BB_PROJECT'];assert re.fullmatch(r'blackbox-a-[a-f0-9]{12}',project)
 assert int(sql(source,'SELECT count(*) FROM bb.workspaces;'))==(2 if a.rotate_data_key else 1)
 assert sql(source,"SELECT count(*) FROM bb.connections WHERE provider<>'replay'"+(" AND NOT(provider='shopify' AND state='paused' AND config->>'rotation_test'='true')"if a.rotate_data_key else '')+";").strip()==b'0'
 assert not keyfile.is_relative_to(source)and not cipher.is_relative_to(source)
 original_database_identity=json.loads((source/'.runtime/database-identity.json').read_text())
 recovery_started=time.monotonic()
 command(source,compose(source,'down','--volumes','--remove-orphans'))
 volume_check=subprocess.run(['docker','volume','ls','--filter','label=com.docker.compose.project='+project,'--format','{{.Name}}'],check=True,text=True,stdout=subprocess.PIPE);assert not volume_check.stdout.strip()
 for action in ['up','setup','reset-access']:
  failed=command(source,['./blackbox',action],expect=1);assert 'volume is missing'in failed
  volume_check=subprocess.run(['docker','volume','ls','--filter','label=com.docker.compose.project='+project,'--format','{{.Name}}'],check=True,text=True,stdout=subprocess.PIPE);assert not volume_check.stdout.strip()
 mark('missing_database_volume_blocks_start_setup_and_access_reset_without_replacement')
 shutil.rmtree(source);removed=True;assert not source.exists()
 del secret,wrong
 mark('original_synthetic_installation_volume_and_local_keys_removed')
 # Only the external vault and ciphertext remain available to recovery.
 secret=keyfile.read_bytes();restore_result=restore(ROOT,cipher,destination,secret,a.restore_port);del secret
 assert restore_result['state']=='awaiting_owner_key'
 restored_database_identity=json.loads((destination/'.runtime/database-identity.json').read_text())
 assert restored_database_identity['system_identifier']!=original_database_identity['system_identifier'] and restored_database_identity['volume']!=original_database_identity['volume']
 mark('restore_binds_new_cluster_identity_without_copying_original_volume_marker')
 assert set(services(destination))=={'postgres'}
 assert int(sql(destination,'SELECT count(*) FROM bb.credentials WHERE revoked_at IS NULL;'))==0
 assert hashlib.sha256((destination/'.runtime/secrets'/keyname).read_bytes()).hexdigest()==key_hash
 assert hashlib.sha256((destination/'.runtime/secrets/internal').read_bytes()).hexdigest()!=internal_hash
 verified=json.loads(run(destination,'run','--rm','--no-deps','tooling','node','--import','tsx','scripts/verify-evidence.ts'))
 assert verified['checked_retained_evidence']==evidence_count
 mark('restored_keys_decrypt_every_retained_object_before_HTTP_or_owner_access')
 wait_started=time.monotonic()
 # Automated test has no human delay; keep this separately from processing time.
 operator_wait+=time.monotonic()-wait_started
 new_owner=owner_from(command(ROOT,[str(ROOT/'blackbox'),'restore','resume','--to',str(destination)],interactive=True))
 restored=API(a.restore_port);restored.ready();assert restored.call('/v1/login',{'key':old_owner})[0]==401
 assert restored.call('/v1/tools/get_business_state',arguments,bearer=old_agent)[0]==401
 assert restored.call('/v1/status',cookie=old_cookie)[0]==401
 restored.login(new_owner);after=restored.state(arguments);assert after['result']==answer['result']
 code,issued=restored.call('/v1/agents',{'name':'Synthetic recovered MCP proof'});assert code==200
 assert mcp(a.restore_port,issued['key'],arguments)['result']==answer['result']
 recovery_elapsed=time.monotonic()-recovery_started
 mark('old_owner_agent_session_denied_new_owner_and_SDK_MCP_preserve_fixed_answer')
 assert restored.call('/v1/tools/get_evidence',{'evidence_id':evidence_id})==(200,{'status':'unavailable'})
 assert sql(destination,'SELECT count(*) FROM bb.recovery_guards WHERE NOT evidence_blocked OR NOT sources_blocked;').strip()==b'0'
 assert sql(destination,"SELECT count(*) FROM bb.credentials WHERE purpose='owner' AND revoked_at IS NULL;").strip()==b'1'
 assert sql(destination,'SELECT count(*) FROM bb.pending_source_tenants();').strip()==b'0'
 mark('raw_evidence_and_provider_collection_remain_fenced_with_one_active_owner')
 status='passed'
finally:
 for directory in [destination,source]:
  if directory and (directory/'.runtime/compose.env').exists():
   try:stop_supervisor(directory);run(directory,'stop','api','worker','engine','postgres')
   except Exception:checks.append('cleanup_stop_failed_inspect_this_isolated_project')
 report={'kind':'isolated_backup_recovery_after_original_removal','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'source_port':a.source_port,'restore_port':a.restore_port,'source_stage':str(source.relative_to(ROOT))if source else None,'restore_stage':str(destination.relative_to(ROOT)),'node_image_source_commit':a.node_image_commit,'engine_image_source_commit':a.engine_image_commit,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip(),'database':'PostgreSQL17 Compose; synthetic isolated test workspaces'},'original_removed':removed,'rotation_proof':rotation_proof,'checks':checks,'commands':commands,'corpus':{'journal_entries':snapshot['journal_count']if answer else None,'retained_evidence_objects':evidence_count,'encrypted_bytes':generation_result['bytes']if generation_result else None},'timing':{'total_test_seconds':round(time.monotonic()-started,3),'bootstrap_seconds':bootstrap_elapsed,'loss_to_authorized_API_and_MCP_seconds':round(recovery_elapsed,3)if recovery_elapsed else None,'operator_wait_seconds':round(operator_wait,6),'automated_operator':True},'restore_state':json.loads((destination/'.runtime/restore-state.json').read_text())if(destination/'.runtime/restore-state.json').exists()else None,'limitations':['Small synthetic corpus; not the required 250-MiB smoke corpus or recovery-time acceptance','Same physical Apple Silicon Mac with new isolated Compose resources; not a second machine','Copied host runtime and prebuilt development images; not the browser-downloaded distribution artifact','Current policy reconciliation, source revalidation, full operational acceptance, upgrade and independent review remain outside this proof']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k not in ['commands']}),flush=True)
