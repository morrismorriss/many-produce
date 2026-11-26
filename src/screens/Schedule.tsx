import { useEffect, useMemo, useState } from "react";
import { Chips, Empty, Field, Modal, Plus, ProjectTag, printHtml, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { calledForScenes, callSheetText, conflictsForEvent, eventHours, eventsToICS, scheduleWarnings, weeklyText } from "../lib/schedule";
import { EVENT_TYPES, type ScheduleEvent } from "../lib/types";
import { addDays, fmtDate, parseISO, uid, weekStart } from "../lib/util";
import { useApp } from "../store";
import { AvailabilityTab, ScenesTab } from "./Availability";
import { TimelineTab } from "./Timeline";

type Tab = "Calendar" | "Availability" | "Scenes" | "Timeline" | "Stripboard";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const printText = (title: string, text: string) => printHtml(title, `<pre style="font: 11pt/1.5 Menlo, monospace; white-space: pre-wrap">${esc(text)}</pre>`);

export function Schedule() {
  const { project, projectBySlug, newItemSignal } = useApp();
  const p = projectBySlug(project);
  const tabs: Tab[] = ["Calendar", "Availability", "Scenes", "Timeline", ...(p?.type === "Film" ? (["Stripboard"] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>("Calendar");
  const [adding, setAdding] = useState<Partial<ScheduleEvent> | null>(null);
  useEffect(() => { if (newItemSignal && tab === "Calendar") setAdding({}); }, [newItemSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tabs.includes(tab) ? tab : "Calendar";
  return (
    <>
      <Header title="Schedule" actions={active === "Calendar" ? <button className="btn primary" onClick={() => setAdding({})}><Plus /> Event</button> : null} />
      <div className="content">
        <div className="toolbar"><Chips label="Schedule view" options={tabs} value={active} onChange={setTab} /></div>
        {active === "Calendar" && <CalendarTab onAdd={setAdding} />}
        {active === "Availability" && <AvailabilityTab onSchedule={(e) => { setTab("Calendar"); setAdding(e); }} />}
        {active === "Scenes" && <ScenesTab />}
        {active === "Timeline" && <TimelineTab />}
        {active === "Stripboard" && (
          <div className="placeholder card">
            <span className="pill amber">Build phase 9</span>
            <h2 style={{ marginTop: 10 }}>Stripboard is coming in a later build</h2>
            <p className="muted">Breakdown sheets, a drag-and-drop board, day out of days, and imports from Many Write and Final Draft. Shoot days will land on this Calendar as events.</p>
          </div>
        )}
      </div>
      {adding && <EventModal preset={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function CalendarTab({ onAdd }: { onAdd: (e: Partial<ScheduleEvent>) => void }) {
  const { data, project, today, projectBySlug } = useApp();
  const [from, setFrom] = useState(weekStart(today));
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [icsPerson, setIcsPerson] = useState("");
  const events = useMemo(() => data.events.filter((e) => !project || e.project === project), [data.events, project]);
  const warnings = useMemo(() => scheduleWarnings(data.events, data.conflicts, data.people, data.venues, data.settings.max_hours_week), [data]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const scenesAll = Object.values(data.scenes).flat();
  const people = data.people.filter((p) => !project || p.projects.includes(project));
  const name = (slug: string) => data.people.find((p) => p.slug === slug)?.name ?? slug;
  const place = (loc: string) => data.venues.find((v) => v.slug === loc)?.name ?? loc;
  const upcoming = events.filter((e) => e.date >= today).length;

  return (
    <>
      <div className="toolbar">
        <button className="btn small" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">←</button>
        <button className="btn small" onClick={() => setFrom(weekStart(today))}>This week</button>
        <button className="btn small" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">→</button>
        <strong>Week of {fmtDate(from, true)}</strong>
        <div className="spacer" />
        <button className="btn small" onClick={() => printText("Weekly schedule", weeklyText(from, events, data.people, data.venues, data.projects, scenesAll))}>Print week</button>
        <button className="btn small" onClick={() => saveTextFile(`schedule-week-of-${from}.txt`, weeklyText(from, events, data.people, data.venues, data.projects, scenesAll))}>Week as text</button>
        <select className="input" aria-label="Calendar file for" value={icsPerson} onChange={(e) => setIcsPerson(e.target.value)}>
          <option value="">Everyone&apos;s calls</option>
          {people.map((p) => <option key={p.slug} value={p.slug}>Only {p.name}&apos;s calls</option>)}
        </select>
        <button className="btn small" onClick={() => saveTextFile(`${icsPerson || project || "schedule"}.ics`, eventsToICS(events, icsPerson, data.projects, data.venues), "text/calendar")}>Export .ics</button>
      </div>
      {!events.length && <Empty title="Nothing scheduled yet"><p>Add rehearsals, fittings, tech and performances. Import everyone&apos;s availability on the Availability tab first, and warnings will flag clashes as you go.</p></Empty>}
      {events.length > 0 && (
        <div className="week">
          {days.map((d) => {
            const list = events.filter((e) => e.date === d).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <section key={d} className={`day${d === today ? " today" : ""}`} aria-label={fmtDate(d, true)}>
                <div className="day-head">
                  <span>{parseISO(d).toLocaleDateString("en-US", { weekday: "short" })} <strong>{fmtDate(d)}</strong></span>
                  <span className="day-actions">
                    {list.length > 0 && <button className="icon-btn" title="Print call sheet" aria-label={`Print call sheet for ${fmtDate(d)}`} onClick={() => printText(`Call sheet ${d}`, callSheetText(d, events, data.people, data.venues, data.projects, scenesAll))}>⎙</button>}
                    <button className="icon-btn" aria-label={`Add event on ${fmtDate(d)}`} onClick={() => onAdd({ date: d })}>+</button>
                  </span>
                </div>
                {list.map((e) => {
                  const w = warnings.filter((x) => x.event === e.id);
                  return (
                    <button key={e.id} className={`event type-${e.type.replace(/\W+/g, "").toLowerCase()}`} onClick={() => setEditing(e)}>
                      <span className="small muted">{e.start ? `${e.start}–${e.end}` : "Time TBD"}</span>
                      <strong>{e.type}{e.title ? `: ${e.title}` : ""}</strong>
                      {!project && <ProjectTag slug={e.project} />}
                      {e.location && <span className="small">{place(e.location)}</span>}
                      {e.called.length > 0 && <span className="small muted">{e.called.length <= 3 ? e.called.map(name).join(", ") : `${e.called.length} called`}</span>}
                      {w.length > 0 && <span className="pill red" title={w.map((x) => x.message).join("\n")}>⚠ {w.length} warning{w.length > 1 ? "s" : ""}</span>}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      {events.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>{upcoming} upcoming events{project && projectBySlug(project)?.opening ? ` · opening ${fmtDate(projectBySlug(project)!.opening, true)}` : ""}.</p>}
      {editing && <EventModal existing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function EventModal({ existing, preset, onClose }: { existing?: ScheduleEvent; preset?: Partial<ScheduleEvent>; onClose: () => void }) {
  const { data, project, today, saveEvent, deleteEvent } = useApp();
  const defProject = project || data.projects.find((p) => !p.builtin)?.slug || "overhead";
  const [e, setE] = useState<ScheduleEvent>(
    existing ?? { id: uid("ev"), project: defProject, date: today, start: "18:00", end: "21:00", type: "Rehearsal", title: "", location: "", called: [], scenes: [], notes: "", ...preset },
  );
  const set = <K extends keyof ScheduleEvent>(k: K, v: ScheduleEvent[K]) => setE((x) => ({ ...x, [k]: v }));
  const proj = data.projects.find((p) => p.slug === e.project);
  const scenes = data.scenes[e.project] ?? [];
  const people = data.people.filter((p) => p.projects.includes(e.project));
  const others = data.people.filter((p) => !p.projects.includes(e.project));
  const hits = conflictsForEvent(e, data.conflicts);
  const allWarnings = scheduleWarnings([...data.events.filter((x) => x.id !== e.id), e], data.conflicts, data.people, data.venues, data.settings.max_hours_week).filter((w) => w.event === e.id && w.kind !== "conflict");
  const name = (slug: string) => data.people.find((p) => p.slug === slug)?.name ?? slug;

  const toggleScene = (id: string) => {
    const next = e.scenes.includes(id) ? e.scenes.filter((x) => x !== id) : [...e.scenes, id];
    // Choosing scenes calls the cast for them (keeps anyone added by hand).
    const auto = calledForScenes(next, scenes, proj?.cast ?? {});
    const before = calledForScenes(e.scenes, scenes, proj?.cast ?? {});
    const manual = e.called.filter((c) => !before.includes(c));
    setE((x) => ({ ...x, scenes: next, called: [...new Set([...manual, ...auto])] }));
  };
  const save = async () => { await saveEvent(e); onClose(); };

  return (
    <Modal title={existing ? "Edit event" : "New event"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Type">
          <select value={e.type} onChange={(x) => set("type", x.target.value)}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Title (optional)"><input autoFocus value={e.title} onChange={(x) => set("title", x.target.value)} placeholder="Act 2 work-through" /></Field>
        <Field label="Project">
          <select value={e.project} onChange={(x) => set("project", x.target.value)}>{data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
        </Field>
        <Field label="Date"><input type="date" value={e.date} onChange={(x) => set("date", x.target.value)} /></Field>
        <Field label="Start"><input type="time" value={e.start} onChange={(x) => set("start", x.target.value)} /></Field>
        <Field label="End"><input type="time" value={e.end} onChange={(x) => set("end", x.target.value)} /></Field>
        <Field label="Location">
          <input list="mp-locations" value={data.venues.find((v) => v.slug === e.location)?.name ?? e.location} onChange={(x) => set("location", data.venues.find((v) => v.name === x.target.value)?.slug ?? x.target.value)} placeholder="A venue or anywhere" />
          <datalist id="mp-locations">{data.venues.map((v) => <option key={v.slug} value={v.name} />)}</datalist>
        </Field>
        {scenes.length > 0 && (
          <div className="wide">
            <div className="muted small" style={{ marginBottom: 4 }}>Scenes (calls the cast automatically)</div>
            <div className="chips">{scenes.map((s) => <button key={s.id} className="chip" aria-pressed={e.scenes.includes(s.id)} onClick={() => toggleScene(s.id)}>{s.number}{s.title ? ` ${s.title}` : ""}</button>)}</div>
          </div>
        )}
        <div className="wide">
          <div className="muted small" style={{ marginBottom: 4, display: "flex", gap: 8 }}>
            Who&apos;s called
            <button className="linklike small" onClick={() => set("called", people.map((p) => p.slug))}>everyone on {proj?.name}</button>
            <button className="linklike small" onClick={() => set("called", [])}>no one</button>
          </div>
          <div className="chips">
            {[...people, ...others.filter((p) => e.called.includes(p.slug))].map((p) => {
              const busy = hits.some((c) => c.person === p.slug) || conflictsForEvent(e, data.conflicts, [p.slug]).length > 0;
              return (
                <button key={p.slug} className={`chip${busy ? " busy" : ""}`} aria-pressed={e.called.includes(p.slug)} title={busy ? "Has a conflict at this time" : undefined} onClick={() => set("called", e.called.includes(p.slug) ? e.called.filter((x) => x !== p.slug) : [...e.called, p.slug])}>
                  {p.name}{busy ? " ⚠" : ""}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Notes" wide><textarea value={e.notes} onChange={(x) => set("notes", x.target.value)} /></Field>
      </div>
      {(hits.length > 0 || allWarnings.length > 0) && (
        <ul className="attn">
          {hits.map((c) => <li key={c.id}><span className="pill red">Conflict</span>{name(c.person)}: {c.start ? `${c.start}–${c.end || "end of day"}` : "all day"}{c.note ? ` (${c.note})` : ""}</li>)}
          {allWarnings.map((w, i) => <li key={i}><span className="pill amber">{w.kind === "hours" ? "Hours" : "Space"}</span>{w.message}</li>)}
        </ul>
      )}
      <div className="toolbar">
        {existing && <button className="btn danger" onClick={() => { void deleteEvent(e.id); onClose(); }}>Delete</button>}
        <span className="small muted">{eventHours(e) ? `${eventHours(e)} hours` : ""}</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
