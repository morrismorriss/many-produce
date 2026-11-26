import { useEffect, useMemo, useState } from "react";
import { budgetFromCSV, budgetToCSV, budgetToManyApplyCSV, expenseActuals, incomeActuals, summarize, type ExpenseRow, type IncomeRow } from "../lib/budget";
import { projectFeeRate } from "../lib/ledger";
import type { BudgetLine, Confidence } from "../lib/types";
import { fmtDate, round2, uid } from "../lib/util";
import { useApp } from "../state/AppState";
import { EditCell, Empty, Modal, Plus, Progress, ProjectTag, Tile, saveTextFile } from "../ui/bits";
import { Header } from "../ui/Shell";

export function Budget() {
  const { data, project, money, saveBudget, newItemSignal } = useApp();
  const [importing, setImporting] = useState(false);
  const projects = data.projects.filter((p) => !project || p.slug === project);

  const per = useMemo(
    () =>
      projects.map((p) => {
        const lines = data.budgets[p.slug] ?? [];
        const exp = expenseActuals(lines, data.ledger, p.slug);
        const inc = incomeActuals(lines, data.ledger, p, data.sponsors);
        return { p, lines, exp, inc, sum: summarize(exp, inc) };
      }),
    [projects, data.budgets, data.ledger, data.sponsors],
  );
  const s = per.reduce(
    (a, x) => ({ total: a.total + x.sum.total, paid: a.paid + x.sum.paid, still: a.still + x.sum.stillToPay, raised: a.raised + x.sum.incomeRaised, proj: a.proj + x.sum.incomeProjected }),
    { total: 0, paid: 0, still: 0, raised: 0, proj: 0 },
  );

  const target = project || "";
  const addLine = (type: "expense" | "income") => {
    if (!target) return;
    const lines = data.budgets[target] ?? [];
    const cats = type === "income" ? data.settings.income_categories : data.settings.expense_categories;
    const line: BudgetLine = {
      id: uid("b"), category: cats[0], type, line_item: type === "income" ? "New income source" : "New line", quantity: 1, rate: 0, amount: 0, notes: "",
      expected_date: "", confidence: type === "income" ? "Likely" : "", through_sponsor: type === "income" && !!data.projects.find((p) => p.slug === target)?.fiscal_sponsor, source: "",
    };
    void saveBudget(target, [...lines, line]);
  };
  useEffect(() => {
    if (newItemSignal && target) addLine("expense");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newItemSignal]);

  const exp = per.flatMap((x) => x.exp.map((r) => ({ slug: x.p.slug, r })));
  const inc = per.flatMap((x) => x.inc.map((r) => ({ slug: x.p.slug, r, p: x.p })));

  return (
    <>
      <Header
        title="Budget"
        actions={
          target ? (
            <button className="btn primary" onClick={() => addLine("expense")}>
              <Plus /> Budget line
            </button>
          ) : null
        }
      />
      <div className="content">
        <div className="tiles">
          <Tile label="Total budget" value={money(s.total)} />
          <Tile label="Paid so far" value={money(s.paid)} sub={s.total ? `${Math.round((s.paid / s.total) * 100)}% of budget` : undefined} />
          <Tile label="Still to pay" value={money(s.still)} />
          <Tile label="Income raised" value={<span className="in">{money(s.raised)}</span>} sub={`of ${money(s.proj)} projected (net of fees)`} />
        </div>
        {!target && <p className="note info" style={{ marginBottom: 14 }}>Showing every project. Pick a project in the sidebar to add or import budget lines.</p>}

        <div className="budget-layout">
          <section className="card" aria-label="Expenses">
            <div className="card-head">
              <h2>Expenses</h2>
              <div className="spacer" />
              {target && (
                <>
                  <button className="btn small" onClick={() => setImporting(true)}>Import CSV</button>
                  <button className="btn small" onClick={() => saveTextFile(`${target}-budget.csv`, budgetToManyApplyCSV(data.budgets[target] ?? []), "text/csv")}>Export (Many Apply format)</button>
                  <button className="btn small" onClick={() => saveTextFile(`${target}-budget-full.csv`, budgetToCSV(data.budgets[target] ?? []), "text/csv")}>Export full</button>
                </>
              )}
            </div>
            {exp.length ? (
              <table className="t">
                <thead>
                  <tr>
                    <th>Line</th>
                    {!target && <th>Project</th>}
                    <th>Category</th>
                    <th>Notes</th>
                    <th className="r">Budgeted</th>
                    <th className="r">Paid</th>
                    <th style={{ width: 110 }}>Progress</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {exp.map(({ slug, r }) => (
                    <ExpenseRowView key={slug + r.line.id} slug={slug} row={r} showProject={!target} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={target ? 3 : 4}>Total</td>
                    <td className="r num">{money(s.total)}</td>
                    <td className="r num">{money(s.paid)}</td>
                    <td><Progress value={s.paid} max={s.total} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            ) : (
              <Empty title="No budget lines yet">
                {target ? <button className="btn" onClick={() => addLine("expense")}><Plus /> Add a line</button> : <p>Pick a project to start a budget.</p>}
              </Empty>
            )}
          </section>

          <section className="card" aria-label="Income">
            <div className="card-head">
              <h2>Income</h2>
              <div className="spacer" />
              {target && <button className="btn small" onClick={() => addLine("income")}><Plus /> Source</button>}
            </div>
            {inc.length ? (
              <div className="income-grid">
                {inc.map(({ slug, r, p }) => (
                  <IncomeRowView key={slug + r.line.id} slug={slug} row={r} showProject={!target} feeLabel={projectFeeRate(p, data.sponsors)} />
                ))}
              </div>
            ) : (
              <p className="muted">No income sources yet.</p>
            )}
          </section>
        </div>
      </div>
      {importing && target && (
        <ImportBudget
          onClose={() => setImporting(false)}
          onImport={(lines, replace) => {
            void saveBudget(target, replace ? lines : [...(data.budgets[target] ?? []), ...lines]);
            setImporting(false);
          }}
        />
      )}
    </>
  );
}

function useLineSaver(slug: string) {
  const { data, saveBudget } = useApp();
  return {
    update: (id: string, patch: Partial<BudgetLine>) => {
      const lines = (data.budgets[slug] ?? []).map((l) => {
        if (l.id !== id) return l;
        const n = { ...l, ...patch };
        // quantity × rate drives amount; editing amount directly resets rate.
        if ("quantity" in patch || "rate" in patch) n.amount = round2(n.quantity * n.rate);
        if ("amount" in patch) { n.quantity = n.quantity || 1; n.rate = round2(n.amount / n.quantity); }
        return n;
      });
      void saveBudget(slug, lines);
    },
    remove: (id: string) => void saveBudget(slug, (data.budgets[slug] ?? []).filter((l) => l.id !== id)),
  };
}

function ExpenseRowView({ slug, row, showProject }: { slug: string; row: ExpenseRow; showProject: boolean }) {
  const { data, money } = useApp();
  const { update, remove } = useLineSaver(slug);
  const l = row.line;
  return (
    <tr>
      <td style={{ minWidth: 220 }}><EditCell label="Line item" value={l.line_item} onSave={(v) => update(l.id, { line_item: v })} /></td>
      {showProject && <td><ProjectTag slug={slug} /></td>}
      <td style={{ minWidth: 140 }}>
        <select className="cell-edit" aria-label="Category" value={l.category} onChange={(e) => update(l.id, { category: e.target.value })}>
          {data.settings.expense_categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </td>
      <td><EditCell label="Notes" value={l.notes} placeholder={l.quantity !== 1 ? `${l.quantity} × ${money(l.rate)}` : ""} onSave={(v) => update(l.id, { notes: v })} /></td>
      <td className="r" style={{ width: 110 }}><EditCell label="Budgeted" align="r" type="number" value={l.amount} onSave={(v) => update(l.id, { amount: Number(v) || 0 })} /></td>
      <td className={`r num ${row.paid > l.amount + 0.005 ? "neg" : ""}`}>{money(row.paid)}</td>
      <td><Progress value={row.paid} max={l.amount} /></td>
      <td><button className="icon-btn" aria-label={`Delete ${l.line_item}`} onClick={() => remove(l.id)}>×</button></td>
    </tr>
  );
}

function IncomeRowView({ slug, row, showProject, feeLabel }: { slug: string; row: IncomeRow; showProject: boolean; feeLabel: { rate: number; sponsor?: { name: string } } }) {
  const { data, money } = useApp();
  const { update, remove } = useLineSaver(slug);
  const l = row.line;
  const sources = data.settings.money_sources.map((s) => s.name);
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditCell label="Income source" value={l.line_item} onSave={(v) => update(l.id, { line_item: v })} />
        </div>
        {showProject && <ProjectTag slug={slug} />}
        <button className="icon-btn" aria-label={`Delete ${l.line_item}`} onClick={() => remove(l.id)}>×</button>
      </div>
      <Progress blue value={row.raisedNet} max={row.goalNet} />
      <div className="small muted" style={{ marginTop: 4 }}>
        <span className="in num">{money(row.raisedNet)}</span> raised of {money(row.goalNet)}
        {l.through_sponsor && feeLabel.rate > 0 && <> · net of {+(feeLabel.rate * 100).toFixed(2)}% {feeLabel.sponsor?.name ?? "sponsor"} fee</>}
      </div>
      <div className="form-grid" style={{ marginTop: 6, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
        <select className="input small" aria-label="Category" value={l.category} onChange={(e) => update(l.id, { category: e.target.value })}>
          {data.settings.income_categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <EditCell label="Goal (gross)" type="number" value={l.amount} onSave={(v) => update(l.id, { amount: Number(v) || 0 })} />
        <select className="input small" aria-label="Confidence" value={l.confidence} onChange={(e) => update(l.id, { confidence: e.target.value as Confidence })}>
          <option value="">Confidence…</option>
          <option>Confirmed</option>
          <option>Likely</option>
          <option>Hoped for</option>
        </select>
        <EditCell label="Expected date" type="date" value={l.expected_date} onSave={(v) => update(l.id, { expected_date: v })} />
        <select className="input small" aria-label="Lands in" value={l.source} onChange={(e) => update(l.id, { source: e.target.value })}>
          <option value="">Lands in…</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={l.through_sponsor} onChange={(e) => update(l.id, { through_sponsor: e.target.checked })} />
          Through sponsor
        </label>
      </div>
      {l.expected_date && <div className="small muted">Expected {fmtDate(l.expected_date, true)}{l.confidence ? ` · ${l.confidence}` : ""}</div>}
    </div>
  );
}

function ImportBudget({ onClose, onImport }: { onClose: () => void; onImport: (lines: BudgetLine[], replace: boolean) => void }) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  let lines: BudgetLine[] = [];
  let err = "";
  try {
    lines = text.trim() ? budgetFromCSV(text).map((l) => ({ ...l, id: uid("b") })) : [];
  } catch (e) {
    err = String(e);
  }
  return (
    <Modal title="Import budget CSV" onClose={onClose}>
      <p className="muted">Paste a budget CSV, such as one exported from Many Apply&apos;s budget builder (columns: category, type, line_item, quantity, rate, amount, notes).</p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Choose a CSV file"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }}
      />
      <textarea className="input" style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV text" />
      {err && <p className="neg">{err}</p>}
      <p className="small muted">{lines.length} lines found.</p>
      <div className="toolbar">
        <label className="small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current budget</label>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!lines.length} onClick={() => onImport(lines, replace)}>Import</button>
      </div>
    </Modal>
  );
}
