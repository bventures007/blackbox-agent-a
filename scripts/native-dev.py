#!/usr/bin/env python3
"""Development-only fallback using already-installed Postgres.app. Not DIST evidence."""
import os,pathlib,subprocess,json,secrets,sys,time,signal,urllib.parse,urllib.request,urllib.error
root=pathlib.Path(__file__).resolve().parents[1];runtime=root/'.runtime';pg=pathlib.Path('/Applications/Postgres.app/Contents/Versions/18/bin')
runtime.mkdir(exist_ok=True,mode=0o700)
config=runtime/'native.json'
if not config.exists():
 data={'admin':secrets.token_hex(32),'api':secrets.token_hex(32),'worker':secrets.token_hex(32),'engine':secrets.token_hex(32),'socket':'/private/tmp/blackbox-a-'+secrets.token_hex(6)}
 with config.open('x')as f:os.chmod(config,0o600);json.dump(data,f)
x=json.load(config.open());sock=pathlib.Path(x['socket']);sock.mkdir(exist_ok=True,mode=0o700)
for d in ['secrets','evidence','logs']:(runtime/d).mkdir(exist_ok=True,mode=0o700)
for n,data in [('data',secrets.token_bytes(32)),('internal',secrets.token_hex(32).encode())]:
 p=runtime/'secrets'/n
 if not p.exists():
  with p.open('xb')as f:os.chmod(p,0o600);f.write(data)
def url(role,key):return f'postgres://{role}:{key}@localhost/blackbox?host='+urllib.parse.quote(str(sock),safe='')
env={**os.environ,'DATABASE_URL':url('bb_api',x['api']),'WORKER_DATABASE_URL':url('bb_worker',x['worker']),'ENGINE_DATABASE_URL':url('bb_engine',x['engine']),'ADMIN_DATABASE_URL':url('blackbox_migrate',x['admin']),'INTERNAL_KEY_FILE':str(runtime/'secrets/internal'),'DATA_KEY_FILE':str(runtime/'secrets/data'),'EVIDENCE_DIR':str(runtime/'evidence'),'LOG_DIR':str(runtime/'logs'),'ENGINE_URL':'http://127.0.0.1:19742','ENGINE_BIND':'127.0.0.1:19742','PORT':'19741','PUBLIC_PORT':'19741','FIXTURE_HOST':'127.0.0.1:19743','FIXTURE_PORT':'19743','ALLOW_SYNTHETIC_FIXTURE':'1','BLACKBOX_API_URL':'http://127.0.0.1:19741','TEST_RUNTIME_DIR':str(runtime),'PGPASSWORD':x['admin']}
def run(args,**kw):return subprocess.run([str(a)for a in args],env=env,cwd=root,check=True,**kw)
def database():
 if not (runtime/'pg/PG_VERSION').exists():
  pw=runtime/'secrets/pg-init';pw.write_text(x['admin']);pw.chmod(0o600)
  run([pg/'initdb','-D',runtime/'pg','-U','blackbox_migrate','--auth=scram-sha-256','--pwfile',pw],stdout=subprocess.DEVNULL);pw.unlink()
  with (runtime/'pg/postgresql.conf').open('a')as f:f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nlog_statement='none'\nlog_min_error_statement='panic'\n")
 if subprocess.run([str(pg/'pg_ctl'),'-D',str(runtime/'pg'),'status'],stdout=subprocess.DEVNULL).returncode:run([pg/'pg_ctl','-D',runtime/'pg','-l',runtime/'pg/server.log','start'],stdout=subprocess.DEVNULL)
 exists=run([pg/'psql','-h',sock,'-U','blackbox_migrate','-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='blackbox'"],capture_output=True).stdout.strip()
 if not exists:
  run([pg/'createdb','-h',sock,'-U','blackbox_migrate','blackbox'])
  # Passwords go through protected stdin psql variables, never command arguments.
  variables=''.join("\\set "+k+" '"+v+"'\n"for k,v in [('api_password',x['api']),('worker_password',x['worker']),('engine_password',x['engine'])])
  run([pg/'psql','-h',sock,'-U','blackbox_migrate','-d','blackbox','-v','ON_ERROR_STOP=1'],input=(variables+(root/'packages/database/migrations/001-foundation.sql').read_text()).encode(),stdout=subprocess.DEVNULL)
 # Incremental migrations have checksums and one transaction each. Runtime identities cannot migrate.
 run([pg/'psql','-h',sock,'-U','blackbox_migrate','-d','blackbox','-v','ON_ERROR_STOP=1'],input=b"CREATE TABLE IF NOT EXISTS bb.schema_migrations(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());",stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 import hashlib
 for migration in sorted((root/'packages/database/migrations').glob('*.sql')):
  digest=hashlib.sha256(migration.read_bytes()).hexdigest()
  prior=run([pg/'psql','-h',sock,'-U','blackbox_migrate','-d','blackbox','-tAc',f"SELECT sha256 FROM bb.schema_migrations WHERE version='{migration.name}'"],capture_output=True).stdout.decode().strip()
  if prior:
   if prior!=digest:raise SystemExit('Applied migration checksum changed: '+migration.name)
   continue
  source='' if migration.name=='001-foundation.sql' else migration.read_text()
  sql="BEGIN;SELECT pg_advisory_xact_lock(18741002);"+source+f"INSERT INTO bb.schema_migrations(version,sha256)VALUES('{migration.name}','{digest}');COMMIT;"
  run([pg/'psql','-h',sock,'-U','blackbox_migrate','-d','blackbox','-v','ON_ERROR_STOP=1'],input=sql.encode(),stdout=subprocess.DEVNULL)
def start():
 database();pids={}
 if (runtime/'native-pids.json').exists():raise SystemExit('Native processes already recorded. Stop explicitly before restarting.')
 for name,command in [('engine',[str(root/'target/debug/blackbox-engine')]),('api',['node','--import','tsx','apps/api/main.ts']),('worker',['node','--import','tsx','apps/worker/main.ts']),('fixture',['node','--import','tsx','tests/fixtures/shopify-server.ts'])]:
  service={**env,'COMPONENT':name}
  if name=='engine':service['DATABASE_URL']=env['ENGINE_DATABASE_URL']
  if name=='worker':service['DATABASE_URL']=env['WORKER_DATABASE_URL']
  log=runtime/'logs'/f'native-{name}.stderr';fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
  try:p=subprocess.Popen(command,env=service,cwd=root,stdout=subprocess.DEVNULL,stderr=fd,start_new_session=True);pids[name]=p.pid
  finally:os.close(fd)
 (runtime/'native-pids.json').write_text(json.dumps(pids))
 deadline=time.monotonic()+20
 for address in ['http://127.0.0.1:19741/v1/status','http://127.0.0.1:19742/health','http://127.0.0.1:19743/']:
  while True:
   try:urllib.request.urlopen(address,timeout=1);break
   except urllib.error.HTTPError as e:
    if e.code in [401,404]:break
    raise
   except urllib.error.URLError:
    if time.monotonic()>deadline:raise SystemExit('Native service readiness deadline exceeded; inspect local diagnostics.')
    time.sleep(.1)
 print('Isolated native development processes started. Web 19741, engine 19742, fixture 19743; PostgreSQL private Unix socket.')
def stop():
 p=runtime/'native-pids.json'
 if p.exists():
  for name,pid in json.load(p.open()).items():
   try:
    os.killpg(pid,signal.SIGCONT)
    os.killpg(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  p.unlink();time.sleep(.5)
 if (runtime/'pg/postmaster.pid').exists():run([pg/'pg_ctl','-D',runtime/'pg','stop','-m','fast'],stdout=subprocess.DEVNULL)
 print('Native development processes stopped; data preserved.')
cmd=sys.argv[1]if len(sys.argv)>1 else 'help'
if cmd=='up':start()
elif cmd=='down':stop()
elif cmd=='test':run(['node','--import','tsx','tests/slice.ts',sys.argv[2]if len(sys.argv)>2 else 'seed'])
elif cmd in ['pause-worker','resume-worker']:
 pid=json.load((runtime/'native-pids.json').open())['worker'];os.kill(pid,signal.SIGSTOP if cmd=='pause-worker' else signal.SIGCONT);print(cmd)
elif cmd=='exec':run(sys.argv[2:])
else:print('native-dev.py up|down|test [seed|verify|corrupt|remove|correction]|exec COMMAND...')
