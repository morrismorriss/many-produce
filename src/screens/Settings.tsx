import { useState } from "react";
import type { MoneySource, Settings as S, Sponsor } from "../lib/types";
import { slugify } from "../lib/util";
import { useApp } from "../store";
import { EditCell, Field } from "../components/bits";
import { Header, ProjectModal } from "../components/Shell";
import { MemoryFS } from "../lib/fs";
import { strToU8, zipSync } from "fflate";
import { collectVault, exportAllCSV } from "../lib/backup";
import { saveBinaryFile } from "../components/bits";
import { TodoistSettings } from "./TodoistSettings";
import { SUPPORT_URL, openExternal } from "../components/Support";
import { ThemePicker } from "./ThemePicker";

export function Settings({ onSwitchVault }: { onSwitchVault: () => void }) {
  const { data, saveSettings, saveSponsor, fs, reload, projectBySlug, project, money, toast } = useApp();
  const s = data.settings;
  const save = (patch: Partial<S>) => void saveSettings({ ...s, ...patch });
  const [editProject, setEditProject] = useState(false);
  const setSource = (i: number, patch: Partial<MoneySource>) => save({ money_sources: s.money_sources.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const p = projectBySlug(project);

  return (
    <>
      <Header title="Settings" />
      <div className="content" style={{ maxWidth: 900 }}>
        <section className="card">
          <div className="card-head"><h2>Vault</h2></div>
          <p>
            Everything lives in <code>{fs.root}</code> as plain markdown and CSV files you own.
            {fs.kind === "browser" && " (This is the browser demo; it's kept in this browser's storage only.)"}
          </p>
          <div className="toolbar">
            <button className="btn" onClick={onSwitchVault}>{fs.kind === "desktop" ? "Open a different vault folder…" : "Back to the start screen"}</button>
            <button className="btn" onClick={() => void reload()}>Reload from disk</button>
            {fs.kind === "desktop" && <span className="small muted">Edits you make in other apps show up straight away.</span>}
            {fs.kind === "browser" && (
              <button className="btn danger" onClick={() => { if (confirm("Erase the browser demo vault?")) { MemoryFS.clearLocalStorage(); location.reload(); } }}>
                Erase demo data
              </button>
            )}
          </div>
        </section>

        {p && (
          <section className="card">
            <div className="card-head"><h2>This project: {p.name}</h2><div className="spacer" /><button className="btn small" onClick={() => setEditProject(true)}>Edit project</button></div>
            <p className="muted small">Name, dates, color, fiscal sponsor and fee rate for {p.name}.</p>
          </section>
        )}

        <section className="card">
          <div className="card-head"><h2>You</h2></div>
          <div className="form-grid">
            <Field label="Your name (fills [Producer])"><input value={s.producer_name} onChange={(e) => save({ producer_name: e.target.value })} /></Field>
            <Field label="Company name (fills [Company])"><input value={s.company_name} onChange={(e) => save({ company_name: e.target.value })} /></Field>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Look</h2></div>
          <ThemePicker />
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Currency">
              <select value={s.currency} onChange={(e) => save({ currency: e.target.value })}>
                {["USD", "CAD", "GBP", "EUR", "AUD", "NZD"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Money sources</h2><div className="spacer" /><button className="btn small" onClick={() => save({ money_sources: [...s.money_sources, { name: "New source", opening_balance: 0, opening_date: "" }] })}>+ Source</button></div>
          <p className="small muted">Starting balance for each place money sits. Ledger entries dated on or after the &quot;as of&quot; date keep it current. Link a sponsor fund to its sponsor so income through that sponsor lands there in the forecast.</p>
          <table className="t">
            <thead><tr><th>Name</th><th className="r">Opening balance</th><th>As of</th><th>Sponsor fund for</th><th /></tr></thead>
            <tbody>
              {s.money_sources.map((m, i) => (
                <tr key={i}>
                  <td><EditCell label="Source name" value={m.name} onSave={(v) => setSource(i, { name: v })} /></td>
                  <td className="r" style={{ width: 140 }}><EditCell label="Opening balance" type="number" align="r" value={m.opening_balance} onSave={(v) => setSource(i, { opening_balance: Number(v) || 0 })} /></td>
                  <td style={{ width: 150 }}><EditCell label="As of" type="date" value={m.opening_date} onSave={(v) => setSource(i, { opening_date: v })} /></td>
                  <td>
                    <select className="cell-edit" aria-label="Sponsor" value={m.sponsor ?? ""} onChange={(e) => setSource(i, { sponsor: e.target.value || undefined })}>
                      <option value="">—</option>
                      {data.sponsors.map((sp) => <option key={sp.slug} value={sp.slug}>{sp.name}</option>)}
                    </select>
                  </td>
                  <td><button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => save({ money_sources: s.money_sources.filter((_, k) => k !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Low-balance cushion">
              <input type="number" value={s.cushion} onChange={(e) => save({ cushion: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <p className="small muted">The forecast warns when your total balance drops below {money(s.cushion)}, or any source goes below zero.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Backup and export</h2></div>
          <p className="small muted">Your vault is already plain files you own. A backup zips the whole folder (receipts and signed PDFs included); the CSV export flattens everything into spreadsheets.</p>
          <div className="toolbar">
            <button className="btn" onClick={async () => { const files = await collectVault(fs); await saveBinaryFile(`many-produce-backup-${new Date().toISOString().slice(0, 10)}.zip`, zipSync(files)); toast(`Backed up ${Object.keys(files).length} files`); }}>Back up vault (zip)</button>
            <button className="btn" onClick={async () => { const csv = exportAllCSV(data); await saveBinaryFile(`many-produce-export-${new Date().toISOString().slice(0, 10)}.zip`, zipSync(Object.fromEntries(Object.entries(csv).map(([k, v]) => [k, strToU8(v)])))); }}>Export everything to CSV (zip)</button>
          </div>
          <p className="small muted">To bring in a bank or card statement, use Import CSV on Bookkeeping → Ledger. Budgets import on Bookkeeping → Budget, availability on Schedule → Availability.</p>
        </section>

        <TodoistSettings />

        <section className="card">
          <div className="card-head"><h2>Schedule</h2></div>
          <div className="form-grid">
            <Field label="Warn over this many hours called per person per week (0 = off)">
              <input type="number" min={0} value={s.max_hours_week} onChange={(e) => save({ max_hours_week: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Fiscal sponsors</h2><div className="spacer" /><button className="btn small" onClick={() => { const name = prompt("Sponsor name"); if (name) void saveSponsor({ slug: slugify(name), name, fee_rate: 0, fee_applies_to: "contributed income", contact: "", account_url: "", review_required_for: [], report_schedule: "", notes: "" }); }}>+ Sponsor</button></div>
          <table className="t">
            <thead><tr><th>Name</th><th className="r">Fee rate (%)</th><th>Contact</th><th>Notes</th></tr></thead>
            <tbody>
              {data.sponsors.map((sp) => <SponsorRow key={sp.slug} sp={sp} onSave={saveSponsor} />)}
            </tbody>
          </table>
          <p className="small muted">Presets for Fractured Atlas (8%) and Producer Hub (2%). Rates change; check your agreement.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Categories and tags</h2></div>
          <ListEditor label="Expense categories" items={s.expense_categories} onChange={(v) => save({ expense_categories: v })} />
          <ListEditor label="Income categories" items={s.income_categories} onChange={(v) => save({ income_categories: v })} />
          <ListEditor label="Tags" items={s.tags} onChange={(v) => save({ tags: v })} />
          <ListEditor label="Your own document types (added to the built-in list)" items={s.doc_types} onChange={(v) => save({ doc_types: v })} />
        </section>

        <section className="card">
          <div className="card-head"><h2>About</h2></div>
          <p>Many Produce is free and open source. It has no AI features, no accounts and no servers. Its code was written with Claude Code and OpenHands.</p>
          <p className="small muted">Not accounting software and not tax advice. It keeps tidy records you can hand to a fiscal sponsor, funder or accountant.</p>
          <p>If it helps your productions, you can support it: <button className="linkbtn" onClick={() => void openExternal(SUPPORT_URL)}>buymeacoffee.com/morriss</button></p>
        </section>
      </div>
      {editProject && p && <ProjectModal existing={p} onClose={() => setEditProject(false)} />}
    </>
  );
}

function SponsorRow({ sp, onSave }: { sp: Sponsor; onSave: (s: Sponsor) => Promise<void> }) {
  return (
    <tr>
      <td><EditCell label="Sponsor name" value={sp.name} onSave={(v) => void onSave({ ...sp, name: v })} /></td>
      <td className="r" style={{ width: 120 }}><EditCell label="Fee rate" type="number" align="r" value={+(sp.fee_rate * 100).toFixed(4)} onSave={(v) => void onSave({ ...sp, fee_rate: (Number(v) || 0) / 100 })} /></td>
      <td><EditCell label="Contact" value={sp.contact} onSave={(v) => void onSave({ ...sp, contact: v })} /></td>
      <td><EditCell label="Notes" value={sp.notes} onSave={(v) => void onSave({ ...sp, notes: v })} /></td>
    </tr>
  );
}

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  const [add, setAdd] = useState("");
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="muted small" style={{ marginBottom: 4 }}>{label}</div>
      <div className="chips">
        {items.map((i) => (
          <span key={i} className="chip" style={{ cursor: "default" }}>
            {i} <button className="icon-btn" style={{ padding: 0, marginLeft: 4 }} aria-label={`Remove ${i}`} onClick={() => onChange(items.filter((x) => x !== i))}>×</button>
          </span>
        ))}
        <input
          className="input"
          style={{ width: 160 }}
          placeholder="Add…"
          aria-label={`Add to ${label}`}
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && add.trim() && !items.includes(add.trim())) { onChange([...items, add.trim()]); setAdd(""); } }}
        />
      </div>
    </div>
  );
}
