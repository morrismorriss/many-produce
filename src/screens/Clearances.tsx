import { useState } from "react";
import { Empty, Field, Modal, Plus, saveTextFile } from "../components/bits";
import { blankClearance, clearanceFeePayment, clearanceWarnings, cueSheetCSV, isSettled, sceneClearance } from "../lib/clearances";
import { anchorsFor } from "../lib/timeline";
import { CLEARANCE_STATUSES, CLEARANCE_TYPES, USES, type Clearance, type ClearanceStatus } from "../lib/types";
import { fmtDate } from "../lib/util";
import { useApp } from "../store";

const STATUS_PILL: Record<ClearanceStatus, string> = { Needed: "red", Requested: "blue", Negotiating: "amber", Cleared: "green", Denied: "red", Replaced: "", "Not needed": "" };
const WEEKS = 4;

export function ClearancesTab() {
  const { data, project, today, projectBySlug, saveProject, money } = useApp();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<"List" | "By scene">("List");
  const [editing, setEditing] = useState<Clearance | null>(null);
  const p = projectBySlug(project);
  if (!project || !p) return <Empty title="Pick a project"><p>Clearances belong to a project. Choose one in the sidebar.</p></Empty>;

  const items = data.clearances[project] ?? [];
  const list = items.filter((c) => (!status || c.status === status) && (!type || c.type === type));
  const opening = anchorsFor(p, data.events).opening;
  const uses = p.planned_uses ?? [];
  const warnings = clearanceWarnings(items, opening, "opening", WEEKS, uses, today);
  const sceneNumbers = [...new Set([...(data.strips[project] ?? []).map((s) => s.number), ...(data.scenes[project] ?? []).map((s) => s.number), ...items.flatMap((c) => c.scenes)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fees = items.filter((c) => c.fee && c.status !== "Replaced" && c.status !== "Not needed").reduce((s, c) => s + (c.fee ?? 0), 0);

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Clearances view">
          {(["List", "By scene"] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{CLEARANCE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{CLEARANCE_TYPES.map((s) => <option key={s}>{s}</option>)}</select>
        <span className="small muted">{items.filter(isSettled).length}/{items.length} settled{fees ? ` · ${money(fees)} in fees` : ""}</span>
        <div className="spacer" />
        <button className="btn small" disabled={!items.some((c) => c.type.startsWith("Music"))} onClick={() => saveTextFile(`${project}-music-cue-sheet.csv`, cueSheetCSV(p.name, items), "text/csv")}>Music cue sheet</button>
        <button className="btn small primary" onClick={() => setEditing(blankClearance(project))}><Plus /> Clearance</button>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: "10px 14px" }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <span className="small">Where {p.name} will be shown:</span>
          <div className="chips">
            {USES.map((u) => <button key={u} className="chip" aria-pressed={uses.includes(u)} onClick={() => void saveProject({ ...p, planned_uses: uses.includes(u) ? uses.filter((x) => x !== u) : [...uses, u] })}>{u}</button>)}
          </div>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>Cleared items whose scope doesn&apos;t cover these get flagged. Anything not cleared {WEEKS} weeks before opening{opening ? ` (${fmtDate(opening, true)})` : ""} gets flagged too.</p>
      </div>

      {warnings.length > 0 && <ul className="attn" style={{ marginBottom: 12 }}>{warnings.map((w, i) => <li key={i}><span className={`pill ${w.kind === "scope" ? "amber" : "red"}`}>{w.kind === "scope" ? "Scope" : w.kind === "denied" ? "Denied" : "Deadline"}</span>{w.message}<button className="btn small" style={{ marginLeft: "auto" }} onClick={() => setEditing(items.find((c) => c.id === w.id) ?? null)}>Open</button></li>)}</ul>}

      {view === "List" ? (
        list.length ? (
          <table className="t">
            <thead><tr><th>Item</th><th>Type</th><th>Scenes</th><th>Rights holder</th><th>Scope</th><th className="r">Fee</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                  <td>{c.item}{c.document && <div className="small muted">Signed: {data.docs.find((d) => d.path === c.document)?.title ?? c.document}</div>}</td>
                  <td className="muted small">{c.type}</td>
                  <td className="small">{c.scenes.join(", ") || "—"}</td>
                  <td className="small">{c.owner || "—"}</td>
                  <td className="small">{c.scope.join(", ") || "—"}</td>
                  <td className="r num">{c.fee ? money(c.fee) : "—"}</td>
                  <td><span className={`pill ${STATUS_PILL[c.status]}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title={items.length ? "Nothing matches" : "No clearances yet"}>
            <p>Music, footage, artwork and logos, locations, and anyone on camera. Breakdown elements on the Stripboard can be sent here with one click.</p>
          </Empty>
        )
      ) : (
        <div className="cards">
          {sceneClearance(items, sceneNumbers).map((s) => (
            <div key={s.scene} className="card">
              <div className="card-head"><h3>Scene {s.scene}</h3><div className="spacer" />{s.total === 0 ? <span className="pill">Nothing to clear</span> : s.open ? <span className="pill red">{s.open} open</span> : <span className="pill green">Fully cleared</span>}</div>
              <ul className="attn">{items.filter((c) => c.scenes.includes(s.scene)).map((c) => <li key={c.id} style={{ cursor: "pointer" }} onClick={() => setEditing(c)}><span className={`pill ${STATUS_PILL[c.status]}`}>{c.status}</span>{c.item}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>Release templates (talent, location, materials, music request) are in Outreach → Templates. Saved as <code>clearances/{project}.csv</code>.</p>
      {editing && <ClearanceModal item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClearanceModal({ item, onClose }: { item: Clearance; onClose: () => void }) {
  const { data, today, saveClearances, savePayment, allPayments, toast } = useApp();
  const list = data.clearances[item.project] ?? [];
  const exists = list.some((c) => c.id === item.id);
  const [c, setC] = useState(item);
  const set = <K extends keyof Clearance>(k: K, v: Clearance[K]) => setC((x) => ({ ...x, [k]: v }));
  const setStatus = (s: ClearanceStatus) => setC((x) => ({ ...x, status: s, requested: s === "Requested" && !x.requested ? today : x.requested, cleared: s === "Cleared" && !x.cleared ? today : x.cleared }));
  const save = async (next = c) => { await saveClearances(item.project, exists || list.some((x) => x.id === next.id) ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next]); };
  const music = c.type.startsWith("Music");
  const pay = allPayments.find((p) => p.id === c.payment_id);
  const docs = data.docs.filter((d) => !d.project || d.project === item.project);
  return (
    <Modal title={exists ? c.item || "Clearance" : "New clearance"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Item" wide><input autoFocus value={c.item} onChange={(e) => set("item", e.target.value)} placeholder='"Blue Hour" (jukebox song)' /></Field>
        <Field label="Type"><select value={c.type} onChange={(e) => set("type", e.target.value)}>{CLEARANCE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Status"><select value={c.status} onChange={(e) => setStatus(e.target.value as ClearanceStatus)}>{CLEARANCE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Scenes (comma separated)"><input value={c.scenes.join(", ")} onChange={(e) => set("scenes", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>
        <Field label="Rights holder"><input value={c.owner} onChange={(e) => set("owner", e.target.value)} /></Field>
        <Field label="Contact"><input value={c.contact} onChange={(e) => set("contact", e.target.value)} /></Field>
        <Field label="Territory"><input value={c.territory} onChange={(e) => set("territory", e.target.value)} /></Field>
        <Field label="Term"><input value={c.term} onChange={(e) => set("term", e.target.value)} placeholder="Perpetual, 5 years…" /></Field>
        <Field label="Fee"><input type="number" value={c.fee ?? ""} onChange={(e) => set("fee", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        <Field label="Requested"><input type="date" value={c.requested} onChange={(e) => set("requested", e.target.value)} /></Field>
        <Field label="Cleared"><input type="date" value={c.cleared} onChange={(e) => set("cleared", e.target.value)} /></Field>
        <div className="wide">
          <div className="muted small" style={{ marginBottom: 4 }}>Cleared for</div>
          <div className="chips">{USES.map((u) => <button key={u} className="chip" aria-pressed={c.scope.includes(u)} onClick={() => set("scope", c.scope.includes(u) ? c.scope.filter((x) => x !== u) : [...c.scope, u])}>{u}</button>)}</div>
        </div>
        <Field label="Signed release or licence (Paperwork)" wide>
          <select value={c.document} onChange={(e) => set("document", e.target.value)}><option value="">None yet</option>{docs.map((d) => <option key={d.path} value={d.path}>{d.title} ({d.status})</option>)}</select>
        </Field>
        {music && (
          <>
            <Field label="Composer"><input value={c.composer} onChange={(e) => set("composer", e.target.value)} /></Field>
            <Field label="Publisher"><input value={c.publisher} onChange={(e) => set("publisher", e.target.value)} /></Field>
            <Field label="Timing"><input value={c.timing} onChange={(e) => set("timing", e.target.value)} placeholder="0:48" /></Field>
            <Field label="Usage"><input list="mp-usage" value={c.usage} onChange={(e) => set("usage", e.target.value)} /><datalist id="mp-usage">{["Background instrumental", "Background vocal", "Visual instrumental", "Visual vocal", "Main title", "End title"].map((x) => <option key={x} value={x} />)}</datalist></Field>
          </>
        )}
        <Field label="Notes" wide><input value={c.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <div className="toolbar">
        {exists && <button className="btn danger" onClick={() => { void saveClearances(item.project, list.filter((x) => x.id !== c.id)); onClose(); }}>Delete</button>}
        {(c.fee ?? 0) > 0 && !pay && <button className="btn" onClick={async () => { const p = clearanceFeePayment(c, today); await savePayment(p); const next = { ...c, payment_id: p.id }; setC(next); await save(next); toast("Fee added to Payments"); }}>Add fee to Payments</button>}
        {pay && <span className={`pill ${pay.status === "paid" ? "green" : "blue"}`}>Fee {pay.status === "paid" ? "paid" : "scheduled"}</span>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!c.item.trim()} onClick={() => void save().then(onClose)}>Save</button>
      </div>
    </Modal>
  );
}
