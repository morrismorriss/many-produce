// One import dialog for every list: choose or paste a CSV, check how its
// columns were matched, preview what will happen, import, undo.
import { useMemo, useState } from "react";
import { IMPORT_FIELDS, KIND_LABEL, PER_PROJECT, buildImport, guessColumns, missingFields, previewOf, readSheet, templateCSV, type ColumnMap, type ImportKind } from "../lib/csvImport";
import { SHOP_DEPARTMENTS, SHOP_MONEY } from "../lib/types";
import { useApp } from "../store";
import { Field, Modal, saveTextFile } from "./bits";

const INTRO: Record<ImportKind, string> = {
  people: "Bring in a contact list from Google Contacts, Outlook, your phone, a spreadsheet or a crew list. People already here (same name or email) are skipped, or filled in if you tick the box.",
  venues: "Bring in a list of spaces from a spreadsheet. Venues already here (same name) are skipped, or filled in if you tick the box.",
  budget: "Bring in a budget from a spreadsheet or Many Apply's budget builder. Totals rows are left out. A line with the same category and name as one already in the budget is skipped, or updated if you tick the box.",
  payments: "Bring in a payment schedule: who gets paid, how much and when. Rows marked paid (or with a paid date) are imported as paid. Payments already here (same payee, amount and due date) are skipped.",
  events: "Bring in a rehearsal or production calendar. Times can be in one column (\"6–9:30pm\") or two. Names in the Called column are matched to collaborators, and locations to venues.",
  shopping: "Bring in a shopping or supplies list. Items already on this project's list (same name) are skipped, or updated if you tick the box. Items marked as bought come in as \"Got it\" without a Bookkeeping entry.",
  inventory: "Bring in a gear list, a rental order or a props and costumes inventory. Items already in the log (same name and serial) are skipped, or updated if you tick the box.",
};

export function CsvImportModal({ kind, title, onClose }: { kind: ImportKind; title: string; onClose: () => void }) {
  const { data, project, today, money, applyImport, toast, setScreen } = useApp();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [proj, setProj] = useState(project || (PER_PROJECT[kind] ? data.projects.find((p) => !p.builtin)?.slug ?? "overhead" : ""));
  const [update, setUpdate] = useState(false);
  const [replace, setReplace] = useState(false);
  const [addPaidToLedger, setAddPaidToLedger] = useState(true);
  const [addPeople, setAddPeople] = useState(true);
  const [busy, setBusy] = useState(false);

  const sheet = useMemo(() => readSheet(text), [text]);
  const m = map ?? guessColumns(sheet.headers, kind);
  const missing = sheet.headers.length ? missingFields(kind, m) : [];
  const sources = data.settings.money_sources;
  const plan = useMemo(
    () => (sheet.rows.length && !missing.length
      ? buildImport(kind, sheet, m, data, { project: proj, update, replace, addPaidToLedger, addPeople, today }, { departments: SHOP_DEPARTMENTS, moneyOptions: [...SHOP_MONEY, ...sources.filter((s) => s.sponsor).map((s) => s.name)] })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, JSON.stringify(m), data, proj, update, replace, addPaidToLedger, addPeople, today, kind],
  );

  const label = KIND_LABEL[kind];
  const count = (n: number, one = label.one, many = label.many) => `${n} ${n === 1 ? one : many}`;
  const names = {
    person: (slug: string) => data.people.find((p) => p.slug === slug)?.name ?? plan?.newPeople.find((p) => p.slug === slug)?.name ?? slug,
    venue: (slug: string) => data.venues.find((v) => v.slug === slug)?.name ?? slug,
    project: (slug: string) => data.projects.find((p) => p.slug === slug)?.name ?? slug,
  };
  const preview = plan ? [...plan.add, ...plan.update.map((u) => u.after)].slice(0, 8) : [];
  const heads = preview.length ? previewOf(kind, preview[0], names, money).heads : [];
  const total = plan ? plan.add.length + plan.update.length + plan.newPeople.length : 0;

  const load = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    setFileName(f.name);
    setMap(null);
  };

  const run = async () => {
    if (!plan || !total) return;
    setBusy(true);
    const undo = await applyImport(kind, plan);
    const bits = [
      plan.add.length ? `added ${count(plan.add.length)}` : "",
      plan.update.length ? `updated ${plan.update.length}` : "",
      plan.newPeople.length ? `added ${count(plan.newPeople.length, "new collaborator", "new collaborators")}` : "",
      plan.entries.length ? `${count(plan.entries.length, "expense", "expenses")} in Bookkeeping` : "",
      plan.duplicates ? `skipped ${plan.duplicates} already here` : "",
    ].filter(Boolean);
    toast(`Imported: ${bits.join(", ")}`, () => void undo());
    setBusy(false);
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose} wide={sheet.headers.length > 0}>
      <p className="muted small">{INTRO[kind]} Save the sheet as CSV (in Excel, Numbers or Google Sheets: File › Download or Export › CSV), then choose it or paste it below. You can undo right after.</p>
      <div className="toolbar" style={{ margin: 0 }}>
        <label className="btn small" style={{ cursor: "pointer" }}>
          Choose CSV file
          <input type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: "none" }} aria-label="Choose a CSV file" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {fileName && <span className="small muted">{fileName}</span>}
        <div className="spacer" />
        <button className="btn small" onClick={() => saveTextFile(`${kind === "people" ? "collaborators" : kind === "events" ? "schedule" : kind === "inventory" ? "equipment" : kind}-template.csv`, templateCSV(kind), "text/csv")}>Download a blank template</button>
      </div>
      <textarea
        className="input"
        style={{ minHeight: sheet.headers.length ? 60 : 120, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        aria-label="CSV text"
        placeholder={templateCSV(kind)}
        value={text}
        onChange={(e) => { setText(e.target.value); setFileName(""); setMap(null); }}
      />

      {sheet.headers.length > 0 && (
        <>
          <div>
            <h3 style={{ margin: "0 0 6px" }}>Match the columns</h3>
            <p className="small muted" style={{ marginTop: 0 }}>{sheet.rows.length} rows. Each field shows the column it reads from; change any that are wrong, or pick &quot;—&quot; to leave it out.</p>
            <div className="form-grid">
              {IMPORT_FIELDS[kind].map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  <select value={m[f.key] ?? ""} onChange={(e) => setMap({ ...m, [f.key]: e.target.value })}>
                    <option value="">—</option>
                    {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          <div className="form-grid">
            {(PER_PROJECT[kind] || kind === "people" || kind === "venues" || kind === "inventory") && (
              <Field label={PER_PROJECT[kind] ? (m.project ? "Project for rows without one" : "Project") : "Add to project"}>
                <select value={proj} onChange={(e) => setProj(e.target.value)}>
                  {!PER_PROJECT[kind] && <option value="">No project</option>}
                  {data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="toolbar" style={{ margin: 0, flexWrap: "wrap", gap: 14 }}>
            {kind === "budget" && <label className="small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current budget</label>}
            {kind !== "payments" && !(kind === "budget" && replace) && (
              <label className="small"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Update {label.many} that are already here with the file&apos;s values</label>
            )}
            {kind === "payments" && <label className="small"><input type="checkbox" checked={addPaidToLedger} onChange={(e) => setAddPaidToLedger(e.target.checked)} /> Add paid payments to Bookkeeping as expenses</label>}
            {(kind === "events" || kind === "shopping") && <label className="small"><input type="checkbox" checked={addPeople} onChange={(e) => setAddPeople(e.target.checked)} /> Add names that aren&apos;t collaborators yet</label>}
          </div>

          {missing.length > 0 && <p className="note small">Pick a column for: {missing.join(", ")}.</p>}

          {plan && (
            <div className="card" style={{ background: "var(--surface)" }}>
              <p className="small">
                <strong>{plan.add.length}</strong> new {plan.add.length === 1 ? label.one : label.many}
                {plan.update.length > 0 && <> · <strong>{plan.update.length}</strong> updated</>}
                {plan.duplicates > 0 && <> · {plan.duplicates} already here (skipped)</>}
                {plan.newPeople.length > 0 && <> · {count(plan.newPeople.length, "new collaborator", "new collaborators")}: {plan.newPeople.map((p) => p.name).join(", ")}</>}
                {plan.entries.length > 0 && <> · {count(plan.entries.length, "expense", "expenses")} added to Bookkeeping</>}
                {plan.linked > 0 && <> · {plan.linked} matched to entries already in Bookkeeping</>}
              </p>
              {preview.length > 0 && (
                <div className="grid-scroll">
                  <table className="t">
                    <thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i}>{previewOf(kind, r, names, money).cells.map((c, j) => <td key={j} className="small">{c || <span className="muted">—</span>}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.add.length + plan.update.length > preview.length && <p className="small muted">…and {plan.add.length + plan.update.length - preview.length} more.</p>}
              {plan.problems.slice(0, 6).map((w, i) => <p key={i} className="note small" style={{ marginTop: 6 }}>{w}</p>)}
              {plan.problems.length > 6 && <p className="small muted">…and {plan.problems.length - 6} more rows skipped.</p>}
              {kind === "payments" && sources.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>&quot;Paid from&quot; values that match a money source ({sources.map((s) => s.name).join(", ")}) are linked to it. Add more in <button className="linkbtn" onClick={() => { onClose(); setScreen("settings"); }}>Settings</button>.</p>}
            </div>
          )}
        </>
      )}

      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!total || busy} onClick={() => void run()}>Import{total ? ` ${plan!.add.length + plan!.update.length || plan!.newPeople.length}` : ""}</button>
      </div>
    </Modal>
  );
}
