import { recordGermanFields, recordGermanValues } from "./record-labels.js";
import { useState } from "react";
import { intents } from "../../../packages/contracts/questions.js";
import { useLocale, questionTitles, semanticNames } from "./locale.js";
import { api } from "./api.js";
import {
  Panel,
  ErrorNotice,
  useAction,
  Evidence,
  DateText,
  Badge,
  Empty,
} from "./common.js";
import { Icon } from "./icons.js";
const germanFields: Record<string, string> = {
  ...recordGermanFields,
  account_id: "Konto-ID",
  active_reserved: "Aktiv reserviert",
  agreed_covered_gross_minor: "Vereinbarter abgedeckter Bruttobetrag",
  allocated: "Zugeordnet",
  allocated_capture_minor: "Zugeordneter Einzug",
  amount_minor: "Betrag",
  arrival_date: "Ankunftsdatum",
  attention: "Aufmerksamkeit erforderlich",
  automatic_action: "Automatische Aktion",
  available: "Verfügbar",
  available_minor: "Verfügbar",
  bank_confirmed_minor: "Von Bank bestätigt",
  cash_refund_confirmed: "Gelderstattung bestätigt",
  cash_refund_due_minor: "Fällige Gelderstattung",
  chargeback_fees_excluded: "Rückbuchungsgebühren ausgeschlossen",
  collected_minor: "Eingezogen",
  communication_count: "Nachrichtenanzahl",
  computed_net_minor: "Berechneter Nettobetrag",
  conclusion: "Ergebnis",
  credit_balance_minor: "Guthaben",
  currency: "Währung",
  customer_due: "Kundenzusage",
  delivered: "Geliefert",
  difference_minor: "Differenz",
  do_not_mark_complete: "Nicht als abgeschlossen markieren",
  due_date: "Fälligkeitsdatum",
  excess_minor: "Überschuss",
  facts: "Fakten",
  failed_history_retained: "Fehlgeschlagene Versuche bleiben erhalten",
  fee_added_to_customer_debt: "Gebühr zur Kundenschuld addiert",
  fees_minor: "Gebühren",
  forecast_at: "Prognosezeitpunkt",
  from_free_stock: "Aus freiem Bestand",
  from_owned_reservation: "Aus eigener Reservierung",
  gross_minor: "Bruttobetrag",
  held_for_review: "Zur Prüfung zurückgehalten",
  held_minor: "Einbehalten",
  id: "Identität",
  in_transit_minor: "Unterwegs",
  incoming_counted_as_stock: "Wareneingang als Bestand gezählt",
  invoice_covered_gross_minor: "Abgedeckter Rechnungsbruttobetrag",
  latest_scan_age_seconds: "Alter des letzten Scans in Sekunden",
  line_id: "Positions-ID",
  lines: "Positionen",
  matching_entries: "Passende Einträge",
  member_postings: "Zugehörige Buchungen",
  missing_confirmation: "Fehlende Bestätigung",
  missing_invoice: "Fehlende Rechnung",
  net_assets_minor: "Nettovermögen",
  net_customer_repayments_minor: "Netto-Rückzahlungen an Kunden",
  new_cash_from_marker: "Zusätzlicher Geldfluss aus Zahlungsmarkierung",
  open_minor: "Offen",
  order_id: "Auftrags-ID",
  original_transaction_id: "Ursprüngliche Transaktion",
  over_reserved: "Zu viel reserviert",
  overdue: "Überfällig",
  pending_overlap: "Ausstehende Überschneidung",
  physical_return_received: "Physische Retoure eingegangen",
  prior_promises_checked: "Vorherige Zusagen geprüft",
  processing_minor: "In Verarbeitung",
  promised_at: "Zugesagt für",
  provider_total_minor: "Gesamt beim Anbieter",
  provisional_plan: "Vorläufiger Plan",
  quarantined_quantity: "Menge in Quarantäne",
  queue_label: "Prüfkategorie",
  receipt_state: "Eingangsstatus",
  received_quantity: "Eingegangene Menge",
  recipient_delivery_proven: "Empfängerzustellung belegt",
  reconciled: "Abgestimmt",
  recovered: "Später erfolgreich",
  release_is_only_promised: "Freigabe ist nur zugesagt",
  release_promised_at: "Freigabe zugesagt für",
  released_minor: "Freigegeben",
  remaining_minor: "Verbleibend",
  remaining_obligation: "Verbleibende Verpflichtung",
  remaining_steps: "Offene Schritte",
  remaining_to_deliver: "Noch zu liefern",
  remaining_to_dispatch: "Noch zu versenden",
  reported_open_minor: "Gemeldeter offener Betrag",
  request_is_not_receipt: "Anforderung ist kein Eingang",
  requested: "Angefragt",
  requested_quantity: "Angefragte Menge",
  required: "Benötigt",
  required_minor: "Benötigter Betrag",
  reservation_step: "Reservierungsschritt",
  review_required: "Prüfung erforderlich",
  risk: "Risiko",
  sellable_added: "Verkaufbarer Bestand hinzugefügt",
  send_action: "Versandaktion",
  send_evidence: "Versandbeleg",
  send_reminder: "Erinnerung senden",
  shortfall: "Fehlmenge",
  stale_is_not_failure: "Veralteter Stand bedeutet keinen Fehlschlag",
  state: "Zustand",
  status: "Status",
  stock_mutated: "Bestand verändert",
  stock_receipt_required: "Wareneingang erforderlich",
  supply_after: "Zulieferung danach",
  supply_id: "Zulieferungs-ID",
  unallocated_payments_separate: "Nicht zugeordnete Zahlungen getrennt",
  under_reserved: "Zu wenig reserviert",
  unexplained_minor: "Ungeklärt",
  uninvoiced_minor: "Nicht fakturiert",
  unit: "Einheit",
  unknown_components: "Unbekannte Bestandteile",
  unknown_components_are_zero: "Unbekannte Bestandteile als null gezählt",
  without_send_evidence: "Ohne Versandbeleg",
};
export function Value({
  value,
  currency,
  field = "",
}: {
  value: any;
  currency?: string;
  field?: string;
}) {
  const { locale, t } = useLocale();
  if (value === null || value === undefined)
    return <span className="muted">{t.null}</span>;
  if (typeof value === "boolean") return <>{value ? t.yes : t.no}</>;
  if (typeof value === "object")
    return Array.isArray(value) ? (
      <div className="value-list">
        {value.length
          ? value.map((v, i) => <Value key={i} value={v} currency={currency} />)
          : "—"}
      </div>
    ) : (
      <dl className="result-fields">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>
              {locale === "de"
                ? (germanFields[k] ?? k)
                : k.replace(/_minor$/, "").replaceAll("_", " ")}
              {k.endsWith("_minor") && !currency && !value.currency
                ? ` (${t.minorUnits})`
                : ""}
            </dt>
            <dd>
              <Value
                value={v}
                currency={value.currency ?? currency}
                field={k}
              />
            </dd>
          </div>
        ))}
      </dl>
    );
  if (typeof value === "number" && field.endsWith("_minor") && currency) {
    const digits =
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return (
      <strong>
        {new Intl.NumberFormat(locale, { style: "currency", currency }).format(
          value / 10 ** digits,
        )}
      </strong>
    );
  }
  return (
    <span>
      {t[value as keyof typeof t] ??
        semanticNames[String(value)]?.[locale === "de" ? 1 : 0] ??
        (locale === "de" ? recordGermanValues[String(value)] : undefined) ??
        String(value)}
    </span>
  );
}
export function Questions({
  initialEntity = "",
  initialIntent = 0,
}: {
  initialEntity?: string;
  initialIntent?: number;
}) {
  const { locale, t } = useLocale(),
    a = useAction();
  const [choice, setChoice] = useState(initialIntent),
    [entity, setEntity] = useState(initialEntity),
    [search, setSearch] = useState(""),
    [result, setResult] = useState<any>(null),
    [scope, setScope] = useState<any>(null),
    [evidence, setEvidence] = useState("");
  const [item, setItem] = useState(""),
    [quantity, setQuantity] = useState("100"),
    [unit, setUnit] = useState("piece"),
    [currency, setCurrency] = useState(""),
    [asOf, setAsOf] = useState(""),
    [cutoff, setCutoff] = useState("");
  const read = async (cursor?: string) => {
    const request = cursor
      ? { ...scope, cursor }
      : {
          intent: intents[choice],
          ...(entity ? { entity_id: entity } : {}),
          ...(item ? { item_id: item } : {}),
          ...(currency ? { currency } : {}),
          ...(asOf ? { as_of: new Date(asOf).toISOString() } : {}),
          ...(cutoff ? { recorded_cutoff: Number(cutoff) } : {}),
          ...(choice === 0 ? { requested_quantity: quantity, unit } : {}),
        };
    const response = await api("/v1/tools/query_business", request);
    setScope(request);
    setResult(response);
  };
  return (
    <div className="answers-layout">
      <Panel title={t.askTitle}>
        <p className="muted">{t.askIntro}</p>
        <form
          className="question-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() => read());
          }}
        >
          <label>
            {t.filterTemplates}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
            />
          </label>
          <label>
            {t.question}
            <select
              id="question-template"
              value={choice}
              onChange={(e) => {
                setChoice(Number(e.target.value));
                setResult(null);
              }}
            >
              {questionTitles.map((q, i) =>
                q[locale === "de" ? 1 : 0]
                  .toLowerCase()
                  .includes(search.toLowerCase()) || i === choice ? (
                  <option key={i} value={i}>
                    {String(i + 1).padStart(2, "0")} ·{" "}
                    {q[locale === "de" ? 1 : 0]}
                  </option>
                ) : null,
              )}
            </select>
          </label>
          <div className="form-grid">
            <label>
              {t.entity}
              <input
                id="template-entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder={t.allEntities}
                pattern="[0-9a-fA-F-]{36}"
              />
            </label>
            <label>
              {t.currency}
              <input
                id="query-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder={t.optional}
                pattern="[A-Z]{3}"
                maxLength={3}
              />
            </label>
            {choice === 0 && (
              <>
                <label>
                  {t.item}
                  <input
                    id="query-item"
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    placeholder={t.optional}
                    pattern="[0-9a-fA-F-]{36}"
                  />
                </label>
                <label>
                  {t.quantity}
                  <input
                    required
                    id="query-quantity"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    inputMode="decimal"
                    pattern="[0-9]+(\.[0-9]{1,6})?"
                  />
                </label>
                <label>
                  {t.unit}
                  <select
                    id="query-unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  >
                    {["piece", "kg", "litre", "metre"].map((x) => (
                      <option value={x} key={x}>
                        {t[x as keyof typeof t]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              {t.asOf}
              <input
                type="datetime-local"
                id="query-asOf"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <label>
              {t.cutoff}
              <input
                type="number"
                min="0"
                step="1"
                id="query-cutoff"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
                placeholder={t.optional}
              />
            </label>
          </div>
          <button className="btn primary" id="ask-template" disabled={a.busy}>
            <Icon name="answers" />
            {a.busy ? t.busy : t.ask}
          </button>
        </form>
        <p className="footnote">
          <Icon name="shield" />
          {t.modelFree}
        </p>
        <ErrorNotice code={a.error} />
      </Panel>
      {result ? (
        <Panel
          title={
            questionTitles[intents.indexOf(result.intent)][
              locale === "de" ? 1 : 0
            ]
          }
        >
          <Badge state={result.status} />
          <p className="notice">{t.notVerified}</p>
          {result.human_confirmed_inputs?.length > 0 && (
            <div className="notice">
              <strong>
                {locale === "de"
                  ? "Enthält menschlich bestätigte Angaben"
                  : "Includes human-confirmed information"}
              </strong>
              <p>
                {locale === "de"
                  ? "Die ursprünglichen Anbieterangaben bleiben im Verlauf erhalten. Entscheidungen und Belege sind unter Quellen → Prüfung erforderlich verfügbar."
                  : "Original provider claims remain in history. Decisions and evidence are available under Sources → Needs review."}
              </p>
            </div>
          )}
          <dl className="details">
            <div>
              <dt>{t.cutoff}</dt>
              <dd>{result.recorded_cutoff}</dd>
            </div>
            <div>
              <dt>{t.asOf}</dt>
              <dd>
                <DateText value={result.as_of} />
              </dd>
            </div>
            <div>
              <dt>{t.scope}</dt>
              <dd>
                {scope.entity_id ?? scope.item_id ?? t.allEntities}
                {scope.currency ? " · " + scope.currency : ""}
              </dd>
            </div>
          </dl>
          {result.missing_inputs?.length > 0 && (
            <div className="notice">
              <strong>{t.missing}</strong>
              <ul>
                {result.missing_inputs.map((x: string) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {result.conflicts?.length > 0 && (
            <div className="notice danger">
              <strong>{t.conflicts}</strong>
              <Value value={result.conflicts} />
            </div>
          )}
          {result.result?.rows?.length ? (
            result.result.rows.map((row: any, i: number) => (
              <div className="answer-row" key={i}>
                <Value value={row} />
              </div>
            ))
          ) : (
            <p>
              {result.status === "insufficient_data"
                ? t.insufficient_data
                : t.noRows}
            </p>
          )}
          <div className="evidence-links">
            {result.evidence?.map((id: string, i: number) => (
              <button
                key={id}
                className="btn small"
                onClick={() => setEvidence(id)}
              >
                <Icon name="shield" />
                {t.evidence} {i + 1}
              </button>
            ))}
          </div>
          {result.next_cursor && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() => void a.run(() => read(result.next_cursor))}
            >
              {t.more}
            </button>
          )}
          <details>
            <summary>{t.structured}</summary>
            <pre id="query-result">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </Panel>
      ) : (
        <Empty>{t.noAnswer}</Empty>
      )}
      {evidence && <Evidence id={evidence} onClose={() => setEvidence("")} />}
    </div>
  );
}
