import { useEffect, useRef, useState } from "react";
import { markdownToHtml } from "../lib/paperwork";
import { DOC_STATUSES, type DocStatus, type PaperDoc } from "../lib/types";
import { fmtDate } from "../lib/util";
import { DocModal, STATUS_PILL } from "../screens/Paperwork";
import { useApp } from "../store";
import { ProjectTag, printHtml } from "./bits";

export function DocDrawerBody({ doc }: { doc: PaperDoc }) {
  const { data, fs, money, saveDoc, deleteDoc, attachDocFile, createSchedulePayments, allPayments, openDrawer, setScreen, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const set = (patch: Partial<PaperDoc>) => void saveDoc({ ...doc, ...patch });

  const setStatus = (status: DocStatus) => {
    const today = new Date().toISOString().slice(0, 10);
    const patch: Partial<PaperDoc> = { status };
    if (status === "Sent" && !doc.sent) patch.sent = today;
    if (status === "Fully signed" && !doc.signed) patch.signed = today;
    set(patch);
  };

  const pending = doc.schedule.filter((s) => !s.payment_id && s.amount > 0).length;

  return (
    <>
      <div className="toolbar" style={{ margin: 0 }}>
        <span className={`pill ${STATUS_PILL[doc.status]}`}>{doc.status}</span>
        <select className="input" aria-label="Status" value={doc.status} onChange={(e) => setStatus(e.target.value as DocStatus)}>
          {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <dl className="kv">
        <dt>Type</dt><dd>{doc.type}</dd>
        <dt>Project</dt><dd>{doc.project ? <ProjectTag slug={doc.project} /> : "Company-wide"}</dd>
        <dt>Parties</dt>
        <dd className="chips" style={{ gap: 4 }}>
          {doc.people.map((s) => {
            const p = data.people.find((x) => x.slug === s);
            return <button key={s} className="btn ghost small" onClick={() => { setScreen("collaborators"); openDrawer({ kind: "person", slug: s }); }}>{p?.name ?? s}</button>;
          })}
          {doc.venues.map((s) => {
            const v = data.venues.find((x) => x.slug === s);
            return <button key={s} className="btn ghost small" onClick={() => { setScreen("venues"); openDrawer({ kind: "venue", slug: s }); }}>{v?.name ?? s}</button>;
          })}
          {!doc.people.length && !doc.venues.length && "—"}
        </dd>
        {doc.amount !== null && (<><dt>Amount</dt><dd className="num">{money(doc.amount)}</dd></>)}
        <dt>Sent</dt><dd>{doc.sent ? fmtDate(doc.sent, true) : "—"}</dd>
        <dt>Signed</dt><dd>{doc.signed ? fmtDate(doc.signed, true) : "—"}</dd>
        {doc.effective && (<><dt>Effective</dt><dd>{fmtDate(doc.effective, true)}</dd></>)}
        {doc.expires && (<><dt>Expires</dt><dd>{fmtDate(doc.expires, true)}</dd></>)}
        <dt>Folder</dt><dd className="small muted">{doc.path}</dd>
      </dl>

      {doc.schedule.length > 0 && (
        <div>
          <div className="section-title">
            <h3>Payment schedule</h3>
            {pending > 0 && <button className="btn small primary" onClick={() => void createSchedulePayments(doc.path)}>Add {pending} to Payments</button>}
          </div>
          <ul className="attn">
            {doc.schedule.map((s, i) => {
              const p = allPayments.find((x) => x.id === s.payment_id);
              return (
                <li key={i}>
                  <span className="num">{money(s.amount, { cents: true })}</span>
                  <span className="muted">{s.due ? `due ${fmtDate(s.due, true)}` : "no date"}</span>
                  {p ? (
                    <button className={`pill ${p.status === "paid" ? "green" : ""}`} style={{ border: 0, cursor: "pointer", marginLeft: "auto" }} onClick={() => { setScreen("payments"); openDrawer({ kind: "payment", id: p.id }); }}>
                      {p.status === "paid" ? `Paid ${fmtDate(p.paid_date)}` : "Scheduled"}
                    </button>
                  ) : s.payment_id ? <span className="muted small" style={{ marginLeft: "auto" }}>Payment removed</span> : <span className="muted small" style={{ marginLeft: "auto" }}>Not in Payments yet</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <div className="section-title"><h3>Files</h3></div>
        {doc.files.length ? (
          <ul className="attn">
            {doc.files.map((f) => (
              <li key={f.file}>
                <span className="pill">{f.label}</span>
                <span className="small">{f.file}</span>
                <span className="muted small">{fmtDate(f.added)}</span>
                {fs.openFile && <button className="btn small" onClick={() => void fs.openFile!(`${doc.path}/${f.file}`).catch((e) => toast(`Couldn't open: ${String(e)}`))}>Open</button>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No files yet. Each upload is kept as its own version.</p>
        )}
        <div className="toolbar" style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder={doc.files.length ? "signed" : "sent"} aria-label="Label for the new file" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn small" onClick={() => { void attachDocFile(doc.path, label.trim() || (doc.files.length ? "signed" : "sent")); setLabel(""); }}>Add file…</button>
        </div>
        {fs.kind !== "desktop" && <p className="small muted">Adding files works in the desktop app.</p>}
      </div>

      <DraftEditor doc={doc} />

      {doc.notes && <div><h3>Notes</h3><p style={{ whiteSpace: "pre-wrap" }}>{doc.notes}</p></div>}

      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing(true)}>Edit</button>
        <div className="spacer" />
        <button className="btn danger" onClick={() => { if (confirm(`Move "${doc.title}" and its files to the trash?`)) void deleteDoc(doc.path); }}>Delete</button>
      </div>
      {editing && <DocModal existing={doc} onClose={() => setEditing(false)} />}
    </>
  );
}

/** The contract draft (draft.md in the document's folder), edited in place with autosave. */
function DraftEditor({ doc }: { doc: PaperDoc }) {
  const { fs, toast } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const path = `${doc.path}/draft.md`;

  useEffect(() => {
    let live = true;
    void fs.read(path).then((t) => live && setText(t));
    return () => { live = false; };
  }, [fs, path]);

  if (text === null) return null;
  const change = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void fs.write(path, v), 500);
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const unfilled = [...new Set([...text.matchAll(/\[([^\]\n]{1,40})\]/g)].map((m) => m[1]))];
  return (
    <div>
      <div className="section-title">
        <h3>Draft</h3>
        <span className="muted small">{words} words</span>
        <button className="btn small" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Edit"}</button>
        <button className="btn small" onClick={() => printHtml(doc.title, markdownToHtml(text))}>Print / Save as PDF</button>
        <button className="btn small" onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Draft copied"))}>Copy</button>
      </div>
      {unfilled.length > 0 && <p className="note small">Still to fill in: {unfilled.map((u) => `[${u}]`).join(", ")}</p>}
      {open && <textarea className="draft-editor" aria-label="Draft text" value={text} onChange={(e) => change(e.target.value)} />}
      <p className="small muted">Signing happens outside the app, on paper or any e-sign service. Add the signed PDF as a file and set the status to Fully signed.</p>
    </div>
  );
}
