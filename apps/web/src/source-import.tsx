import { useState, useEffect, useRef } from "react";
import { api } from "./api.js";
import { useLocale } from "./locale.js";
import {
  Dialog,
  Panel,
  DateText,
  useAction,
  useRemote,
  Empty,
} from "./common.js";
const en = {
  needs_review: "Needs review",
  state: "State",
  setup: "Connect Shopify",
  name: "Connection name",
  shop: "Shop domain",
  auth: "Authentication",
  token: "Existing app access token",
  client: "Client credentials (your organization)",
  clientId: "Client ID",
  clientSecret: "Client secret",
  validate: "Check connection",
  prerequisites:
    "Use a read-authorized app installed on your shop. Client credentials work for shops in your own Shopify organization. Existing app tokens can be used where Shopify permits them.",
  protected:
    "Credentials are encrypted locally and are never shown again. Closing this form clears its fields.",
  choose: "Choose your history",
  timezone: "Timezone",
  range: "History range",
  last_30_days: "Last 30 days",
  this_year: "This year",
  last_12_months: "Last 12 months",
  custom: "Choose a start date",
  from_now: "From now on",
  customDate: "Start date",
  advanced: "Advanced scope",
  open: "Include accessible older open and unsettled orders",
  related: "Include older related transactions needed to interpret records",
  opening: "Request available opening state",
  openingNote:
    "Orders do not provide a historical opening inventory or payment-provider balance. Those answers remain incomplete until a suitable source supplies them.",
  strict:
    "From now on requires an explicit choice. Older business records can be included by the options below. Turn all three off for strict new data only.",
  preview: "Review scope",
  start: "Start import",
  expand: "Import more history",
  reconnect: "Reconnect account",
  review: "Review your import",
  from: "Requested from",
  through: "Initial cutoff",
  limitations: "Known limitations",
  ack: "I understand the available scope and these gaps.",
  unknownTotal:
    "The total is not known yet. Counts will show durable logical records; no estimated completion percentage is used.",
  check_connection: "Check connection",
  import_records: "Import records",
  link_and_process: "Link and process",
  ready_for_queries: "Ready for scoped queries",
  scopes: "Granted scopes",
  capabilities: "Capabilities",
  orders: "Orders",
  payments: "Payments",
  refunds: "Refunds",
  stock: "Inventory snapshots (requires inventory read access)",
  fulfillments: "Fulfillments and recorded handover milestones",
  allocations:
    "Fulfillment assignments (separate fulfillment-order access required)",
  sourceHealth: "Collection and import progress",
  lastSuccess: "Last successful scoped check",
  lastNew: "Last new record",
  next: "Next check",
  reconcile: "Last reconciliation",
  poll: "Poll interval",
  seconds: "seconds",
  history: "History remains partial",
  observed: "Status observed",
  discovered: "Logical records found",
  committed: "Committed",
  processed: "Processed",
  duplicates: "Duplicates",
  skipped: "Outside scope",
  quarantined: "Needs review",
  processingNotice:
    "Processed records can still lack data needed for a particular question. Snapshot answers apply only at their declared cutoff.",
  pause: "Pause this run",
  resume: "Resume this run",
  retry: "Retry this run",
  cancel: "Cancel this run",
  cancelNotice:
    "Canceling preserves all committed history. A missing scope remains visible.",
  logs: "View logs",
  noJobs: "No scheduled imports for this source.",
  busy: "Working…",
  done: "Plan saved. Collection continues in the background.",
  failure:
    "The source action could not finish. Your committed history is preserved.",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  complete_with_gaps: "Finished with gaps",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Canceled",
  reauthorization_required: "Reconnect required",
  configured: "Configured",
  ready_with_gaps: "Current checks; history gaps",
  retry_wait: "Waiting to retry",
  delayed: "Delayed",
  backfilling: "Importing history",
  initial: "Initial history",
  incremental: "New activity",
  reconciliation: "Reconciliation",
  history_expansion: "History expansion",
  close: "Close",
  changed: "Change scope",
  unsupported:
    "This flow imports orders, payments and refunds, with optional inventory snapshots, fulfillments and location assignments. Other selected Shopify capabilities are still being implemented.",
};
const de: Record<keyof typeof en, string> = {
  needs_review: "Prüfung erforderlich",
  state: "Status",
  setup: "Shopify verbinden",
  name: "Name der Verbindung",
  shop: "Shop-Domain",
  auth: "Authentifizierung",
  token: "Vorhandenes App-Zugriffstoken",
  client: "Client-Zugangsdaten (eigene Organisation)",
  clientId: "Client-ID",
  clientSecret: "Client-Geheimnis",
  validate: "Verbindung prüfen",
  prerequisites:
    "Verwende eine im Shop installierte App mit Leseberechtigung. Client-Zugangsdaten gelten für Shops deiner eigenen Shopify-Organisation. Vorhandene App-Tokens können verwendet werden, soweit Shopify dies erlaubt.",
  protected:
    "Zugangsdaten werden lokal verschlüsselt und nicht erneut angezeigt. Beim Schließen werden die Formularfelder geleert.",
  choose: "Zeitraum wählen",
  timezone: "Zeitzone",
  range: "Historischer Zeitraum",
  last_30_days: "Letzte 30 Tage",
  this_year: "Dieses Jahr",
  last_12_months: "Letzte 12 Monate",
  custom: "Startdatum auswählen",
  from_now: "Ab jetzt",
  customDate: "Startdatum",
  advanced: "Erweiterter Umfang",
  open: "Zugängliche ältere offene und noch nicht abgewickelte Aufträge einbeziehen",
  related: "Ältere zugehörige Transaktionen zur Einordnung einbeziehen",
  opening: "Verfügbare Anfangsbestände anfordern",
  openingNote:
    "Aufträge liefern keinen historischen Lageranfangsbestand oder Saldo des Zahlungsanbieters. Diese Antworten bleiben unvollständig, bis eine geeignete Quelle die Daten liefert.",
  strict:
    "Für „Ab jetzt“ ist eine ausdrückliche Auswahl nötig. Die folgenden Optionen können ältere Geschäftsdaten einbeziehen. Deaktiviere alle drei, um ausschließlich neue Daten zu importieren.",
  preview: "Umfang prüfen",
  start: "Import starten",
  expand: "Weitere Historie importieren",
  reconnect: "Konto erneut verbinden",
  review: "Import prüfen",
  from: "Angefordert ab",
  through: "Ende des Erstimports",
  limitations: "Bekannte Einschränkungen",
  ack: "Ich verstehe den verfügbaren Umfang und diese Lücken.",
  unknownTotal:
    "Die Gesamtzahl ist noch unbekannt. Die Zähler zeigen dauerhaft gespeicherte logische Datensätze; es wird kein geschätzter Gesamtfortschritt angezeigt.",
  check_connection: "Verbindung prüfen",
  import_records: "Datensätze importieren",
  link_and_process: "Verknüpfen und verarbeiten",
  ready_for_queries: "Bereit für abgegrenzte Abfragen",
  scopes: "Erteilte Berechtigungen",
  capabilities: "Datenbereiche",
  orders: "Aufträge",
  payments: "Zahlungen",
  refunds: "Erstattungen",
  stock: "Bestandsaufnahmen (Leseberechtigung für Lagerbestand erforderlich)",
  fulfillments: "Auslieferungen und erfasste Übergabezeitpunkte",
  allocations:
    "Zuordnungen zur Auslieferung (separate Leseberechtigung erforderlich)",
  sourceHealth: "Erfassung und Importfortschritt",
  lastSuccess: "Letzte erfolgreiche Prüfung des Datenumfangs",
  lastNew: "Letzter neuer Datensatz",
  next: "Nächste Prüfung",
  reconcile: "Letzter Abgleich",
  poll: "Abfrageintervall",
  seconds: "Sekunden",
  history: "Historie bleibt teilweise unvollständig",
  observed: "Status erfasst",
  discovered: "Gefundene logische Datensätze",
  committed: "Gespeichert",
  processed: "Verarbeitet",
  duplicates: "Duplikate",
  skipped: "Außerhalb des Umfangs",
  quarantined: "Prüfung erforderlich",
  processingNotice:
    "Auch verarbeitete Datensätze können für eine bestimmte Frage unvollständig sein. Antworten aus Momentaufnahmen gelten nur zum ausgewiesenen Stichtag.",
  pause: "Diesen Lauf pausieren",
  resume: "Diesen Lauf fortsetzen",
  retry: "Diesen Lauf wiederholen",
  cancel: "Diesen Lauf abbrechen",
  cancelNotice:
    "Beim Abbrechen bleiben alle gespeicherten Daten erhalten. Fehlende Bereiche bleiben sichtbar.",
  logs: "Protokolle anzeigen",
  noJobs: "Keine geplanten Importe für diese Quelle.",
  busy: "Wird bearbeitet…",
  done: "Plan gespeichert. Die Erfassung läuft im Hintergrund weiter.",
  failure:
    "Die Quellenaktion konnte nicht abgeschlossen werden. Deine gespeicherten Daten bleiben erhalten.",
  queued: "Eingeplant",
  running: "Wird ausgeführt",
  paused: "Pausiert",
  complete_with_gaps: "Mit Lücken abgeschlossen",
  complete: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  reauthorization_required: "Erneute Verbindung erforderlich",
  configured: "Konfiguriert",
  ready_with_gaps: "Aktuelle Prüfungen; Lücken in der Historie",
  retry_wait: "Warten auf Wiederholung",
  delayed: "Verzögert",
  backfilling: "Historie wird importiert",
  initial: "Erstimport",
  incremental: "Neue Aktivität",
  reconciliation: "Abgleich",
  history_expansion: "Erweiterung der Historie",
  close: "Schließen",
  changed: "Umfang ändern",
  unsupported:
    "Dieser Ablauf importiert Aufträge, Zahlungen und Erstattungen sowie optional Bestandsaufnahmen, Auslieferungen und Standortzuordnungen. Weitere ausgewählte Shopify-Datenbereiche werden noch implementiert.",
};
const reasons: Record<string, [string, string]> = {
  provider_query_cost_exceeded: [
    "Shopify rejected even the smallest bounded query. Collection is stopped for this run; inspect the source limitations before retrying.",
    "Shopify hat auch die kleinste begrenzte Abfrage abgelehnt. Dieser Lauf wurde gestoppt; prüfe die Einschränkungen der Quelle vor einem erneuten Versuch.",
  ],
  allocation_assignments_not_reservations: [
    "Assignments show which location should fulfill an order. They do not prove reserved stock or a priority policy.",
    "Zuordnungen zeigen, welcher Standort einen Auftrag ausliefern soll. Sie belegen keinen reservierten Bestand und keine Prioritätsregel.",
  ],
  allocation_accessible_subset: [
    "Shopify exposes only fulfillment orders permitted by the granted access. Complete reservation coverage needs additional evidence.",
    "Shopify liefert nur Auslieferungsaufträge innerhalb der erteilten Berechtigungen. Vollständige Reservierungsdaten benötigen zusätzliche Belege.",
  ],
  provider_read_fulfillment_orders_required: [
    "The installed app needs fulfillment-order read access for assignments.",
    "Die installierte App benötigt für Zuordnungen eine Leseberechtigung für Auslieferungsaufträge.",
  ],
  provider_allocation_scope_lost: [
    "Fulfillment-order access narrowed. Reconnect and review the available categories.",
    "Der Zugriff auf Auslieferungsaufträge wurde eingeschränkt. Verbinde das Konto erneut und prüfe die verfügbaren Kategorien.",
  ],
  fulfillment_preparation_is_not_handover: [
    "A prepared fulfillment is not proof of courier handover. Missing milestone timestamps leave delivery answers incomplete.",
    "Eine vorbereitete Auslieferung belegt keine Übergabe an den Transportdienst. Fehlende Zeitpunkte lassen Lieferantworten unvollständig.",
  ],
  inventory_current_snapshot_only: [
    "Inventory supplies current states, not historical opening balances or the causes of quantity changes.",
    "Lagerdaten liefern aktuelle Zustände, keine historischen Anfangsbestände oder Ursachen von Mengenänderungen.",
  ],
  inventory_non_atomic_locations: [
    "Locations are read in sequence. The result is not an atomic stock count; unknown or invalid quantities stay unresolved.",
    "Standorte werden nacheinander gelesen. Das Ergebnis ist keine gleichzeitige Bestandszählung; unbekannte oder ungültige Mengen bleiben ungeklärt.",
  ],
  inventory_scan_bounded: [
    "Inventory scans are bounded to 50,000 items and 248 locations per item. Exceeding a limit leaves an explicit gap.",
    "Bestandsabfragen sind auf 50.000 Artikel und 248 Standorte je Artikel begrenzt. Beim Überschreiten bleibt eine sichtbare Lücke.",
  ],
  provider_read_inventory_required: [
    "The installed app needs inventory read access for this selection.",
    "Die installierte App benötigt für diese Auswahl eine Leseberechtigung für Lagerbestand.",
  ],
  provider_history_scope_lost: [
    "Order-history access changed. Reconnect and review the available scope.",
    "Die Berechtigung für die Auftragshistorie wurde geändert. Verbinde das Konto erneut und prüfe den verfügbaren Umfang.",
  ],
  source_records_quarantined: [
    "Some records need review. A successful later check does not repair this gap.",
    "Einige Datensätze müssen geprüft werden. Eine spätere erfolgreiche Prüfung behebt diese Lücke nicht.",
  ],
  current_snapshots_cannot_reconstruct_intermediate_changes: [
    "Current snapshots cannot reconstruct every intermediate change.",
    "Aktuelle Momentaufnahmen können nicht jede zwischenzeitliche Änderung rekonstruieren.",
  ],
  order_line_cancellation_and_gross_may_require_review: [
    "Ambiguous line cancellations or amounts require review.",
    "Mehrdeutige Stornierungen oder Beträge auf Positionsebene müssen geprüft werden.",
  ],
  open_order_filter_cannot_certify_all_unresolved_obligations: [
    "Shopify’s open-order filters cannot certify every unresolved obligation.",
    "Shopifys Filter für offene Aufträge können nicht alle unerledigten Verpflichtungen bestätigen.",
  ],
  older_orders_require_read_all_orders: [
    "Older orders require Shopify’s read_all_orders permission.",
    "Ältere Aufträge benötigen Shopifys Berechtigung read_all_orders.",
  ],
  requested_history_exceeds_order_permission: [
    "The requested history extends beyond the granted order history. The original request is retained and the gap remains visible.",
    "Der gewünschte Zeitraum überschreitet die erlaubte Auftragshistorie. Die ursprüngliche Anfrage bleibt gespeichert und die Lücke sichtbar.",
  ],
  different_account_requires_new_connection: [
    "These credentials belong to another shop. Create a separate connection.",
    "Diese Zugangsdaten gehören zu einem anderen Shop. Erstelle eine separate Verbindung.",
  ],
  account_already_connected: [
    "This shop is already connected. Use Reconnect on that connection.",
    "Dieser Shop ist bereits verbunden. Verwende dort „Konto erneut verbinden“.",
  ],
  provider_authorization_required: [
    "Shopify rejected these credentials. Check the app installation and token.",
    "Shopify hat diese Zugangsdaten abgelehnt. Prüfe App-Installation und Token.",
  ],
  provider_read_orders_required: [
    "The installed app needs read_orders access.",
    "Die installierte App benötigt die Berechtigung read_orders.",
  ],
  history_import_already_active: [
    "A history import is already active. Cancel or finish it before expanding.",
    "Ein historischer Import ist bereits aktiv. Brich ihn ab oder warte auf den Abschluss, bevor du den Zeitraum erweiterst.",
  ],
  history_expansion_required: [
    "Choose an earlier start or additional context to expand the saved plan.",
    "Wähle einen früheren Beginn oder zusätzlichen Kontext, um den gespeicherten Plan zu erweitern.",
  ],
  provider_network_unavailable: [
    "Shopify could not be reached. Check the connection and try again.",
    "Shopify war nicht erreichbar. Prüfe die Verbindung und versuche es erneut.",
  ],
  provider_rate_limited: [
    "Shopify’s request limit was reached. The worker waits before retrying.",
    "Shopifys Anfragelimit wurde erreicht. Der Hintergrunddienst wartet vor dem nächsten Versuch.",
  ],
  invalid_shop: [
    "Enter only your shop’s myshopify.com domain.",
    "Gib ausschließlich die myshopify.com-Domain deines Shops ein.",
  ],
};
function useCopy() {
  const { locale } = useLocale();
  return { s: locale === "de" ? de : en, language: locale === "de" ? 1 : 0 };
}
function Reason({ code }: { code: string }) {
  const { s, language } = useCopy();
  return <>{reasons[code]?.[language] ?? s.failure}</>;
}
export function ShopifySetup({
  onClose,
  onSaved,
  connection,
}: {
  onClose: () => void;
  onSaved: () => void;
  connection?: string;
}) {
  const { s } = useCopy(),
    a = useAction(),
    [name, setName] = useState("Shopify"),
    [shop, setShop] = useState(""),
    [auth, setAuth] = useState("access_token"),
    [token, setToken] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [connected, setConnected] = useState<any>(null);
  if (connected)
    return (
      <ImportPlan
        connection={connected.connection_id}
        timezone={connected.timezone}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Dialog title={s.setup} onClose={onClose}>
      <p>{s.prerequisites}</p>
      <p className="muted">{s.protected}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            const result = await api(
              "/v1/sources/shopify",
              {
                name,
                connection_id: connection,
                credentials: {
                  shop: shop.trim().toLowerCase(),
                  auth,
                  ...(auth === "access_token"
                    ? { access_token: token }
                    : { client_id: clientId, client_secret: clientSecret }),
                },
              },
              50000,
            );
            setToken("");
            setClientSecret("");
            setClientId("");
            onSaved();
            if (connection) onClose();
            else setConnected(result);
          });
        }}
      >
        <label>
          {s.name}
          <input
            id="shopify-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label>
          {s.shop}
          <input
            id="shopify-domain"
            placeholder="your-shop.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            pattern="[a-z0-9][a-z0-9-]*\.myshopify\.com"
            autoComplete="off"
            required
          />
        </label>
        <label>
          {s.auth}
          <select value={auth} onChange={(e) => setAuth(e.target.value)}>
            <option value="access_token">{s.token}</option>
            <option value="client_credentials">{s.client}</option>
          </select>
        </label>
        {auth === "access_token" ? (
          <label>
            {s.token}
            <input
              id="shopify-token"
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              minLength={8}
              maxLength={4096}
            />
          </label>
        ) : (
          <>
            <label>
              {s.clientId}
              <input
                autoComplete="off"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <label>
              {s.clientSecret}
              <input
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                required
                minLength={8}
              />
            </label>
          </>
        )}
        {a.error && (
          <p className="notice danger" role="alert">
            <Reason code={a.error} />
          </p>
        )}
        <button className="btn primary" disabled={a.busy}>
          {a.busy ? s.busy : s.validate}
        </button>
      </form>
    </Dialog>
  );
}
export function ImportPlan({
  connection,
  timezone,
  onClose,
  onSaved,
}: {
  connection: string;
  timezone?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const scopeTouched = useRef(false);
  const { s } = useCopy(),
    r = useRemote("/v1/sources/readiness"),
    a = useAction(),
    [includeStock, setIncludeStock] = useState(false),
    [includeFulfillments, setIncludeFulfillments] = useState(false),
    [includeAllocations, setIncludeAllocations] = useState(false),
    [preset, setPreset] = useState("last_30_days"),
    [zone, setZone] = useState(
      timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [date, setDate] = useState(""),
    [context, setContext] = useState({
      include_open_items: true,
      include_related_records: true,
      include_opening_state: true,
    }),
    [preview, setPreview] = useState<any>(null),
    [ack, setAck] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    const proposed = r.data?.workspace?.suggested_history_from;
    if (proposed && !scopeTouched.current) {
      setPreset("custom");
      setDate(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(proposed)),
      );
    }
  }, [r.data?.workspace?.suggested_history_from]);
  const body = {
    selection: {
      preset,
      timezone: zone,
      ...(preset === "custom" ? { custom_date: date } : {}),
      ...context,
    },
    capabilities: [
      "orders",
      "payments",
      "refunds",
      ...(includeStock ? ["stock"] : []),
      ...(includeFulfillments ? ["fulfillments"] : []),
      ...(includeAllocations ? ["allocations"] : []),
    ],
    acknowledge_restrictions: ack,
  };
  return (
    <Dialog title={preview ? s.review : s.choose} onClose={onClose}>
      <p className="notice">{s.unsupported}</p>
      {done ? (
        <>
          <p className="notice good">{s.done}</p>
          <dl className="details">
            <div>
              <dt>{s.from}</dt>
              <dd>
                <DateText value={preview.parameters.requested_from} />
              </dd>
            </div>
            <div>
              <dt>{s.through}</dt>
              <dd>
                <DateText value={preview.parameters.initial_cutoff} />
              </dd>
            </div>
          </dl>
          <button className="btn primary" onClick={onClose}>
            {s.close}
          </button>
        </>
      ) : preview ? (
        <>
          <dl className="details">
            <div>
              <dt>{s.from}</dt>
              <dd>
                <DateText value={preview.parameters.requested_from} />
              </dd>
            </div>
            <div>
              <dt>{s.through}</dt>
              <dd>
                <DateText value={preview.parameters.initial_cutoff} />
              </dd>
            </div>
            <div>
              <dt>{s.timezone}</dt>
              <dd>{preview.parameters.timezone}</dd>
            </div>
          </dl>
          <h3>{s.limitations}</h3>
          <ul>
            {preview.restrictions.map((code: string) => (
              <li key={code}>
                <Reason code={code} />
              </li>
            ))}
          </ul>
          <p>{s.openingNote}</p>
          <p className="muted">{s.unknownTotal}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            {s.ack}
          </label>
          <div className="actions">
            <button
              className="btn"
              onClick={() => {
                setPreview(null);
                setAck(false);
              }}
            >
              {s.changed}
            </button>
            <button
              id="start-source-import"
              className="btn primary"
              disabled={!ack || a.busy}
              onClick={() =>
                void a.run(async () => {
                  const plan = await api(
                    `/v1/sources/${connection}/import`,
                    body,
                  );
                  setPreview(plan);
                  setDone(true);
                  onSaved();
                })
              }
            >
              {a.busy ? s.busy : s.start}
            </button>
          </div>
        </>
      ) : (
        <form
          onChange={() => {
            scopeTouched.current = true;
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () =>
              setPreview(await api(`/v1/sources/${connection}/preview`, body)),
            );
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={includeStock}
              onChange={(e) => setIncludeStock(e.target.checked)}
            />
            {s.stock}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeFulfillments}
              onChange={(e) => setIncludeFulfillments(e.target.checked)}
            />
            {s.fulfillments}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeAllocations}
              onChange={(e) => setIncludeAllocations(e.target.checked)}
            />
            {s.allocations}
          </label>
          <label>
            {s.range}
            <select
              id="import-range"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (e.target.value === "from_now")
                  setContext({
                    include_open_items: false,
                    include_related_records: false,
                    include_opening_state: false,
                  });
              }}
            >
              {["last_30_days", "this_year", "last_12_months", "custom"].map(
                (x) => (
                  <option key={x} value={x}>
                    {s[x as keyof typeof s]}
                  </option>
                ),
              )}
              <optgroup label={s.advanced}>
                <option value="from_now">{s.from_now}</option>
              </optgroup>
            </select>
          </label>
          {preset === "custom" && (
            <label>
              {s.customDate}
              <input
                id="import-start-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            {s.timezone}
            <input
              id="import-timezone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          {preset === "from_now" && <p className="notice">{s.strict}</p>}
          {(
            [
              "include_open_items",
              "include_related_records",
              "include_opening_state",
            ] as const
          ).map((key, i) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={context[key]}
                onChange={(e) =>
                  setContext({ ...context, [key]: e.target.checked })
                }
              />
              {[s.open, s.related, s.opening][i]}
            </label>
          ))}
          <p className="muted">{s.openingNote}</p>
          <button className="btn primary" disabled={a.busy}>
            {a.busy ? s.busy : s.preview}
          </button>
        </form>
      )}
      {a.error && (
        <p className="notice danger" role="alert">
          <Reason code={a.error} />
        </p>
      )}
    </Dialog>
  );
}
export function SourceProgress({
  connection,
  onLogs,
  onChanged,
}: {
  connection: string;
  onLogs: (id: string) => void;
  onChanged: () => void;
}) {
  const { s } = useCopy(),
    r = useRemote("/v1/sources/readiness", undefined, 5000),
    a = useAction(),
    [plan, setPlan] = useState(false),
    [reconnect, setReconnect] = useState(false),
    [cancel, setCancel] = useState<any>(null);
  const health =
      r.data?.capabilities.filter((x: any) => x.connection_id === connection) ??
      [],
    runs =
      r.data?.runs.filter((x: any) => x.connection_id === connection) ?? [];
  const label = (value: string) => s[value as keyof typeof s] ?? value;
  const refresh = () => {
    r.refresh();
    onChanged();
  };
  const action = (job: any, act: string) =>
    void a.run(async () => {
      await api(`/v1/imports/${job.job_id}/control`, { action: act });
      setCancel(null);
      refresh();
    });
  return (
    <section className="source-progress">
      <div className="actions">
        <button className="btn small" onClick={() => setPlan(true)}>
          {s.expand}
        </button>
        <button className="btn small" onClick={() => setReconnect(true)}>
          {s.reconnect}
        </button>
      </div>
      {health.map((h: any) => (
        <details key={h.capability}>
          <summary>
            {label(h.capability)} · {label(h.effective_state)}
          </summary>
          <dl className="details">
            {[
              [s.lastSuccess, h.last_success_at],
              [s.lastNew, h.last_new_at],
              [s.next, h.next_poll_at],
              [s.reconcile, h.last_reconciliation_at],
            ].map(([name, time]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <DateText value={time} />
                </dd>
              </div>
            ))}
            <div>
              <dt>{s.poll}</dt>
              <dd>
                {h.poll_seconds} {s.seconds}
              </dd>
            </div>
          </dl>
          <p className="notice">{s.history}</p>
          {h.error_code && (
            <p className="notice danger">
              <Reason code={h.error_code} />
            </p>
          )}
        </details>
      ))}
      <p className="muted">{s.processingNotice}</p>
      {runs.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  s.capabilities,
                  s.state,
                  s.discovered,
                  s.committed,
                  s.processed,
                  s.quarantined,
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((j: any) => (
                <tr key={j.job_id}>
                  <td>
                    {label(j.capability)}
                    <small>{label(j.kind)}</small>
                  </td>
                  <td>
                    {label(j.state)}
                    <small>{label(j.phase)}</small>
                  </td>
                  <td>{j.discovered}</td>
                  <td>{j.committed_objects}</td>
                  <td>{j.processed_objects}</td>
                  <td>
                    {j.quarantined}
                    <details>
                      <summary>{s.advanced}</summary>
                      <p>
                        {s.duplicates}: {j.duplicates} · {s.skipped}:{" "}
                        {j.skipped}
                      </p>
                      <div className="actions">
                        {["queued", "running"].includes(j.state) && (
                          <button
                            className="btn small"
                            disabled={a.busy}
                            onClick={() => action(j, "pause")}
                          >
                            {s.pause}
                          </button>
                        )}
                        {j.state === "paused" && (
                          <button
                            className="btn small"
                            disabled={a.busy}
                            onClick={() => action(j, "resume")}
                          >
                            {s.resume}
                          </button>
                        )}
                        {["failed", "reauthorization_required"].includes(
                          j.state,
                        ) && (
                          <button
                            className="btn small"
                            disabled={a.busy}
                            onClick={() => action(j, "retry")}
                          >
                            {s.retry}
                          </button>
                        )}
                        {[
                          "queued",
                          "running",
                          "paused",
                          "failed",
                          "reauthorization_required",
                        ].includes(j.state) && (
                          <button
                            className="btn small"
                            onClick={() => setCancel(j)}
                          >
                            {s.cancel}
                          </button>
                        )}
                        <button
                          className="btn small"
                          onClick={() => onLogs(connection)}
                        >
                          {s.logs}
                        </button>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{s.noJobs}</Empty>
      )}
      {a.error && (
        <p role="alert" className="notice danger">
          <Reason code={a.error} />
        </p>
      )}
      <p className="muted">
        {s.observed}: <DateText value={r.data?.observed_at} />
      </p>
      {plan && (
        <ImportPlan
          connection={connection}
          onClose={() => setPlan(false)}
          onSaved={refresh}
        />
      )}
      {reconnect && (
        <ShopifySetup
          connection={connection}
          onClose={() => setReconnect(false)}
          onSaved={refresh}
        />
      )}
      {cancel && (
        <Dialog title={s.cancel} onClose={() => setCancel(null)}>
          <p>{s.cancelNotice}</p>
          <button
            className="btn"
            disabled={a.busy}
            onClick={() => action(cancel, "cancel")}
          >
            {s.cancel}
          </button>
        </Dialog>
      )}
    </section>
  );
}
