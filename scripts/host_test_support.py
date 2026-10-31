"""Bounded synthetic host-test client helpers; credentials never enter report output."""
import http.client,http.cookiejar,json,os,pathlib,pty,re,select,signal,subprocess,time,urllib.error,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
commands=[]
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
  finally:
   os.close(master)
   if process.poll()is None:
    try:os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    process.wait(timeout=10)
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

def mcp(port,key,arguments,tool="get_business_state"):
 script='''import {Client} from "@modelcontextprotocol/sdk/client/index.js";import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
const client=new Client({name:"isolated-recovery-proof",version:"1"});await client.connect(new StdioClientTransport({command:"node",args:["--import","tsx","packages/mcp/main.ts"],env:process.env}));try{const r=await client.callTool({name:process.env.TEST_TOOL,arguments:JSON.parse(process.env.TEST_ARGUMENTS)});if(r.isError)throw Error("mcp_recovery_query_failed");process.stdout.write(r.content[0].text);}finally{await client.close();}'''
 result=subprocess.run(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,env={**os.environ,'BLACKBOX_API_URL':f'http://127.0.0.1:{port}','PUBLIC_PORT':str(port),'BLACKBOX_AGENT_KEY':key,'TEST_ARGUMENTS':json.dumps(arguments),'TEST_TOOL':tool},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=20)
 if result.returncode:raise RuntimeError('Actual SDK MCP recovery request failed')
 return json.loads(result.stdout)

