import { useEffect, useState } from "react";
import { datasetRecord } from "../../../packages/contracts/records.js";
import { intents } from "../../../packages/contracts/questions.js";
import { useLocale, questionTitles, semanticNames } from "./locale.js";
import { api, ApiError } from "./api.js";
import {
  Panel,
  Dialog,
  Evidence,
  DateText,
  useRemote,
  Empty,
} from "./common.js";
import {
  recordGermanFields as deFields,
  recordGermanValues as deValues,
} from "./record-labels.js";
import { Value } from "./questions.js";

const copy = {
  title: ["Needs review", "Prüfung erforderlich"],
  intro: [
    "Resolve a specific uncertainty using its evidence. Saved decisions preserve the original facts and history.",
    "Kläre eine konkrete Unsicherheit anhand ihrer Belege. Gespeicherte Entscheidungen erhalten die ursprünglichen Fakten und den Verlauf.",
  ],
  inspect: ["Inspect case", "Prüffall öffnen"],
  source: ["Source", "Quelle"],
  account: ["Account", "Konto"],
  original: ["Current accepted facts", "Aktuell angenommene Fakten"],
  claim: ["Conflicting provider claim", "Abweichende Angabe des Anbieters"],
  evidence: ["Evidence", "Belege"],
  useClaim: ["Use proposed values", "Vorgeschlagene Werte übernehmen"],
  edit: ["Correction", "Korrektur"],
  action: ["Decision", "Entscheidung"],
  correct: ["Append a correction", "Korrektur ergänzen"],
  retry: [
    "Retry the original input",
    "Ursprüngliche Eingabe erneut verarbeiten",
  ],
  leave: ["Leave unresolved", "Ungeklärt lassen"],
  confirm_link: [
    "Confirm proposed link",
    "Vorgeschlagene Zuordnung bestätigen",
  ],
  reject_link: ["Reject proposed link", "Vorgeschlagene Zuordnung ablehnen"],
  reason: ["Reason", "Begründung"],
  note: ["What did you verify?", "Was hast du geprüft?"],
  support: [
    "Supporting evidence text (optional; encrypted)",
    "Ergänzender Belegtext (optional; verschlüsselt)",
  ],
  original_confirmed: [
    "Original evidence confirmed",
    "Ursprünglichen Beleg bestätigt",
  ],
  provider_claim_confirmed: [
    "Provider claim confirmed",
    "Anbieterangabe bestätigt",
  ],
  external_document: ["External document checked", "Externen Beleg geprüft"],
  human_observation: ["My direct observation", "Meine eigene Beobachtung"],
  link_confirmed: ["Link verified", "Zuordnung geprüft"],
  link_rejected: ["Link rejected", "Zuordnung abgelehnt"],
  retry_mapping: [
    "Retry with current processing rules",
    "Mit aktuellen Verarbeitungsregeln erneut versuchen",
  ],
  needs_more_evidence: ["More evidence needed", "Weitere Belege erforderlich"],
  acknowledge: [
    "I checked the evidence. This records a human decision and does not certify complete provider history.",
    "Ich habe die Belege geprüft. Dies erfasst eine menschliche Entscheidung und bestätigt keine vollständige Anbieterhistorie.",
  ],
  revise: ["Revise saved decision", "Gespeicherte Entscheidung überarbeiten"],
  save: ["Save decision", "Entscheidung speichern"],
  saved: [
    "Decision saved; recalculating",
    "Entscheidung gespeichert; wird neu berechnet",
  ],
  unresolved: ["Still unresolved", "Weiterhin ungeklärt"],
  open: ["Open", "Offen"],
  in_progress: ["Recalculating", "Wird neu berechnet"],
  resolved: ["Resolved", "Geklärt"],
  ownerActor: ["Recorded by owner", "Vom Inhaber erfasst"],
  privacy: [
    "Notes and supporting documents are encrypted and available for 90 days by default. Typed business facts remain in history.",
    "Notizen und ergänzende Belege werden verschlüsselt und sind standardmäßig 90 Tage verfügbar. Strukturierte Geschäftsfakten bleiben im Verlauf erhalten.",
  ],
  history: ["Decision history", "Entscheidungsverlauf"],
  affected: ["Affected questions", "Betroffene Fragen"],
  minor: [
    "Minor currency units, for example 100 = EUR 1.00",
    "Kleinste Währungseinheiten, zum Beispiel 100 = 1,00 EUR",
  ],
  limitations: [
    "Identities and line membership stay fixed. A correction supersedes this exact assertion; it does not create extra cash or restock a return.",
    "Identitäten und Positionszugehörigkeiten bleiben fest. Eine Korrektur ersetzt diese konkrete Aussage; sie erzeugt keinen zusätzlichen Geldfluss und lagert keine Retoure ein.",
  ],
  noTyped: [
    "This input has no accepted typed facts to edit. Inspect its evidence, retry the original input or leave it unresolved.",
    "Diese Eingabe enthält keine angenommenen strukturierten Fakten zum Bearbeiten. Prüfe den Beleg, verarbeite die ursprüngliche Eingabe erneut oder lasse sie ungeklärt.",
  ],
  invalid: [
    "One or more values do not match the required format. Use the original units and date format.",
    "Einige Werte entsprechen nicht dem erforderlichen Format. Verwende die ursprünglichen Einheiten und das Datumsformat.",
  ],
  retryLimit: [
    "Three retry attempts used. Further evidence or an evidenced correction is needed.",
    "Drei Wiederholungsversuche aufgebraucht. Weitere Belege oder eine belegte Korrektur sind erforderlich.",
  ],
  provider_content_conflict: [
    "Different content for the same provider revision",
    "Abweichender Inhalt für dieselbe Anbieterversion",
  ],
  unresolved_link: [
    "Unverified proposed link",
    "Ungeprüfte vorgeschlagene Zuordnung",
  ],
  genericReason: [
    "Input requires evidence review",
    "Eingabe erfordert eine Belegprüfung",
  ],
  checks: ["Questions checked", "Geprüfte Fragen"],
  required: ["Required journal cursor", "Erforderlicher Journalstand"],
  review_revision_conflict: [
    "This case changed. Close and reopen it before deciding.",
    "Dieser Fall hat sich geändert. Schließe und öffne ihn erneut, bevor du entscheidest.",
  ],
  review_stale_entry: [
    "Newer facts arrived. Reopen the case to review them.",
    "Neuere Fakten sind eingetroffen. Öffne den Fall erneut, um sie zu prüfen.",
  ],
  review_identity_change: [
    "A correction cannot replace the identities in this record.",
    "Eine Korrektur darf die Identitäten dieses Datensatzes nicht ersetzen.",
  ],
  review_evidence_unavailable: [
    "The original evidence is unavailable or expired. Original-content reprocessing is unavailable.",
    "Der ursprüngliche Beleg ist nicht verfügbar oder abgelaufen. Eine erneute Verarbeitung des Originalinhalts ist nicht möglich.",
  ],
  review_retry_limit: [
    "The original input has reached its three-attempt retry limit.",
    "Die ursprüngliche Eingabe hat ihr Limit von drei Wiederholungsversuchen erreicht.",
  ],
  review_retry_unavailable: [
    "This input does not support retained-source reprocessing.",
    "Für diese Eingabe ist keine erneute Verarbeitung der gespeicherten Quelle verfügbar.",
  ],
  review_decision_superseded: [
    "A newer assertion superseded this decision before confirmation. Inspect the current facts.",
    "Eine neuere Aussage hat diese Entscheidung vor der Bestätigung ersetzt. Prüfe die aktuellen Fakten.",
  ],
  review_link_target_unavailable: [
    "The proposed link target is not present in this workspace.",
    "Das Ziel der vorgeschlagenen Zuordnung ist in diesem Arbeitsbereich nicht vorhanden.",
  ],
  failure: [
    "The operation could not be completed. Reload the case and inspect diagnostics if it persists.",
    "Der Vorgang konnte nicht abgeschlossen werden. Lade den Fall neu und prüfe bei anhaltenden Problemen die Diagnose.",
  ],
} satisfies Record<string, [string, string]>;
function Fields({
  value,
  schema,
  onChange,
  field = "",
}: {
  value: any;
  schema: any;
  onChange: (v: any) => void;
  field?: string;
}) {
  const { locale, t } = useLocale();
  let shape = schema;
  while (shape?.unwrap) shape = shape.unwrap();
  const label =
    locale === "de" ? (deFields[field] ?? field) : field.replaceAll("_", " ");
  if (Array.isArray(value))
    return (
      <fieldset>
        <legend>{label}</legend>
        {value.map((v, i) => (
          <Fields
            key={i}
            value={v}
            schema={shape?.element}
            field={String(i + 1)}
            onChange={(next) =>
              onChange(value.map((old, n) => (n === i ? next : old)))
            }
          />
        ))}
      </fieldset>
    );
  if (value && typeof value === "object")
    return (
      <div className="review-fields">
        {Object.entries(value).map(([k, v]) => (
          <Fields
            key={k}
            field={k}
            value={v}
            schema={shape?.shape?.[k]}
            onChange={(next) => onChange({ ...value, [k]: next })}
          />
        ))}
      </div>
    );
  const locked =
    field === "dataset" ||
    field.endsWith("_id") ||
    field.endsWith("_ids") ||
    ["reference", "trace_reference"].includes(field);
  const options = shape?.options?.filter?.((v: any) => typeof v === "string");
  const title = (v: string) =>
    locale === "de"
      ? (deValues[v] ?? t[v as keyof typeof t] ?? semanticNames[v]?.[1] ?? v)
      : (t[v as keyof typeof t] ??
        semanticNames[v]?.[0] ??
        v.replaceAll("_", " "));
  return (
    <label data-field={field}>
      {label}
      {field.endsWith("_minor") && (
        <small>{copy.minor[locale === "de" ? 1 : 0]}</small>
      )}
      {options ? (
        <select
          value={value ?? ""}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((v: string) => (
            <option key={v} value={v}>
              {title(v)}
            </option>
          ))}
        </select>
      ) : typeof value === "boolean" ? (
        <input
          type="checkbox"
          checked={value}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : (
        <input
          value={field === "dataset" ? title(value) : (value ?? "")}
          readOnly={locked}
          type={typeof value === "number" ? "number" : "text"}
          step={typeof value === "number" ? 1 : undefined}
          onChange={(e) =>
            onChange(
              typeof value === "number"
                ? Number(e.target.value)
                : e.target.value || null,
            )
          }
        />
      )}
    </label>
  );
}
function ReviewDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { locale } = useLocale(),
    i = locale === "de" ? 1 : 0,
    t = (k: string) => (copy[k as keyof typeof copy] ?? copy.failure)[i];
  const { data, error, refresh } = useRemote("/v1/reviews/" + id);
  const [allowRevision, setAllowRevision] = useState(false);
  const [record, setRecord] = useState<any>(null),
    [action, setAction] = useState("leave"),
    [note, setNote] = useState(""),
    [reason, setReason] = useState("needs_more_evidence"),
    [support, setSupport] = useState(""),
    [ack, setAck] = useState(false),
    [evidence, setEvidence] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [progress, setProgress] = useState<any>(null),
    [command, setCommand] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (data) {
      setRecord(data.current?.payload?.record ?? null);
      if (data.state === "in_progress" && !allowRevision)
        setProgress({ state: "recalculating" });
    }
  }, [data, allowRevision]);
  useEffect(() => {
    if (progress?.state !== "recalculating") return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        const next = await api("/v1/reviews/" + id + "/check", {});
        if (!stopped) {
          setProgress(next);
          if (next.state !== "recalculating") {
            onChanged();
            refresh();
          }
        }
      } catch (e) {
        if (!stopped) {
          setFailure(e instanceof ApiError ? e.code : "failure");
          setProgress(null);
        }
      }
    }, 750);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [progress, id, onChanged]);
  const submit = async () => {
    setBusy(true);
    setFailure("");
    try {
      const result = await api("/v1/reviews/" + id + "/decisions", {
        command_id: command,
        revision: data.revision,
        action,
        reason_code: reason,
        note,
        evidence_ids: [
          ...new Set(
            [
              data.original_evidence_id,
              data.claim_evidence_id,
              data.evidence_id,
            ].filter(Boolean),
          ),
        ],
        ...(support ? { supporting_content: support } : {}),
        ...(record && action !== "leave" && action !== "retry"
          ? { record, expected_entry_id: data.current.entry_id }
          : {}),
        acknowledged: true,
      });
      setProgress(result);
      refresh();
      onChanged();
    } catch (e) {
      setFailure(e instanceof ApiError ? e.code : "failure");
    } finally {
      setBusy(false);
    }
  };
  const editable = action === "correct";
  const schema = datasetRecord.options.find(
    (o) => o.shape.dataset.value === record?.dataset,
  );
  const canLink =
    record &&
    ["payment_allocations", "identity", "bank"].includes(record.dataset);
  return (
    <Dialog title={t("title")} onClose={onClose}>
      {error && <p role="alert">{t(error)}</p>}
      {data && (
        <>
          <p>
            <span className={"badge " + data.state}>{t(data.state)}</span>
            <strong>
              {copy[data.kind as keyof typeof copy]
                ? t(data.kind)
                : t("genericReason")}
            </strong>
          </p>
          <p>
            {t("source")}: {data.source_name ?? data.provider} · {t("account")}:{" "}
            <code>{data.account_anchor}</code>
          </p>
          <div className="actions">
            {[
              ...new Set(
                [
                  data.original_evidence_id,
                  data.claim_evidence_id,
                  data.evidence_id,
                ].filter(Boolean),
              ),
            ].map((e: any) => (
              <button
                className="btn small"
                key={e}
                onClick={() => setEvidence(e)}
              >
                {t("evidence")} · {e.slice(0, 8)}
              </button>
            ))}
          </div>
          {data.current?.payload?.record && (
            <details>
              <summary>{t("original")}</summary>
              <Value value={data.current.payload.record} />
            </details>
          )}
          {data.proposed_observation && (
            <details>
              <summary>{t("claim")}</summary>
              <Value value={data.proposed_observation.record} />
            </details>
          )}
          <details>
            <summary>{t("affected")}</summary>
            <ul>
              {data.affected_intents.map((intent: string) => (
                <li key={intent}>
                  {questionTitles[intents.indexOf(intent as any)]?.[i] ??
                    intent}
                </li>
              ))}
            </ul>
          </details>
          {progress && (
            <p className="notice" role="status">
              {t(progress.state === "recalculating" ? "saved" : progress.state)}
              {progress.total
                ? ` · ${t("checks")}: ${progress.checked}/${progress.total}`
                : ""}
              {progress.required_cursor
                ? ` · ${t("required")}: ${progress.required_cursor}`
                : ""}
            </p>
          )}
          {failure && (
            <p className="notice danger" role="alert">
              {t(failure)}
            </p>
          )}
          {data.state === "in_progress" && !allowRevision && (
            <button
              className="btn small"
              onClick={() => {
                setAllowRevision(true);
                setProgress(null);
                setCommand(crypto.randomUUID());
              }}
            >
              {t("revise")}
            </button>
          )}
          {!progress &&
            data.state !== "resolved" &&
            (data.state !== "in_progress" || allowRevision) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
                className="question-form"
              >
                <label>
                  {t("action")}
                  <select
                    aria-label={t("action")}
                    value={action}
                    onChange={(e) => {
                      setAction(e.target.value);
                      setCommand(crypto.randomUUID());
                      setReason(
                        e.target.value === "retry"
                          ? "retry_mapping"
                          : e.target.value === "leave"
                            ? "needs_more_evidence"
                            : e.target.value === "confirm_link"
                              ? "link_confirmed"
                              : e.target.value === "reject_link"
                                ? "link_rejected"
                                : "human_observation",
                      );
                    }}
                  >
                    <option value="leave">{t("leave")}</option>
                    {record && <option value="correct">{t("correct")}</option>}
                    {data.run_id && data.retry_count < 3 && (
                      <option value="retry">{t("retry")}</option>
                    )}
                    {canLink && (
                      <>
                        <option value="confirm_link">
                          {t("confirm_link")}
                        </option>
                        <option value="reject_link">{t("reject_link")}</option>
                      </>
                    )}
                  </select>
                </label>
                {data.retry_count >= 3 && (
                  <p className="notice">{t("retryLimit")}</p>
                )}
                {!record && <p className="notice">{t("noTyped")}</p>}
                {editable && (
                  <>
                    <p className="notice">{t("limitations")}</p>
                    {data.proposed_observation?.record && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setRecord(data.proposed_observation.record);
                          setReason("provider_claim_confirmed");
                        }}
                      >
                        {t("useClaim")}
                      </button>
                    )}
                    <Fields
                      value={record}
                      schema={schema}
                      onChange={setRecord}
                    />
                    {!datasetRecord.safeParse(record).success && (
                      <p role="alert">{t("invalid")}</p>
                    )}
                  </>
                )}
                <label>
                  {t("reason")}
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {[
                      "original_confirmed",
                      "provider_claim_confirmed",
                      "external_document",
                      "human_observation",
                      "link_confirmed",
                      "link_rejected",
                      "retry_mapping",
                      "needs_more_evidence",
                    ].map((v) => (
                      <option value={v} key={v}>
                        {t(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">{t("privacy")}</p>
                <label>
                  {t("note")}
                  <textarea
                    value={note}
                    required
                    minLength={10}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <label>
                  {t("support")}
                  <textarea
                    value={support}
                    maxLength={65536}
                    onChange={(e) => setSupport(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {t("acknowledge")}
                </label>
                <button
                  className="btn"
                  disabled={
                    busy ||
                    !ack ||
                    note.trim().length < 10 ||
                    (editable && !datasetRecord.safeParse(record).success)
                  }
                >
                  {t("save")}
                </button>
              </form>
            )}
          <h3>{t("history")}</h3>
          {data.history.map((d: any) => (
            <div key={d.decision_id} className="source-row">
              <p>
                {t(d.action)} · {t(d.reason_code)} ·{" "}
                <DateText value={d.created_at} />
                <br />
                <small>
                  {t("ownerActor")}: {d.principal_id.slice(0, 8)}
                </small>
              </p>
              <button
                className="btn small"
                onClick={() => setEvidence(d.evidence_id)}
              >
                {t("evidence")}
              </button>
            </div>
          ))}
        </>
      )}
      {evidence && <Evidence id={evidence} onClose={() => setEvidence("")} />}
    </Dialog>
  );
}
export function Reviews() {
  const { locale } = useLocale(),
    i = locale === "de" ? 1 : 0,
    t = (k: string) => (copy[k as keyof typeof copy] ?? copy.failure)[i];
  const r = useRemote("/v1/reviews", undefined, 5000),
    [selected, setSelected] = useState("");
  return (
    <Panel title={t("title")}>
      <p>{t("intro")}</p>
      {r.error && <p role="alert">{t(r.error)}</p>}
      {r.data?.cases.length ? (
        r.data.cases.map((c: any) => (
          <article className="source-row" key={c.case_id}>
            <div>
              <span className={"badge " + c.state}>{t(c.state)}</span>
              <h3>
                {copy[c.kind as keyof typeof copy]
                  ? t(c.kind)
                  : t("genericReason")}
              </h3>
              <p>
                {c.source_name ?? c.provider} ·{" "}
                <DateText value={c.created_at} />
              </p>
              <button
                className="btn small"
                onClick={() => setSelected(c.case_id)}
              >
                {t("inspect")}
              </button>
            </div>
          </article>
        ))
      ) : (
        <Empty />
      )}
      {selected && (
        <ReviewDialog
          id={selected}
          onClose={() => setSelected("")}
          onChanged={r.refresh}
        />
      )}
    </Panel>
  );
}
