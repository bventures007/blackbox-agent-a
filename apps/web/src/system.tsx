import { useState } from "react";
import { useLocale } from "./locale.js";
import { api, download } from "./api.js";
import {
  useRemote,
  useAction,
  Panel,
  Badge,
  DateText,
  ErrorNotice,
  Empty,
  Dialog,
} from "./common.js";
const summaries: Record<string, string> = {
  "service.started": "Dienst gestartet",
  "journal.batch_committed": "Journal-Stapel gespeichert",
  "engine.batch_applied": "Engine-Stapel verarbeitet",
  "query.served": "Geschäftsabfrage beantwortet",
  "worker.failed": "Worker-Vorgang fehlgeschlagen",
  "access.denied": "Zugriff abgelehnt",
  "source.fetched": "Anbieterseite abgerufen",
  "wrapper.command": "Host-Befehl gestartet",
};
export function System({
  connection = "",
  onSource,
}: {
  connection?: string;
  onSource: (id: string) => void;
}) {
  const { t, locale } = useLocale(),
    health = useRemote("/v1/diagnostics/health", undefined, 5000),
    a = useAction();
  const [range, setRange] = useState(1),
    [from, setFrom] = useState(new Date(Date.now() - 3600000).toISOString()),
    [levels, setLevels] = useState(["INFO", "WARN", "ERROR"]),
    [component, setComponent] = useState(""),
    [search, setSearch] = useState(""),
    [connectionId, setConnectionId] = useState(connection),
    [runId, setRunId] = useState(""),
    [traceId, setTraceId] = useState(""),
    [paused, setPaused] = useState(false),
    [frozen, setFrozen] = useState<any>(null),
    [extra, setExtra] = useState<any[]>([]),
    [next, setNext] = useState<string | null | undefined>(),
    [detail, setDetail] = useState<any>(null),
    [exporting, setExporting] = useState(false);
  const request = {
      from,
      levels,
      components: component ? [component] : [],
      search,
      ...(connectionId ? { connection_id: connectionId } : {}),
      ...(runId ? { run_id: runId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      limit: 200,
    },
    logs = useRemote("/v1/diagnostics/logs", request, 5000),
    shown = paused ? frozen : logs.data;
  const resetPage = () => {
    setExtra([]);
    setNext(undefined);
  };
  const rows = [...(shown?.records ?? []), ...extra],
    newCount =
      paused && logs.data
        ? logs.data.records.filter(
            (r: any) =>
              !frozen?.records.some((x: any) => x.record_id === r.record_id),
          ).length
        : 0;
  return (
    <>
      <ErrorNotice code={health.error} />
      {health.error && (
        <p className="notice danger">
          {t.stale} · <DateText value={health.data?.observed_at} />
        </p>
      )}
      <div className="health-grid">
        {[
          "api",
          "worker",
          "postgres",
          "engine",
          "diagnostics",
          "mcp",
          "backup",
        ].map((x) => (
          <Panel key={x} title={t[x as keyof typeof t]}>
            <Badge
              state={
                health.error
                  ? "unknown"
                  : (health.data?.[x]?.state ?? "unknown")
              }
            />
            {x === "api" && (
              <p>
                {t.version} {health.data?.api.version ?? "—"} ·{" "}
                {health.data?.api.uptime_seconds ?? "—"} {t.seconds}
              </p>
            )}
            {x === "engine" && (
              <p>
                {health.data?.engine.applied ?? "—"} /{" "}
                {health.data?.engine.committed ?? "—"}
              </p>
            )}
            {x === "worker" && (
              <p>
                <DateText value={health.data?.worker.heartbeat} />
              </p>
            )}
            {x === "mcp" && <p>{t.mcpUnknown}</p>}
            {x === "backup" && (
              <>
                <p>
                  {health.data?.backup.configured ? t.backupCutoff : t.noBackup}
                </p>
                {health.data?.backup.configured && (
                  <>
                    <DateText value={health.data.backup.recoverable_cutoff} />
                    {health.data.backup.overdue && (
                      <p className="notice danger">{t.backupOverdue}</p>
                    )}
                    {!health.data.backup.scheduler_alive && (
                      <p className="notice danger">
                        {t.backupSchedulerStopped}
                      </p>
                    )}
                    {health.data.backup.same_device && (
                      <p>{t.backupSameDevice}</p>
                    )}
                  </>
                )}
              </>
            )}
            <small>
              {t.observedAt}: <DateText value={health.data?.observed_at} />
            </small>
          </Panel>
        ))}
      </div>
      <Panel
        title={t.retained}
        actions={
          <div className="actions">
            <button
              className="btn small"
              onClick={() => {
                if (!paused) setFrozen(logs.data);
                setPaused(!paused);
                resetPage();
              }}
            >
              {paused ? `${t.resume} (${newCount})` : t.pause}
            </button>
            <button className="btn small" onClick={() => setExporting(true)}>
              {t.export}
            </button>
          </div>
        }
      >
        <div className="filters">
          <label>
            {t.from}
            <select
              value={range}
              onChange={(e) => {
                setRange(Number(e.target.value));
                setFrom(
                  new Date(
                    Date.now() - Number(e.target.value) * 3600000,
                  ).toISOString(),
                );
                resetPage();
              }}
            >
              <option value={1}>{t.lastHour}</option>
              <option value={24}>{t.lastDay}</option>
              <option value={168}>{t.lastWeek}</option>
            </select>
          </label>
          <label>
            {t.component}
            <select
              value={component}
              onChange={(e) => {
                setComponent(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t.all}</option>
              {["api", "worker", "engine", "mcp", "wrapper"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            {t.logSearch}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
            />
          </label>
        </div>
        <div className="level-filters">
          <span>{t.levels}</span>
          {["DEBUG", "INFO", "WARN", "ERROR"].map((level) => (
            <label key={level}>
              <input
                type="checkbox"
                checked={levels.includes(level)}
                onChange={() => {
                  setLevels((x) =>
                    x.includes(level)
                      ? x.length > 1
                        ? x.filter((v) => v !== level)
                        : x
                      : [...x, level],
                  );
                  resetPage();
                }}
              />
              {level}
            </label>
          ))}
          <button
            className="btn small"
            onClick={() => {
              setLevels(["WARN", "ERROR"]);
              resetPage();
            }}
          >
            {t.warnings}
          </button>
          <button
            className="btn small"
            onClick={() => {
              setLevels(["INFO", "WARN", "ERROR"]);
              setComponent("");
              setSearch("");
              setConnectionId("");
              setRunId("");
              setTraceId("");
              resetPage();
            }}
          >
            {t.clear}
          </button>
        </div>
        <details>
          <summary>{t.identity}</summary>
          <div className="form-grid">
            <label>
              {t.sources}
              <input
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  resetPage();
                }}
              />
            </label>
            <label>
              {t.imports}
              <input
                value={runId}
                onChange={(e) => {
                  setRunId(e.target.value);
                  resetPage();
                }}
              />
            </label>
            <label>
              Trace ID
              <input
                value={traceId}
                onChange={(e) => {
                  setTraceId(e.target.value);
                  resetPage();
                }}
              />
            </label>
          </div>
        </details>
        <ErrorNotice code={logs.error || a.error} />
        {logs.error && <p className="notice danger">{t.stale}</p>}
        <div className="table-scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th>{t.recordedAt}</th>
                <th>{t.levels}</th>
                <th>{t.component}</th>
                <th>{t.event}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.record_id}>
                  <td>
                    <DateText value={r.occurred_at} />
                  </td>
                  <td>
                    <Badge state={r.level} />
                  </td>
                  <td>{r.component}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setDetail(r)}
                    >
                      {locale === "de"
                        ? (summaries[r.event_name] ?? r.message)
                        : r.message}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty>{t.noLogs}</Empty>}
        {(next === undefined ? shown?.next_cursor : next) && (
          <button
            className="btn"
            onClick={() =>
              void a.run(async () => {
                const r = await api("/v1/diagnostics/logs", {
                  ...request,
                  cursor: next === undefined ? shown.next_cursor : next,
                });
                setExtra((x) => [
                  ...x,
                  ...r.records.filter(
                    (n: any) => !x.some((old) => old.record_id === n.record_id),
                  ),
                ]);
                setNext(r.next_cursor);
              })
            }
            disabled={a.busy}
          >
            {t.more}
          </button>
        )}
        <p className="notice">{t.logIncomplete}</p>
        <p className="footnote">
          {t.retention}: 7 {locale === "de" ? "Tage" : "days"} / 100 MiB ·{" "}
          {shown?.retention?.bytes ?? "—"} {t.bytes} ·{" "}
          <DateText value={shown?.retention?.oldest} /> —{" "}
          <DateText value={shown?.retention?.newest} />
        </p>
      </Panel>
      {detail && (
        <Dialog title={t.details} onClose={() => setDetail(null)}>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
          {detail.connection_id && (
            <button
              className="btn"
              onClick={() => {
                onSource(detail.connection_id);
                setDetail(null);
              }}
            >
              {t.sources} →
            </button>
          )}
        </Dialog>
      )}
      {exporting && (
        <Dialog title={t.exportTitle} onClose={() => setExporting(false)}>
          <p>{t.exportText}</p>
          <div className="actions">
            <button
              className="btn primary"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const file = await api("/v1/diagnostics/export", {
                    confirmed: true,
                  });
                  download(file, "blackbox-diagnostics.json");
                  setExporting(false);
                })
              }
            >
              {t.confirmExport}
            </button>
            <button className="btn" onClick={() => setExporting(false)}>
              {t.cancel}
            </button>
          </div>
          <ErrorNotice code={a.error} />
        </Dialog>
      )}
    </>
  );
}
