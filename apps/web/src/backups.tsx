import { api } from "./api.js";
import { useLocale } from "./locale.js";
import {
  Panel,
  Badge,
  DateText,
  ErrorNotice,
  useAction,
  useRemote,
} from "./common.js";

export function Backups() {
  const { t, locale } = useLocale(),
    remote = useRemote("/v1/backups", undefined, 5000),
    action = useAction(),
    value = remote.data;
  return (
    <Panel title={t.backup}>
      <Badge state={remote.error ? "unknown" : (value?.state ?? "unknown")} />
      <ErrorNotice code={remote.error || action.error} />
      {!value?.configured ? (
        <>
          <p>{t.noBackup}</p>
          <p>{t.backupText}</p>
          <pre>./blackbox backup configure /absolute/backup-destination</pre>
          <p className="muted">{t.backupPostpone}</p>
        </>
      ) : (
        <>
          {value.overdue && <p className="notice danger">{t.backupOverdue}</p>}
          {!value.scheduler_alive && (
            <p className="notice danger">
              {t.backupSchedulerStopped} <code>./blackbox up</code>
            </p>
          )}
          {!value.destination_available && (
            <p className="notice danger">{t.backupDestinationMissing}</p>
          )}
          {value.same_device && <p className="notice">{t.backupSameDevice}</p>}
          {value.clock_anomaly && (
            <p className="notice danger">{t.backupClock}</p>
          )}
          {value.maintenance_required && (
            <p className="notice danger">
              {t.backupMaintenance} <code>./blackbox backup recover</code>
            </p>
          )}
          {value.retention_error && (
            <p className="notice danger">{t.backupRetentionError}</p>
          )}
          <dl className="details">
            <div>
              <dt>{t.backupLastAttempt}</dt>
              <dd>
                <DateText value={value.last_attempt} />
              </dd>
            </div>
            <div>
              <dt>{t.backupLastCompleted}</dt>
              <dd>
                <DateText value={value.last_completed} />
              </dd>
            </div>
            <div>
              <dt>{t.backupCutoff}</dt>
              <dd>
                <DateText value={value.recoverable_cutoff} />
              </dd>
            </div>
            <div>
              <dt>{t.backupAge}</dt>
              <dd>
                {value.recoverable_age_seconds == null
                  ? "—"
                  : (value.recoverable_age_seconds / 3600).toLocaleString(
                      locale,
                      { maximumFractionDigits: 1 },
                    ) +
                    " " +
                    t.backupHours}
              </dd>
            </div>
            <div>
              <dt>{t.backupNextDue}</dt>
              <dd>
                <DateText value={value.next_due_at} />
              </dd>
            </div>
            <div>
              <dt>{t.backupSize}</dt>
              <dd>
                {value.bytes == null
                  ? "—"
                  : (value.bytes / 1048576).toLocaleString(locale, {
                      maximumFractionDigits: 2,
                    }) + " MiB"}
              </dd>
            </div>
            <div>
              <dt>{t.backupRestoreTest}</dt>
              <dd>
                <DateText value={value.last_restore_test} />
              </dd>
            </div>
          </dl>
          <p>
            {t.backupSchedule}:{" "}
            {(value.interval_seconds / 3600).toLocaleString(locale)}{" "}
            {t.backupHours} · {value.daily_retention} {t.backupDaily} /{" "}
            {value.weekly_retention} {t.backupWeekly}
          </p>
          <p className="muted">{t.backupScheduleHelp}</p>
          <pre>
            ./blackbox backup policy --interval-hours 23.5 --daily 7 --weekly 4
          </pre>
          <button
            className="btn"
            disabled={
              action.busy ||
              !!remote.error ||
              value.request_pending ||
              value.state === "running" ||
              !value.scheduler_alive ||
              value.maintenance_required
            }
            onClick={() =>
              void action.run(async () => {
                await api("/v1/backups/request", {});
                remote.refresh();
              })
            }
          >
            {value.request_pending ? t.backupQueued : t.backupNow}
          </button>
          <p className="muted">{t.backupPause}</p>
        </>
      )}
      <p>{t.backupRecoveryHelp}</p>
      <pre>
        ./blackbox restore /absolute/generation.bb.age --to
        /absolute/new-installation --port 18755
      </pre>
    </Panel>
  );
}
