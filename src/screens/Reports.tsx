import { useMemo, useState } from "react";
import { Chips, Field, printHtml, saveBinaryFile, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { markdownToHtml } from "../lib/paperwork";
import { buildReceiptsPdf } from "../lib/receiptsPdf";
import {
  REPORT_CSS, SECTION_LABEL, computeReport, defaultReportSettings, reportCSV, reportHtml, reportMarkdown, runSummary, savedReportPath,
} from "../lib/reports";
import { REPORT_SECTIONS, type ReportSettings, type SavedReport } from "../lib/types";
import { fmtDate } from "../lib/util";
import { useApp } from "../store";
import { DailyReports } from "./DailyReports";
import { HouseReports, VenueSettlement } from "./HouseReports";

type Mode = "Sponsor & funder" | "House reports" | "Venue settlement" | "Daily reports";

export function Reports() {
  const [mode, setMode] = useState<Mode>("Sponsor & funder");
  return (
    <>
      <Header title="Reports" />
      <div className="content">
        <div className="toolbar"><Chips label="Report type" options={["Sponsor & funder", "House reports", "Venue settlement", "Daily reports"] as const} value={mode} onChange={setMode} /></div>
        {mode === "Sponsor & funder" && <FunderReport />}
        {mode === "House reports" && <HouseReports />}
        {mode === "Venue settlement" && <VenueSettlement />}
        {mode === "Daily reports" && <DailyReports />}
      </div>
    </>
  );
}

function quarterStart(today: string): string {
  const m = Number(today.slice(5, 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${today.slice(0, 4)}-${String(q).padStart(2, "0")}-01`;
}

function FunderReport() {
  const { data, project, today, money, fs, saveReport, deleteReport, toast } = useApp();
  const proj = data.projects.find((p) => p.slug === project);
  const [s, setS] = useState<ReportSettings>(() => defaultReportSettings(project, proj?.fiscal_sponsor ?? data.sponsors[0]?.slug ?? "", quarterStart(today), today));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ReportSettings>) => setS((x) => ({ ...x, ...patch }));
  const r = useMemo(() => computeReport(s, data), [s, data]);

  // Attendance from house reports in the period feeds funder reports too.
  const house = data.houseReports.filter((h) => (!s.projects.length || s.projects.includes(h.project)) && (!s.from || h.date >= s.from) && (!s.to || h.date <= s.to));
  const run = house.length ? runSummary(house) : null;
  const attendanceHtml = run ? `<h2>Attendance</h2><p>${run.attendance} people over ${run.nights} performance${run.nights === 1 ? "" : "s"}${run.pctCapacity !== null ? ` (${run.pctCapacity}% of capacity)` : ""}. Box office ${money(run.gross)}.</p>` : "";
  const body = reportHtml(r, s, notes, data.settings.producer_name, (n) => money(n), markdownToHtml(notes)) + attendanceHtml;
  const md = reportMarkdown(r, s, notes, (n) => money(n)) + (run ? `\n## Attendance\n\n${run.attendance} people over ${run.nights} performances${run.pctCapacity !== null ? ` (${run.pctCapacity}% of capacity)` : ""}.\n` : "");
  const fileBase = `${r.title.toLowerCase().replace(/\W+/g, "-")}-${s.to || today}`;

  const sent = data.reports.filter((x) => !x.template).sort((a, b) => b.sent.localeCompare(a.sent));
  const templates = data.reports.filter((x) => x.template);

  const saveAs = async (template: boolean) => {
    const title = prompt(template ? "Name this report template" : "Name this report", template ? `${r.title.replace(/ report$/, "")} quarterly` : `${r.title} ${fmtDate(s.to || today, true)}`);
    if (!title) return;
    const rep: SavedReport = {
      path: savedReportPath(title, today, template), title, template, settings: s, sent: template ? "" : today,
      snapshot: template ? null : { received: r.received, spent: r.spent, balance: r.balance, sponsor_fees: r.sponsorFees, period: r.period, projects: r.projects, ...(run ? { attendance: run.attendance } : {}) },
      notes: template ? "" : notes,
    };
    await saveReport(rep);
    toast(template ? `Saved "${title}" as a report template` : `Saved "${title}" with a snapshot of today's numbers`);
  };

  const receiptsPdf = async () => {
    if (!fs.readBase64) { toast("The receipts appendix needs the desktop app, where receipts are real files."); return; }
    setBusy(true);
    try {
      const { bytes, missing } = await buildReceiptsPdf(`Receipts: ${r.title}, ${r.period}`, r.receipts.map((x) => ({ ...x, amount: money(x.amount, { cents: true }) })), fs.readBase64);
      await saveBinaryFile(`${fileBase}-receipts.pdf`, bytes);
      toast(missing.length ? `Saved. ${missing.length} receipt(s) couldn't be added (missing, or not PDF/PNG/JPG).` : "Receipts appendix saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="report-layout">
      <aside className="card report-settings" aria-label="Report settings">
        {templates.length > 0 && (
          <Field label="Start from a template">
            <select value="" onChange={(e) => { const t = templates.find((x) => x.path === e.target.value); if (t) setS({ ...t.settings, from: s.from, to: s.to }); }}>
              <option value="">Choose…</option>
              {templates.map((t) => <option key={t.path} value={t.path}>{t.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Report for">
          <select value={s.report_for} onChange={(e) => set({ report_for: e.target.value })}>
            {data.sponsors.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            <option value="">Another funder…</option>
          </select>
        </Field>
        {!s.report_for && (
          <>
            <Field label="Funder name"><input value={s.funder_name} onChange={(e) => set({ funder_name: e.target.value })} /></Field>
            <Field label="Grant number"><input value={s.grant_number} onChange={(e) => set({ grant_number: e.target.value })} /></Field>
          </>
        )}
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>Projects (none ticked = all)</div>
          <div className="chips">
            {data.projects.map((p) => <button key={p.slug} className="chip" aria-pressed={s.projects.includes(p.slug)} onClick={() => set({ projects: s.projects.includes(p.slug) ? s.projects.filter((x) => x !== p.slug) : [...s.projects, p.slug] })}>{p.name}</button>)}
          </div>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="From"><input type="date" value={s.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={s.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>Include</div>
          {REPORT_SECTIONS.map((k) => (
            <label key={k} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={s.include.includes(k)} onChange={(e) => set({ include: e.target.checked ? [...s.include, k] : s.include.filter((x) => x !== k) })} />
              {SECTION_LABEL[k]}
            </label>
          ))}
        </div>
        {s.include.includes("producer_notes") && (
          <Field label="Producer notes (markdown)"><textarea style={{ minHeight: 120 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened this period, what the money did, what's next." /></Field>
        )}
        <div className="toolbar" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <button className="btn primary" onClick={() => printHtml(r.title, `<style>${REPORT_CSS}</style><div class="report">${body}</div>`)}>Print / Save as PDF</button>
          {s.include.includes("receipts_appendix") && <button className="btn" disabled={busy || !r.receipts.length} onClick={() => void receiptsPdf()}>{busy ? "Building…" : `Receipts appendix PDF (${r.receipts.length})`}</button>}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => saveTextFile(`${fileBase}.csv`, reportCSV(r), "text/csv")}>CSV</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => saveTextFile(`${fileBase}.md`, md, "text/markdown")}>.md</button>
          </div>
          <button className="btn" onClick={() => void saveAs(false)}>Save as sent (keeps a snapshot)</button>
          <button className="btn ghost" onClick={() => void saveAs(true)}>Save these settings as a template</button>
        </div>
      </aside>

      <div>
        <style>{REPORT_CSS}</style>
        <article className="card report report-page" aria-label="Report preview" dangerouslySetInnerHTML={{ __html: body }} />
        {sent.length > 0 && (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card-head"><h2>Sent reports</h2><span className="muted small">Numbers as they were when saved</span></div>
            <table className="t">
              <tbody>
                {sent.map((x) => {
                  const snap = (x.snapshot ?? {}) as Record<string, number | string>;
                  return (
                    <tr key={x.path}>
                      <td>{x.title}<div className="small muted">{String(snap.period ?? "")}</div></td>
                      <td className="small muted">Sent {fmtDate(x.sent, true)}</td>
                      <td className="r num">{snap.received !== undefined ? `In ${money(Number(snap.received))} · Out ${money(Number(snap.spent))}` : ""}</td>
                      <td className="r">
                        <button className="btn small" onClick={() => { setS(x.settings); setNotes(x.notes); }}>Open settings</button>
                        <button className="icon-btn" aria-label={`Delete ${x.title}`} onClick={() => void deleteReport(x.path)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
