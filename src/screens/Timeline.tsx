import { useMemo, useState } from "react";
import { EditCell, Empty, Field, Modal, Plus } from "../components/bits";
import { ANCHOR_LABEL, DEPARTMENTS, TASK_STATUSES, anchorsFor, applyTemplate, autoMilestones, relLabel, resolveDue, toTemplate } from "../lib/timeline";
import type { Anchor, TaskStatus, TimelineTask } from "../lib/types";
import { addDays, daysBetween, fmtDate, slugify, uid, weekStart } from "../lib/util";
import { useApp } from "../store";

type View = "Checklist" | "Timeline";

export function TimelineTab() {
  const { data, project, today, projectBySlug, saveTimeline, saveTimelineTemplate, allPayments, openDrawer, setScreen, toast } = useApp();
  const [view, setView] = useState<View>("Checklist");
  const [editing, setEditing] = useState<TimelineTask | null>(null);
  const [showDone, setShowDone] = useState(false);
  const p = projectBySlug(project);
  const tasks = data.timelines[project] ?? [];
  const anchors = useMemo(() => (p ? anchorsFor(p, data.events) : null), [p, data.events]);
  const milestones = useMemo(() => (p && anchors ? autoMilestones(p, anchors, allPayments, data.docs) : []), [p, anchors, allPayments, data.docs]);

  if (!project || !p || !anchors) return <Empty title="Pick a project"><p>Each project has its own timeline. Choose one in the sidebar.</p></Empty>;

  const save = (next: TimelineTask[]) => void saveTimeline(project, next);
  const update = (id: string, patch: Partial<TimelineTask>) => save(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const owner = (o: string) => (o === "producer" ? "You" : data.people.find((x) => x.slug === o)?.name ?? o);

  const rows = tasks
    .map((t) => ({ t, due: resolveDue(t, anchors) }))
    .filter(({ t }) => showDone || (t.status !== "Done" && t.status !== "Skipped"))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const overdue = rows.filter(({ t, due }) => due && due < today && t.status !== "Done" && t.status !== "Skipped").length;
  const done = tasks.filter((t) => t.status === "Done").length;

  const addTemplate = (slug: string) => {
    const tpl = data.timelineTemplates.find((x) => x.slug === slug);
    if (!tpl) return;
    const usesOpening = tpl.tasks.some((x) => x.rel?.anchor === "opening");
    const usesClosing = tpl.tasks.some((x) => x.rel?.anchor === "closing");
    if ((usesOpening && !anchors.opening) || (usesClosing && !anchors.closing)) toast(`Set ${p.name}'s ${usesOpening && !anchors.opening ? "opening" : "closing"} date so these tasks get due dates.`);
    save([...tasks, ...applyTemplate(tpl)]);
  };

  const saveAsTemplate = () => {
    const title = prompt("Template name", `${p.name} timeline`);
    if (!title) return;
    const t = toTemplate(title, `Saved from ${p.name}.`, tasks, anchors);
    void saveTimelineTemplate({ ...t, slug: slugify(title) });
    toast(`Saved "${title}" as a timeline template`);
  };

  // Group by week for the checklist.
  const weeks = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.due ? weekStart(r.due) : "";
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k)!.push(r);
  }
  const msByWeek = new Map<string, typeof milestones>();
  for (const m of milestones) {
    const k = weekStart(m.date);
    if (!msByWeek.has(k)) msByWeek.set(k, []);
    msByWeek.get(k)!.push(m);
  }
  const allWeeks = [...new Set([...weeks.keys(), ...msByWeek.keys()])].sort((a, b) => (a || "9999").localeCompare(b || "9999"));

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Timeline view">
          {(["Checklist", "Timeline"] as View[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <span className="small muted">{done}/{tasks.length} done{overdue ? ` · ` : ""}{overdue ? <span className="neg">{overdue} overdue</span> : null}</span>
        <span className="small muted">· Opening {anchors.opening ? fmtDate(anchors.opening, true) : "not set"}</span>
        <div className="spacer" />
        <label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
        <select className="input" aria-label="Add tasks from a template" value="" onChange={(e) => addTemplate(e.target.value)}>
          <option value="">Add from template…</option>
          {data.timelineTemplates.map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}
        </select>
        {tasks.length > 0 && <button className="btn small" onClick={saveAsTemplate}>Save as template</button>}
        <button className="btn small primary" onClick={() => setEditing({ id: uid("t"), title: "", due: today, rel: null, owner: "producer", status: "To do", department: "Producing", phase: "", link: "", todoist: false, todoist_task_id: "" })}><Plus /> Task</button>
      </div>

      {!tasks.length && !milestones.length && (
        <Empty title="No timeline yet">
          <p>Start from a template (Staged reading, Fringe / bar show, Full production, or the Closing checklist). Tasks are set relative to opening, so they move when opening moves.</p>
        </Empty>
      )}

      {view === "Checklist" && allWeeks.length > 0 && (
        <table className="t">
          {allWeeks.map((w) => (
            <tbody key={w || "nodate"}>
              <tr className="group-head"><td colSpan={6}>{w ? `Week of ${fmtDate(w, true)}${w === weekStart(today) ? " · this week" : ""}` : "No date yet"}</td></tr>
              {(msByWeek.get(w) ?? []).map((m, i) => (
                <tr key={`m${i}`} className="milestone">
                  <td />
                  <td colSpan={3}>
                    <button className="linklike" disabled={!m.target} onClick={() => { if (m.target?.kind === "payment") { setScreen("payments"); openDrawer(m.target); } else if (m.target?.kind === "doc") { setScreen("paperwork"); openDrawer(m.target); } }}>{m.title}</button>
                    <span className="tag" style={{ marginLeft: 8 }}>{m.kind === "schedule" ? "Schedule" : m.kind === "payment" ? "Payments" : "Paperwork"}</span>
                  </td>
                  <td className="num small muted">{fmtDate(m.date)}</td>
                  <td />
                </tr>
              ))}
              {(weeks.get(w) ?? []).map(({ t, due }) => {
                const late = due && due < today && t.status !== "Done" && t.status !== "Skipped";
                return (
                  <tr key={t.id} className={t.status === "Done" ? "done" : ""}>
                    <td style={{ width: 32 }}><input type="checkbox" aria-label={`Done: ${t.title}`} checked={t.status === "Done"} onChange={(e) => update(t.id, { status: e.target.checked ? "Done" : "To do" })} /></td>
                    <td><EditCell label="Task" value={t.title} onSave={(v) => update(t.id, { title: v })} /></td>
                    <td className="small muted">{t.department}</td>
                    <td>
                      <select className="cell-edit" aria-label="Owner" value={t.owner} onChange={(e) => update(t.id, { owner: e.target.value })}>
                        <option value="producer">You</option>
                        {data.people.filter((x) => x.projects.includes(project)).map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
                      </select>
                    </td>
                    <td className={`num small ${late ? "neg" : ""}`} style={{ whiteSpace: "nowrap" }}>
                      <button className="linklike" onClick={() => setEditing(t)} title="Change date">{due ? fmtDate(due) : "Set date"}</button>
                      {t.rel && <div className="muted small">{relLabel(t.rel)}</div>}
                    </td>
                    <td>
                      <select className="cell-edit" aria-label="Status" value={t.status} onChange={(e) => update(t.id, { status: e.target.value as TaskStatus })}>
                        {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      )}

      {view === "Timeline" && <Gantt rows={rows} milestones={milestones} today={today} owner={owner} onOpen={setEditing} />}
      {editing && <TaskModal task={editing} anchors={anchors} onClose={() => setEditing(null)} onSave={(t) => { save(tasks.some((x) => x.id === t.id) ? tasks.map((x) => (x.id === t.id ? t : x)) : [...tasks, t]); setEditing(null); }} onDelete={tasks.some((x) => x.id === editing.id) ? () => { save(tasks.filter((x) => x.id !== editing.id)); setEditing(null); } : undefined} />}
    </>
  );
}

/** A horizontal week-by-week view, one row per department. */
function Gantt({ rows, milestones, today, owner, onOpen }: { rows: { t: TimelineTask; due: string }[]; milestones: ReturnType<typeof autoMilestones>; today: string; owner: (o: string) => string; onOpen: (t: TimelineTask) => void }) {
  const dated = rows.filter((r) => r.due);
  const dates = [...dated.map((r) => r.due), ...milestones.map((m) => m.date), today].sort();
  if (dated.length + milestones.length === 0) return <p className="muted">Nothing with a date yet.</p>;
  const start = weekStart(dates[0]);
  const nWeeks = Math.min(60, Math.ceil((daysBetween(start, dates[dates.length - 1]) + 1) / 7) + 1);
  const W = 56;
  const x = (d: string) => (daysBetween(start, d) / 7) * W;
  const depts = [...new Set(dated.map((r) => r.t.department || "Other"))];
  return (
    <div className="grid-scroll card" style={{ padding: 0 }}>
      <div className="gantt" style={{ width: 160 + nWeeks * W }}>
        <div className="g-row g-head">
          <div className="g-label" />
          <div className="g-track">
            {Array.from({ length: nWeeks }, (_, i) => <span key={i} className="g-week" style={{ left: i * W, width: W }}>{fmtDate(addDays(start, i * 7))}</span>)}
            <span className="g-today" style={{ left: x(today) }} title="Today" />
          </div>
        </div>
        <div className="g-row">
          <div className="g-label muted small">Milestones</div>
          <div className="g-track">
            {milestones.map((m, i) => <span key={i} className={`g-ms g-${m.kind}`} style={{ left: x(m.date) }} title={`${fmtDate(m.date)}: ${m.title}`}>◆</span>)}
            <span className="g-today" style={{ left: x(today) }} />
          </div>
        </div>
        {depts.map((d) => (
          <div className="g-row" key={d}>
            <div className="g-label small">{d}</div>
            <div className="g-track">
              {dated.filter((r) => (r.t.department || "Other") === d).map(({ t, due }) => (
                <button key={t.id} className={`g-task${t.status === "Done" ? " done" : due < today && t.status !== "Skipped" ? " late" : ""}`} style={{ left: x(due) }} title={`${fmtDate(due)} · ${t.title} · ${owner(t.owner)} · ${t.status}`} onClick={() => onOpen(t)}>
                  {t.title}
                </button>
              ))}
              <span className="g-today" style={{ left: x(today) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskModal({ task, anchors, onClose, onSave, onDelete }: { task: TimelineTask; anchors: Record<Anchor, string>; onClose: () => void; onSave: (t: TimelineTask) => void; onDelete?: () => void }) {
  const { data, project } = useApp();
  const [t, setT] = useState(task);
  const [mode, setMode] = useState<"date" | "rel">(task.rel ? "rel" : "date");
  const rel = t.rel ?? { anchor: "opening" as Anchor, days: anchors.opening && t.due ? daysBetween(anchors.opening, t.due) : -28 };
  const weeks = rel.days % 7 === 0;
  const due = mode === "rel" ? (anchors[rel.anchor] ? addDays(anchors[rel.anchor], rel.days) : "") : t.due;
  const submit = () => onSave({ ...t, title: t.title.trim(), rel: mode === "rel" ? rel : null, due: mode === "rel" ? "" : t.due });
  return (
    <Modal title={task.title ? "Edit task" : "New task"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Task" wide><input autoFocus value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></Field>
        <div className="wide">
          <div className="seg" role="group" aria-label="Due date type">
            <button aria-pressed={mode === "date"} onClick={() => setMode("date")}>On a date</button>
            <button aria-pressed={mode === "rel"} onClick={() => setMode("rel")}>Relative to a key date</button>
          </div>
        </div>
        {mode === "date" ? (
          <Field label="Due"><input type="date" value={t.due} onChange={(e) => setT({ ...t, due: e.target.value })} /></Field>
        ) : (
          <>
            <Field label="Amount">
              <input type="number" value={Math.abs(weeks ? rel.days / 7 : rel.days)} onChange={(e) => { const n = Math.abs(Number(e.target.value) || 0) * (weeks ? 7 : 1) * (rel.days > 0 ? 1 : -1); setT({ ...t, rel: { ...rel, days: n } }); }} />
            </Field>
            <Field label="Unit">
              <select value={weeks ? "w" : "d"} onChange={(e) => setT({ ...t, rel: { ...rel, days: e.target.value === "w" ? Math.round(rel.days / 7) * 7 || (rel.days < 0 ? -7 : 7) : rel.days } })}>
                <option value="w">weeks</option><option value="d">days</option>
              </select>
            </Field>
            <Field label="Before / after">
              <select value={rel.days > 0 ? "after" : "before"} onChange={(e) => setT({ ...t, rel: { ...rel, days: Math.abs(rel.days) * (e.target.value === "after" ? 1 : -1) } })}>
                <option value="before">before</option><option value="after">after</option>
              </select>
            </Field>
            <Field label="Key date">
              <select value={rel.anchor} onChange={(e) => setT({ ...t, rel: { ...rel, anchor: e.target.value as Anchor } })}>
                {(Object.keys(ANCHOR_LABEL) as Anchor[]).map((a) => <option key={a} value={a}>{ANCHOR_LABEL[a]}{anchors[a] ? ` (${fmtDate(anchors[a])})` : " (not set)"}</option>)}
              </select>
            </Field>
            <p className="wide small muted">{due ? `Due ${fmtDate(due, true)}. It moves if ${ANCHOR_LABEL[rel.anchor].toLowerCase()} moves.` : `${ANCHOR_LABEL[rel.anchor]} isn't set yet, so this has no date.`}</p>
          </>
        )}
        <Field label="Owner">
          <select value={t.owner} onChange={(e) => setT({ ...t, owner: e.target.value })}>
            <option value="producer">You</option>
            {data.people.filter((x) => x.projects.includes(project)).map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <input list="mp-depts" value={t.department} onChange={(e) => setT({ ...t, department: e.target.value })} />
          <datalist id="mp-depts">{DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Status">
          <select value={t.status} onChange={(e) => setT({ ...t, status: e.target.value as TaskStatus })}>{TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
      </div>
      <div className="toolbar">
        {onDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!t.title.trim()} onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}
