import { useState, Fragment } from "react";
import { ShopifySetup, SourceProgress } from "./source-import.js";
import { useLocale, questionTitles, eventTitle } from "./locale.js";
import { api, download } from "./api.js";
import {
  Badge,
  Panel,
  useRemote,
  useAction,
  ErrorNotice,
  Empty,
  DateText,
  Entry,
  Dialog,
  Secret,
} from "./common.js";
import { Icon } from "./icons.js";
export const tracks = [
  "source",
  "fact",
  "commitment",
  "movement",
  "reservation",
];
export function Recorder({
  overview,
  onNavigate,
  onEntity,
}: {
  overview: any;
  onNavigate: (page: string, intent?: number) => void;
  onEntity: (id: string) => void;
}) {
  const { t, locale } = useLocale(),
    a = useAction(),
    { data, error, refresh } = useRemote(
      "/v1/tools/list_journal_entries",
      { limit: 100, direction: "desc" },
      5000,
    );
  const [entry, setEntry] = useState<any>(null),
    [paused, setPaused] = useState(false),
    [frozen, setFrozen] = useState<any[]>([]),
    [entity, setEntity] = useState(""),
    [answer, setAnswer] = useState<any>(null);
  const rows = paused ? frozen : (data?.entries ?? []);
  const runExample = () =>
    void a.run(async () => {
      const r = await api("/v1/example", {});
      setEntity(r.entity_id);
      refresh();
    });
  return (
    <>
      <div className="stats">
        {[
          [
            t.connected,
            overview?.sources?.length ?? "—",
            t.observed,
            "sources",
          ],
          [
            t.recorded,
            overview?.tracks?.reduce((n: number, x: any) => n + x.count, 0) ??
              "—",
            t.preserved,
            "journal",
          ],
          [t.review, overview?.review ?? "—", t.review, "clock"],
          [
            t.pending,
            overview
              ? Math.max(
                  0,
                  Number(overview.heads.committed) -
                    Number(overview.heads.applied),
                )
              : "—",
            t.current,
            "recorder",
          ],
        ].map(([name, value, note, icon]) => (
          <section className="stat" key={name}>
            <span>
              {name}
              <Icon name={icon} />
            </span>
            <strong>{value}</strong>
            <small>{note}</small>
          </section>
        ))}
      </div>
      <section className="panel recorder">
        <div className="panel-head">
          <strong>
            <Icon />
            {t.recorder} <Badge state={paused ? "paused" : "live"} />
          </strong>
          <div className="actions">
            <button
              className="btn small"
              onClick={() => {
                if (!paused) setFrozen(rows);
                setPaused(!paused);
              }}
            >
              {paused ? t.resume : t.pause}
            </button>
            <button
              className="btn small"
              disabled={a.busy}
              onClick={runExample}
            >
              <Icon name="plus" />
              {t.runExample}
            </button>
          </div>
        </div>
        <div className="recorder-time">
          <span>{t.fiveTracks}</span>
          <span>
            {data?.entries.length
              ? new Date(rows.at(-1)?.occurred_at).toLocaleTimeString(locale)
              : "—"}
          </span>
          <span>
            {data?.entries.length
              ? new Date(rows[0]?.occurred_at).toLocaleTimeString(locale)
              : "—"}
          </span>
        </div>
        <div id="journal">
          {tracks.map((track) => (
            <div className={"track-row " + track} key={track}>
              <div className="track-name">
                <i />
                {t[track as keyof typeof t]}
                <small>
                  {overview?.tracks?.find((x: any) => x.record_type === track)
                    ?.count ?? 0}
                </small>
              </div>
              <div className="track-lane">
                {rows
                  .filter((x: any) => x.record_type === track)
                  .slice(0, 8)
                  .reverse()
                  .map((e: any) => (
                    <button
                      key={e.entry_id}
                      className="event-chip"
                      onClick={() => {
                        setEntry(e);
                        setEntity(e.entity_id);
                      }}
                    >
                      <Icon
                        name={
                          track === "source"
                            ? "sources"
                            : track === "fact"
                              ? "check"
                              : track === "commitment"
                                ? "clock"
                                : track === "movement"
                                  ? "arrow"
                                  : "lock"
                        }
                      />
                      <span>{eventTitle(e.event_type, locale)}</span>
                      <time>
                        {new Date(e.occurred_at).toLocaleTimeString(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </button>
                  ))}
                {!rows.some((e: any) => e.record_type === track) && (
                  <span className="muted">{t.empty}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="recorder-bottom">
          <span>
            <Icon name="shield" />
            {t.provenance}
          </span>
          <button onClick={() => onNavigate("journal")}>{t.viewAll} ↗</button>
        </div>
      </section>
      <ErrorNotice code={error || a.error} />
      <div className="two-columns">
        <Panel title={t.askTitle}>
          <p className="muted">{t.askIntro}</p>
          <div className="suggestions">
            {[0, 4, 8, 12, 16, 20].map((i) => (
              <button key={i} onClick={() => onNavigate("answers", i)}>
                {questionTitles[i][locale === "de" ? 1 : 0]}
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          <p className="footnote">
            <Icon name="shield" />
            {t.modelFree}
          </p>
        </Panel>
        <Panel title={t.contextTitle}>
          <div className="context-item">
            <Icon name="clock" />
            <div>
              <strong>{t.current}</strong>
              <p>
                {overview?.heads.applied ?? "—"} /{" "}
                {overview?.heads.committed ?? "—"}
              </p>
            </div>
          </div>
          <div className="context-item">
            <Icon name="sources" />
            <div>
              <strong>{t.noLive}</strong>
              <button
                className="text-button"
                onClick={() => onNavigate("sources")}
              >
                {t.connect} →
              </button>
            </div>
          </div>
          <div className="context-item">
            <Icon name="agents" />
            <div>
              <strong>{t.agents}</strong>
              <button
                className="text-button"
                onClick={() => onNavigate("agents")}
              >
                {t.clientGuide} →
              </button>
            </div>
          </div>
        </Panel>
      </div>
      {!rows.length && (
        <Panel title={t.empty}>
          <p>{t.emptyIntro}</p>
          <p className="muted">{t.exampleNote}</p>
          <button
            className="btn primary"
            onClick={runExample}
            disabled={a.busy}
          >
            {t.runExample}
          </button>
        </Panel>
      )}
      <Panel title={t.paymentState}>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () =>
              setAnswer(
                await api("/v1/tools/get_business_state", {
                  entity_id: entity,
                }),
              ),
            );
          }}
        >
          <label>
            {t.entity}
            <input
              id="entity"
              required
              pattern="[0-9a-fA-F-]{36}"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            />
          </label>
          <button id="ask" className="btn" disabled={a.busy}>
            {t.readState}
          </button>
        </form>
        {answer && <pre id="answer">{JSON.stringify(answer, null, 2)}</pre>}
      </Panel>
      {entry && (
        <Entry
          entry={entry}
          onClose={() => setEntry(null)}
          onEntity={onEntity}
        />
      )}
    </>
  );
}
export function Journal({
  entity = "",
  onEntity,
}: {
  entity?: string;
  onEntity: (id: string) => void;
}) {
  const { t, locale } = useLocale(),
    a = useAction();
  const [track, setTrack] = useState(""),
    [filterEntity, setFilterEntity] = useState(entity),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [extra, setExtra] = useState<any[]>([]),
    [next, setNext] = useState<string | null | undefined>(),
    [entry, setEntry] = useState<any>(null);
  const body = {
      limit: 100,
      direction: "desc",
      ...(track ? { track } : {}),
      ...(filterEntity ? { entity_id: filterEntity } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(to).toISOString() } : {}),
    },
    r = useRemote("/v1/tools/list_journal_entries", body),
    rows = [...(r.data?.entries ?? []), ...extra];
  const change = (f: () => void) => {
    f();
    setExtra([]);
    setNext(undefined);
  };
  return (
    <Panel>
      <div className="filters">
        <label>
          {t.track}
          <select
            value={track}
            onChange={(e) => change(() => setTrack(e.target.value))}
          >
            <option value="">{t.all}</option>
            {tracks.map((x) => (
              <option key={x} value={x}>
                {t[x as keyof typeof t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.entity}
          <input
            value={filterEntity}
            onChange={(e) => change(() => setFilterEntity(e.target.value))}
          />
        </label>
        <label>
          {t.from}
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => change(() => setFrom(e.target.value))}
          />
        </label>
        <label>
          {t.to}
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => change(() => setTo(e.target.value))}
          />
        </label>
        <button
          className="btn small"
          onClick={() =>
            change(() => {
              setTrack("");
              setFilterEntity("");
              setFrom("");
              setTo("");
            })
          }
        >
          {t.clear}
        </button>
      </div>
      <ErrorNotice code={r.error || a.error} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t.sequence}</th>
              <th>{t.track}</th>
              <th>{t.event}</th>
              <th>{t.effective}</th>
              <th>{t.recordedAt}</th>
              <th>{t.identity}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.entry_id}>
                <td>{e.sequence}</td>
                <td>
                  <Badge state={e.record_type} />
                </td>
                <td>
                  <button className="text-button" onClick={() => setEntry(e)}>
                    {eventTitle(e.event_type, locale)}
                  </button>
                </td>
                <td>
                  <DateText value={e.occurred_at} />
                </td>
                <td>
                  <DateText value={e.recorded_at} />
                </td>
                <td>
                  <button
                    className="text-button mono"
                    title={e.entity_id}
                    onClick={() => change(() => setFilterEntity(e.entity_id))}
                  >
                    {e.entity_id.slice(0, 8)}…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty />}
      {(next === undefined ? r.data?.next_cursor : next) && (
        <button
          className="btn"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              const d = await api("/v1/tools/list_journal_entries", {
                ...body,
                cursor: next === undefined ? r.data.next_cursor : next,
              });
              setExtra((x) => [...x, ...d.entries]);
              setNext(d.next_cursor);
            })
          }
        >
          {t.more}
        </button>
      )}
      <p className="footnote">
        {t.cutoff}: {r.data?.recorded_cutoff ?? "—"} · {t.observed_only}
      </p>
      {entry && (
        <Entry
          entry={entry}
          onClose={() => setEntry(null)}
          onEntity={onEntity}
        />
      )}
    </Panel>
  );
}
export function Sources({ onLogs }: { onLogs: (id: string) => void }) {
  const { t } = useLocale(),
    r = useRemote("/v1/connections", undefined, 5000),
    review = useRemote("/v1/reviews"),
    a = useAction();
  const [name, setName] = useState(""),
    [provider, setProvider] = useState("generic"),
    [secret, setSecret] = useState(""),
    [showShopify, setShowShopify] = useState(false);
  return (
    <>
      <div className="source-catalog">
        <Panel title="Shopify">
          <div className="source-icon">S</div>
          <p>{t.shopifySetup}</p>
          <p className="notice">{t.noLive}</p>
          <button className="btn" onClick={() => setShowShopify(true)}>
            {t.connect}
          </button>
        </Panel>
        <Panel title={t.supplemental}>
          <p>{t.producerIntro}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                const s = await api("/v1/producers", { name, provider });
                setSecret(s.key);
                r.refresh();
              });
            }}
          >
            <label>
              {t.provider}
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {["generic", "replay", "bank_csv", "policy"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              {t.sourceName}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <button className="btn primary" disabled={a.busy}>
              {t.createProducer}
            </button>
          </form>
        </Panel>
      </div>
      <ErrorNotice code={r.error || a.error} />
      <Panel title={t.connected}>
        {r.data?.connections.length ? (
          r.data.connections.map((s: any) => (
            <Fragment key={s.connection_id}>
              <article className="source-row">
                <div>
                  <h3>{s.name ?? s.provider}</h3>
                  <p className="muted mono">
                    {s.provider} · {s.connection_id}
                  </p>
                  <Badge state={s.state} />
                  <dl className="details">
                    <div>
                      <dt>{t.observations}</dt>
                      <dd>{s.observations}</dd>
                    </div>
                    <div>
                      <dt>{t.lastNew}</dt>
                      <dd>
                        <DateText value={s.last_new_at} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t.lastCheck}</dt>
                      <dd>
                        <DateText
                          value={
                            r.data.runs.find(
                              (x: any) => x.connection_id === s.connection_id,
                            )?.last_success_at
                          }
                        />
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="actions">
                  <button
                    className="btn small"
                    onClick={() => onLogs(s.connection_id)}
                  >
                    {t.logs}
                  </button>
                  <button
                    className="btn small"
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await api(
                          "/v1/connections/" + s.connection_id + "/state",
                          {
                            state:
                              s.state === "paused" ? "configured" : "paused",
                          },
                        );
                        r.refresh();
                      })
                    }
                  >
                    {s.state === "paused" ? t.resume : t.disconnect}
                  </button>
                </div>
              </article>
              {s.provider === "shopify" && (
                <SourceProgress
                  connection={s.connection_id}
                  onLogs={onLogs}
                  onChanged={r.refresh}
                />
              )}
            </Fragment>
          ))
        ) : (
          <Empty />
        )}
      </Panel>
      {r.data?.runs.some((run: any) => !run.plan_id) && (
        <Panel title={t.imports}>
          {r.data?.runs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t.identity}</th>
                    <th>{t.state}</th>
                    <th>{t.fetched}</th>
                    <th>{t.committed}</th>
                    <th>{t.lastCheck}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.data.runs
                    .filter((x: any) => !x.plan_id)
                    .map((x: any) => (
                      <tr key={x.run_id}>
                        <td className="mono">{x.run_id}</td>
                        <td>
                          <Badge state={x.state} />
                        </td>
                        <td>{x.fetched}</td>
                        <td>{x.committed}</td>
                        <td>
                          <DateText value={x.last_success_at} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t.noRuns}</Empty>
          )}
        </Panel>
      )}
      <Panel title={t.review}>
        <p>{t.reviewIntro}</p>
        {review.data?.cases.length ? (
          review.data.cases.map((c: any) => (
            <article className="source-row" key={c.case_id}>
              <div>
                <Badge state={c.state} />
                <h3>{c.kind}</h3>
                <p>
                  {c.provider} · {c.case_id}
                </p>
                <p className="notice">{t.reviewLimit}</p>
              </div>
            </article>
          ))
        ) : (
          <Empty>{t.noReviews}</Empty>
        )}
      </Panel>
      <Panel title={t.shipping}>
        <p className="muted">{t.plannedNote}</p>
        <div className="actions">
          {["DHL", "easybill", "Stripe", "PayPal"].map((x) => (
            <span className="planned-provider" key={x}>
              {x} <Badge state="planned" />
            </span>
          ))}
        </div>
      </Panel>
      {secret && (
        <Dialog title={t.saveKey} onClose={() => setSecret("")}>
          <Secret value={secret} />
        </Dialog>
      )}
      {showShopify && (
        <ShopifySetup
          onClose={() => setShowShopify(false)}
          onSaved={r.refresh}
        />
      )}
    </>
  );
}
export function Agents() {
  const { t } = useLocale(),
    r = useRemote("/v1/agents"),
    a = useAction();
  const [name, setName] = useState(""),
    [secret, setSecret] = useState("");
  return (
    <>
      <div className="two-columns">
        <Panel title={t.createAgent}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                const s = await api("/v1/agents", { name });
                setSecret(s.key);
                setName("");
                r.refresh();
              });
            }}
          >
            <label>
              {t.agentName}
              <input
                id="agent-name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn primary" id="create-agent" disabled={a.busy}>
              <Icon name="plus" />
              {t.createAgent}
            </button>
          </form>
          <ErrorNotice code={a.error} />
        </Panel>
        <Panel title={t.clientGuide}>
          <p>{t.clientText}</p>
          <pre>node --import tsx packages/mcp/main.ts</pre>
          <p className="notice">{t.clientPrivacy}</p>
        </Panel>
      </div>
      <Panel title={t.agents}>
        <ErrorNotice code={r.error} />
        {r.data?.agents.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.status}</th>
                  <th>{t.created}</th>
                  <th>{t.lastUsed}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.data.agents.map((x: any) => (
                  <tr key={x.credential_id}>
                    <td>{x.name}</td>
                    <td>
                      <Badge state={x.revoked_at ? "revoked" : "active"} />
                    </td>
                    <td>
                      <DateText value={x.created_at} />
                    </td>
                    <td>
                      <DateText value={x.last_used_at} />
                    </td>
                    <td>
                      {!x.revoked_at && (
                        <button
                          className="btn small"
                          disabled={a.busy}
                          onClick={() =>
                            void a.run(async () => {
                              await api(
                                "/v1/agents/" + x.credential_id + "/revoke",
                                {},
                              );
                              r.refresh();
                            })
                          }
                        >
                          {t.revoke}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </Panel>
      {secret && (
        <Dialog title={t.saveKey} onClose={() => setSecret("")}>
          <Secret value={secret} />
        </Dialog>
      )}
    </>
  );
}
export function Settings({ onRotated }: { onRotated: (key: string) => void }) {
  const { t, locale } = useLocale(),
    a = useAction();
  const [key, setKey] = useState("");
  return (
    <>
      <div className="two-columns">
        <Panel title={t.runtimeTitle}>
          <p>{t.runtimeText}</p>
          <pre>./blackbox up</pre>
          <p className="notice">{t.lostKey}</p>
        </Panel>
        <Panel title={t.backup}>
          <Badge state="not_configured" />
          <p>{t.noBackup}</p>
          <p className="muted">{t.backupText}</p>
        </Panel>
      </div>
      <Panel title={t.retention}>
        <p>{t.retentionText}</p>
      </Panel>
      <Panel title={t.rotation}>
        <p>{t.rotateText}</p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              const s = await api("/v1/key/rotate", { current_key: key });
              setKey("");
              onRotated(s.key);
            });
          }}
        >
          <label>
            {t.currentKey}
            <input
              type="password"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="btn" disabled={a.busy}>
            {t.rotate}
          </button>
        </form>
        <ErrorNotice code={a.error} />
      </Panel>
    </>
  );
}
