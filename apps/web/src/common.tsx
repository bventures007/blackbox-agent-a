import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.js";
import { useLocale } from "./locale.js";
import { Icon } from "./icons.js";
export function useRemote(path: string, body?: unknown, interval = 0) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    serialized = JSON.stringify(body);
  useEffect(() => {
    let active = true,
      inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api(
          path,
          serialized === undefined ? undefined : JSON.parse(serialized),
        );
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.code : "failure");
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = interval
      ? setInterval(() => {
          if (!document.hidden) void refresh();
        }, interval)
      : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, serialized, interval, revision]);
  return { data, error, refresh: () => setRevision((x) => x + 1) };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "failure");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
export function ErrorNotice({ code }: { code?: string }) {
  const { t } = useLocale();
  if (!code) return null;
  return (
    <p className="notice danger" role="alert">
      {t[code as keyof typeof t] ?? t.failure}
    </p>
  );
}
export function DateText({ value }: { value?: string | null }) {
  const { locale, t } = useLocale();
  return (
    <>
      {value
        ? new Date(value).toLocaleString(locale === "de" ? "de-DE" : "en-GB")
        : t.never}
    </>
  );
}
export function Badge({ state }: { state: string }) {
  const { t } = useLocale();
  return (
    <span className={"badge " + state}>
      {t[state as keyof typeof t] ?? state}
    </span>
  );
}
export function Panel({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      {title && (
        <div className="panel-head">
          <strong>{title}</strong>
          {actions}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLocale();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Copy({ value }: { value: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? t.copied : t.copy}
    </button>
  );
}
export function Secret({ value }: { value: string }) {
  const { t } = useLocale();
  return (
    <div className="secret">
      <h3>{t.saveKey}</h3>
      <p>{t.keyOnce}</p>
      <code>{value}</code>
      <Copy value={value} />
    </div>
  );
}
export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useLocale();
  return (
    <div className="empty">
      <Icon name="journal" />
      <p>{children ?? t.empty}</p>
    </div>
  );
}
export function Evidence({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useLocale(),
    a = useAction();
  const [ack, setAck] = useState(false),
    [restricted, setRestricted] = useState(false);
  const { data, error, refresh } = useRemote(
    "/v1/tools/get_evidence",
    {
      evidence_id: id,
    },
    3000,
  );
  return (
    <Dialog title={t.rawEvidence} onClose={onClose}>
      <p className="notice">{t.untrusted}</p>
      <ErrorNotice code={error || a.error} />
      {!data ? (
        <p>{t.loading}</p>
      ) : data.status === "available" && !restricted && !error ? (
        <>
          <pre>{JSON.stringify(data.content, null, 2)}</pre>
          <label className="check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            {locale === "de"
              ? "Originalinhalt dauerhaft sperren. Geschäftsdaten bleiben erhalten; vorhandene Sicherungen und Exporte bleiben unverändert."
              : "Permanently restrict original content. Business facts remain; existing backups and exports stay unchanged."}
          </label>
          <button
            className="btn"
            disabled={!ack || a.busy}
            onClick={() =>
              void a.run(async () => {
                await api(`/v1/evidence/${id}/restrict`, {
                  acknowledged: true,
                });
                setRestricted(true);
                refresh();
              })
            }
          >
            {locale === "de" ? "Inhalt sperren" : "Restrict content"}
          </button>
        </>
      ) : (
        <p>{t.contentUnavailable}</p>
      )}
    </Dialog>
  );
}
export function Entry({
  entry,
  onClose,
  onEntity,
}: {
  entry: any;
  onClose: () => void;
  onEntity: (id: string) => void;
}) {
  const { t } = useLocale();
  const [evidence, setEvidence] = useState("");
  return (
    <Dialog title={t.details} onClose={onClose}>
      <Badge state={entry.record_type} />
      <h3>{entry.event_type}</h3>
      {entry.payload?.test && <p className="notice">{t.testData}</p>}
      <dl className="details">
        <div>
          <dt>{t.sequence}</dt>
          <dd>{entry.sequence}</dd>
        </div>
        <div>
          <dt>{t.identity}</dt>
          <dd>{entry.entity_id}</dd>
        </div>
        <div>
          <dt>{t.effective}</dt>
          <dd>
            <DateText value={entry.occurred_at} />
          </dd>
        </div>
        <div>
          <dt>{t.recordedAt}</dt>
          <dd>
            <DateText value={entry.recorded_at} />
          </dd>
        </div>
        <div>
          <dt>{t.rule}</dt>
          <dd>{entry.rule_version}</dd>
        </div>
        {entry.supersedes_entry_id && (
          <div>
            <dt>{t.supersedes}</dt>
            <dd>{entry.supersedes_entry_id}</dd>
          </div>
        )}
      </dl>
      <div className="actions">
        <button
          className="btn primary"
          onClick={() => setEvidence(entry.evidence_id)}
        >
          {t.showEvidence}
        </button>
        <button
          className="btn"
          onClick={() => {
            onEntity(entry.entity_id);
            onClose();
          }}
        >
          {t.history}
        </button>
      </div>
      <details>
        <summary>{t.structured}</summary>
        <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
      </details>
      {evidence && <Evidence id={evidence} onClose={() => setEvidence("")} />}
    </Dialog>
  );
}
