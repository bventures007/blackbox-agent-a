#!/usr/bin/env python3
"""Fetch pinned local dependency binaries; no global installation or archive extraction."""
import argparse,hashlib,json,pathlib,platform,tarfile,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--archive',type=pathlib.Path);a=p.parse_args()
lock=json.loads((root/'vendor/age.lock.json').read_text())
platform_key={('Darwin','arm64'):'darwin-arm64',('Linux','x86_64'):'linux-amd64'}.get((platform.system(),platform.machine()))
if platform_key not in lock['platforms']:raise SystemExit('Unsupported host-tool platform.')
lock=lock['platforms'][platform_key]
archive=a.archive or root/'work/vendor-downloads'/lock['filename'];archive.parent.mkdir(parents=True,exist_ok=True)
if not archive.exists():
 request=urllib.request.Request(lock['url'],headers={'User-Agent':'Blackbox local dependency preparation'})
 with urllib.request.urlopen(request,timeout=30)as r,archive.open('xb')as f:
  total=0
  while chunk:=r.read(1024*1024):
   total+=len(chunk)
   if total>64*1024*1024:raise SystemExit('Dependency download exceeded bound.')
   f.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=lock['sha256']:raise SystemExit('Dependency archive checksum mismatch.')
dest=root/'.tools/age';dest.mkdir(parents=True,exist_ok=True)
with tarfile.open(archive,'r:gz')as tar:
 for filename,expected in lock['files'].items():
  member=tar.getmember('age/'+filename)
  if not member.isfile()or member.size>32*1024*1024:raise SystemExit('Unsafe dependency archive member.')
  value=tar.extractfile(member).read()
  if hashlib.sha256(value).hexdigest()!=expected:raise SystemExit('Dependency member checksum mismatch.')
  target=dest/filename
  if target.is_symlink():raise SystemExit('Unsafe dependency destination.')
  target.write_bytes(value);target.chmod(0o644 if filename=='LICENSE' else 0o755)
print('Verified pinned age host tools prepared locally; no global installation.')
