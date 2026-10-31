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
    blocked:
      "Restored raw content is blocked. Reconcile the policy and backup cutoff through the host before reopening it.",
    copies:
      "Old immutable backups and external exports remain unchanged. A current authenticated ledger prevents silent revival on restore. Copies outside this installation cannot be guaranteed erased.",
    cleanup: "Physical removal runs through guarded host maintenance:",
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
    blocked:
      "Wiederhergestellte Originalinhalte sind gesperrt. Gleiche Richtlinie und Sicherungsstand am Host ab, bevor du sie wieder freigibst.",
    copies:
      "Alte unveränderliche Sicherungen und externe Exporte bleiben unverändert. Ein aktuelles authentifiziertes Sperrverzeichnis verhindert eine unbemerkte Freigabe nach Wiederherstellung. Die Löschung von Kopien außerhalb dieser Installation kann nicht garantiert werden.",
    cleanup: "Die physische Entfernung erfolgt über geschützte Host-Wartung:",
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
      <p>{s.cleanup}</p>
      <pre>./blackbox evidence purge</pre>
      <p className="muted">{s.copies}</p>
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
