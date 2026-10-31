#!/usr/bin/env python3
"""Recover a pre-keyring synthetic generation with its separate recovery material."""
import argparse,datetime,http.cookiejar,json,os,pathlib,platform,pty,re,select,subprocess,time,urllib.request,urllib.error,uuid
from backup_restore import restore,verified_backup
from backup_operations import run,sql
from host_runtime import protected_read,read_compose,read_keyring
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--backup',required=True,type=pathlib.Path);p.add_argument('--recovery-key-file',required=True,type=pathlib.Path);p.add_argument('--output',required=True);p.add_argument('--port',type=int,default=18771);a=p.parse_args()
target=ROOT/'work'/('legacy-recovery-'+uuid.uuid4().hex[:12]);checks=[];status='failed';started=time.monotonic()
def issue():
 master,slave=pty.openpty();process=subprocess.Popen([str(ROOT/'blackbox'),'restore','resume','--to',str(target)],cwd=ROOT,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave);data=bytearray();deadline=time.monotonic()+120
 try:
  while True:
   if time.monotonic()>deadline:process.kill();raise RuntimeError('Protected owner issuance timed out')
   ready,_,_=select.select([master],[],[],.2)
   if ready:
    try:chunk=os.read(master,8192)
    except OSError:break
    if not chunk:break
    data.extend(chunk)
    if len(data)>2*1024*1024:process.kill();raise RuntimeError('Owner issuance output budget exceeded')
   elif process.poll()is not None:break
  code=process.wait(timeout=10);keys=re.findall(rb'bb_owner_[A-Za-z0-9_-]{43}',data)
  if code or len(keys)!=1:raise RuntimeError('Protected owner issuance failed')
  return keys[0].decode()
 finally:os.close(master)
try:
 secret=protected_read(a.recovery_key_file.expanduser(),16384)
 with verified_backup(ROOT,a.backup,secret)as(_,manifest,small,digest):
  assert 'secrets/keyring.json'not in small and 'secrets/identity'not in small
  assert manifest['metadata']['snapshot']['journal_count']==55
 restore(ROOT,a.backup,target,secret,a.port);del secret
 assert read_compose(target/'.runtime')['BB_KEY_LAYOUT']=='legacy-v1' and read_keyring(target/'.runtime')is None
 assert not(target/'.runtime/secrets/identity').exists()and not(target/'.runtime/secrets/keyring.json').exists()
 refused=subprocess.run(['./blackbox','key','rotate'],cwd=target,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=15)
 assert refused.returncode!=0 and 'Legacy preview'in refused.stdout
 assert json.loads((target/'.runtime/maintenance.json').read_text())['operation']=='restore'
 checks.append('authenticated_old_archive_restores_explicit_legacy_layout_without_new_identity_or_rotation_bypass')
 owner=issue();base=f'http://127.0.0.1:{a.port}';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));csrf=None
 def call(path,body=None):
  headers={'Origin':base,'Content-Type':'application/json'}
  if csrf:headers['x-blackbox-csrf']=csrf
  request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
  with client.open(request,timeout=5)as response:return json.load(response)
 csrf=call('/v1/login',{'key':owner,'remember':True})['csrf'];del owner
 entity=sql(target,"SELECT entity_id FROM bb.journal WHERE record_type='source' ORDER BY sequence LIMIT 1;").decode().strip();arguments={'entity_id':entity}
 answer=call('/v1/tools/get_business_state',arguments);assert answer['result']['captured_minor']==11900 and answer['result']['refunded_minor']==2380
 agent=call('/v1/agents',{'name':'Legacy backup protocol proof'})['key']
 script='''import{Client}from"@modelcontextprotocol/sdk/client/index.js";import{StdioClientTransport}from"@modelcontextprotocol/sdk/client/stdio.js";const c=new Client({name:"legacy-recovery-proof",version:"1"});await c.connect(new StdioClientTransport({command:"node",args:["--import","tsx","packages/mcp/main.ts"],env:process.env}));try{const r=await c.callTool({name:"get_business_state",arguments:JSON.parse(process.env.TEST_ARGUMENTS)});if(r.isError)throw Error("query_failed");process.stdout.write(r.content[0].text);}finally{await c.close();}'''
 result=subprocess.run(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':base,'PUBLIC_PORT':str(a.port),'BLACKBOX_AGENT_KEY':agent,'TEST_ARGUMENTS':json.dumps(arguments)},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
 assert result.returncode==0 and json.loads(result.stdout)['result']==answer['result']
 assert call('/v1/tools/get_evidence',{'evidence_id':answer['result']['evidence'][0]})=={'status':'unavailable'}
 assert sql(target,'SELECT count(*) FROM bb.recovery_guards WHERE NOT evidence_blocked OR NOT sources_blocked;').strip()==b'0'
 checks.append('new_owner_API_actual_SDK_MCP_and_retained_ciphertexts_recover_while_raw_and_provider_guards_remain')
 status='passed'
finally:
 if(target/'.runtime/compose.env').exists():
  try:run(target,'stop','api','worker','engine','postgres')
  except Exception:checks.append('cleanup_stop_failed_inspect_own_project')
 report={'kind':'legacy_pre_keyring_encrypted_backup_recovery','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(target.relative_to(ROOT)),'port':a.port,'node_image':subprocess.check_output(['docker','image','inspect','blackbox-a-node:0.1.0-dev','--format','{{.Id}}'],text=True).strip()},'checks':checks,'elapsed_seconds':round(time.monotonic()-started,3),'limitations':['Known pre-keyring synthetic 55-entry generation; not smoke RTO or a downloaded release','Legacy identity coupling remains explicit; no rotation retirement claim for this old layout','No live providers, policy reconciliation completion or independent acceptance']}
 output=ROOT/a.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
