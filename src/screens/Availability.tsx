import { useMemo, useState } from "react";
import { Empty, Field, Initials, Modal, ProjectTag } from "../components/bits";
import { matchNames, mergeConflicts, parseAvailabilityCSV, type CellMeaning } from "../lib/availabilityImport";
import { bestDates, calledForScenes, conflictsFormText, dateRange, hoursTally, parseScenesPaste } from "../lib/schedule";
import type { Conflict, ScheduleEvent } from "../lib/types";
import { addDays, fmtDate, parseISO, round2, uid, weekStart } from "../lib/util";
import { useApp } from "../store";
import { PaymentModal } from "./Payments";
import { printText } from "./Schedule";

export function AvailabilityTab({ onSchedule }: { onSchedule: (e: Partial<ScheduleEvent>) => void }) {
  const { data, project, today, money, projectBySlug } = useApp();
  const [from, setFrom] = useState(weekStart(today));
  const [days, setDays] = useState(14);
  const [group, setGroup] = useState("all");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pay, setPay] = useState<{ person: string; hours: number } | null>(null);
  const p = projectBySlug(project);

  if (!project) return <Empty title="Pick a project"><p>Availability is per project. Choose one in the sidebar.</p></Empty>;

  const people = data.people.filter((x) => x.projects.includes(project));
  const scenes = data.scenes[project] ?? [];
  const dates = dateRange(from, days);
  const groupPeople = group === "all" ? people.map((x) => x.slug) : group.startsWith("scene:") ? calledForScenes([group.slice(6)], scenes, p?.cast ?? {}) : [];
  const best = bestDates(groupPeople, dates, start, end, data.conflicts).filter((d) => d.date >= today).slice(0, 5);
  const events = data.events.filter((e) => e.project === project);
  const tally = hoursTally(events, from, addDays(from, days - 1));

  return (
    <>
      <div className="toolbar">
        <button className="btn small" onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier">←</button>
        <button className="btn small" onClick={() => setFrom(weekStart(today))}>This week</button>
        <button className="btn small" onClick={() => setFrom(addDays(from, 7))} aria-label="Later">→</button>
        <select className="input" aria-label="How many days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={14}>2 weeks</option><option value={28}>4 weeks</option><option value={42}>6 weeks</option>
        </select>
        <div className="spacer" />
        <button className="btn small primary" onClick={() => setImporting(true)}>Import availability (CSV)</button>
        <button className="btn small" onClick={() => setAdding(true)}>+ Conflict</button>
        <button className="btn small" onClick={() => printText("Conflicts form", conflictsFormText(p?.name ?? "", from, addDays(from, days - 1)))}>Print conflicts form</button>
      </div>

      {people.length ? (
        <div className="grid-scroll card" style={{ padding: 0 }}>
          <table className="avail">
            <thead>
              <tr>
                <th className="who">Person</th>
                {dates.map((d) => <th key={d} className={d === today ? "today" : ""}>{parseISO(d).toLocaleDateString("en-US", { weekday: "narrow" })}<br />{parseISO(d).getDate()}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((x) => (
                <tr key={x.slug}>
                  <th className="who"><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Initials name={x.name} />{x.name}</span></th>
                  {dates.map((d) => {
                    const c = data.conflicts.filter((k) => k.person === x.slug && k.date === d);
                    const called = events.some((e) => e.date === d && e.called.includes(x.slug));
                    const label = c.map((k) => (k.start ? `${k.start}–${k.end}` : "All day") + (k.note ? ` (${k.note})` : "")).join("; ");
                    return (
                      <td key={d} className={`${c.length ? (c.some((k) => !k.start) ? "busy" : "partly") : ""}${called ? " called" : ""}`} title={[label && `Conflict: ${label}`, called && "Called"].filter(Boolean).join(" · ") || "Free"}>
                        {c.length ? (c.some((k) => !k.start) ? "✕" : "◐") : called ? "●" : ""}
                        <span className="sr-only">{label ? `Conflict ${label}` : "Free"}{called ? ", called" : ""}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ padding: "8px 12px" }}>✕ conflict all day · ◐ part of the day (hover for times) · ● called · blank = free</div>
        </div>
      ) : (
        <Empty title="No one on this project yet"><p>Add collaborators to {p?.name} on the Collaborators screen, or import a sheet and add the names it finds.</p></Empty>
      )}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <section className="card" aria-label="Best dates">
          <div className="card-head">
            <h2>Best dates</h2>
            <select className="input" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">Everyone on {p?.name}</option>
              {scenes.map((s) => <option key={s.id} value={`scene:${s.id}`}>Scene {s.number}{s.title ? ` ${s.title}` : ""}</option>)}
            </select>
            <input className="input" type="time" aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} />
            <input className="input" type="time" aria-label="To" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {groupPeople.length ? (
            <ul className="attn">
              {best.map((b) => (
                <li key={b.date}>
                  <span className={`pill ${b.busy.length ? "amber" : "green"}`}>{b.free.length}/{groupPeople.length} free</span>
                  <span>{parseISO(b.date).toLocaleDateString("en-US", { weekday: "short" })} {fmtDate(b.date)}</span>
                  {b.busy.length > 0 && <span className="small muted">Out: {b.busy.map((s) => data.people.find((x) => x.slug === s)?.name ?? s).join(", ")}</span>}
                  <button className="btn small" onClick={() => onSchedule({ date: b.date, start, end, called: b.free, project, scenes: group.startsWith("scene:") ? [group.slice(6)] : [] })}>Schedule…</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{group === "all" ? "No one on this project yet." : "Nobody is cast in that scene yet. Match characters to people on the Scenes tab."}</p>
          )}
        </section>

        <section className="card" aria-label="Hours tally">
          <div className="card-head"><h2>Hours called</h2><span className="muted small">{fmtDate(from)}–{fmtDate(addDays(from, days - 1))}</span></div>
          {Object.keys(tally).length ? (
            <table className="t">
              <tbody>
                {Object.entries(tally).sort((a, b) => b[1].hours - a[1].hours).map(([slug, t]) => {
                  const person = data.people.find((x) => x.slug === slug);
                  const rate = Number(person?.rate) || 0;
                  const owed = person?.rate_type === "hourly" ? round2(rate * t.hours) : person?.rate_type === "per show" ? 0 : 0;
                  return (
                    <tr key={slug}>
                      <td>{person?.name ?? slug}</td>
                      <td className="r num">{t.hours} h</td>
                      <td className="r num muted">{t.calls} calls</td>
                      <td className="r">{owed > 0 && <button className="btn small" onClick={() => setPay({ person: slug, hours: t.hours })}>Pay {money(owed)}…</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No one is called in these dates yet.</p>
          )}
        </section>
      </div>

      <ConflictList />
      {importing && <ImportAvailability onClose={() => setImporting(false)} />}
      {adding && <ConflictModal onClose={() => setAdding(false)} />}
      {pay && (() => {
        const person = data.people.find((x) => x.slug === pay.person)!;
        return <PaymentModal preset={{ payee: person.name, title: `${person.name}, ${pay.hours} hours (${fmtDate(from)}–${fmtDate(addDays(from, days - 1))})`, amount: round2(Number(person.rate) * pay.hours), category: "Artist fees", project_alloc: { [project]: 1 } }} onClose={() => setPay(null)} />;
      })()}
    </>
  );
}

function ConflictList() {
  const { data, project, saveConflicts, toast } = useApp();
  const people = data.people.filter((x) => x.projects.includes(project));
  const list = data.conflicts.filter((c) => people.some((x) => x.slug === c.person)).sort((a, b) => a.date.localeCompare(b.date));
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <details className="card" style={{ marginTop: 14 }} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><strong>All conflicts</strong> <span className="muted small">({list.length})</span></summary>
      <table className="t" style={{ marginTop: 8 }}>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{data.people.find((x) => x.slug === c.person)?.name ?? c.person}</td>
              <td className="num">{fmtDate(c.date, true)}</td>
              <td className="num muted">{c.start ? `${c.start}–${c.end}` : "All day"}</td>
              <td className="muted">{c.note}</td>
              <td className="r"><button className="icon-btn" aria-label="Delete conflict" onClick={() => { const next = data.conflicts.filter((x) => x.id !== c.id); void saveConflicts(next); toast("Conflict removed", () => void saveConflicts([...next, c])); }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ConflictModal({ onClose }: { onClose: () => void }) {
  const { data, project, today, saveConflicts } = useApp();
  const people = data.people.filter((x) => x.projects.includes(project));
  const [c, setC] = useState<Conflict>({ id: uid("c"), person: people[0]?.slug ?? "", date: today, start: "", end: "", note: "" });
  const [until, setUntil] = useState("");
  const save = async () => {
    const extra: Conflict[] = [];
    if (until && until > c.date) for (let d = addDays(c.date, 1); d <= until; d = addDays(d, 1)) extra.push({ ...c, id: uid("c"), date: d });
    await saveConflicts([...data.conflicts, c, ...extra]);
    onClose();
  };
  return (
    <Modal title="Add a conflict" onClose={onClose}>
      <div className="form-grid">
        <Field label="Person"><select value={c.person} onChange={(e) => setC({ ...c, person: e.target.value })}>{people.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} /></Field>
        <Field label="Through (optional)"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label="From (blank = all day)"><input type="time" value={c.start} onChange={(e) => setC({ ...c, start: e.target.value })} /></Field>
        <Field label="To"><input type="time" value={c.end} onChange={(e) => setC({ ...c, end: e.target.value })} /></Field>
        <Field label="Note"><input value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} placeholder="Class, other show…" /></Field>
      </div>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!c.person} onClick={save}>Save</button></div>
    </Modal>
  );
}

function ImportAvailability({ onClose }: { onClose: () => void }) {
  const { data, project, today, saveConflicts, savePerson, toast } = useApp();
  const [text, setText] = useState("");
  const [meaning, setMeaning] = useState<CellMeaning>("unavailable");
  const [addNew, setAddNew] = useState(true);
  const parsed = useMemo(() => (text.trim() ? parseAvailabilityCSV(text, meaning, today) : null), [text, meaning, today]);
  const match = useMemo(() => (parsed ? matchNames(parsed.names, data.people) : {}), [parsed, data.people]);
  const unmatched = Object.entries(match).filter(([, v]) => !v).map(([k]) => k);

  const run = async () => {
    if (!parsed) return;
    const m = { ...match };
    if (addNew) {
      for (const n of unmatched) {
        const slug = n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("person");
        await savePerson({ slug, name: n, roles: [], projects: project ? [project] : [], email: "", phone: "", city: "", rate: "", rate_type: "", status: "Reached out", pronouns: "", payment_method: "", w9_on_file: false, w9_date: "", notes: "Added from an availability import." });
        m[n] = slug;
      }
    }
    const before = data.conflicts;
    const { next, added, replaced } = mergeConflicts(before, parsed, m);
    await saveConflicts(next);
    toast(`Imported ${added.length} conflicts${replaced.length ? ` (replaced ${replaced.length} older ones on the same dates)` : ""}`, () => void saveConflicts(before));
    onClose();
  };

  return (
    <Modal title="Import availability" onClose={onClose}>
      <p className="muted">
        Use a spreadsheet with <strong>names down the side and dates across the top</strong> (like a Google Form or shared sheet), or one row per conflict with columns <code>name, date, start, end, note</code>. Export it as CSV, then choose the file or paste it below.
      </p>
      <input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea className="input" style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 12 }} aria-label="CSV text" placeholder={"Name,12/8,12/9,12/10\nAna Reyes,x,,after 6pm\nJun Park,,busy,2-5pm"} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="toolbar" style={{ margin: 0 }}>
        <span className="small">A marked cell (x, yes) means the person is</span>
        <div className="seg" role="group" aria-label="Marked cells mean">
          <button aria-pressed={meaning === "unavailable"} onClick={() => setMeaning("unavailable")}>unavailable</button>
          <button aria-pressed={meaning === "available"} onClick={() => setMeaning("available")}>available</button>
        </div>
      </div>
      <p className="small muted">Times in a cell are understood too: &quot;after 6pm&quot;, &quot;before 2&quot;, &quot;2–5pm&quot;. Words like &quot;busy&quot; or &quot;free&quot; mean what they say either way.</p>
      {parsed && (
        <div className="card" style={{ background: "var(--surface)" }}>
          <p><strong>{parsed.conflicts.length}</strong> conflicts for <strong>{parsed.names.length}</strong> people across <strong>{parsed.dates.length}</strong> dates{parsed.dates.length ? ` (${fmtDate(parsed.dates[0], true)} – ${fmtDate(parsed.dates[parsed.dates.length - 1], true)})` : ""}.</p>
          <div className="chips" style={{ margin: "6px 0" }}>
            {Object.entries(match).map(([n, slug]) => <span key={n} className={`pill ${slug ? "green" : "amber"}`}>{n}{slug && data.people.find((x) => x.slug === slug)?.name !== n ? ` → ${data.people.find((x) => x.slug === slug)?.name}` : ""}{slug ? "" : " (new)"}</span>)}
          </div>
          {unmatched.length > 0 && (
            <label className="small"><input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} /> Add {unmatched.length} new {unmatched.length === 1 ? "person" : "people"} to Collaborators{project ? " on this project" : ""} (otherwise their rows are skipped)</label>
          )}
          {parsed.warnings.map((w, i) => <p key={i} className="note small" style={{ marginTop: 6 }}>{w}</p>)}
          <p className="small muted" style={{ marginTop: 6 }}>Re-importing an updated sheet replaces each person&apos;s older conflicts on those dates, so nothing doubles up. You can undo right after.</p>
        </div>
      )}
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!parsed?.conflicts.length && !parsed?.names.length} onClick={run}>Import</button>
      </div>
    </Modal>
  );
}

export function ScenesTab() {
  const { data, project, projectBySlug, saveScenes, saveProject } = useApp();
  const [paste, setPaste] = useState("");
  const p = projectBySlug(project);
  if (!project || !p) return <Empty title="Pick a project"><p>Scenes belong to a project. Choose one in the sidebar.</p></Empty>;
  const scenes = data.scenes[project] ?? [];
  const characters = [...new Set(scenes.flatMap((s) => s.characters))];
  const cast = p.cast ?? {};
  const people = data.people.filter((x) => x.projects.includes(project));
  const castOf = (ch: string) => cast[ch] ?? Object.entries(cast).find(([k]) => k.toLowerCase() === ch.toLowerCase())?.[1] ?? "";

  return (
    <>
      <div className="grid-2">
        <section className="card" aria-label="Scene breakdown">
          <div className="card-head"><h2>Scene breakdown</h2><span className="muted small">{scenes.length} scenes · {characters.length} characters</span></div>
          {scenes.length ? (
            <div className="grid-scroll">
              <table className="avail">
                <thead><tr><th className="who">Scene</th>{characters.map((c) => <th key={c} className="vert"><span>{c}</span></th>)}<th /></tr></thead>
                <tbody>
                  {scenes.map((s) => (
                    <tr key={s.id}>
                      <th className="who">{s.number} <span className="muted small">{s.title}</span></th>
                      {characters.map((c) => (
                        <td key={c} className={s.characters.includes(c) ? "in" : ""}>
                          <button className="cellbtn" aria-label={`${c} in scene ${s.number}`} aria-pressed={s.characters.includes(c)} onClick={() => void saveScenes(project, scenes.map((x) => (x.id === s.id ? { ...x, characters: x.characters.includes(c) ? x.characters.filter((y) => y !== c) : [...x.characters, c] } : x)))}>
                            {s.characters.includes(c) ? "●" : ""}
                          </button>
                        </td>
                      ))}
                      <td><button className="icon-btn" aria-label={`Delete scene ${s.number}`} onClick={() => void saveScenes(project, scenes.filter((x) => x.id !== s.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No scenes yet. Paste them in on the right.</p>
          )}
        </section>

        <section className="card" aria-label="Add scenes">
          <div className="card-head"><h2>Paste scenes</h2></div>
          <p className="small muted">One scene per line: number, optional title, then the characters in it.</p>
          <textarea className="input" style={{ width: "100%", minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 12 }} aria-label="Scene list" placeholder={"1.1 The kitchen: ANA, BEN\n1.2: ANA, CLEO, BEN\n2.1 Rooftop: CLEO"} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn primary small" disabled={!paste.trim()} onClick={() => { void saveScenes(project, [...scenes, ...parseScenesPaste(paste)]); setPaste(""); }}>Add {parseScenesPaste(paste).length || ""} scenes</button>
            <span className="small muted">Reading from a Many Write play file comes later.</span>
          </div>
        </section>
      </div>

      {characters.length > 0 && (
        <section className="card" style={{ marginTop: 14 }} aria-label="Cast list">
          <div className="card-head"><h2>Cast list</h2><span className="muted small">Who plays each character, so choosing a scene calls the right people.</span></div>
          <div className="form-grid">
            {characters.map((ch) => (
              <Field key={ch} label={ch}>
                <select value={castOf(ch)} onChange={(e) => void saveProject({ ...p, cast: { ...Object.fromEntries(Object.entries(cast).filter(([k]) => k.toLowerCase() !== ch.toLowerCase())), ...(e.target.value ? { [ch]: e.target.value } : {}) } })}>
                  <option value="">Not cast</option>
                  {people.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {!people.length && <p className="small muted">Add people to this project first.</p>}
        </section>
      )}
      <p className="small muted" style={{ marginTop: 10 }}><ProjectTag slug={project} /> Saved as <code>schedule/{project}-scenes.csv</code>; the cast list lives in the project file.</p>
    </>
  );
}
