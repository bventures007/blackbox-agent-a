"""Protected installation image pins; no mutable tag is used after activation."""
import json,re,subprocess,threading
from host_runtime import RuntimeConfigError,protected_read

SERVICES={'api','worker','tooling','mcp','engine'}

def validate(value):
 if not isinstance(value,dict)or set(value)!={'services'}or not isinstance(value['services'],dict)or set(value['services'])!=SERVICES:
  raise RuntimeConfigError('Invalid installation image pins. Recover the exact release metadata.')
 for entry in value['services'].values():
  if not isinstance(entry,dict)or set(entry)!={'image'}or not isinstance(entry['image'],str)or not re.fullmatch('sha256:[a-f0-9]{64}',entry['image']):
   raise RuntimeConfigError('Installation image pins must contain immutable local image identities only.')
 if len({value['services'][name]['image']for name in SERVICES-{'engine'}})!=1:
  raise RuntimeConfigError('API, worker, tooling and MCP must use the same release image.')
 return value

def pins(node,engine):
 return validate({'services':{name:{'image':engine if name=='engine'else node}for name in sorted(SERVICES)}})

def override(runtime):
 path=runtime/'release-images.json'
 if not path.exists()and not path.is_symlink():return []
 validate(json.loads(protected_read(path,4096)))
 return ['-f',str(path)]

def image_id(reference):
 result=subprocess.run(['docker','image','inspect','--format','{{.Id}}',reference],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20)
 value=result.stdout.decode().strip()
 if result.returncode or not re.fullmatch('sha256:[a-f0-9]{64}',value):raise RuntimeConfigError('Exact release image is unavailable. Load the versioned release archive before upgrading.')
 return value

def require_available(value):
 validate(value)
 for reference in {x['image']for x in value['services'].values()}:
  if image_id(reference)!=reference:raise RuntimeConfigError('Release image identity changed.')

def save(runtime,value):
 from backup_operations import atomic_json
 validate(value);require_available(value)
 atomic_json(runtime/'release-images.json',value)

def image_contract(reference,engine=False):
 """Run a tiny, bounded contract command with no installation mounts/network."""
 entry='blackbox-engine'if engine else'node'
 args=['--print-contract']if engine else['--import','tsx','--input-type=module','-e',"import './packages/runtime/compatibility.ts';import fs from 'node:fs';console.log(fs.readFileSync('release/compatibility.json','utf8'))"]
 created=subprocess.run(['docker','create','--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=16777216,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','32','--cpus','0.5','--env','NODE_DISABLE_COMPILE_CACHE=1','--entrypoint',entry,reference,*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20)
 identifier=created.stdout.decode().strip()
 if created.returncode or not re.fullmatch('[a-f0-9]{64}',identifier):raise RuntimeConfigError('Release contract probe could not be created.')
 process=None;timer=None
 try:
  process=subprocess.Popen(['docker','start','--attach',identifier],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  timer=threading.Timer(20,process.kill);timer.start();raw=process.stdout.read(65537)
  if len(raw)>65536 or process.wait(timeout=5):raise RuntimeConfigError('Release contract probe failed or exceeded its budget.')
  try:return json.loads(raw)
  except ValueError:raise RuntimeConfigError('Release image did not provide a valid compiled contract.')from None
 finally:
  if timer:timer.cancel()
  if process:
   if process.poll()is None:process.kill()
   process.wait();process.stdout.close()
  subprocess.run(['docker','container','rm','--force',identifier],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)

def verify_target(value,manifest):
 validate(value);require_available(value)
 for name in ['api','engine']:
  found=image_contract(value['services'][name]['image'],engine=name=='engine')
  if not isinstance(found,dict)or any(found.get(k)!=manifest[k]for k in ['release','runtime','migrations'])or found.get('install',{}).get('schema')!=manifest['install']['schema']:
   raise RuntimeConfigError('Target image contract does not match the host bundle. Migration refused.')
