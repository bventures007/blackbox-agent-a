#!/usr/bin/env python3
"""Fill reports/performance.json (smoke profile) from the actual load-driver outputs and compare every measured value with the
contract targets. The profile passes only if every measured target holds; unmeasured targets are listed as limitations, never
assumed. Usage: python3 scripts/update-performance.py --commit SHA --environment "..."
"""
import argparse, json, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]; EV = ROOT / 'tests/evidence/current'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--commit', required=True); ap.add_argument('--environment', required=True); a = ap.parse_args()
    contract = json.loads((ROOT / 'benchmarks/performance-contract.json').read_text()); T = contract['profiles']['smoke']['targets']
    api = json.loads((EV / 'perf-load-api.json').read_text()); mcp = json.loads((EV / 'perf-load-mcp.json').read_text())
    seed = json.loads((EV / 'perf-seed-manifest.json').read_text()); hw = (EV / 'perf-hardware.txt').read_text().strip().splitlines()
    checks = {}
    def chk(name, value, limit, lower_is_better=True):
        ok = None if value is None else (value <= limit if lower_is_better else value >= limit)
        checks[name] = {'measured': value, 'target': limit, 'ok': ok}
    c = api['classes']; m = mcp['classes']
    chk('hot_current_state_api_p95_ms', c['hot_current_state']['p95'], T['hot_current_state_api_p95_ms']); chk('hot_current_state_api_p99_ms', c['hot_current_state']['p99'], T['hot_current_state_api_p99_ms'])
    chk('hot_current_state_mcp_p95_ms', m['hot_current_state']['p95'], T['hot_current_state_mcp_p95_ms']); chk('hot_current_state_mcp_p99_ms', m['hot_current_state']['p99'], T['hot_current_state_mcp_p99_ms'])
    chk('cold_order_state_api_p95_ms', c['cold_order_state']['p95'], T['cold_order_state_api_p95_ms']); chk('cold_order_state_mcp_p95_ms', m['cold_order_state']['p95'], T['cold_order_state_mcp_p95_ms'])
    chk('entity_history_100_entries_api_p95_ms', c['entity_history_first_100']['p95'], T['entity_history_100_entries_api_p95_ms']); chk('entity_history_100_entries_mcp_p95_ms', m['entity_history_first_100']['p95'], T['entity_history_100_entries_mcp_p95_ms'])
    chk('bounded_30_day_summary_api_p95_ms', c['bounded_30_day_summary']['p95'], T['bounded_30_day_summary_api_p95_ms']); chk('bounded_30_day_summary_mcp_p95_ms', m['bounded_30_day_summary']['p95'], T['bounded_30_day_summary_mcp_p95_ms'])
    chk('successful_query_fraction_api', api['success_fraction'], T['successful_query_fraction_minimum'], lower_is_better=False); chk('successful_query_fraction_mcp', mcp['success_fraction'], T['successful_query_fraction_minimum'], lower_is_better=False)
    chk('durable_ack_p95_ms', (api.get('durable_ack_ms') or {}).get('p95'), T['durable_ack_p95_ms'])
    lag = max(x for x in [(api.get('projection_lag') or {}).get('lag_ms_p95'), (mcp.get('projection_lag') or {}).get('lag_ms_p95')] if x is not None) if any(((r.get('projection_lag') or {}).get('lag_ms_p95') is not None) for r in (api, mcp)) else None
    chk('projection_lag_p95_ms', lag, T['projection_lag_p95_ms'])
    rss_peak = max(x for x in [(api.get('projection_lag') or {}).get('rss_bytes_peak'), (mcp.get('projection_lag') or {}).get('rss_bytes_peak'), api['engine'].get('rss_bytes'), mcp['engine'].get('rss_bytes')] if x) / 1024 ** 2
    chk('engine_peak_rss_mib', round(rss_peak, 1), T['engine_peak_rss_mib_maximum']); chk('engine_steady_rss_mib', round(min(api['engine']['rss_bytes'], mcp['engine']['rss_bytes']) / 1024 ** 2, 1), T['engine_steady_rss_mib_maximum'])
    chk('scheduled_arrival_api_p95_ms', api['scheduled_arrival_latency_ms']['p95'], T['current_state_api_p95_ms']); chk('scheduled_arrival_mcp_p95_ms', mcp['scheduled_arrival_latency_ms']['p95'], T['current_state_api_p95_ms'])
    dataset_ok = seed['tenants'] >= contract['profiles']['smoke']['dataset']['tenants'] and seed.get('journal_entries_total_now', 0) >= contract['profiles']['smoke']['dataset']['minimum_journal_entries'] and seed['orders'] >= contract['profiles']['smoke']['dataset']['minimum_distinct_orders']
    checks['dataset_minimums'] = {'measured': {'tenants': seed['tenants'], 'journal_entries': seed.get('journal_entries_total_now'), 'orders': seed['orders']}, 'target': contract['profiles']['smoke']['dataset'], 'ok': dataset_ok}
    unmeasured = [k for k in ('snapshot_restart_ready_seconds_maximum', 'no_snapshot_rebuild_ready_seconds_maximum', 'backup_restore_query_ready_seconds_maximum', 'total_stack_peak_memory_mib_maximum', 'restart_unapplied_tail_entries') if k]
    failed = [k for k, v in checks.items() if v['ok'] is False]; missing = [k for k, v in checks.items() if v['ok'] is None]
    status = 'failed' if failed else 'passed_measured_targets'
    report = json.loads((ROOT / 'reports/performance.json').read_text())
    report['profiles']['smoke'] = {
        'status': status, 'tested_commit': a.commit, 'environment': a.environment, 'hardware': hw,
        'commands': ['node tests/perf/seed.mjs --orders 11000 --tenants 50', f"node tests/perf/load.mjs --duration {api['duration_s']} --mode api --rate {api['fixed_arrival_rate']} --clients {api['clients']} --ingest {api['ingest_rate_target']}", f"node tests/perf/load.mjs --duration {mcp['duration_s']} --mode mcp --rate {mcp['fixed_arrival_rate']} --clients {mcp['clients']} --ingest {mcp['ingest_rate_target']}"],
        'dataset_manifest': seed, 'measurements': {'api': api, 'mcp': mcp}, 'checks': checks, 'failed_targets': failed, 'unmeasured_targets': missing + unmeasured,
        'evidence_paths': ['tests/evidence/current/perf-seed-manifest.json', 'tests/evidence/current/perf-load-api.json', 'tests/evidence/current/perf-load-mcp.json', 'tests/evidence/current/perf-hardware.txt', 'tests/evidence/current/perf-engine-health-after-seed.json'],
        'limitations': ['Host is a developer Mac with Docker Desktop (shared with other workloads), not the contract reference host; container limits are those in infra/compose/compose.yaml.',
                        'Restart/rebuild/restore readiness seconds and total stack peak memory were not instrumented by the load driver; restart behaviour is covered functionally by SLICE-01 and restore by PILOT-02 evidence.',
                        'Durations shorter than the contract (if any) are recorded in measurements.api.duration_s / measurements.mcp.duration_s.'],
        'delivery_scope': 'local_pilot', 'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    report['note'] = f"Smoke profile measured at commit {a.commit[:12]}: {status}; failed targets: {failed or 'none'}; unmeasured: {len(missing + unmeasured)}. Reference and scale profiles remain deferred."
    (ROOT / 'reports/performance.json').write_text(json.dumps(report, indent=1) + '\n')
    print(status, 'failed:', failed, 'unmeasured:', missing)


if __name__ == '__main__':
    main()
