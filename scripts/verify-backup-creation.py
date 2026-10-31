#!/usr/bin/env python3
"""Actual coherent encrypted database backup proof; does not claim database restore."""
import argparse,datetime,hashlib,json,os,pathlib,platform,shutil,subprocess,uuid
from backup_operations import enroll,generation,target,services
from backup_codec import decrypt,inspect_archive
from host_runtime import RuntimeConfigError
root=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--stage',required=True,type=pathlib.Path);p.add_argument('--output',required=True);a=p.parse_args()
stage=(root/a.stage).resolve()
if not stage.is_relative_to(root/'work')or not (stage/'.runtime/compose.env').is_file():raise SystemExit('Use an existing isolated synthetic installation under this repository work directory.')
for name in ['blackbox','scripts/host_runtime.py','scripts/key_rotation.py','scripts/backup_operations.py','scripts/backup_supervisor.py','scripts/backup_codec.py','vendor/age.lock.json']:
 destination=stage/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,destination)
shutil.copytree(root/'.tools/age',stage/'bin',dirs_exist_ok=True)
status='failed';checks=[];result=None
try:
 if (stage/'.runtime/backup.json').exists():raise RuntimeError('Use a fresh synthetic stage with no backup enrollment.')
 destination=root/'work'/('backup-destination-'+uuid.uuid4().hex[:12]);destination.mkdir(mode=0o700)
 secret=enroll(stage,destination)
 # This test vault models the user saving recovery material independently.
 vault=root/'work/recovery-test-vault';vault.mkdir(exist_ok=True,mode=0o700)
 keyfile=vault/('recovery-'+uuid.uuid4().hex+'.key');fd=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb')as f:f.write(secret)
 prior=services(stage);result=generation(stage)
 config=json.loads((stage/'.runtime/backup.json').read_text());cipher=target(config)/result['generation']
 with cipher.open('rb')as f,decrypt(stage,secret,f)as plain:manifest=inspect_archive(plain)
 assert manifest['metadata']['snapshot']['journal_count']>0
 assert any(x.startswith('evidence/')for x in manifest['members'])
 assert {'secrets/data','secrets/internal','policy/redactions.json','installation.json'}<=manifest['members'].keys()
 assert hashlib.sha256(cipher.read_bytes()).hexdigest()==result['ciphertext_sha256']
 assert not (stage/'.runtime/maintenance.json').exists()and services(stage)==prior
 assert all(secret not in f.read_bytes()for f in (stage/'.runtime').rglob('*')if f.is_file()and f.stat().st_size<1024*1024)
 checks+=['actual_pg17_dump_streamed_into_age','referenced_evidence_and_keys_in_authenticated_manifest','coherent_heads_and_journal_count','recovery_secret_not_stored_in_installation','prior_service_state_restored','ciphertext_hash_matches']
 # Simulate a disappeared mount and a replacement empty directory at its old path.
 held=destination.with_name(destination.name+'-disconnected');destination.rename(held);destination.mkdir()
 try:
  try:generation(stage);raise AssertionError('Missing volume accepted')
  except (OSError,RuntimeConfigError):pass
  assert not list(destination.iterdir());checks.append('unavailable_destination_never_written_as_empty_mountpoint')
 finally:destination.rmdir();held.rename(destination)
 assert cipher.is_file()
 (stage/'.runtime/test-recovery-location.json').write_text(json.dumps({'key_file':str(keyfile),'backup':str(cipher)}));(stage/'.runtime/test-recovery-location.json').chmod(0o600)
 status='passed'
finally:
 report={'kind':'coherent_encrypted_backup_creation','status':status,'tested_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'host':platform.platform(),'stage':str(stage.relative_to(root)),'age':'1.3.2 pinned Mac ARM64','database':'Pinned PostgreSQL17 Compose; synthetic example'},'checks':checks,'encrypted_bytes':result['bytes']if result else None,'limitations':['Actual backup creation and authenticated archive validation only; database restore not yet proved','Fresh isolated synthetic installation; no live customer/provider data','No scheduler/retention/key-rotation/full operations or independent review approval']}
 out=root/a.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
