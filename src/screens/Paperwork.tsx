import { strToU8, zipSync } from "fflate";
import { useEffect, useMemo, useState } from "react";
import { Chips, Empty, Field, Modal, Plus, ProjectTag, Tile, saveBinaryFile, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { ledgerToCSV } from "../lib/ledger";
import {
  TAX_TYPES,
  blankDoc,
  categoryTotalsCSV,
  draftValues,
  fillTemplate,
  list1099CSV,
  missingPaperwork,
  paidPeople,
  scheduleText,
  splitFee,
  totals1099,
  type Missing,
} from "../lib/paperwork";
import { DOC_STATUSES, DOC_TYPES, type DocStatus, type PaperDoc } from "../lib/types";
import { fmtDate, todayISO } from "../lib/util";
import { useApp } from "../store";

type Tab = "Documents" | "Missing" | "W-9s" | "1099s" | "My tax documents" | "Clearances";

export const STATUS_PILL: Record<DocStatus, string> = {
  Needed: "red", Drafted: "", Sent: "blue", "Signed by them": "amber", "Fully signed": "green", Expired: "red", Void: "",
};

export function docTypes(custom: string[]): string[] {
  return [...new Set([...DOC_TYPES, ...custom])];
}

export function Paperwork() {
  const { data, project, today, openDrawer, newItemSignal } = useApp();
  const [tab, setTab] = useState<Tab>("Documents");
  const [adding, setAdding] = useState<Partial<PaperDoc> | null>(null);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { if (newItemSignal) setAdding({}); }, [newItemSignal]);

  const missing = useMemo(() => missingPaperwork(data, project, today), [data, project, today]);

  return (
    <>
      <Header
        title="Paperwork"
        actions={
          <>
            <button className="btn" onClick={() => setDrafting(true)}>Draft from template</button>
            <button className="btn primary" onClick={() => setAdding({})}><Plus /> Document</button>
          </>
        }
      />
      <div className="content">
        <div className="toolbar">
          <Chips label="View" options={["Documents", "Missing", "W-9s", "1099s", "My tax documents", "Clearances"] as const} value={tab} onChange={setTab} />
          {missing.length > 0 && tab !== "Missing" && <button className="pill red" style={{ border: 0, cursor: "pointer" }} onClick={() => setTab("Missing")}>{missing.length} missing</button>}
        </div>
        {tab === "Documents" && <DocumentsTab onOpen={(path) => openDrawer({ kind: "doc", path })} />}
        {tab === "Missing" && <MissingTab missing={missing} onAdd={setAdding} />}
        {tab === "W-9s" && <W9Tab />}
        {tab === "1099s" && <Tab1099 />}
        {tab === "Clearances" && (
          <div className="placeholder card">
            <span className="pill amber">Build phase 9</span>
            <h2 style={{ marginTop: 10 }}>Clearances are coming in a later build</h2>
            <p className="muted">Every right and permission a project needs before it can be shown, recorded or sold: music (sync and master), footage, artwork and logos, locations, talent and minors, with scope, territory and term. Signed releases will link to documents here, and a per-scene view will show what&apos;s fully cleared.</p>
          </div>
        )}
        {tab === "My tax documents" && <TaxDocsTab onAdd={() => setAdding({ type: "Tax document received", project: "overhead" })} />}
      </div>
      {adding && <DocModal preset={adding} onClose={() => setAdding(null)} />}
      {drafting && <DraftModal onClose={() => setDrafting(false)} />}
    </>
  );
}

function DocumentsTab({ onOpen }: { onOpen: (path: string) => void }) {
  const { data, project } = useApp();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const list = data.docs
    .filter((d) => !project || d.project === project || !d.project)
    .filter((d) => !status || d.status === status)
    .filter((d) => !type || d.type === type)
    .filter((d) => !TAX_TYPES.includes(d.type) || type)
    .sort((a, b) => a.title.localeCompare(b.title));
  const parties = (d: PaperDoc) => [...d.people.map((s) => data.people.find((p) => p.slug === s)?.name ?? s), ...d.venues.map((s) => data.venues.find((v) => v.slug === s)?.name ?? s)].join(", ");
  return (
    <>
      <div className="toolbar">
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types (tax documents are in their own tabs)</option>
          {docTypes(data.settings.doc_types).map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {list.length ? (
        <table className="t">
          <thead><tr><th>Document</th><th>Type</th><th>Project</th><th>Parties</th><th>Status</th><th>Key date</th><th className="r">Files</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.path} className="clickable" onClick={() => onOpen(d.path)}>
                <td>{d.title}</td>
                <td className="muted">{d.type}</td>
                <td>{d.project ? <ProjectTag slug={d.project} /> : <span className="muted small">Company-wide</span>}</td>
                <td>{parties(d) || "—"}</td>
                <td><span className={`pill ${STATUS_PILL[d.status]}`}>{d.status}</span></td>
                <td className="num small">{keyDate(d)}</td>
                <td className="r num">{d.files.length || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="No documents here yet"><p>Contracts, releases, insurance certificates and permits, with what&apos;s missing up front.</p></Empty>
      )}
    </>
  );
}

function keyDate(d: PaperDoc): string {
  if (d.expires) return `${d.expires < todayISO() ? "Expired" : "Expires"} ${fmtDate(d.expires, true)}`;
  if (d.signed) return `Signed ${fmtDate(d.signed, true)}`;
  if (d.sent) return `Sent ${fmtDate(d.sent, true)}`;
  return "—";
}

const MISSING_LABEL: Record<Missing["kind"], string> = {
  agreement: "No agreement", w9: "No W-9", "venue-agreement": "No rental agreement", coi: "No COI", sponsorship: "No sponsorship agreement", expiring: "Expiring", expired: "Expired",
};

export function MissingList({ missing, onAdd, compact }: { missing: Missing[]; onAdd?: (p: Partial<PaperDoc>) => void; compact?: boolean }) {
  const { openDrawer, setScreen } = useApp();
  if (!missing.length) return <p className="muted">Nothing missing. 🎉</p>;
  return (
    <ul className="attn">
      {missing.map((m, i) => (
        <li key={i}>
          <span className={`pill ${m.kind === "expiring" ? "amber" : "red"}`}>{MISSING_LABEL[m.kind]}</span>
          <span>{m.message}</span>
          {!compact && m.project && <ProjectTag slug={m.project} />}
          {m.doc ? (
            <button className="btn small" onClick={() => { setScreen("paperwork"); openDrawer({ kind: "doc", path: m.doc! }); }}>Open</button>
          ) : m.kind === "w9" ? (
            <button className="btn small" onClick={() => { setScreen("collaborators"); openDrawer({ kind: "person", slug: m.person! }); }}>Open</button>
          ) : onAdd && m.preset ? (
            <button className="btn small" onClick={() => onAdd(m.preset!)}>Add</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MissingTab({ missing, onAdd }: { missing: Missing[]; onAdd: (p: Partial<PaperDoc>) => void }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Missing paperwork</h2></div>
      <MissingList missing={missing} onAdd={onAdd} />
      <p className="small muted" style={{ marginTop: 10 }}>
        Rules: a confirmed collaborator with no fully signed agreement · anyone paid with no W-9 · a booked venue with no signed rental agreement or no COI · a project with a fiscal sponsor but no sponsorship agreement · anything expiring within 30 days.
      </p>
    </section>
  );
}

const W9_REQUEST = "w9-request";

function W9Tab() {
  const { data, project, savePerson, money, toast } = useApp();
  const paid = paidPeople(data.people, data.ledger, project);
  const others = data.people.filter((p) => !paid.includes(p) && (!project || p.projects.includes(project)));
  const paidTotal = (name: string) => data.ledger.filter((e) => e.kind === "expense" && e.counterparty.trim().toLowerCase() === name.toLowerCase()).reduce((s, e) => s + e.amount, 0);
  const request = async (name: string) => {
    const t = data.templates.find((x) => x.slug === W9_REQUEST);
    const person = data.people.find((p) => p.name === name);
    const proj = data.projects.find((p) => p.slug === (project || person?.projects[0]));
    const text = fillTemplate(t?.body ?? "Hi [First name], could you send me a completed W-9? Thank you! [Producer]", draftValues({ producer: data.settings.producer_name, company: data.settings.company_name, today: todayISO(), person, project: proj }));
    try {
      await navigator.clipboard.writeText(text);
      toast(`W-9 request for ${name} copied. Paste it into an email.`);
    } catch {
      toast("Couldn't copy to the clipboard.");
    }
  };
  const row = (p: (typeof data.people)[number], isPaid: boolean) => (
    <tr key={p.slug}>
      <td>{p.name}</td>
      <td className="r num">{isPaid ? money(paidTotal(p.name)) : "—"}</td>
      <td>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={p.w9_on_file} onChange={(e) => void savePerson({ ...p, w9_on_file: e.target.checked, w9_date: e.target.checked ? p.w9_date || todayISO() : "" })} />
          {p.w9_on_file ? <span className="pill green">On file</span> : isPaid ? <span className="pill red">Missing</span> : <span className="pill">Not yet</span>}
        </label>
      </td>
      <td className="num small">{p.w9_on_file ? <input className="cell-edit" type="date" aria-label={`W-9 date for ${p.name}`} value={p.w9_date} onChange={(e) => void savePerson({ ...p, w9_date: e.target.value })} /> : ""}</td>
      <td className="r">{!p.w9_on_file && <button className="btn small" onClick={() => void request(p.name)}>Copy request</button>}</td>
    </tr>
  );
  return (
    <section className="card">
      <div className="card-head"><h2>W-9 tracker</h2></div>
      <p className="note info" style={{ marginBottom: 10 }}>
        W-9s contain taxpayer ID numbers. Many Produce only records whether a form is on file and when it arrived. It never reads or shows the numbers. Keep the forms themselves somewhere safe (an encrypted folder or disk image), and if your vault syncs through iCloud or Dropbox, remember that anything in it syncs too.
      </p>
      <table className="t">
        <thead><tr><th>Person</th><th className="r">Paid to date</th><th>W-9</th><th>Received</th><th /></tr></thead>
        <tbody>
          {paid.length > 0 && <tr className="group-head"><td colSpan={5}>Paid · {paid.length}</td></tr>}
          {paid.map((p) => row(p, true))}
          {others.length > 0 && <tr className="group-head"><td colSpan={5}>Not paid yet · {others.length}</td></tr>}
          {others.map((p) => row(p, false))}
        </tbody>
      </table>
    </section>
  );
}

function Tab1099() {
  const { data, money, saveIssued1099, saveSettings, openDrawer, setScreen } = useApp();
  const years = [...new Set([todayISO().slice(0, 4), ...data.ledger.map((e) => e.date.slice(0, 4))])].sort().reverse();
  const [year, setYear] = useState(String(Number(todayISO().slice(0, 4)) - (todayISO().slice(5, 7) <= "03" ? 1 : 0)));
  const issued = data.issued1099[year] ?? [];
  const rows = totals1099(data.ledger, data.people, data.venues, year, data.settings.threshold_1099, issued);
  const setIssued = (payee: string, date: string) => {
    const others = issued.filter((i) => i.payee.toLowerCase() !== payee.toLowerCase());
    void saveIssued1099(year, date ? [...others, { payee, issued_date: date, notes: "" }] : others);
  };
  return (
    <>
      <div className="tiles">
        <Tile label={`Paid to people and businesses in ${year}`} value={money(rows.reduce((s, r) => s + r.total, 0))} sub={`${rows.length} payees`} />
        <Tile label="Likely need a 1099" value={rows.filter((r) => r.needed).length} sub={`At or over ${money(data.settings.threshold_1099)}`} />
        <Tile label="Issued" value={rows.filter((r) => r.needed && r.issued).length} />
        <Tile label="Missing W-9 (over threshold)" value={rows.filter((r) => r.needed && r.w9 === false).length} alert={rows.some((r) => r.needed && r.w9 === false)} />
      </div>
      <section className="card">
        <div className="card-head">
          <h2>1099 tracker</h2>
          <select className="input" aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
            {[...new Set([year, ...years])].sort().reverse().map((y) => <option key={y}>{y}</option>)}
          </select>
          <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            Reporting threshold
            <input className="input" style={{ width: 100 }} type="number" value={data.settings.threshold_1099} onChange={(e) => void saveSettings({ ...data.settings, threshold_1099: Number(e.target.value) || 0 })} />
          </label>
          <div className="spacer" />
          <button className="btn small" onClick={() => saveTextFile(`1099-list-${year}.csv`, list1099CSV(rows), "text/csv")}>Export CSV</button>
          <YearEndButton year={year} />
        </div>
        {rows.length ? (
          <table className="t">
            <thead><tr><th>Payee</th><th className="r">Total paid</th><th>W-9 on file</th><th>1099 needed</th><th>1099 issued</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.payee}>
                  <td>{r.person ? <button className="linklike" onClick={() => { setScreen("collaborators"); openDrawer({ kind: "person", slug: r.person!.slug }); }}>{r.payee}</button> : r.payee}</td>
                  <td className="r num">{money(r.total, { cents: true })}</td>
                  <td>{r.w9 === null ? <span className="muted small">Not a collaborator</span> : r.w9 ? <span className="pill green">Yes</span> : <span className="pill red">No</span>}</td>
                  <td>{r.needed ? <span className="pill amber">Likely</span> : <span className="muted small">Under threshold</span>}</td>
                  <td><input className="cell-edit" type="date" aria-label={`1099 issued to ${r.payee}`} value={r.issued?.issued_date ?? ""} onChange={(e) => setIssued(r.payee, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No payments to people or businesses in {year}.</p>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Not tax advice. Totals come from Bookkeeping expenses by payee (sponsor fees are left out). Whether someone needs a 1099 depends on what you paid them for, how you paid (card and payment-app payments are often reported by the processor instead), and the current IRS threshold, which you can change above. Export the list for whatever filing service you use.
        </p>
      </section>
    </>
  );
}

function TaxDocsTab({ onAdd }: { onAdd: () => void }) {
  const { data, openDrawer } = useApp();
  const list = data.docs.filter((d) => TAX_TYPES.includes(d.type) && d.type !== "W-9").sort((a, b) => b.path.localeCompare(a.path));
  return (
    <section className="card">
      <div className="card-head">
        <h2>My tax documents</h2>
        <div className="spacer" />
        <button className="btn small" onClick={onAdd}><Plus /> Tax document</button>
        <YearEndButton year={String(Number(todayISO().slice(0, 4)) - (todayISO().slice(5, 7) <= "03" ? 1 : 0))} />
      </div>
      <p className="small muted">1099s you received, sponsor and grant letters, and anything else your accountant will want. Saved by year in <code>paperwork/tax/</code>.</p>
      {list.length ? (
        <table className="t">
          <tbody>
            {list.map((d) => (
              <tr key={d.path} className="clickable" onClick={() => openDrawer({ kind: "doc", path: d.path })}>
                <td>{d.title}</td><td className="muted">{d.type}</td><td className="muted small">{d.path.split("/")[2]}</td><td className="r num">{d.files.length} files</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Nothing yet.</p>
      )}
    </section>
  );
}

/** Zips the year's ledger, category totals, 1099 list, receipts and tax documents. */
function YearEndButton({ year }: { year: string }) {
  const { data, fs, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    try {
      const entries = data.ledger.filter((e) => e.date.startsWith(year));
      const files: Record<string, Uint8Array> = {
        [`ledger-${year}.csv`]: strToU8(ledgerToCSV(entries)),
        [`category-totals-${year}.csv`]: strToU8(categoryTotalsCSV(data.ledger, year)),
        [`1099-list-${year}.csv`]: strToU8(list1099CSV(totals1099(data.ledger, data.people, data.venues, year, data.settings.threshold_1099, data.issued1099[year]))),
      };
      let missingFiles = 0;
      const addFile = async (vaultPath: string, zipPath: string) => {
        const b64 = fs.readBase64 ? await fs.readBase64(vaultPath) : await fs.read(vaultPath).then((t) => (t === null ? null : btoa(unescape(encodeURIComponent(t)))));
        if (b64 === null) { missingFiles++; return; }
        files[zipPath] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      };
      for (const e of entries) if (e.receipt) await addFile(e.receipt, `receipts/${e.receipt.split("/").pop()}`);
      // Tax documents received this year. W-9s stay out: they hold other people's taxpayer IDs.
      for (const d of data.docs.filter((x) => x.path.startsWith(`paperwork/tax/${year}/`) && x.type !== "W-9")) {
        for (const f of d.files) await addFile(`${d.path}/${f.file}`, `tax-documents/${d.path.split("/").pop()}/${f.file}`);
      }
      files["README.txt"] = strToU8(
        `Year-end packet for ${year}, from Many Produce.\n\n` +
          `ledger-${year}.csv: every income and expense entry.\ncategory-totals-${year}.csv: totals by category.\n1099-list-${year}.csv: totals paid per payee, W-9 status and 1099s issued.\nreceipts/: receipts attached to this year's entries.\ntax-documents/: documents received for this year.\n\n` +
          `W-9 forms are not included. This is a record, not tax advice.\n`,
      );
      await saveBinaryFile(`many-produce-${year}-year-end.zip`, zipSync(files));
      toast(missingFiles ? `Year-end packet saved. ${missingFiles} attached file(s) couldn't be found.` : "Year-end packet saved");
    } catch (e) {
      toast(`Couldn't build the packet: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return <button className="btn small primary" disabled={busy} onClick={build}>{busy ? "Building…" : `Year-end packet (${year})`}</button>;
}

// ---- add / edit document ----

export function DocModal({ preset, existing, onClose }: { preset?: Partial<PaperDoc>; existing?: PaperDoc; onClose: () => void }) {
  const { data, project, saveDoc, openDrawer, setScreen } = useApp();
  const [d, setD] = useState<PaperDoc>(existing ?? blankDoc({ project: project || "", ...preset }));
  const set = <K extends keyof PaperDoc>(k: K, v: PaperDoc[K]) => setD((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!d.title.trim()) return;
    const saved = await saveDoc({ ...d, title: d.title.trim() });
    setScreen("paperwork");
    openDrawer({ kind: "doc", path: saved.path });
    onClose();
  };
  return (
    <Modal title={existing ? `Edit ${existing.title}` : "New document"} onClose={onClose}>
      <DocFields d={d} set={set} />
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!d.title.trim()} onClick={submit}>Save</button>
      </div>
      {!existing && <p className="small muted">You can add files (each version kept, e.g. &quot;v1 sent&quot;, &quot;v2 signed&quot;) once it&apos;s saved.</p>}
      <datalist id="mp-doc-types">{docTypes(data.settings.doc_types).map((t) => <option key={t} value={t} />)}</datalist>
    </Modal>
  );
}

export function DocFields({ d, set }: { d: PaperDoc; set: <K extends keyof PaperDoc>(k: K, v: PaperDoc[K]) => void }) {
  const { data } = useApp();
  return (
    <div className="form-grid">
      <Field label="Title" wide><input autoFocus value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Ana Reyes director agreement" /></Field>
      <Field label="Type">
        <select value={d.type} onChange={(e) => set("type", e.target.value)}>
          {docTypes(data.settings.doc_types).map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Project">
        <select value={d.project} onChange={(e) => set("project", e.target.value)}>
          <option value="">Company-wide</option>
          {data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select value={d.status} onChange={(e) => set("status", e.target.value as DocStatus)}>
          {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Amount">
        <input type="number" value={d.amount ?? ""} onChange={(e) => set("amount", e.target.value === "" ? null : Number(e.target.value))} />
      </Field>
      <Field label="Sent"><input type="date" value={d.sent} onChange={(e) => set("sent", e.target.value)} /></Field>
      <Field label="Signed"><input type="date" value={d.signed} onChange={(e) => set("signed", e.target.value)} /></Field>
      <Field label="Effective"><input type="date" value={d.effective} onChange={(e) => set("effective", e.target.value)} /></Field>
      <Field label="Expires"><input type="date" value={d.expires} onChange={(e) => set("expires", e.target.value)} /></Field>
      <div className="wide">
        <div className="muted small" style={{ marginBottom: 4 }}>People</div>
        <div className="chips">
          {data.people.map((p) => <button key={p.slug} className="chip" aria-pressed={d.people.includes(p.slug)} onClick={() => set("people", d.people.includes(p.slug) ? d.people.filter((x) => x !== p.slug) : [...d.people, p.slug])}>{p.name}</button>)}
        </div>
      </div>
      <div className="wide">
        <div className="muted small" style={{ marginBottom: 4 }}>Venues</div>
        <div className="chips">
          {data.venues.map((v) => <button key={v.slug} className="chip" aria-pressed={d.venues.includes(v.slug)} onClick={() => set("venues", d.venues.includes(v.slug) ? d.venues.filter((x) => x !== v.slug) : [...d.venues, v.slug])}>{v.name}</button>)}
        </div>
      </div>
      <Field label="Notes" wide><textarea value={d.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
    </div>
  );
}

// ---- draft from template ----

export function DraftModal({ onClose, preset }: { onClose: () => void; preset?: { person?: string; venue?: string } }) {
  const { data, project, today, money, saveDoc, fs, openDrawer, setScreen, createSchedulePayments, toast } = useApp();
  const agreements = data.templates.filter((t) => t.doc_type);
  const [tpl, setTpl] = useState(agreements.find((t) => (preset?.venue ? t.doc_type === "Venue rental agreement" : t.slug === "artist-agreement"))?.slug ?? agreements[0]?.slug ?? "");
  const t = data.templates.find((x) => x.slug === tpl);
  const forVenue = t?.doc_type === "Venue rental agreement";
  const [proj, setProj] = useState(project || data.projects.find((p) => !p.builtin)?.slug || "");
  const [person, setPerson] = useState(preset?.person ?? "");
  const [venue, setVenue] = useState(preset?.venue ?? "");
  const pObj = data.people.find((p) => p.slug === person);
  const vObj = data.venues.find((v) => v.slug === venue);
  const [role, setRole] = useState(pObj?.roles[0] ?? "");
  const [fee, setFee] = useState(pObj?.rate && pObj.rate_type === "flat" ? pObj.rate : "");
  const [count, setCount] = useState(1);
  const [firstDue, setFirstDue] = useState(today);
  const [every, setEvery] = useState(14);
  const [makePayments, setMakePayments] = useState(true);
  useEffect(() => { if (pObj) { setRole(pObj.roles[0] ?? ""); if (pObj.rate && pObj.rate_type === "flat") setFee(pObj.rate); } }, [person]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = Number(fee) || 0;
  const schedule = total > 0 ? splitFee(total, count, firstDue, every) : [];
  const projObj = data.projects.find((p) => p.slug === proj);
  const values = draftValues({
    producer: data.settings.producer_name, company: data.settings.company_name, today, project: projObj,
    person: forVenue ? undefined : pObj, venue: vObj, role, fee: total ? money(total) : "", schedule: scheduleText(schedule, (n) => money(n, { cents: true })),
  });
  const text = t ? fillTemplate(t.body, values) : "";
  const party = forVenue ? vObj?.name : pObj?.name;
  const valid = t && proj && party;

  const create = async () => {
    if (!valid || !t) return;
    const title = forVenue ? `${vObj!.name} rental agreement` : `${pObj!.name} ${role ? role.toLowerCase() + " " : ""}agreement`;
    const doc = await saveDoc(blankDoc({
      title, type: t.doc_type, project: proj, people: forVenue ? [] : [person], venues: forVenue ? [venue] : venue ? [venue] : [],
      status: "Drafted", amount: total || null, schedule, template: t.slug,
    }));
    await fs.write(`${doc.path}/draft.md`, text);
    if (makePayments && schedule.length) await createSchedulePayments(doc.path);
    if (!data.settings.producer_name) toast("Tip: add your name and company in Settings so drafts fill [Producer] and [Company].");
    setScreen("paperwork");
    openDrawer({ kind: "doc", path: doc.path });
    onClose();
  };

  return (
    <Modal title="Draft from template" onClose={onClose}>
      <div className="form-grid">
        <Field label="Template">
          <select value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {agreements.map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select value={proj} onChange={(e) => setProj(e.target.value)}>
            {data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </Field>
        {forVenue ? (
          <Field label="Venue">
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">Choose…</option>
              {data.venues.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Person">
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Choose…</option>
                {data.people.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
          </>
        )}
        <Field label="Total fee"><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="Installments"><input type="number" min={1} max={12} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></Field>
        <Field label="First due"><input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        {count > 1 && <Field label="Then every (days)"><input type="number" min={1} value={every} onChange={(e) => setEvery(Number(e.target.value) || 1)} /></Field>}
      </div>
      {schedule.length > 0 && (
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={makePayments} onChange={(e) => setMakePayments(e.target.checked)} />
          Also add {schedule.length > 1 ? `these ${schedule.length} installments` : "this payment"} to Payments
        </label>
      )}
      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>Preview (fields still in [brackets] can be filled in after)</div>
        <pre className="draft-preview">{text}</pre>
      </div>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={create}>Create draft</button>
      </div>
    </Modal>
  );
}
