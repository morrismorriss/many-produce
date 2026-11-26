import { useMemo, useState } from "react";
import { Empty, Field, Modal, Plus, printHtml, saveTextFile } from "../components/bits";
import { blankClearance, clearanceTypeFor } from "../lib/clearances";
import {
  ELEMENT_LABEL, addDay, boardWarnings, castNumbers, dayMinutes, dayOutOfDays, dayPages, doodCSV, eighthsLabel, emptyElements, moveStrip,
  normalizeBoard, oneLineSchedule, parseFdx, parseScreenplayText, shootDayEvents, sortUnscheduled, stripboardHtml, stripsToCSV, type GroupBy,
} from "../lib/stripboard";
import { ELEMENT_KINDS, type Board, type ElementKind, type ShoppingItem, type StripScene } from "../lib/types";
import { blankBoard } from "../lib/stripboard";
import { fmtDate, uid } from "../lib/util";
import { useApp } from "../store";
import { printText } from "./Schedule";

type View = "Board" | "Breakdown" | "Day out of days";

export function StripboardTab() {
  const { data, project, projectBySlug } = useApp();
  const [view, setView] = useState<View>("Board");
  const [editing, setEditing] = useState<StripScene | null>(null);
  const [importing, setImporting] = useState(false);
  const p = projectBySlug(project);
  if (!project || !p) return <Empty title="Pick a project"><p>The stripboard belongs to a project.</p></Empty>;
  const strips = data.strips[project] ?? [];
  const board = normalizeBoard(data.boards[project] ?? blankBoard(), strips);

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Stripboard view">
          {(["Board", "Breakdown", "Day out of days"] as View[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <span className="small muted">{strips.length} scenes · {eighthsLabel(strips.reduce((s, x) => s + x.pages, 0))} pages · {board.days.length} shoot days</span>
        <div className="spacer" />
        <button className="btn small" onClick={() => setImporting(true)}>Import script</button>
        <button className="btn small primary" onClick={() => setEditing(blankStrip(strips))}><Plus /> Scene</button>
      </div>
      {!strips.length ? (
        <Empty title="No scenes yet">
          <p>Import a Final Draft (.fdx) file or a screenplay from Many Write (Fountain or plain text), and the breakdown starts filled in. Or add scenes by hand.</p>
        </Empty>
      ) : view === "Board" ? (
        <BoardView strips={strips} board={board} onOpen={setEditing} />
      ) : view === "Breakdown" ? (
        <BreakdownList strips={strips} onOpen={setEditing} />
      ) : (
        <Dood strips={strips} board={board} />
      )}
      {editing && <BreakdownModal strip={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportScript onClose={() => setImporting(false)} />}
    </>
  );
}

function blankStrip(strips: StripScene[]): StripScene {
  return { id: uid("st"), number: String(strips.length + 1), ie: "INT", location: "", venue: "", tod: "DAY", pages: 8, description: "", characters: [], elements: emptyElements(), notes: "" };
}

const stripClass = (s: StripScene) => `strip strip-${s.ie.startsWith("EXT") ? "ext" : "int"} strip-${s.tod === "NIGHT" ? "night" : s.tod === "DAY" ? "day" : "other"}`;

function BoardView({ strips, board, onOpen }: { strips: StripScene[]; board: Board; onOpen: (s: StripScene) => void }) {
  const { data, project, projectBySlug, saveBoard, saveEvent, today, toast } = useApp();
  const [groupBy, setGroupBy] = useState<GroupBy>("number");
  const [castFilter, setCastFilter] = useState("");
  const [dragging, setDragging] = useState("");
  const p = projectBySlug(project)!;
  const nums = castNumbers(strips);
  const save = (b: Board) => void saveBoard(project, b);
  const warnings = boardWarnings(board, strips, p.cast ?? {}, data.conflicts, (s) => data.people.find((x) => x.slug === s)?.name ?? s);
  const get = (id: string) => strips.find((s) => s.id === id);

  const drop = (toDay: string, before?: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    if (id) save(moveStrip(board, id, toDay, before));
    setDragging("");
  };

  const Strip = ({ id, day }: { id: string; day: string }) => {
    const s = get(id);
    if (!s) return null;
    return (
      <div
        className={stripClass(s)}
        draggable
        tabIndex={0}
        role="button"
        aria-label={`Scene ${s.number}, ${s.ie} ${s.location}, ${s.tod}, ${eighthsLabel(s.pages)} pages`}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", s.id); setDragging(s.id); }}
        onDragEnd={() => setDragging("")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop(day, s.id)}
        onClick={() => onOpen(s)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(s);
          // Keyboard: move to the next / previous day with ] and [.
          // Same order as on screen: the days, then "Not scheduled" at the bottom.
          const order = [...board.days.map((d) => d.id), ""];
          const i = order.indexOf(day);
          if (e.key === "]" && i < order.length - 1) save(moveStrip(board, s.id, order[i + 1]));
          if (e.key === "[" && i > 0) save(moveStrip(board, s.id, order[i - 1]));
        }}
      >
        <span className="sn">{s.number}</span>
        <span className="tag-ie">{s.ie}</span>
        <span className="loc">{s.location}</span>
        <span className="tag-ie">{s.tod}</span>
        <span className="pg">{eighthsLabel(s.pages)}</span>
        <span className="cast">{s.characters.map((c) => nums[c]).sort((a, b) => a - b).join(", ")}</span>
        <span className="desc">{s.description}</span>
      </div>
    );
  };

  const sendToSchedule = async () => {
    const { events, eventIds } = shootDayEvents(board, strips, project, p.cast ?? {});
    for (const e of events) await saveEvent(e);
    save({ ...board, event_ids: eventIds });
    toast(`${events.length} shoot day${events.length === 1 ? "" : "s"} on the Schedule (with call sheets)`);
  };

  return (
    <>
      <div className="toolbar">
        <label className="small">Group unscheduled by
          <select className="input" style={{ marginLeft: 6 }} value={groupBy} onChange={(e) => { const g = e.target.value as GroupBy; setGroupBy(g); if (g !== "cast") save(sortUnscheduled(board, strips, g)); }}>
            <option value="number">Scene number</option><option value="location">Location</option><option value="tod">Day / night</option><option value="ie">Int / ext</option><option value="cast">Cast member</option>
          </select>
        </label>
        {groupBy === "cast" && (
          <select className="input" aria-label="Cast member" value={castFilter} onChange={(e) => { setCastFilter(e.target.value); save(sortUnscheduled(board, strips, "cast", e.target.value)); }}>
            <option value="">Choose…</option>{Object.keys(nums).map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <label className="small">Page limit / day <input className="input" style={{ width: 60 }} type="number" value={board.page_limit / 8} onChange={(e) => save({ ...board, page_limit: Math.round((Number(e.target.value) || 0) * 8) })} /></label>
        <label className="small">Minutes / page <input className="input" style={{ width: 60 }} type="number" value={board.minutes_per_page} onChange={(e) => save({ ...board, minutes_per_page: Number(e.target.value) || 60 })} /></label>
        <div className="spacer" />
        <button className="btn small" onClick={() => save(addDay(board, ""))}>+ Shoot day</button>
        <button className="btn small" disabled={!board.days.some((d) => d.date)} onClick={() => void sendToSchedule()}>Send shoot days to Schedule</button>
        <button className="btn small" onClick={() => printHtml(`${p.name} stripboard`, stripboardHtml(`${p.name}: stripboard`, board, strips))}>Print stripboard</button>
        <button className="btn small" onClick={() => printText("One-line schedule", oneLineSchedule(`${p.name}: one-line schedule`, board, strips))}>One-line schedule</button>
      </div>
      {warnings.length > 0 && <ul className="attn" style={{ marginBottom: 10 }}>{warnings.map((w, i) => <li key={i}><span className="pill red">Warning</span>{w.message}</li>)}</ul>}
      <div className="small muted" style={{ marginBottom: 8 }}>
        Cast: {Object.entries(nums).map(([c, n]) => `${n}. ${c}${p.cast?.[c] ? ` (${data.people.find((x) => x.slug === p.cast![c])?.name ?? p.cast![c]})` : ""}`).join(" · ")}. Drag strips between days, or focus one and press [ or ].
      </div>
      <div className={`stripboard${dragging ? " dragging" : ""}`}>
        {board.days.map((d, i) => {
          const pages = dayPages(d, strips);
          const mins = dayMinutes(d, strips, board.minutes_per_page);
          return (
            <section key={d.id} className="shoot-day" onDragOver={(e) => e.preventDefault()} onDrop={drop(d.id)} aria-label={`Day ${i + 1}`}>
              <div className="day-break">
                <strong>Day {i + 1}</strong>
                <input className="cell-edit" type="date" aria-label="Date" value={d.date} onChange={(e) => save({ ...board, days: board.days.map((x) => (x.id === d.id ? { ...x, date: e.target.value } : x)) })} />
                <span className="small">call</span><input className="cell-edit" type="time" aria-label="Call" value={d.call} onChange={(e) => save({ ...board, days: board.days.map((x) => (x.id === d.id ? { ...x, call: e.target.value } : x)) })} />
                <span className="small">wrap</span><input className="cell-edit" type="time" aria-label="Wrap" value={d.wrap} onChange={(e) => save({ ...board, days: board.days.map((x) => (x.id === d.id ? { ...x, wrap: e.target.value } : x)) })} />
                <span className={`small ${board.page_limit && pages > board.page_limit ? "neg" : ""}`}>{eighthsLabel(pages)} pages · ~{Math.floor(mins / 60)}h{String(mins % 60).padStart(2, "0")}</span>
                <span className="spacer" />
                {d.date && d.date < today && <span className="small muted">done?</span>}
                <button className="icon-btn" aria-label={`Remove day ${i + 1}`} onClick={() => save({ ...board, days: board.days.filter((x) => x.id !== d.id), unscheduled: [...board.unscheduled, ...d.scenes] })}>×</button>
              </div>
              {d.scenes.map((id) => <Strip key={id} id={id} day={d.id} />)}
              {!d.scenes.length && <div className="drop-hint">Drag scenes here</div>}
            </section>
          );
        })}
        <section className="shoot-day unscheduled" onDragOver={(e) => e.preventDefault()} onDrop={drop("")} aria-label="Not scheduled">
          <div className="day-break"><strong>Not scheduled</strong><span className="small">{eighthsLabel(board.unscheduled.reduce((s, id) => s + (get(id)?.pages ?? 0), 0))} pages</span></div>
          {board.unscheduled.map((id) => <Strip key={id} id={id} day="" />)}
          {!board.unscheduled.length && <div className="drop-hint">Everything is scheduled.</div>}
        </section>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Strip colors: white INT/DAY · yellow EXT/DAY · lavender INT/NIGHT · blue EXT/NIGHT · peach dawn, dusk and other times. Every strip also shows the words. {board.days.some((d) => d.date) ? `First shoot day ${fmtDate(board.days.filter((d) => d.date).map((d) => d.date).sort()[0], true)}.` : ""}</p>
    </>
  );
}

function BreakdownList({ strips, onOpen }: { strips: StripScene[]; onOpen: (s: StripScene) => void }) {
  const { project, projectBySlug } = useApp();
  const p = projectBySlug(project)!;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheetsHtml = strips.map((s) => `<h2>Scene ${esc(s.number)}: ${esc(s.ie)}. ${esc(s.location)} – ${esc(s.tod)} (${eighthsLabel(s.pages)} pages)</h2><p>${esc(s.description)}</p><p><b>Cast:</b> ${esc(s.characters.join(", ") || "—")}</p>${ELEMENT_KINDS.filter((k) => s.elements[k].length).map((k) => `<p><b>${ELEMENT_LABEL[k]}:</b> ${esc(s.elements[k].join(", "))}</p>`).join("")}`).join('<hr style="margin:18px 0">');
  return (
    <>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn small" onClick={() => printHtml(`${p.name} breakdown`, `<h1>${esc(p.name)}: breakdown sheets</h1>${sheetsHtml}`)}>Print breakdown sheets</button>
        <button className="btn small" onClick={() => saveTextFile(`${project}-breakdown.csv`, stripsToCSV(strips), "text/csv")}>Breakdown CSV</button>
      </div>
      <table className="t">
        <thead><tr><th>Sc</th><th>Heading</th><th className="r">Pages</th><th>Cast</th><th>Elements</th></tr></thead>
        <tbody>
          {strips.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => onOpen(s)}>
              <td className="num">{s.number}</td>
              <td>{s.ie}. {s.location} – {s.tod}<div className="small muted">{s.description}</div></td>
              <td className="r num">{eighthsLabel(s.pages)}</td>
              <td className="small">{s.characters.join(", ")}</td>
              <td className="small muted">{ELEMENT_KINDS.filter((k) => s.elements[k].length).map((k) => `${ELEMENT_LABEL[k]} (${s.elements[k].length})`).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Dood({ strips, board }: { strips: StripScene[]; board: Board }) {
  const { data, project, projectBySlug } = useApp();
  const p = projectBySlug(project)!;
  const rows = useMemo(() => dayOutOfDays(board, strips), [board, strips]);
  if (!board.days.length) return <Empty title="No shoot days yet"><p>Add shoot days on the Board and drag scenes into them.</p></Empty>;
  return (
    <>
      <div className="toolbar">
        <span className="small muted">S = start · W = work · H = hold (paid, not working) · F = finish</span>
        <div className="spacer" />
        <button className="btn small" onClick={() => saveTextFile(`${project}-day-out-of-days.csv`, doodCSV(board, rows), "text/csv")}>CSV</button>
      </div>
      <div className="grid-scroll card" style={{ padding: 0 }}>
        <table className="avail">
          <thead><tr><th className="who">Cast</th>{board.days.map((d, i) => <th key={d.id}>Day {i + 1}<br />{d.date ? fmtDate(d.date) : ""}</th>)}<th>Work</th><th>Hold</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.character}>
                <th className="who">{r.number}. {r.character}{p.cast?.[r.character] ? <span className="muted small"> · {data.people.find((x) => x.slug === p.cast![r.character])?.name}</span> : ""}</th>
                {r.marks.map((m, i) => <td key={i} className={m === "H" ? "partly" : m ? "in" : ""}>{m}</td>)}
                <td className="num">{r.work}</td><td className="num">{r.hold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Work and hold days feed day-rate pay: schedule payments from each person&apos;s drawer.</p>
    </>
  );
}

function BreakdownModal({ strip, onClose }: { strip: StripScene; onClose: () => void }) {
  const { data, project, saveStrips, saveBoard, saveShoppingItem, saveClearances, saveInventoryItem, toast } = useApp();
  const strips = data.strips[project] ?? [];
  const exists = strips.some((s) => s.id === strip.id);
  const [s, setS] = useState(strip);
  const [text, setText] = useState<Record<string, string>>(() => ({ characters: strip.characters.join(", "), ...Object.fromEntries(ELEMENT_KINDS.map((k) => [k, strip.elements[k].join(", ")])) }));
  const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const current = (): StripScene => ({ ...s, characters: split(text.characters ?? "").map((c) => c.toUpperCase()), elements: Object.fromEntries(ELEMENT_KINDS.map((k) => [k, split(text[k] ?? "")])) as unknown as Record<ElementKind, string[]> });
  const save = async () => {
    const next = current();
    await saveStrips(project, exists ? strips.map((x) => (x.id === next.id ? next : x)) : [...strips, next]);
    onClose();
  };
  const toShopping = async (kind: ElementKind, item: string) => {
    const dept: Record<string, string> = { props: "Props", wardrobe: "Costumes", equipment: "Other", set_dressing: "Set", makeup: "Hair & makeup", vehicles: "Other" };
    const sh: ShoppingItem = { id: uid("sh"), project, item, where: "", link: "", department: dept[kind] ?? "Other", buyer: "", buyer_role: "unassigned", need_by: "", est_cost: null, actual_cost: null, money: "Producer card", status: "Needed", receipt: "", notes: `Scene ${s.number}`, payment_id: "", ledger_id: "", inventory_id: "" };
    await saveShoppingItem(sh);
    toast(`"${item}" added to the Shopping list`);
  };
  const toEquipment = async (item: string) => {
    await saveInventoryItem({ id: uid("it"), name: item, category: "Other", owner: "producer", project, serial: "", value: null, rental_house: "", rental_order: "", rental_cost: null, rental_start: "", rental_end: "", deposit: null, deposit_returned: false, returned: false, condition: "", notes: `Scene ${s.number}` });
    toast(`"${item}" added to the Equipment log`);
  };
  const toClearance = async (kind: string, item: string) => {
    const list = data.clearances[project] ?? [];
    await saveClearances(project, [...list, blankClearance(project, { item, type: clearanceTypeFor(kind), scenes: [s.number] })]);
    toast(`"${item}" added to Clearances`);
  };
  const remove = async () => {
    await saveStrips(project, strips.filter((x) => x.id !== s.id));
    const b = data.boards[project];
    if (b) await saveBoard(project, normalizeBoard(b, strips.filter((x) => x.id !== s.id)));
    onClose();
  };
  const actions: Partial<Record<ElementKind, "shop" | "clear" | "both">> = { props: "both", wardrobe: "shop", set_dressing: "both", equipment: "shop", vehicles: "shop", makeup: "shop", sound: "clear", extras: "clear" };

  return (
    <Modal title={exists ? `Scene ${strip.number}` : "New scene"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Scene number"><input autoFocus value={s.number} onChange={(e) => setS({ ...s, number: e.target.value })} /></Field>
        <Field label="INT / EXT"><select value={s.ie} onChange={(e) => setS({ ...s, ie: e.target.value })}><option>INT</option><option>EXT</option><option>INT/EXT</option></select></Field>
        <Field label="Day / night"><input list="mp-tod" value={s.tod} onChange={(e) => setS({ ...s, tod: e.target.value.toUpperCase() })} /><datalist id="mp-tod">{["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING"].map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Pages (in eighths)"><input type="number" value={s.pages} onChange={(e) => setS({ ...s, pages: Number(e.target.value) || 0 })} /></Field>
        <Field label="Location (as in the script)" wide><input value={s.location} onChange={(e) => setS({ ...s, location: e.target.value.toUpperCase() })} /></Field>
        <Field label="Real place (venue)"><select value={s.venue} onChange={(e) => setS({ ...s, venue: e.target.value })}><option value="">—</option>{data.venues.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}</select></Field>
        <Field label="Short description" wide><input value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
        <Field label="Cast (characters, comma separated)" wide><input value={text.characters} onChange={(e) => setText({ ...text, characters: e.target.value })} /></Field>
      </div>
      <p className="small muted">{eighthsLabel(s.pages)} pages. Characters link to people through the cast list on Schedule → Scenes.</p>
      <div className="form-grid">
        {ELEMENT_KINDS.map((k) => (
          <div key={k} className="field">
            <span>{ELEMENT_LABEL[k]}</span>
            <input aria-label={ELEMENT_LABEL[k]} value={text[k]} placeholder="comma separated" onChange={(e) => setText({ ...text, [k]: e.target.value })} />
            {actions[k] && split(text[k] ?? "").length > 0 && (
              <div className="chips" style={{ gap: 4, marginTop: 4 }}>
                {split(text[k] ?? "").map((item) => (
                  <span key={item} className="tag">
                    {item}
                    {(actions[k] === "shop" || actions[k] === "both") && <button className="linklike small" title="Add to the Shopping list" onClick={() => void toShopping(k, item)}>buy</button>}
                    {k === "equipment" && <button className="linklike small" title="Already have it: add to the Equipment log" onClick={() => void toEquipment(item)}>have</button>}
                    {(actions[k] === "clear" || actions[k] === "both") && <button className="linklike small" title="Add to Clearances" onClick={() => void toClearance(k, item)}>clear</button>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {s.location && <button className="btn small ghost" onClick={() => void toClearance("location", `${s.location} (location)`)}>Add a location release to Clearances</button>}
      <div className="toolbar">
        {exists && <button className="btn danger" onClick={() => void remove()}>Delete scene</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

function ImportScript({ onClose }: { onClose: () => void }) {
  const { data, project, saveStrips, saveBoard, saveProject, projectBySlug, toast } = useApp();
  const [parsed, setParsed] = useState<StripScene[] | null>(null);
  const [replace, setReplace] = useState(false);
  const [name, setName] = useState("");
  const read = async (f: File) => {
    const text = await f.text();
    setName(f.name);
    setParsed(f.name.toLowerCase().endsWith(".fdx") || text.trimStart().startsWith("<?xml") ? parseFdx(text) : parseScreenplayText(text));
  };
  const run = async () => {
    if (!parsed) return;
    const cur = data.strips[project] ?? [];
    const next = replace ? parsed : [...cur, ...parsed];
    await saveStrips(project, next);
    await saveBoard(project, normalizeBoard(replace ? blankBoard() : data.boards[project] ?? blankBoard(), next));
    // New characters go on the cast list, ready to match to people.
    const p = projectBySlug(project)!;
    const cast = { ...(p.cast ?? {}) };
    for (const c of new Set(parsed.flatMap((s) => s.characters))) if (!(c in cast)) cast[c] = "";
    await saveProject({ ...p, cast: Object.fromEntries(Object.entries(cast).filter(([, v]) => v !== undefined)) });
    toast(`Imported ${parsed.length} scenes from ${name}`);
    onClose();
  };
  const chars = parsed ? [...new Set(parsed.flatMap((s) => s.characters))] : [];
  return (
    <Modal title="Import a script" onClose={onClose}>
      <p className="muted">Final Draft (<code>.fdx</code>), Fountain (<code>.fountain</code>), or a Many Write screenplay exported as markdown or text. Scene headings (INT./EXT.) become scenes; character names become cast; page counts are estimated.</p>
      <input type="file" accept=".fdx,.fountain,.txt,.md,text/plain" aria-label="Choose a script" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
      {parsed && (
        <div className="card" style={{ background: "var(--surface)" }}>
          <p><strong>{parsed.length}</strong> scenes, <strong>{chars.length}</strong> characters, about <strong>{eighthsLabel(parsed.reduce((s, x) => s + x.pages, 0))}</strong> pages.</p>
          <p className="small muted">{chars.join(", ")}</p>
          {(data.strips[project] ?? []).length > 0 && <label className="small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current breakdown and board</label>}
        </div>
      )}
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!parsed?.length} onClick={() => void run()}>Import</button></div>
    </Modal>
  );
}

