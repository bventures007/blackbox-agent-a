"""Standard age encryption around bounded POSIX tar members; no plaintext staging."""
from contextlib import contextmanager
import hashlib,io,json,os,pathlib,platform,re,stat,subprocess,tarfile,threading

MAX_MEMBER=8*1024*1024
MAX_MANIFEST=32*1024*1024
MAX_MEMBERS=100000
MAX_ARCHIVE=16*1024*1024*1024
NAME=re.compile(r'(?:database/[0-9]{8}\.bin|evidence/[a-f0-9-]{36}/[a-f0-9-]{36}|secrets/(?:data|internal|identity)|policy/redactions\.json|installation\.json)')

class BackupFormatError(RuntimeError):pass


def tool(root:pathlib.Path,name:str)->str:
 if name not in ['age','age-keygen']:raise BackupFormatError('unsupported_backup_tool')
 lock=json.loads((root/'vendor/age.lock.json').read_text())
 platform_key={('Darwin','arm64'):'darwin-arm64',('Linux','x86_64'):'linux-amd64'}.get((platform.system(),platform.machine()))
 if platform_key not in lock['platforms']:raise BackupFormatError('unsupported_backup_tool_platform')
 lock=lock['platforms'][platform_key]
 path=root/'bin'/name
 if not path.exists():path=root/'.tools/age'/name
 if path.is_symlink()or not path.is_file():raise BackupFormatError('backup_tool_missing: prepare the pinned host tools')
 value=path.stat()
 if value.st_mode&0o022 or hashlib.sha256(path.read_bytes()).hexdigest()!=lock['files'][name]:raise BackupFormatError('backup_tool_integrity_failed')
 return str(path)


def recovery_key(value:bytes)->bytes:
 # Exactly one native PQ identity; never load plugins, SSH, scrypt or path values.
 try:
  lines=[line for line in value.decode('ascii').splitlines()if line and not line.startswith('#')]
 except UnicodeError:raise BackupFormatError('invalid_recovery_key')from None
 if len(lines)!=1 or not re.fullmatch('AGE-SECRET-KEY-PQ-1[A-Z0-9]{40,200}',lines[0]):raise BackupFormatError('invalid_recovery_key')
 return (lines[0]+'\n').encode()


def new_recovery(root:pathlib.Path)->tuple[bytes,str]:
 r=subprocess.run([tool(root,'age-keygen'),'-pq'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
 if r.returncode:raise BackupFormatError('recovery_key_generation_failed')
 secret=recovery_key(r.stdout)
 r=subprocess.run([tool(root,'age-keygen'),'-y'],input=secret,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
 recipient=r.stdout.decode().strip()
 if r.returncode or not re.fullmatch('age1pq1[a-z0-9]{1000,4096}',recipient):raise BackupFormatError('recovery_recipient_invalid')
 return secret,recipient


@contextmanager
def encrypt(root:pathlib.Path,recipient:str,output):
 if not re.fullmatch('age1pq1[a-z0-9]{1000,4096}',recipient):raise BackupFormatError('recovery_recipient_invalid')
 proc=subprocess.Popen([tool(root,'age'),'-e','-r',recipient],stdin=subprocess.PIPE,stdout=output,stderr=subprocess.DEVNULL)
 timer=threading.Timer(600,proc.kill);timer.start()
 try:
  yield proc.stdin
  proc.stdin.close()
  if proc.wait(timeout=10):raise BackupFormatError('backup_encryption_failed')
 finally:
  timer.cancel()
  if proc.poll()is None:proc.kill()
  proc.wait();proc.stdin.close()


@contextmanager
def decrypt(root:pathlib.Path,secret:bytes,cipher):
 secret=recovery_key(secret)
 readfd,writefd=os.pipe()
 try:
  os.write(writefd,secret);os.close(writefd);writefd=None
  proc=subprocess.Popen([tool(root,'age'),'-d','-i',f'/dev/fd/{readfd}',f'/dev/fd/{cipher.fileno()}'],pass_fds=(readfd,cipher.fileno()),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 finally:
  os.close(readfd)
  if writefd is not None:os.close(writefd)
 timer=threading.Timer(600,proc.kill);timer.start()
 try:
  yield proc.stdout
  # Complete authentication includes the final age chunk, even after tar EOF.
  if proc.stdout.read(1):raise BackupFormatError('unexpected_plaintext_tail')
  if proc.wait(timeout=10):raise BackupFormatError('backup_authentication_failed')
 finally:
  timer.cancel();proc.stdout.close()
  if proc.poll()is None:proc.kill()
  proc.wait()


class ArchiveWriter:
 def __init__(self,stream):
  self.tar=tarfile.open(fileobj=stream,mode='w|',format=tarfile.USTAR_FORMAT);self.files={};self.total=0
 def add(self,name:str,data:bytes):
  if not NAME.fullmatch(name)or name in self.files or len(data)>MAX_MEMBER or len(self.files)>=MAX_MEMBERS:raise BackupFormatError('invalid_or_oversized_backup_member')
  self.total+=len(data)
  if self.total>MAX_ARCHIVE:raise BackupFormatError('backup_size_limit_exceeded')
  self._add(name,data);self.files[name]={'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 def _add(self,name,data):
  info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600;info.mtime=0;self.tar.addfile(info,io.BytesIO(data))
 def finish(self,metadata:dict):
  manifest={'backup_format':1,'encryption':'age-v1-pq','metadata':metadata,'members':self.files}
  value=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
  if len(value)>MAX_MANIFEST:raise BackupFormatError('backup_manifest_limit_exceeded')
  self._add('manifest.json',value);self.tar.close();return manifest


def read_exact(stream,count:int)->bytes:
 chunks=[];remaining=count
 while remaining:
  value=stream.read(min(remaining,1024*1024))
  if not value:raise BackupFormatError('truncated_backup_archive')
  chunks.append(value);remaining-=len(value)
 return b''.join(chunks)


def inspect_archive(stream,visit=None)->dict:
 """Validate using TarInfo, rejecting extension headers before their body is read.
 `visit` is only used during a second pass of an already authenticated archive.
 """
 members={};manifest=None;total=0
 while True:
  block=read_exact(stream,512)
  if block==bytes(512):
   if read_exact(stream,512)!=bytes(512):raise BackupFormatError('invalid_tar_terminator')
   break
  try:info=tarfile.TarInfo.frombuf(block,'utf-8','strict')
  except (tarfile.HeaderError,UnicodeError,ValueError):raise BackupFormatError('invalid_tar_header')from None
  name=info.name
  if not info.isfile()or info.type not in [tarfile.REGTYPE,tarfile.AREGTYPE] or manifest is not None or info.linkname or info.size<0:raise BackupFormatError('unsafe_backup_archive_member')
  limit=MAX_MANIFEST if name=='manifest.json' else MAX_MEMBER
  if info.size>limit:raise BackupFormatError('backup_member_size_limit_exceeded')
  total+=info.size
  if total>MAX_ARCHIVE+MAX_MANIFEST or (len(members)>=MAX_MEMBERS and name!='manifest.json'):raise BackupFormatError('backup_size_limit_exceeded')
  if name!='manifest.json'and(not NAME.fullmatch(name)or name in members):raise BackupFormatError('unknown_or_duplicate_backup_member')
  value=read_exact(stream,info.size)
  padding=read_exact(stream,(-info.size)%512)
  if any(padding):raise BackupFormatError('invalid_tar_padding')
  if name=='manifest.json':
   try:manifest=json.loads(value)
   except (ValueError,UnicodeError):raise BackupFormatError('invalid_backup_manifest')from None
  else:
   members[name]={'size':len(value),'sha256':hashlib.sha256(value).hexdigest()}
   if visit:visit(name,value)
 # Consume the standard tar record padding and force age final-chunk authentication.
 tail=stream.read(10240)
 if any(tail)or stream.read(1):raise BackupFormatError('unexpected_plaintext_tail')
 if not isinstance(manifest,dict)or set(manifest)!={'backup_format','encryption','metadata','members'}or type(manifest['backup_format'])is not int or manifest['backup_format']!=1 or manifest['encryption']!='age-v1-pq' or manifest['members']!=members or not isinstance(manifest['metadata'],dict):raise BackupFormatError('backup_manifest_integrity_failed')
 return manifest
