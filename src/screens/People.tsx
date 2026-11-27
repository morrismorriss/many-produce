import { useEffect, useMemo, useState } from "react";
import type { Person, Venue, VenueStatus } from "../lib/types";
import { uniqueSlug } from "../lib/util";
import { useApp } from "../store";
import { Chips, Empty, Field, Initials, Modal, Plus, ProjectTag } from "../components/bits";
import { Header } from "../components/Shell";
import { CsvImportModal } from "../components/CsvImport";

const BASE_ROLES = ["Director", "Actor", "Stage manager", "Lighting", "Sound", "Costumes", "Fight choreo", "Photographer"];
const STATUS_PILL: Record<string, string> = { Confirmed: "green", "Offer out": "blue", "Reached out": "", "Past collaborator": "" };

export function Collaborators() {
  const { data, project, openDrawer, newItemSignal } = useApp();
  const [role, setRole] = useState("All");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (newItemSignal) setAdding(true); }, [newItemSignal]);
  const roles = ["All", ...new Set([...BASE_ROLES, ...data.people.flatMap((p) => p.roles)])];
  const list = useMemo(
    () => data.people.filter((p) => (!project || p.projects.includes(project)) && (role === "All" || p.roles.includes(role))).sort((a, b) => a.name.localeCompare(b.name)),
    [data.people, project, role],
  );
  return (
    <>
      <Header title="Collaborators" actions={<><button className="btn" onClick={() => setImporting(true)}>Import CSV</button><button className="btn primary" onClick={() => setAdding(true)}><Plus /> Person</button></>} />
      <div className="content">
        <div className="toolbar"><Chips label="Role" options={roles} value={role} onChange={setRole} /></div>
        {list.length ? (
          <div className="table-scroll"><table className="t">
            <thead><tr><th>Name</th><th>Does</th><th>Projects</th><th>Rate</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.slug} className="clickable" onClick={() => openDrawer({ kind: "person", slug: p.slug })}>
                  <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Initials name={p.name} />{p.name}{p.pronouns && <span className="muted small">{p.pronouns}</span>}</span></td>
                  <td>{p.roles.join(", ")}</td>
                  <td><span className="chips" style={{ gap: 4 }}>{p.projects.map((s) => <ProjectTag key={s} slug={s} />)}</span></td>
                  <td className="num">{p.rate ? `$${p.rate}${p.rate_type ? ` ${p.rate_type}` : ""}` : "—"}</td>
                  <td><span className={`pill ${STATUS_PILL[p.status] ?? ""}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <Empty title="No collaborators here yet"><p>Add the people you work with. They&apos;re shared across projects.</p></Empty>
        )}
      </div>
      {adding && <PersonModal onClose={() => setAdding(false)} />}
      {importing && <CsvImportModal kind="people" title="Import contacts" onClose={() => setImporting(false)} />}
    </>
  );
}

export function PersonModal({ onClose, existing }: { onClose: () => void; existing?: Person }) {
  const { data, project, savePerson, openDrawer } = useApp();
  const [p, setP] = useState<Person>(
    existing ?? { slug: "", name: "", roles: [], projects: project ? [project] : [], email: "", phone: "", city: "", rate: "", rate_type: "", status: "Reached out", pronouns: "", payment_method: "", w9_on_file: false, w9_date: "", notes: "" },
  );
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setP((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!p.name.trim()) return;
    const slug = existing?.slug ?? uniqueSlug(p.name, data.people.map((x) => x.slug));
    await savePerson({ ...p, slug, name: p.name.trim() });
    openDrawer({ kind: "person", slug });
    onClose();
  };
  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New collaborator"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name"><input autoFocus value={p.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Pronouns"><input value={p.pronouns} onChange={(e) => set("pronouns", e.target.value)} /></Field>
        <Field label="Roles (comma separated)" wide><input value={p.roles.join(", ")} onChange={(e) => set("roles", e.target.value.split(/,\s*/).filter(Boolean))} placeholder="Director, Actor" /></Field>
        <Field label="Email"><input type="email" value={p.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input value={p.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="City"><input value={p.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Status">
          <select value={p.status} onChange={(e) => set("status", e.target.value as Person["status"])}>
            {["Reached out", "Offer out", "Confirmed", "Past collaborator"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Rate"><input value={p.rate} onChange={(e) => set("rate", e.target.value)} /></Field>
        <Field label="Rate type">
          <select value={p.rate_type} onChange={(e) => set("rate_type", e.target.value as Person["rate_type"])}>
            <option value="">—</option>{["flat", "hourly", "per show", "stipend"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Payment method"><input value={p.payment_method} onChange={(e) => set("payment_method", e.target.value)} placeholder="Zelle, Venmo, check…" /></Field>
        <label className="field"><span>W-9 on file</span><input type="checkbox" checked={p.w9_on_file} onChange={(e) => setP((x) => ({ ...x, w9_on_file: e.target.checked, w9_date: e.target.checked ? x.w9_date || new Date().toISOString().slice(0, 10) : "" }))} style={{ width: 18 }} /></label>
        {p.w9_on_file && <Field label="W-9 received"><input type="date" value={p.w9_date} onChange={(e) => set("w9_date", e.target.value)} /></Field>}
        <div className="wide">
          <div className="muted small" style={{ marginBottom: 4 }}>Projects</div>
          <div className="chips">
            {data.projects.map((x) => (
              <button key={x.slug} className="chip" aria-pressed={p.projects.includes(x.slug)} onClick={() => set("projects", p.projects.includes(x.slug) ? p.projects.filter((s) => s !== x.slug) : [...p.projects, x.slug])}>{x.name}</button>
            ))}
          </div>
        </div>
        <Field label="Notes" wide><textarea value={p.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!p.name.trim()} onClick={submit}>Save</button></div>
    </Modal>
  );
}

const VSTATUS: VenueStatus[] = ["Contacted", "Toured", "Hold", "Booked", "Passed"];
const VPILL: Record<VenueStatus, string> = { Contacted: "", Toured: "blue", Hold: "amber", Booked: "green", Passed: "red" };

export function Venues() {
  const { data, project, openDrawer, newItemSignal } = useApp();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (newItemSignal) setAdding(true); }, [newItemSignal]);
  const list = data.venues.filter((v) => !project || v.projects.includes(project));
  return (
    <>
      <Header title="Venues" actions={<><button className="btn" onClick={() => setImporting(true)}>Import CSV</button><button className="btn primary" onClick={() => setAdding(true)}><Plus /> Venue</button></>} />
      <div className="content">
        <div className="chips" style={{ marginBottom: 14 }}>
          {VSTATUS.map((s) => <span key={s} className={`pill ${VPILL[s]}`}>{s} · {list.filter((v) => v.status === s).length}</span>)}
        </div>
        {list.length ? (
          <div className="cards">
            {list.map((v) => (
              <button key={v.slug} className="vcard" onClick={() => openDrawer({ kind: "venue", slug: v.slug })}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8 }}><h3>{v.name}</h3><span className={`pill ${VPILL[v.status]}`}>{v.status}</span></div>
                <div className="muted small">{[v.type, v.city, v.capacity ? `${v.capacity} seats` : ""].filter(Boolean).join(" · ")}</div>
                {v.rate && <div className="small">{v.rate}</div>}
                {v.tech_notes && <div className="small muted">{v.tech_notes}</div>}
                <div className="chips" style={{ gap: 4 }}>{v.projects.map((s) => <ProjectTag key={s} slug={s} />)}</div>
                {v.next_step && <div className="small"><strong>Next:</strong> {v.next_step}</div>}
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No venues yet"><p>Track spaces from first contact to booked.</p></Empty>
        )}
      </div>
      {adding && <VenueModal onClose={() => setAdding(false)} />}
      {importing && <CsvImportModal kind="venues" title="Import venues" onClose={() => setImporting(false)} />}
    </>
  );
}

export function VenueModal({ onClose, existing }: { onClose: () => void; existing?: Venue }) {
  const { data, project, saveVenue, openDrawer } = useApp();
  const [v, setV] = useState<Venue>(
    existing ?? { slug: "", name: "", type: "", city: "", capacity: null, rate: "", tech_notes: "", status: "Contacted", projects: project ? [project] : [], next_step: "", contact: "", hold_dates: "", notes: "" },
  );
  const set = <K extends keyof Venue>(k: K, val: Venue[K]) => setV((x) => ({ ...x, [k]: val }));
  const submit = async () => {
    if (!v.name.trim()) return;
    const slug = existing?.slug ?? uniqueSlug(v.name, data.venues.map((x) => x.slug));
    await saveVenue({ ...v, slug, name: v.name.trim() });
    openDrawer({ kind: "venue", slug });
    onClose();
  };
  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New venue"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" wide><input autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Type"><input list="mp-vtypes" value={v.type} onChange={(e) => set("type", e.target.value)} /><datalist id="mp-vtypes">{["black box", "bar", "brewery", "gallery", "event space", "community hall"].map((t) => <option key={t} value={t} />)}</datalist></Field>
        <Field label="City"><input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Capacity"><input type="number" value={v.capacity ?? ""} onChange={(e) => set("capacity", e.target.value ? Number(e.target.value) : null)} /></Field>
        <Field label="Rate"><input value={v.rate} onChange={(e) => set("rate", e.target.value)} /></Field>
        <Field label="Status"><select value={v.status} onChange={(e) => set("status", e.target.value as VenueStatus)}>{VSTATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Contact"><input value={v.contact} onChange={(e) => set("contact", e.target.value)} /></Field>
        <Field label="Hold dates"><input value={v.hold_dates} onChange={(e) => set("hold_dates", e.target.value)} /></Field>
        <Field label="Next step" wide><input value={v.next_step} onChange={(e) => set("next_step", e.target.value)} /></Field>
        <Field label="Tech notes" wide><input value={v.tech_notes} onChange={(e) => set("tech_notes", e.target.value)} /></Field>
        <div className="wide">
          <div className="muted small" style={{ marginBottom: 4 }}>Projects</div>
          <div className="chips">{data.projects.map((x) => <button key={x.slug} className="chip" aria-pressed={v.projects.includes(x.slug)} onClick={() => set("projects", v.projects.includes(x.slug) ? v.projects.filter((s) => s !== x.slug) : [...v.projects, x.slug])}>{x.name}</button>)}</div>
        </div>
        <Field label="Notes" wide><textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!v.name.trim()} onClick={submit}>Save</button></div>
    </Modal>
  );
}
