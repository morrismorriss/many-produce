import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { expenseActuals, incomeActuals, summarize } from "../lib/budget";
import { buildForecast, forecastToCSV, type ForecastItem, type LowPoint, type Scenario } from "../lib/forecast";
import { groupOf } from "../lib/payments";
import type { Payment } from "../lib/types";
import { addDays, allocTouches, fmtDate, round2, shareOf } from "../lib/util";
import { useApp } from "../store";
import { Modal, Progress, ProjectTag, Tile, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { PaymentModal } from "./Payments";
import { MissingList } from "./Paperwork";
import { missingPaperwork } from "../lib/paperwork";
import { anchorsFor, resolveDue } from "../lib/timeline";
import { summarize as shopSummary } from "../lib/shopping";
import { useGearWarnings } from "./Equipment";
import { missingDailyReports, missingHouseReports } from "../lib/reports";
import { clearanceWarnings } from "../lib/clearances";
import { QuickHub } from "../components/QuickHub";

export function Dashboard() {
  const app = useApp();
  const { data, project, today, money, allPayments, saveSettings, setScreen, openDrawer, saveBudget } = app;
  const [scenario, setScenario] = useState<Scenario>("confirmed");
  const [low, setLow] = useState<LowPoint | null>(null);
  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [schedule, setSchedule] = useState<Partial<Payment> | null>(null);
  const weeks = data.settings.forecast_weeks;

  const f = useMemo(
    () =>
      buildForecast({
        today, weeks, project, scenario, cushion: data.settings.cushion, sources: data.settings.money_sources,
        ledger: data.ledger, payments: allPayments, budgets: data.budgets, projects: data.projects, sponsors: data.sponsors,
        shopping: Object.values(data.shopping).flat(),
        fmt: (n) => money(n),
      }),
    [today, weeks, project, scenario, data, allPayments, money],
  );

  const budgets = useMemo(
    () =>
      data.projects
        .filter((p) => !project || p.slug === project)
        .map((p) => {
          const lines = data.budgets[p.slug] ?? [];
          return { p, sum: summarize(expenseActuals(lines, data.ledger, p.slug), incomeActuals(lines, data.ledger, p, data.sponsors)) };
        }),
    [data, project],
  );
  const stillToPay = budgets.reduce((s, b) => s + b.sum.stillToPay, 0);
  const raised = budgets.reduce((s, b) => s + b.sum.incomeRaised, 0);
  const goal = budgets.reduce((s, b) => s + b.sum.incomeProjected, 0);

  const payments = allPayments.filter((p) => allocTouches(p.project_alloc, project));
  const overdue = payments.filter((p) => groupOf(p, today) === "Overdue");

  const missing = useMemo(() => missingPaperwork(data, project, today), [data, project, today]);

  // The next 7 days from Payments, the Schedule and the Timeline.
  const in7 = (d: string) => d >= today && d <= addDays(today, 7);
  const timelineRows = data.projects
    .filter((p) => !project || p.slug === project)
    .flatMap((p) => {
      const a = anchorsFor(p, data.events);
      return (data.timelines[p.slug] ?? []).map((t) => ({ t, p, due: resolveDue(t, a) }));
    })
    .filter(({ t }) => t.status !== "Done" && t.status !== "Skipped");
  const toReimburse = shopSummary(Object.values(data.shopping).flat().filter((i) => !project || i.project === project), allPayments).toReimburse;
  const gear = useGearWarnings(project);
  const noHouse = missingHouseReports(data.events, data.houseReports, today, project);
  const noDaily = missingDailyReports(data.events, data.dailyReports, today, project);
  const clearWarn = data.projects.filter((p) => !project || p.slug === project).flatMap((p) => clearanceWarnings(data.clearances[p.slug] ?? [], anchorsFor(p, data.events).opening, "opening", 4, p.planned_uses ?? [], today).map((w) => ({ ...w, project: p.name })));
  const overdueTasks = timelineRows.filter(({ due }) => due && due < today);
  type WeekItem = { date: string; time: string; kind: string; pill: string; text: string; go: () => void };
  const week: WeekItem[] = [
    ...payments.filter((p) => p.status === "scheduled" && in7(p.due)).map((p) => ({ date: p.due, time: "", kind: "Payment", pill: "pink", text: `${p.title} · ${money(p.amount)}`, go: () => { setScreen("payments"); openDrawer({ kind: "payment", id: p.id }); } })),
    ...data.events.filter((e) => (!project || e.project === project) && in7(e.date)).map((e) => ({ date: e.date, time: e.start, kind: e.type, pill: "blue", text: `${e.start ? `${e.start} ` : ""}${e.title || e.type}${project ? "" : ` · ${data.projects.find((p) => p.slug === e.project)?.name ?? ""}`}`, go: () => setScreen("schedule") })),
    ...Object.values(data.shopping).flat().filter((i) => (!project || i.project === project) && i.status === "Needed" && in7(i.need_by)).map((i) => ({ date: i.need_by, time: "", kind: "Buy", pill: "amber", text: `${i.item}${i.buyer && i.buyer !== "producer" ? ` (${data.people.find((p) => p.slug === i.buyer)?.name ?? i.buyer})` : ""}`, go: () => setScreen("shopping") })),
    ...data.campaigns.filter((c) => (!project || c.project === project) && c.status !== "Done" && c.status !== "Ideas" && in7(c.date)).map((c) => ({ date: c.date, time: "", kind: c.type === "Fundraising" ? "Ask" : "Post", pill: "pink", text: `${c.title}${c.channel ? ` · ${c.channel}` : ""}`, go: () => setScreen("campaigns") })),
    ...timelineRows.filter(({ due }) => in7(due)).map(({ t, p, due }) => ({ date: due, time: "", kind: "Task", pill: "", text: `${t.title}${project ? "" : ` · ${p.name}`}`, go: () => setScreen("schedule") })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  // Chart rows
  const rows = f.weeks.map((w) => ({
    name: fmtDate(w.start),
    in: w.moneyIn,
    out: -w.moneyOut,
    balance: w.balance,
    low: w.low.length > 0,
    w,
  }));
  const firstLowPerSource = dedupeLows(f.lowPoints);

  return (
    <>
      <Header title="Dashboard" />
      <div className="content">
        <div className="tiles">
          <Tile label="Cash on hand" value={<span className={f.startTotal < 0 ? "neg" : ""}>{money(f.startTotal)}</span>} sub={project ? "This project's net so far" : "All money sources"} />
          <Tile label="Still to pay" value={money(stillToPay)} sub="Budgeted, not yet paid" />
          <Tile label="Income raised" value={<span className="in">{money(raised)}</span>} sub={`of ${money(goal)} goal`} />
          <Tile label="Payments overdue" value={overdue.length} alert={overdue.length > 0} sub={overdue.length ? money(overdue.reduce((s, p) => s + p.amount * shareOf(p.project_alloc, project), 0)) : "All caught up"} />
          <Tile label="Paperwork missing" value={missing.length} alert={missing.length > 0} sub={missing.length ? "Agreements, W-9s, COIs…" : "All on file"} />
        </div>

        <QuickHub />

        <section className="card" aria-label="Cash flow forecast">
          <div className="card-head">
            <h2>Cash flow forecast</h2>
            <span className="muted small">Starting balance {money(f.startTotal)}</span>
            <div className="spacer" />
            <div className="seg" role="group" aria-label="Scenario">
              <button aria-pressed={scenario === "confirmed"} onClick={() => setScenario("confirmed")}>Confirmed only</button>
              <button aria-pressed={scenario === "likely"} onClick={() => setScenario("likely")}>Including likely</button>
            </div>
            <div className="seg" role="group" aria-label="Weeks">
              {([6, 12, 26] as const).map((n) => (
                <button key={n} aria-pressed={weeks === n} onClick={() => void saveSettings({ ...data.settings, forecast_weeks: n })}>{n} wk</button>
              ))}
            </div>
            <button className="btn small" onClick={() => saveTextFile("cash-flow-forecast.csv", forecastToCSV(f), "text/csv")}>CSV</button>
          </div>

          {firstLowPerSource.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {firstLowPerSource.map((l) => (
                <button key={l.week + l.source} className="lowpoint" onClick={() => setLow(l)}>
                  <span aria-hidden>▼</span>
                  <span><strong>Week of {fmtDate(l.week)}:</strong> {l.message} <u>See what’s causing it</u></span>
                </button>
              ))}
            </div>
          )}

          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }} stackOffset="sign">
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(v) => money(v)} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<WeekTip money={money} />} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                {data.settings.cushion > 0 && <ReferenceLine y={data.settings.cushion} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: "Cushion", fill: "var(--danger)", fontSize: 11, position: "insideTopRight" }} />}
                <Bar dataKey="in" name="Money in" fill="var(--secondary)" radius={[4, 4, 0, 0]} stackId="s" />
                <Bar dataKey="out" name="Money out" fill="var(--primary)" radius={[0, 0, 4, 4]} stackId="s" />
                <Line
                  dataKey="balance"
                  name="Balance"
                  stroke="var(--text)"
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; payload?: { low: boolean }; index?: number }) =>
                    props.payload?.low ? <circle key={props.index} cx={props.cx} cy={props.cy} r={5} fill="var(--danger)" stroke="var(--bg)" strokeWidth={2} /> : <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} fill="var(--text)" />
                  }
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="chips small muted" style={{ marginTop: 6 }}>
            <span><span className="tag" style={{ background: "var(--secondary)", color: "var(--on-secondary)" }}>Money in</span></span>
            <span><span className="tag" style={{ background: "var(--primary)", color: "var(--on-primary)" }}>Money out</span></span>
            <span><span className="tag">— Balance (red dot = low point)</span></span>
          </div>

          {f.unscheduled.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">
                Unscheduled budget: {money(f.unscheduled.reduce((s, u) => s + u.amount, 0))} across {f.unscheduled.length} lines (not in the chart until scheduled)
              </summary>
              <div className="table-scroll"><table className="t" style={{ marginTop: 8 }}>
                <tbody>
                  {f.unscheduled.map((u) => (
                    <tr key={u.project + u.line.id}>
                      <td>{u.line.line_item}</td>
                      <td><ProjectTag slug={u.project} /></td>
                      <td className="muted">{u.line.category}</td>
                      <td className="r num">{money(u.amount)}</td>
                      <td className="r">
                        <button className="btn small" onClick={() => setSchedule({ title: u.line.line_item, amount: round2(u.amount), budget_line: u.line.id, category: u.line.category, project_alloc: { [u.project]: 1 } })}>
                          Schedule…
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </details>
          )}
        </section>

        <div className="grid-2" style={{ marginTop: 14 }}>
          <section className="card" aria-label="Needs attention">
            <div className="card-head"><h2>Needs attention</h2></div>
            <ul className="attn">
              {overdue.map((p) => (
                <li key={p.id}>
                  <span className="pill red">Overdue</span>
                  <span>{p.title} · {money(p.amount)} · due {fmtDate(p.due)}</span>
                  <button className="btn small" onClick={() => { setScreen("payments"); openDrawer({ kind: "payment", id: p.id }); }}>Open</button>
                </li>
              ))}
              {toReimburse > 0 && (
                <li>
                  <span className="pill amber">Reimburse</span>
                  <span>{money(toReimburse)} owed back to collaborators for things they bought</span>
                  <button className="btn small" onClick={() => setScreen("shopping")}>Open</button>
                </li>
              )}
              {gear.map((g, i) => (
                <li key={"g" + i}>
                  <span className={`pill ${g.kind === "rental-due" ? "amber" : "red"}`}>Gear</span>
                  <span>{g.message}</span>
                  <button className="btn small" onClick={() => setScreen("inventory")}>Open</button>
                </li>
              ))}
              {noHouse.map((e) => (
                <li key={"h" + e.id}>
                  <span className="pill amber">House report</span>
                  <span>{fmtDate(e.date)} · {e.title || "Performance"}{project ? "" : ` · ${data.projects.find((p) => p.slug === e.project)?.name ?? ""}`} has no house report yet</span>
                  <button className="btn small" onClick={() => setScreen("reports")}>Fill in</button>
                </li>
              ))}
              {app.todoistToConfirm.map((id) => {
                const pay = allPayments.find((x) => x.id === id);
                if (!pay) return null;
                return (
                  <li key={"td" + id}>
                    <span className="pill blue">Todoist</span>
                    <span>You ticked off &quot;{pay.title}&quot; in Todoist. Paid {money(pay.amount, { cents: true })}?</span>
                    <button className="btn small primary" onClick={() => { void app.setPaid(id, true); app.dismissTodoistConfirm(id); }}>Yes, mark paid</button>
                    <button className="btn small" onClick={() => { setScreen("payments"); openDrawer({ kind: "payment", id }); app.dismissTodoistConfirm(id); }}>Change amount</button>
                  </li>
                );
              })}
              {clearWarn.length > 0 && (
                <li>
                  <span className="pill red">Clearances</span>
                  <span>{clearWarn.length} clearance{clearWarn.length > 1 ? "s" : ""} need attention: {clearWarn.slice(0, 2).map((w) => w.message).join("; ")}{clearWarn.length > 2 ? "…" : ""}</span>
                  <button className="btn small" onClick={() => setScreen("paperwork")}>Open</button>
                </li>
              )}
              {noDaily.length > 0 && (
                <li>
                  <span className="pill amber">Daily report</span>
                  <span>{noDaily.length} work day{noDaily.length > 1 ? "s" : ""} in the last two weeks with no daily report</span>
                  <button className="btn small" onClick={() => setScreen("reports")}>Open</button>
                </li>
              )}
              {overdueTasks.length > 0 && (
                <li>
                  <span className="pill red">Timeline</span>
                  <span>{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}: {overdueTasks.slice(0, 2).map(({ t }) => t.title).join(", ")}{overdueTasks.length > 2 ? "…" : ""}</span>
                  <button className="btn small" onClick={() => setScreen("schedule")}>Open</button>
                </li>
              )}
              {firstLowPerSource.map((l) => (
                <li key={"l" + l.week + l.source}>
                  <span className="pill red">Low point</span>
                  <span>Week of {fmtDate(l.week)}: {l.source || "Total"} {money(l.balance)}</span>
                  <button className="btn small" onClick={() => setLow(l)}>Fix</button>
                </li>
              ))}
              {!overdue.length && !missing.length && !firstLowPerSource.length && !overdueTasks.length && !toReimburse && !gear.length && !noHouse.length && !noDaily.length && !clearWarn.length && !app.todoistToConfirm.length && <li className="muted">Nothing needs attention. Nice.</li>}
            </ul>
            {missing.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <MissingList missing={missing} compact={!!project} />
              </div>
            )}
            <p className="small muted" style={{ marginTop: 10 }}>Sponsor report due dates aren't tracked yet.</p>
          </section>

          <section className="card" aria-label="This week">
            <div className="card-head"><h2>This week</h2></div>
            {week.length ? (
              <ul className="attn">
                {week.map((w, i) => (
                  <li key={i} style={{ cursor: "pointer" }} onClick={w.go}>
                    <span className={`pill ${w.pill}`}>{w.kind}</span>
                    <span><strong>{fmtDate(w.date)}</strong> · {w.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing in the next 7 days.</p>
            )}
          </section>
        </div>

        <section className="card" style={{ marginTop: 14 }} aria-label="Budget snapshot">
          <div className="card-head"><h2>Budget snapshot</h2><span className="muted small">Paid vs. budgeted</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {budgets.filter((b) => b.sum.total > 0).map((b) => (
              <div key={b.p.slug} style={{ display: "grid", gridTemplateColumns: "200px 1fr 180px", gap: 12, alignItems: "center" }}>
                <ProjectTag slug={b.p.slug} />
                <Progress value={b.sum.paid} max={b.sum.total} />
                <span className="small num">{money(b.sum.paid)} of {money(b.sum.total)}</span>
              </div>
            ))}
            {!budgets.some((b) => b.sum.total > 0) && <p className="muted">No budgets yet.</p>}
          </div>
        </section>
      </div>

      {low && (
        <LowPointModal
          low={low}
          onClose={() => setLow(null)}
          onMovePayment={(id) => { const p = allPayments.find((x) => x.id === id); if (p) { setLow(null); setEditPayment(p); } }}
          onSooner={(item) => {
            const lines = data.budgets[item.ref.project] ?? [];
            const nd = prompt("Expected date (YYYY-MM-DD)", item.date);
            if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) void saveBudget(item.ref.project, lines.map((l) => (l.id === item.ref.id ? { ...l, expected_date: nd } : l)));
            setLow(null);
          }}
          laterIncome={f.weeks.flatMap((w) => w.items).filter((i) => i.amount > 0 && (!low.source || i.source === low.source) && i.date >= low.week)}
        />
      )}
      {editPayment && <PaymentModal existing={editPayment} onClose={() => setEditPayment(null)} />}
      {schedule && <PaymentModal preset={schedule} onClose={() => setSchedule(null)} />}
    </>
  );
}

function dedupeLows(lows: LowPoint[]): LowPoint[] {
  const seen = new Set<string>();
  return lows.filter((l) => (seen.has(l.source) ? false : (seen.add(l.source), true)));
}

function WeekTip({ active, payload, money }: { active?: boolean; payload?: { payload: { w: { start: string; balance: number; items: ForecastItem[]; moneyIn: number; moneyOut: number } } }[]; money: (n: number, o?: { sign?: boolean }) => string }) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload.w;
  return (
    <div className="card" style={{ boxShadow: "var(--shadow)", minWidth: 240, fontSize: 12 }}>
      <strong>Week of {fmtDate(w.start, true)}</strong>
      <div className="muted">In {money(w.moneyIn)} · Out {money(w.moneyOut)} · Balance {money(w.balance)}</div>
      {w.items.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          {w.items.map((i, k) => (
            <li key={k}>
              <span className={i.amount > 0 ? "in" : ""}>{money(i.amount, { sign: true })}</span> {i.label} <span className="muted">· {i.source}{i.confidence ? ` · ${i.confidence}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">Nothing scheduled</div>
      )}
    </div>
  );
}

function LowPointModal({ low, onClose, onMovePayment, onSooner, laterIncome }: { low: LowPoint; onClose: () => void; onMovePayment: (id: string) => void; onSooner: (i: ForecastItem) => void; laterIncome: ForecastItem[] }) {
  const { money } = useApp();
  return (
    <Modal title={`Low point · week of ${fmtDate(low.week, true)}`} onClose={onClose}>
      <p className="neg">{low.message}</p>
      <h3>Money going out that week</h3>
      <ul className="attn">
        {low.causes.map((c) => (
          <li key={c.ref.id}>
            <span>{fmtDate(c.date)} · {c.label} · {money(c.amount)}</span>
            <button className="btn small" onClick={() => onMovePayment(c.ref.id)}>Move due date</button>
          </li>
        ))}
        {!low.causes.length && <li className="muted">No single payment that week; the balance was already low.</li>}
      </ul>
      {laterIncome.length > 0 && (
        <>
          <h3>Expected income after it</h3>
          <ul className="attn">
            {laterIncome.slice(0, 5).map((i) => (
              <li key={i.ref.id + i.date}>
                <span>{fmtDate(i.date)} · {i.label} · <span className="in">{money(i.amount, { sign: true })}</span> <span className="muted">({i.confidence})</span></span>
                <button className="btn small" onClick={() => onSooner(i)}>Expect sooner…</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
