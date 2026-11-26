import { useState } from "react";
import { Empty, Field, Modal, Tile } from "../components/bits";
import { DAILY_DEPTS, dailyCalc, dailyFromSchedule, dailyRunSummary, dailyText, eighths } from "../lib/reports";
import type { DailyReport, DailyScene, Payment, TimelineTask } from "../lib/types";
import { fmtDate, round2, uid } from "../lib/util";
import { useApp } from "../store";
import { printText } from "./Schedule";

const WORK_TYPES = ["Rehearsal", "Read-through", "Tech", "Dress", "Photo / video shoot", "Strike", "Fitting"];

export function DailyReports() {
  const { data, project, today, projectBySlug } = useApp();
  const [editing, setEditing] = useState<DailyReport | null>(null);
  if (!project) return <Empty title="Pick a project"><p>Daily reports belong to a project. Choose one in the sidebar.</p></Empty>;
  const p = projectBySlug(project);
  const reports = data.dailyReports.filter((r) => r.project === project);
  const workDays = [...new Set(data.events.filter((e) => e.project === project && WORK_TYPES.includes(e.type) && e.date <= today).map((e) => e.date))];
  const dates = [...new Set([...workDays, ...reports.map((r) => r.date)])].sort().reverse();
  const run = dailyRunSummary(reports);
  const scenes = data.scenes[project] ?? [];

  const open = (date: string) => {
    const r = reports.find((x) => x.date === date);
    setEditing(r ?? dailyFromSchedule(project, date, data.events, (id) => scenes.find((s) => s.id === id)?.number ?? id, (loc) => data.venues.find((v) => v.slug === loc)?.name ?? loc));
  };

  return (
    <>
      {reports.length > 0 && (
        <div className="tiles">
          <Tile label="Days reported" value={run.days} />
          <Tile label="Hours worked" value={run.hours} sub="Everyone, all days" />
          {run.plannedPages > 0 && <Tile label="Pages" value={eighths(run.shotPages)} sub={`of ${eighths(run.plannedPages)} planned`} />}
          <Tile label="Days over" value={run.daysOver} alert={run.daysOver > 0} sub={`${run.incidents} with incidents or damage`} />
        </div>
      )}
      {dates.length ? (
        <table className="t">
          <thead><tr><th>Day</th><th>Kind</th><th>Wrap</th><th className="r">People</th><th /></tr></thead>
          <tbody>
            {dates.map((d) => {
              const r = reports.find((x) => x.date === d);
              const c = r && dailyCalc(r);
              const ev = data.events.find((e) => e.project === project && e.date === d);
              return (
                <tr key={d} className="clickable" onClick={() => open(d)}>
                  <td>{fmtDate(d, true)}{ev?.title ? <span className="muted small"> · {ev.title}</span> : ""}</td>
                  <td className="muted">{r?.kind ?? ev?.type}</td>
                  <td className={c?.overMinutes ? "neg" : ""}>{r?.wrap || "—"}{c?.overMinutes ? ` (+${c.overMinutes} min)` : ""}</td>
                  <td className="r num">{r ? r.calls.filter((x) => !x.absent).length : ""}</td>
                  <td className="r">{r ? <span className="pill green">Done</span> : <span className="pill red">Missing</span>}{r && (r.injuries || r.damage) && <span className="pill amber" style={{ marginLeft: 4 }}>Incident</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty title="No work days yet"><p>Rehearsals, tech and shoot days on the Schedule each get a daily report. It starts filled in from the Schedule.</p></Empty>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>One report per working day for {p?.name}: a shoot day for film, or a rehearsal, tech or work day for theater. Saved as <code>daily-reports/{project}/&lt;date&gt;.md</code>.</p>
      {editing && <DailyModal report={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DailyModal({ report, onClose }: { report: DailyReport; onClose: () => void }) {
  const { data, money, saveDailyReport, saveTimeline, savePayment, deleteReportFile, toast } = useApp();
  const [r, setR] = useState(report);
  const set = <K extends keyof DailyReport>(k: K, v: DailyReport[K]) => setR((x) => ({ ...x, [k]: v }));
  const c = dailyCalc(r);
  const name = (s: string) => data.people.find((p) => p.slug === s)?.name ?? s;
  const exists = data.dailyReports.some((x) => x.path === report.path);
  const projName = data.projects.find((p) => p.slug === r.project)?.name ?? r.project;
  const items = data.inventory.filter((i) => !i.project || i.project === r.project);
  const people = data.people.filter((p) => p.projects.includes(r.project) && !r.calls.some((x) => x.person === p.slug));
  const scenesAll = data.scenes[r.project] ?? [];
  const setCall = (i: number, patch: Partial<DailyReport["calls"][number]>) => set("calls", r.calls.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setScene = (i: number, patch: Partial<DailyScene>) => set("scenes", r.scenes.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // Overtime: hourly people who worked past the planned end.
  const overtime = r.calls
    .map((x) => {
      const person = data.people.find((p) => p.slug === x.person);
      const planned = x.call && r.planned_end ? Math.max(0, (toMin(r.planned_end) - toMin(x.call)) / 60) : 0;
      const extra = round2((c.hours[x.person] ?? 0) - planned);
      return { person, extra };
    })
    .filter((o) => o.person?.rate_type === "hourly" && o.extra > 0.05);

  const followUps = async () => {
    const tasks: TimelineTask[] = [];
    const t = (title: string, department: string): TimelineTask => ({ id: uid("t"), title, due: r.date, rel: null, owner: "producer", status: "To do", department, phase: "", link: `daily:${r.date}`, todoist: false, todoist_task_id: "" });
    for (const s of c.moved) tasks.push(t(`Reschedule scene ${s} (moved on ${r.date})`, "Production"));
    if (r.injuries.trim()) tasks.push(t(`Follow up on incident from ${r.date}: ${r.injuries.slice(0, 60)}`, "Admin"));
    if (r.damage.trim()) tasks.push(t(`Deal with damage from ${r.date}: ${r.damage.slice(0, 60)}`, "Production"));
    if (tasks.length) await saveTimeline(r.project, [...(data.timelines[r.project] ?? []), ...tasks]);
    for (const o of overtime) {
      const pay: Payment = { id: uid("p"), title: `Overtime ${r.date}: ${o.person!.name} (${o.extra} h)`, payee: o.person!.name, method: "Checking", budget_line: "", category: "Artist fees", due: r.date, amount: round2(o.extra * (Number(o.person!.rate) || 0)), status: "scheduled", paid_date: "", ledger_id: "", project_alloc: { [r.project]: 1 }, notes: "Draft from the daily report. Check before paying." };
      await savePayment(pay);
    }
    const next = { ...r, followups_done: true };
    setR(next);
    await saveDailyReport(next);
    toast(`Follow-ups: ${tasks.length} timeline task${tasks.length === 1 ? "" : "s"}${overtime.length ? `, ${overtime.length} overtime payment draft${overtime.length === 1 ? "" : "s"}` : ""}`);
  };
  const needsFollowUp = !r.followups_done && (c.moved.length || r.injuries.trim() || r.damage.trim() || overtime.length);
  const text = dailyText(r, data.people, projName, "");

  return (
    <Modal title={`Daily report · ${fmtDate(r.date, true)}`} onClose={onClose}>
      <div className="form-grid">
        <Field label="Kind"><input list="mp-daykinds" value={r.kind} onChange={(e) => set("kind", e.target.value)} /><datalist id="mp-daykinds">{["Rehearsal", "Tech", "Dress", "Shoot day", "Work day"].map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Location"><input value={r.location} onChange={(e) => set("location", e.target.value)} /></Field>
        <Field label="Planned end"><input type="time" value={r.planned_end} onChange={(e) => set("planned_end", e.target.value)} /></Field>
        <Field label="First shot / start"><input type="time" value={r.first_start} onChange={(e) => set("first_start", e.target.value)} /></Field>
        <Field label="Meal from"><input type="time" value={r.meal_start} onChange={(e) => set("meal_start", e.target.value)} /></Field>
        <Field label="Meal to"><input type="time" value={r.meal_end} onChange={(e) => set("meal_end", e.target.value)} /></Field>
        <Field label="Wrap"><input type="time" value={r.wrap} onChange={(e) => set("wrap", e.target.value)} /></Field>
      </div>
      {c.overMinutes > 0 && <p className="note small">Ran {c.overMinutes} minutes past the planned end.</p>}

      <div>
        <div className="section-title">
          <h3>Who was called</h3>
          {people.length > 0 && (
            <select className="input" aria-label="Add a person" value="" onChange={(e) => e.target.value && set("calls", [...r.calls, { person: e.target.value, call: "", in: "", out: r.wrap, late: false, absent: false }])}>
              <option value="">+ Add person…</option>{people.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          )}
        </div>
        <table className="t daily-calls">
          <thead><tr><th>Person</th><th>Call</th><th>In</th><th>Out</th><th>Late</th><th>Absent</th><th className="r">Hours</th></tr></thead>
          <tbody>
            {r.calls.map((x, i) => (
              <tr key={x.person}>
                <td>{name(x.person)}</td>
                <td><input className="cell-edit" type="time" aria-label="Call" value={x.call} onChange={(e) => setCall(i, { call: e.target.value })} /></td>
                <td><input className="cell-edit" type="time" aria-label="In" value={x.in} onChange={(e) => setCall(i, { in: e.target.value })} /></td>
                <td><input className="cell-edit" type="time" aria-label="Out" value={x.out} onChange={(e) => setCall(i, { out: e.target.value })} /></td>
                <td><input type="checkbox" aria-label="Late" checked={x.late} onChange={(e) => setCall(i, { late: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label="Absent" checked={x.absent} onChange={(e) => setCall(i, { absent: e.target.checked })} /></td>
                <td className="r num">{c.hours[x.person] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.calls.some((x) => !x.out) && r.wrap && <button className="btn small ghost" onClick={() => set("calls", r.calls.map((x) => ({ ...x, out: x.out || r.wrap })))}>Set everyone&apos;s out time to wrap ({r.wrap})</button>}
      </div>

      <div>
        <div className="section-title">
          <h3>Scenes {c.plannedPages > 0 && <span className="muted small">· {eighths(c.shotPages)} of {eighths(c.plannedPages)} pages</span>}</h3>
          <select className="input" aria-label="Add a scene" value="" onChange={(e) => e.target.value && set("scenes", [...r.scenes, { scene: e.target.value, planned_pages: 0, shot_pages: 0, status: "Planned" }])}>
            <option value="">+ Add scene…</option>{scenesAll.map((s) => <option key={s.id} value={s.number}>{s.number} {s.title}</option>)}
          </select>
        </div>
        {r.scenes.length > 0 && (
          <table className="t">
            <thead><tr><th>Scene</th><th>Status</th><th className="r">Planned (1/8 pages)</th><th className="r">Done (1/8 pages)</th></tr></thead>
            <tbody>
              {r.scenes.map((s, i) => (
                <tr key={i}>
                  <td>{s.scene}</td>
                  <td><select className="cell-edit" aria-label="Status" value={s.status} onChange={(e) => setScene(i, { status: e.target.value as DailyScene["status"] })}>{["Planned", "Done", "Partly done", "Moved"].map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td className="r"><input className="cell-edit r" type="number" aria-label="Planned eighths" value={s.planned_pages || ""} onChange={(e) => setScene(i, { planned_pages: Number(e.target.value) || 0 })} /></td>
                  <td className="r"><input className="cell-edit r" type="number" aria-label="Done eighths" value={s.shot_pages || ""} onChange={(e) => setScene(i, { shot_pages: Number(e.target.value) || 0 })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="form-grid">
        <Field label="Setups (film)"><input type="number" value={r.setups ?? ""} onChange={(e) => set("setups", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        <Field label="Takes (film)"><input type="number" value={r.takes ?? ""} onChange={(e) => set("takes", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        {items.length > 0 && (
          <div className="wide">
            <div className="muted small" style={{ marginBottom: 4 }}>Used from the Equipment log</div>
            <div className="chips">{items.map((i) => <button key={i.id} className="chip" aria-pressed={r.used_items.includes(i.id)} onClick={() => set("used_items", r.used_items.includes(i.id) ? r.used_items.filter((x) => x !== i.id) : [...r.used_items, i.id])}>{i.name}</button>)}</div>
          </div>
        )}
        <Field label="Injuries or incidents" wide><input value={r.injuries} onChange={(e) => set("injuries", e.target.value)} /></Field>
        <Field label="Damage" wide><input value={r.damage} onChange={(e) => set("damage", e.target.value)} /></Field>
        {DAILY_DEPTS.map((d) => <Field key={d} label={`${d} notes`}><input value={r.dept_notes[d] ?? ""} onChange={(e) => set("dept_notes", { ...r.dept_notes, [d]: e.target.value })} /></Field>)}
        <Field label="Notes for tomorrow" wide><input value={r.tomorrow} onChange={(e) => set("tomorrow", e.target.value)} /></Field>
      </div>

      {needsFollowUp ? (
        <div className="note small">
          Follow-ups to make: {[c.moved.length && `${c.moved.length} moved scene${c.moved.length > 1 ? "s" : ""} → timeline tasks`, (r.injuries || r.damage) && "incident/damage → timeline task", overtime.length && `overtime for ${overtime.map((o) => `${o.person!.name} (${o.extra} h, ${money(o.extra * (Number(o.person!.rate) || 0))})`).join(", ")} → draft payments`].filter(Boolean).join(" · ")}
          <button className="btn small primary" style={{ marginLeft: 8 }} onClick={() => void followUps()}>Make them</button>
        </div>
      ) : r.followups_done ? <p className="small muted">Follow-ups made.</p> : null}

      <div className="toolbar">
        {exists && <button className="btn danger" onClick={() => { void deleteReportFile(report.path); onClose(); }}>Delete</button>}
        <button className="btn" onClick={() => printText(`Daily report ${r.date}`, text)}>Print / Save as PDF</button>
        <button className="btn" onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Copied. Paste it into an email to the company."))}>Copy as text</button>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void saveDailyReport(r).then(onClose)}>Save</button>
      </div>
    </Modal>
  );
}

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
