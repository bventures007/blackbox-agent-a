import { useState } from "react";
import { api } from "./api.js";
import { useLocale } from "./locale.js";
import {
  Panel,
  ErrorNotice,
  useAction,
  useRemote,
  DateText,
} from "./common.js";
const classes = [
  "provider_response",
  "typed_submission",
  "imported_document",
  "owner_assertion",
  "legacy_unclassified",
];
const copy = {
  en: {
    title: "Original content & retention",
    intro:
      "The default is 90 days from local receipt, including historical imports. Typed business facts remain queryable after the original content expires. This product default is not a statutory retention recommendation.",
    scope: "Source",
    all: "All",
    kind: "Evidence class",
    days: "Days from receipt",
    reason: "Reason",
    business: "Explicit business requirement",
    minimize: "Minimize retained content",
    default: "Default policy",
    ack: "I understand: shorter periods can immediately restrict existing content. Longer periods apply only to future receipts and never revive expired or restricted content. Stricter provider limits always apply.",
    save: "Save retention policy",
    future: "Selected policy saved. Existing content cannot gain extra time.",
    counts: "Accessible / pending physical removal / removed",
    unclassified:
      "Originals without a verified source/class association are blocked and scheduled for audited removal. Business facts remain available. A longer policy cannot reopen these originals.",
    blocked:
      "Restored raw content is blocked. Reconcile the policy and backup cutoff through the host before reopening it.",
    copies:
      "Old immutable backups and external exports remain unchanged. A current authenticated ledger prevents silent revival on restore. Copies outside this installation cannot be guaranteed erased.",
    generations: "Known managed backup generations",
    copyScan: "Inventory checked",
    copyTotal: "Completed generations found",
    copyUnknown:
      "The managed backup inventory is unavailable. Other backups and exported copies are unknown.",
    copyNone:
      "No backup destination is enrolled. Other backups and exported copies are unknown.",
    copyLimited:
      "Only the newest 100 generations are listed; older generations may also retain original content.",
    mayPredate: "May contain content removed or restricted since this cutoff",
    policyAtCutoff:
      "No later policy change is recorded; archive contents have not been inspected",
    copyBasis:
      "This bounded list checks managed metadata and file sizes, not archive contents or recoverability. Restricting live content does not delete these copies. Their configured backup retention policy applies; keep an independently exported current restriction ledger for recovery.",
    cleanup: "Physical removal runs through guarded host maintenance:",
    automatic:
      "While the backend is running, expired or restricted originals are checked hourly; abandoned temporary files are checked daily. Cleanup briefly pauses the application. Sleep or shutdown delays physical removal; access expires immediately.",
    maintenance: "Automatic cleanup",
    lastCheck: "Last check",
    lastCleanup: "Last completed cleanup",
    nextCheck: "Next check due",
    inactive:
      "The scheduler is not reporting a current heartbeat. Automatic cleanup cannot be confirmed; start the backend or inspect host status.",
    unavailable:
      "Automatic cleanup status is unavailable in this runtime. Use the host command for immediate removal.",
    states: {
      scheduled: "Scheduled",
      checking: "Checking",
      running: "Removing content",
      failed: "Check failed; retry pending",
      clock_anomaly: "Clock change requires attention",
      maintenance_required: "Interrupted maintenance requires host recovery",
    },
    history: "Latest 100 policy revisions",
    ceilings: "Stricter provider limits",
    names: [
      "Provider response",
      "Typed submission",
      "Imported document",
      "Owner assertion",
      "Unclassified legacy content",
    ],
    preview:
      "days from local receipt for original provider content. Configure source/class policies in Settings before importing; stricter provider limits apply.",
  },
  de: {
    title: "Originalinhalte & Aufbewahrung",
    intro:
      "Standardmäßig gelten 90 Tage ab lokalem Empfang, auch für historische Importe. Typisierte Geschäftsdaten bleiben nach Ablauf der Originalinhalte abfragbar. Dieser Produktstandard ist keine Empfehlung für gesetzliche Aufbewahrungsfristen.",
    scope: "Quelle",
    all: "Alle",
    kind: "Belegklasse",
    days: "Tage ab Empfang",
    reason: "Grund",
    business: "Ausdrückliche geschäftliche Anforderung",
    minimize: "Gespeicherte Inhalte minimieren",
    default: "Standardrichtlinie",
    ack: "Ich verstehe: Kürzere Fristen können vorhandene Inhalte sofort sperren. Längere Fristen gelten nur für zukünftige Eingänge und stellen abgelaufene oder gesperrte Inhalte nie wieder bereit. Strengere Anbietervorgaben gelten immer.",
    save: "Aufbewahrungsrichtlinie speichern",
    future:
      "Richtlinie gespeichert. Vorhandene Inhalte erhalten keine zusätzliche Zeit.",
    counts: "Zugänglich / Entfernung ausstehend / entfernt",
    unclassified:
      "Originale ohne bestätigte Quellen- und Belegklassenzuordnung sind gesperrt und für die protokollierte Entfernung vorgesehen. Geschäftsdaten bleiben verfügbar. Eine längere Frist gibt diese Originale nicht wieder frei.",
    blocked:
      "Wiederhergestellte Originalinhalte sind gesperrt. Gleiche Richtlinie und Sicherungsstand am Host ab, bevor du sie wieder freigibst.",
    copies:
      "Alte unveränderliche Sicherungen und externe Exporte bleiben unverändert. Ein aktuelles authentifiziertes Sperrverzeichnis verhindert eine unbemerkte Freigabe nach Wiederherstellung. Die Löschung von Kopien außerhalb dieser Installation kann nicht garantiert werden.",
    generations: "Bekannte verwaltete Sicherungsstände",
    copyScan: "Bestand geprüft",
    copyTotal: "Gefundene abgeschlossene Sicherungen",
    copyUnknown:
      "Der Bestand verwalteter Sicherungen ist nicht verfügbar. Weitere Sicherungen und exportierte Kopien sind unbekannt.",
    copyNone:
      "Es ist kein Sicherungsziel eingerichtet. Weitere Sicherungen und exportierte Kopien sind unbekannt.",
    copyLimited:
      "Nur die neuesten 100 Sicherungen werden angezeigt; ältere Sicherungen können ebenfalls Originalinhalte enthalten.",
    mayPredate:
      "Kann Inhalte enthalten, die seit diesem Stand entfernt oder gesperrt wurden",
    policyAtCutoff:
      "Keine spätere Richtlinienänderung erfasst; Archivinhalte wurden nicht geprüft",
    copyBasis:
      "Diese begrenzte Liste prüft verwaltete Metadaten und Dateigrößen, nicht Archivinhalte oder Wiederherstellbarkeit. Eine Sperrung im laufenden System löscht diese Kopien nicht. Es gilt die eingerichtete Aufbewahrung für Sicherungen; bewahre ein separat exportiertes aktuelles Sperrverzeichnis für die Wiederherstellung auf.",
    cleanup: "Die physische Entfernung erfolgt über geschützte Host-Wartung:",
    automatic:
      "Bei laufendem Backend werden abgelaufene oder gesperrte Originale stündlich geprüft; verwaiste temporäre Dateien täglich. Die Bereinigung pausiert die Anwendung kurz. Ruhezustand oder Ausschalten verzögert die physische Entfernung; der Zugriff endet sofort mit Ablauf der Frist.",
    maintenance: "Automatische Bereinigung",
    lastCheck: "Letzte Prüfung",
    lastCleanup: "Letzte abgeschlossene Bereinigung",
    nextCheck: "Nächste Prüfung fällig",
    inactive:
      "Der Zeitplaner meldet kein aktuelles Lebenszeichen. Die automatische Bereinigung ist nicht bestätigt; starte das Backend oder prüfe den Host-Status.",
    unavailable:
      "Der Status der automatischen Bereinigung ist in dieser Laufzeit nicht verfügbar. Nutze den Host-Befehl für die sofortige Entfernung.",
    states: {
      scheduled: "Geplant",
      checking: "Prüfung läuft",
      running: "Inhalte werden entfernt",
      failed: "Prüfung fehlgeschlagen; erneuter Versuch ausstehend",
      clock_anomaly: "Uhrzeitänderung muss geprüft werden",
      maintenance_required:
        "Unterbrochene Wartung erfordert Wiederaufnahme am Host",
    },
    history: "Letzte 100 Richtlinienänderungen",
    ceilings: "Strengere Anbietervorgaben",
    names: [
      "Anbieterantwort",
      "Typisierte Übermittlung",
      "Importiertes Dokument",
      "Eigene Bestätigung",
      "Nicht klassifizierte Altinhalte",
    ],
    preview:
      "Tage ab lokalem Empfang für Originalinhalte des Anbieters. Lege Quellen- und Klassenrichtlinien vor dem Import unter Einstellungen fest; strengere Anbietervorgaben gelten.",
  },
};
export function RetentionPreview({ days }: { days: number }) {
  const { locale } = useLocale();
  return (
    <p className="notice">
      {days} {copy[locale].preview}
    </p>
  );
}
export function EvidencePolicy() {
  const { locale } = useLocale(),
    s = copy[locale],
    remote = useRemote("/v1/evidence-policy", undefined, 5000),
    a = useAction();
  const [source, setSource] = useState(""),
    [kind, setKind] = useState(""),
    [days, setDays] = useState(90),
    [reason, setReason] = useState("default_policy"),
    [ack, setAck] = useState(false),
    [saved, setSaved] = useState(false);
  const className = (value: string | null) =>
    value ? (s.names[classes.indexOf(value)] ?? value) : s.all;
  return (
    <Panel title={s.title}>
      <p>{s.intro}</p>
      <ErrorNotice code={remote.error || a.error} />
      {remote.data?.recovery_blocked && (
        <p className="notice danger">{s.blocked}</p>
      )}
      {remote.data?.counts && (
        <p>
          {s.counts}: {remote.data.counts.accessible} /{" "}
          {remote.data.counts.removal_pending} / {remote.data.counts.disposed}
        </p>
      )}
      {remote.data?.counts?.unclassified > 0 && (
        <p role="status">
          {s.unclassified} ({remote.data.counts.unclassified})
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api("/v1/evidence-policy", {
              connection_id: source || null,
              evidence_class: kind || null,
              days,
              reason,
              acknowledged: ack,
            });
            setSaved(true);
            setAck(false);
            remote.refresh();
          });
        }}
      >
        <div className="two-columns">
          <label>
            {s.scope}
            <select
              aria-label={s.scope}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setAck(false);
                setSaved(false);
              }}
            >
              <option value="">{s.all}</option>
              {remote.data?.sources.map((v: any) => (
                <option key={v.connection_id} value={v.connection_id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {s.kind}
            <select
              aria-label={s.kind}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setAck(false);
                setSaved(false);
              }}
            >
              <option value="">{s.all}</option>
              {classes.map((v) => (
                <option key={v} value={v}>
                  {className(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {s.days}
            <input
              type="number"
              min={1}
              max={3650}
              required
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setAck(false);
                setSaved(false);
              }}
            />
          </label>
          <label>
            {s.reason}
            <select
              aria-label={s.reason}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setAck(false);
              }}
            >
              <option value="default_policy">{s.default}</option>
              <option value="minimize_content">{s.minimize}</option>
              <option value="business_requirement">{s.business}</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          {s.ack}
        </label>
        <button
          className="btn"
          disabled={
            a.busy ||
            !ack ||
            !remote.data ||
            !!remote.error ||
            (days > 90 && reason !== "business_requirement")
          }
        >
          {s.save}
        </button>
      </form>
      {saved && <p className="notice good">{s.future}</p>}
      {!!remote.data?.provider_limits?.length && (
        <div>
          <strong>{s.ceilings}</strong>
          {remote.data.provider_limits.map((p: any) => (
            <p key={p.connection_id + p.evidence_class}>
              {remote.data.sources.find(
                (v: any) => v.connection_id === p.connection_id,
              )?.name ?? s.scope}{" "}
              · {className(p.evidence_class)} · {p.days} {s.days}
            </p>
          ))}
        </div>
      )}
      <h3>{s.maintenance}</h3>
      <p>{s.automatic}</p>
      {remote.data?.maintenance?.state &&
      remote.data.maintenance.state !== "unavailable" ? (
        <div>
          <p>
            {s.states[remote.data.maintenance.state as keyof typeof s.states]}
          </p>
          {(!remote.data.maintenance.scheduler_alive ||
            remote.data.maintenance.status_stale) && (
            <p className="notice danger">{s.inactive}</p>
          )}
          <p>
            {s.lastCheck}:{" "}
            <DateText value={remote.data.maintenance.last_checked_at} />
          </p>
          <p>
            {s.lastCleanup}:{" "}
            <DateText value={remote.data.maintenance.last_completed} />
          </p>
          <p>
            {s.nextCheck}:{" "}
            <DateText value={remote.data.maintenance.next_check_at} />
          </p>
        </div>
      ) : (
        <p className="notice">{s.unavailable}</p>
      )}
      <p>{s.cleanup}</p>
      <pre>./blackbox evidence purge</pre>
      <p className="muted">{s.copies}</p>
      <details>
        <summary>{s.generations}</summary>
        <p>{s.copyBasis}</p>
        {remote.data?.maintenance?.copies?.state === "available" ? (
          <>
            <p>
              {s.copyScan}:{" "}
              <DateText value={remote.data.maintenance.copies.observed_at} />
            </p>
            <p>
              {s.copyTotal}: {remote.data.maintenance.copies.total}
            </p>
            {remote.data.maintenance.copies.truncated && (
              <p className="notice">{s.copyLimited}</p>
            )}
            {remote.data.maintenance.copies.generations.map((v: any) => (
              <p key={v.generation}>
                <code>{v.generation}</code> ·{" "}
                <DateText value={v.recoverable_cutoff} /> ·{" "}
                {remote.data.latest_content_policy_change &&
                Date.parse(v.recoverable_cutoff) <=
                  Date.parse(remote.data.latest_content_policy_change)
                  ? s.mayPredate
                  : s.policyAtCutoff}
              </p>
            ))}
          </>
        ) : (
          <p>
            {remote.data?.maintenance?.copies?.state === "not_configured"
              ? s.copyNone
              : s.copyUnknown}
          </p>
        )}
      </details>
      <details>
        <summary>{s.history}</summary>
        {remote.data?.policies.map((p: any) => (
          <p key={p.policy_id}>
            <DateText value={p.created_at} /> ·{" "}
            {remote.data.sources.find(
              (v: any) => v.connection_id === p.connection_id,
            )?.name ?? s.all}{" "}
            · {className(p.evidence_class)} · {p.days} {s.days}
          </p>
        ))}
      </details>
    </Panel>
  );
}
