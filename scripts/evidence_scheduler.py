"""Hourly eligibility checks and daily orphan sweeps in the existing host supervisor."""
import datetime,time
from backup_operations import atomic_json,services,sql
from evidence_policy import maintain

CHECK_SECONDS=3600
SCAN_SECONDS=86400
RETRY_SECONDS=300

def iso(now):return datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()

def due(state,now):
 from backup_supervisor import timestamp
 checked=timestamp(state.get('last_checked_at'))
 if checked is not None and checked>now+300:return False
 interval=RETRY_SECONDS if state.get('state')=='failed'else CHECK_SECONDS
 return checked is None or now>=checked+interval

def publish(root,now=None,heartbeat=None,maintenance_required=False):
 from backup_supervisor import load_json,timestamp
 now=time.time()if now is None else now;runtime=root/'.runtime';state=load_json(runtime/'evidence-sweep.json')
 completed=load_json(runtime/'evidence-policy-status.json').get('completed_at')
 checked=timestamp(state.get('last_checked_at'));clock_anomaly=checked is not None and checked>now+300
 next_check=now if checked is None else checked+(RETRY_SECONDS if state.get('state')=='failed'else CHECK_SECONDS)
 # Cache bounded metadata inspection across heartbeat/UI publication. A newly
 # completed generation invalidates the cache without waiting for another hour.
 copies=load_json(runtime/'evidence-copy-inventory.json');copied_at=timestamp(copies.get('observed_at'))
 generation=load_json(runtime/'backup-status.json').get('generation')
 if copied_at is None or copied_at>now+300 or now-copied_at>=60 or copies.get('last_generation')!=generation:
  from evidence_copies import inventory
  copies={**inventory(root,now),'last_generation':generation};atomic_json(runtime/'evidence-copy-inventory.json',copies)
 value={'schema_version':1,'owner_workspace_id':load_json(runtime/'owner-workspace.json').get('tenant_id'),'observed_at':iso(now),'state':'maintenance_required'if maintenance_required else 'clock_anomaly'if clock_anomaly else state.get('state','scheduled'),'last_checked_at':state.get('last_checked_at'),'last_attempt':state.get('last_attempt'),'last_completed':completed,'next_check_at':None if clock_anomaly or maintenance_required else iso(next_check),'check_interval_seconds':CHECK_SECONDS,'orphan_interval_seconds':SCAN_SECONDS,'scheduler_heartbeat':heartbeat or load_json(runtime/'supervisor.json').get('observed_at')}
 value['copies']={k:v for k,v in copies.items()if k!='last_generation'}
 atomic_json(runtime/'control/status/evidence-policy.json',value);return value

def tick(root,now=None):
 from backup_supervisor import load_json,timestamp
 now=time.time()if now is None else now;runtime=root/'.runtime';state=load_json(runtime/'evidence-sweep.json')
 if(runtime/'maintenance.json').exists()or not due(state,now):return
 # An explicit stopped backend stays stopped; no maintenance-only startup.
 if 'api'not in services(root):return
 baseline=timestamp(state.get('first_checked_at'))
 if baseline is None:baseline=now
 completed=timestamp(load_json(runtime/'evidence-policy-status.json').get('completed_at'))
 last_scan=completed if completed is not None else baseline
 state={**state,'first_checked_at':iso(baseline),'last_checked_at':iso(now),'state':'checking'};atomic_json(runtime/'evidence-sweep.json',state)
 try:
  eligible=sql(root,'SELECT EXISTS(SELECT 1 FROM bb.evidence_retention WHERE NOT retained AND disposed_at IS NULL);').strip()==b't'
  if eligible or now>=last_scan+SCAN_SECONDS:
   state.update({'state':'running','last_attempt':iso(now)});atomic_json(runtime/'evidence-sweep.json',state);publish(root,now)
   maintain(root)
  state['state']='scheduled';atomic_json(runtime/'evidence-sweep.json',state)
 except Exception:
  state['state']='failed';atomic_json(runtime/'evidence-sweep.json',state)
  raise
 finally:publish(root,now)
