import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, Field, Modal, Tile, printHtml, saveTextFile } from "../components/bits";
import { parseCSV } from "../lib/files";
import { REPORT_CSS, dealFrom, depositsPaidTo, houseCSV, houseCalc, runSummary, settle, settlementHtml, ticketsFromRows } from "../lib/reports";
import type { BudgetLine, HouseReport, VenueDeal } from "../lib/types";
import { fmtDate, uid } from "../lib/util";
import { useApp } from "../store";
import { PaymentModal } from "./Payments";

function blankHouse(project: string, date: string, venue: string, capacity: number | null): HouseReport {
  return {
    path: `house-reports/${project}/${date}.md`, project, date, venue, call_time: "", start_time: "", capacity,
    tickets: [{ type: "Full", sold: 0, price: 0 }], comps: [], walkups: 0, no_shows: 0, attendance: null, gross: null,
    platform_fees: 0, bar_sales: null, foh_notes: "", incidents: "", venue_notes: "",
  };
}

export function HouseReports() {
  const { data, project, today, money, projectBySlug } = useApp();
  const [editing, setEditing] = useState<HouseReport | null>(null);
  if (!project) return <Empty title="Pick a project"><p>House reports belong to a project. Choose one in the sidebar.</p></Empty>;
  const p = projectBySlug(project);
  const perfs = data.events.filter((e) => e.project === project && e.type === "Performance").sort((a, b) => a.date.localeCompare(b.date));
  const reports = data.houseReports.filter((h) => h.project === project);
  const dates = [...new Set([...perfs.map((e) => e.date), ...reports.map((h) => h.date)])].sort();
  const run = runSummary(reports);
  const open = (date: string) => {
    const existing = reports.find((h) => h.date === date);
    if (existing) return setEditing(existing);
    const ev = perfs.find((e) => e.date === date);
    const venue = data.venues.find((v) => v.slug === ev?.location);
    setEditing({ ...blankHouse(project, date, venue?.slug ?? "", venue?.capacity ?? null), call_time: ev?.start ? ev.start : "" });
  };

  return (
    <>
      {dates.length ? (
        <div className="table-scroll"><table className="t">
          <thead><tr><th>Performance</th><th>Venue</th><th className="r">Attendance</th><th className="r">Gross</th><th className="r">Net</th><th /></tr></thead>
          <tbody>
            {dates.map((d) => {
              const h = reports.find((x) => x.date === d);
              const c = h && houseCalc(h);
              const ev = perfs.find((e) => e.date === d);
              const past = d < today;
              return (
                <tr key={d} className="clickable" onClick={() => open(d)}>
                  <td>{fmtDate(d, true)}{ev?.title ? <span className="muted small"> · {ev.title}</span> : ""}</td>
                  <td className="muted">{data.venues.find((v) => v.slug === (h?.venue || ev?.location))?.name ?? ev?.location ?? ""}</td>
                  <td className="r num">{c ? `${c.attendance}${h!.capacity ? ` / ${h!.capacity}` : ""}` : "—"}</td>
                  <td className="r num">{c ? money(c.gross) : "—"}</td>
                  <td className="r num">{c ? money(c.net) : "—"}</td>
                  <td className="r">{h ? <span className="pill green">Done</span> : past ? <span className="pill red">Missing</span> : <span className="pill">Upcoming</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : (
        <Empty title="No performances yet"><p>Add performances on the Schedule. Each one gets a quick house report after the show.</p></Empty>
      )}

      {reports.length > 0 && (
        <section className="card" style={{ marginTop: 14 }} aria-label="Run summary">
          <div className="card-head">
            <h2>Run summary</h2><span className="muted small">{p?.name}</span>
            <div className="spacer" />
            <button className="btn small" onClick={() => saveTextFile(`${project}-house-reports.csv`, houseCSV(reports), "text/csv")}>CSV</button>
          </div>
          <div className="tiles">
            <Tile label="Attendance" value={run.attendance} sub={run.pctCapacity !== null ? `${run.pctCapacity}% of capacity over ${run.nights} nights` : `${run.nights} nights`} />
            <Tile label="Box office" value={money(run.gross)} sub={`${money(run.net)} after platform fees`} />
            <Tile label="Average ticket" value={money(run.avgPrice, { cents: true })} />
            {run.best && <Tile label="Best night" value={fmtDate(run.best.date)} sub={`${run.best.attendance} people${run.worst ? ` · lowest ${fmtDate(run.worst.date)} (${run.worst.attendance})` : ""}`} />}
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={run.perNight.map((x) => ({ ...x, name: fmtDate(x.date) }))}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <Tooltip />
                <Bar dataKey="capacity" name="Capacity" fill="var(--surface-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="attendance" name="Attendance" fill="var(--secondary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {run.byType.length > 0 && (
            <div className="table-scroll"><table className="t" style={{ marginTop: 8 }}>
              <thead><tr><th>Ticket type</th><th className="r">Sold</th><th className="r">Revenue</th></tr></thead>
              <tbody>{run.byType.map((t) => <tr key={t.type}><td>{t.type}</td><td className="r num">{t.sold}</td><td className="r num">{money(t.revenue)}</td></tr>)}</tbody>
            </table></div>
          )}
          <p className="small muted" style={{ marginTop: 6 }}>Attendance here also appears in sponsor and funder reports for the same dates.</p>
        </section>
      )}
      {editing && <HouseModal report={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HouseModal({ report, onClose }: { report: HouseReport; onClose: () => void }) {
  const { data, money, saveHouseReport, deleteReportFile } = useApp();
  const [h, setH] = useState(report);
  const [importing, setImporting] = useState(false);
  const set = <K extends keyof HouseReport>(k: K, v: HouseReport[K]) => setH((x) => ({ ...x, [k]: v }));
  const c = houseCalc(h);
  const exists = data.houseReports.some((x) => x.path === report.path);
  const num = (v: string) => (v === "" ? null : Number(v));
  const save = async () => { await saveHouseReport(h); onClose(); };
  return (
    <Modal title={`House report · ${fmtDate(h.date, true)}`} onClose={onClose}>
      <div className="form-grid">
        <Field label="Venue">
          <select value={h.venue} onChange={(e) => { const v = data.venues.find((x) => x.slug === e.target.value); setH({ ...h, venue: e.target.value, capacity: h.capacity ?? v?.capacity ?? null }); }}>
            <option value="">—</option>{data.venues.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Call time"><input type="time" value={h.call_time} onChange={(e) => set("call_time", e.target.value)} /></Field>
        <Field label="Actual start"><input type="time" value={h.start_time} onChange={(e) => set("start_time", e.target.value)} /></Field>
        <Field label="Capacity"><input type="number" value={h.capacity ?? ""} onChange={(e) => set("capacity", num(e.target.value))} /></Field>
      </div>
      <div>
        <div className="section-title"><h3>Tickets sold</h3><button className="btn small" onClick={() => setImporting(true)}>Import from ticketing CSV</button></div>
        <div className="table-scroll"><table className="t">
          <thead><tr><th>Type</th><th className="r">Sold</th><th className="r">Price</th><th className="r">Total</th><th /></tr></thead>
          <tbody>
            {h.tickets.map((t, i) => (
              <tr key={i}>
                <td><input className="cell-edit" aria-label="Ticket type" list="mp-ticket-types" value={t.type} onChange={(e) => set("tickets", h.tickets.map((x, k) => (k === i ? { ...x, type: e.target.value } : x)))} /></td>
                <td className="r"><input className="cell-edit r" type="number" aria-label="Sold" value={t.sold} onChange={(e) => set("tickets", h.tickets.map((x, k) => (k === i ? { ...x, sold: Number(e.target.value) || 0 } : x)))} /></td>
                <td className="r"><input className="cell-edit r" type="number" aria-label="Price" value={t.price} onChange={(e) => set("tickets", h.tickets.map((x, k) => (k === i ? { ...x, price: Number(e.target.value) || 0 } : x)))} /></td>
                <td className="r num">{money(t.sold * t.price)}</td>
                <td><button className="icon-btn" aria-label="Remove ticket type" onClick={() => set("tickets", h.tickets.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <datalist id="mp-ticket-types">{["Full", "Student", "Senior", "Pay what you can", "Industry", "Group"].map((x) => <option key={x} value={x} />)}</datalist>
        <button className="btn small ghost" onClick={() => set("tickets", [...h.tickets, { type: "", sold: 0, price: 0 }])}>+ Ticket type</button>
      </div>
      <div>
        <div className="section-title"><h3>Comps</h3><button className="btn small ghost" onClick={() => set("comps", [...h.comps, { who: "", why: "" }])}>+ Comp</button></div>
        {h.comps.map((x, i) => (
          <div key={i} className="toolbar" style={{ marginBottom: 4 }}>
            <input className="input" style={{ flex: 1 }} aria-label="Who" placeholder="Who" value={x.who} onChange={(e) => set("comps", h.comps.map((y, k) => (k === i ? { ...y, who: e.target.value } : y)))} />
            <input className="input" style={{ flex: 1 }} aria-label="Why" placeholder="Why (press, artist guest…)" value={x.why} onChange={(e) => set("comps", h.comps.map((y, k) => (k === i ? { ...y, why: e.target.value } : y)))} />
            <button className="icon-btn" aria-label="Remove comp" onClick={() => set("comps", h.comps.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Walk-ups"><input type="number" value={h.walkups} onChange={(e) => set("walkups", Number(e.target.value) || 0)} /></Field>
        <Field label="No-shows"><input type="number" value={h.no_shows} onChange={(e) => set("no_shows", Number(e.target.value) || 0)} /></Field>
        <Field label={`Attendance (counted: ${c.attendance})`}><input type="number" placeholder="Override" value={h.attendance ?? ""} onChange={(e) => set("attendance", num(e.target.value))} /></Field>
        <Field label={`Gross box office (from tickets: ${money(c.gross)})`}><input type="number" placeholder="Override" value={h.gross ?? ""} onChange={(e) => set("gross", num(e.target.value))} /></Field>
        <Field label="Ticketing platform fees"><input type="number" value={h.platform_fees} onChange={(e) => set("platform_fees", Number(e.target.value) || 0)} /></Field>
        <Field label="Bar sales (for venue settlement)"><input type="number" value={h.bar_sales ?? ""} onChange={(e) => set("bar_sales", num(e.target.value))} /></Field>
        <Field label="Front-of-house notes" wide><textarea value={h.foh_notes} onChange={(e) => set("foh_notes", e.target.value)} /></Field>
        <Field label="Incidents" wide><input value={h.incidents} onChange={(e) => set("incidents", e.target.value)} /></Field>
        <Field label="Notes for the venue" wide><input value={h.venue_notes} onChange={(e) => set("venue_notes", e.target.value)} /></Field>
      </div>
      <p className="small">Attendance <strong>{c.attendance}</strong>{c.pctCapacity !== null ? ` (${c.pctCapacity}% of capacity)` : ""} · Gross <strong>{money(c.gross)}</strong> · Net <strong>{money(c.net)}</strong> · Average ticket {money(c.avgPrice, { cents: true })}</p>
      <div className="toolbar">
        {exists && <button className="btn danger" onClick={() => { void deleteReportFile(report.path); onClose(); }}>Delete</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
      {importing && <TicketImport date={h.date} onClose={() => setImporting(false)} onImport={(t) => { set("tickets", t); setImporting(false); }} />}
    </Modal>
  );
}

/** Column matching for a ticketing platform export (Eventbrite, Square, a spreadsheet…). */
function TicketImport({ date, onClose, onImport }: { date: string; onClose: () => void; onImport: (t: HouseReport["tickets"]) => void }) {
  const [text, setText] = useState("");
  const rows = useMemo(() => (text.trim() ? parseCSV(text) : []), [text]);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const guess = (re: RegExp) => cols.find((c) => re.test(c)) ?? "";
  const [map, setMap] = useState({ type: "", quantity: "", amount: "", amountIsTotal: true, date: "", dateValue: "" });
  const m = {
    type: map.type || guess(/ticket.?type|type|tier|category/i),
    quantity: map.quantity || guess(/^qty$|quantity|count|tickets/i),
    amount: map.amount || guess(/total|gross|amount|price|paid/i),
    amountIsTotal: map.amountIsTotal,
    date: map.date || guess(/event.?date|^date$|performance/i),
    dateValue: map.dateValue,
  };
  const tickets = rows.length && m.amount ? ticketsFromRows(rows, m) : [];
  const sel = (label: string, key: "type" | "quantity" | "amount" | "date", optional = false) => (
    <Field label={label}>
      <select value={m[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        {optional && <option value="">— (one ticket per row)</option>}
        {!optional && <option value="">Choose…</option>}
        {cols.map((c) => <option key={c}>{c}</option>)}
      </select>
    </Field>
  );
  return (
    <Modal title="Import tickets" onClose={onClose}>
      <p className="muted small">Export orders or attendees from your ticketing platform as CSV, then match the columns. Only this performance&apos;s rows are counted if you pick a date column.</p>
      <input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea className="input" style={{ minHeight: 80, fontFamily: "ui-monospace, monospace", fontSize: 12 }} aria-label="CSV text" value={text} onChange={(e) => setText(e.target.value)} />
      {cols.length > 0 && (
        <div className="form-grid">
          {sel("Ticket type column", "type")}
          {sel("Quantity column", "quantity", true)}
          {sel("Amount column", "amount")}
          <Field label="Amount is">
            <select value={m.amountIsTotal ? "total" : "each"} onChange={(e) => setMap({ ...map, amountIsTotal: e.target.value === "total" })}>
              <option value="total">the row total</option><option value="each">the price per ticket</option>
            </select>
          </Field>
          {sel("Date column (optional)", "date", true)}
          {m.date && <Field label={`Only rows whose date contains`}><input value={map.dateValue} placeholder={date} onChange={(e) => setMap({ ...map, dateValue: e.target.value })} /></Field>}
        </div>
      )}
      {tickets.length > 0 && <p className="small">Found: {tickets.map((t) => `${t.sold} ${t.type} @ ${t.price}`).join(" · ")}</p>}
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!tickets.length} onClick={() => onImport(tickets)}>Use these numbers</button></div>
    </Modal>
  );
}

// ---- venue settlement ----

export function VenueSettlement() {
  const { data, project, today, money, saveVenue, saveBudget, allPayments, toast } = useApp();
  const venues = data.venues.filter((v) => !project || v.projects.includes(project));
  const [venue, setVenue] = useState(venues.find((v) => v.deal)?.slug ?? venues[0]?.slug ?? "");
  const v = data.venues.find((x) => x.slug === venue);
  const [nights, setNights] = useState<string[] | null>(null);
  const [pay, setPay] = useState<number | null>(null);
  if (!project) return <Empty title="Pick a project"><p>Settlements are per project and venue. Choose a project in the sidebar.</p></Empty>;
  if (!v) return <Empty title="No venues on this project"><p>Link a venue to this project on Contacts → Venues.</p></Empty>;

  const deal = dealFrom(v);
  const setDeal = (patch: Partial<VenueDeal>) => void saveVenue({ ...v, deal: { ...deal, ...patch } });
  const reports = data.houseReports.filter((h) => h.project === project && h.venue === v.slug).sort((a, b) => a.date.localeCompare(b.date));
  const chosen = reports.filter((h) => !nights || nights.includes(h.path));
  const deposits = depositsPaidTo(v, allPayments, project);
  const s = settle(deal, chosen, deposits, (x) => money(x, { cents: true }));
  const period = chosen.length ? `${fmtDate(chosen[0].date, true)}${chosen.length > 1 ? ` – ${fmtDate(chosen[chosen.length - 1].date, true)}` : ""}` : "";
  const projName = data.projects.find((p) => p.slug === project)?.name ?? project;

  const confirm = async () => {
    if (s.balance > 0) setPay(s.balance);
    else if (s.balance < 0) {
      const lines = data.budgets[project] ?? [];
      const line: BudgetLine = { id: uid("b"), category: "Ticket sales", type: "income", line_item: `Settlement from ${v.name} (${period})`, quantity: 1, rate: -s.balance, amount: -s.balance, notes: "From the venue settlement", expected_date: today, confidence: "Confirmed", through_sponsor: false, source: "Direct (earned income)" };
      await saveBudget(project, [...lines, line]);
      toast(`Expected income of ${money(-s.balance)} from ${v.name} added to the budget`);
    }
  };
  const n = (x: string) => Number(x) || 0;

  return (
    <div className="grid-2">
      <section className="card" aria-label="Settlement">
        <div className="card-head">
          <select className="input" aria-label="Venue" value={venue} onChange={(e) => { setVenue(e.target.value); setNights(null); }}>{venues.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select>
          <div className="spacer" />
          <button className="btn small" onClick={() => printHtml(`Settlement ${v.name}`, `<style>${REPORT_CSS}</style>${settlementHtml(v.name, projName, period, s, (x) => money(x, { cents: true }))}`)}>Print settlement sheet</button>
          <button className="btn small primary" disabled={!chosen.length || !s.balance} onClick={() => void confirm()}>Confirm</button>
        </div>
        {reports.length ? (
          <div className="chips" style={{ marginBottom: 10 }}>
            {reports.map((h) => (
              <button key={h.path} className="chip" aria-pressed={!nights || nights.includes(h.path)} onClick={() => { const cur = nights ?? reports.map((r) => r.path); setNights(cur.includes(h.path) ? cur.filter((x) => x !== h.path) : [...cur, h.path]); }}>{fmtDate(h.date)}</button>
            ))}
          </div>
        ) : (
          <p className="note small">No house reports at {v.name} for this project yet. Fill them in on House reports first.</p>
        )}
        <div className="table-scroll"><table className="t">
          <tbody>
            <tr><td>Box office (gross)</td><td className="r num">{money(s.gross, { cents: true })}</td></tr>
            {s.bar > 0 && <tr><td>Bar sales</td><td className="r num">{money(s.bar, { cents: true })}</td></tr>}
            {s.lines.map((l, i) => <tr key={i}><td className="muted">{l.label}</td><td className="r num">{money(l.amount, { cents: true })}</td></tr>)}
            <tr><td><strong>Due to the venue</strong></td><td className="r num"><strong>{money(s.venueDue, { cents: true })}</strong></td></tr>
            {s.depositsPaid > 0 && <tr><td className="muted">Deposits already paid</td><td className="r num">−{money(s.depositsPaid, { cents: true })}</td></tr>}
            {s.boxOfficeHeldByVenue > 0 && <tr><td className="muted">Box office held by the venue</td><td className="r num">−{money(s.boxOfficeHeldByVenue, { cents: true })}</td></tr>}
          </tbody>
          <tfoot><tr><td>{s.balance >= 0 ? "You owe the venue" : "The venue owes you"}</td><td className="r num">{money(Math.abs(s.balance), { cents: true })}</td></tr></tfoot>
        </table></div>
        <p className="small muted" style={{ marginTop: 8 }}>Confirm adds a payment to the venue (if you owe them) or expected income in the budget (if they owe you).</p>
      </section>

      <section className="card" aria-label="Deal terms">
        <div className="card-head"><h2>Deal terms</h2><span className="muted small">Saved on {v.name}</span></div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Amounts are">
            <select value={deal.basis} onChange={(e) => setDeal({ basis: e.target.value as VenueDeal["basis"] })}><option value="run">for the whole run</option><option value="night">per performance</option></select>
          </Field>
          <Field label="Flat rental"><input type="number" value={deal.flat_rental || ""} onChange={(e) => setDeal({ flat_rental: n(e.target.value) })} /></Field>
          <Field label="Venue's door split (%)"><input type="number" value={deal.door_split ? Math.round(deal.door_split * 100) : ""} onChange={(e) => setDeal({ door_split: n(e.target.value) / 100 })} /></Field>
          <Field label="Guarantee"><input type="number" value={deal.guarantee || ""} onChange={(e) => setDeal({ guarantee: n(e.target.value) })} /></Field>
          <label className="small wide"><input type="checkbox" checked={deal.versus} onChange={(e) => setDeal({ versus: e.target.checked })} /> Guarantee vs. door split, whichever is higher</label>
          <Field label="Bar minimum"><input type="number" value={deal.bar_minimum || ""} onChange={(e) => setDeal({ bar_minimum: n(e.target.value) })} /></Field>
          <label className="small"><input type="checkbox" checked={deal.venue_collects_box_office} onChange={(e) => setDeal({ venue_collects_box_office: e.target.checked })} /> The venue collects the box office</label>
        </div>
        <div className="section-title" style={{ marginTop: 10 }}><h3>Extra fees</h3><button className="btn small ghost" onClick={() => setDeal({ fees: [...deal.fees, { label: "", amount: 0 }] })}>+ Fee</button></div>
        {deal.fees.map((f, i) => (
          <div key={i} className="toolbar" style={{ marginBottom: 4 }}>
            <input className="input" style={{ flex: 1 }} aria-label="Fee" placeholder="Cleaning, tech…" value={f.label} onChange={(e) => setDeal({ fees: deal.fees.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
            <input className="input" style={{ width: 90 }} type="number" aria-label="Amount" value={f.amount || ""} onChange={(e) => setDeal({ fees: deal.fees.map((x, k) => (k === i ? { ...x, amount: n(e.target.value) } : x)) })} />
            <button className="icon-btn" aria-label="Remove fee" onClick={() => setDeal({ fees: deal.fees.filter((_, k) => k !== i) })}>×</button>
          </div>
        ))}
        {!v.deal && <p className="small muted">Fill these in once from the venue agreement; they&apos;re saved on the venue.</p>}
      </section>
      {pay !== null && <PaymentModal preset={{ payee: v.name, title: `Settlement: ${v.name} (${period})`, amount: pay, category: "Venue rental", due: today, project_alloc: { [project]: 1 } }} onClose={() => setPay(null)} />}
    </div>
  );
}
