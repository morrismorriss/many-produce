import { useEffect, useMemo, useState } from "react";
import { groupOf, paymentsToICS, type PaymentGroup } from "../lib/payments";
import type { Payment } from "../lib/types";
import { allocTouches, allocValid, fmtDate, round2, shareOf, single, uid } from "../lib/util";
import { useApp } from "../store";
import { AllocTags, Empty, Field, Modal, Plus, Tile, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { CsvImportModal } from "../components/CsvImport";
import { SplitEditor } from "./Bookkeeping";

const GROUPS: PaymentGroup[] = ["Overdue", "Next 30 days", "Later", "Paid"];

export function Payments() {
  const { allPayments, project, today, money, setPaid, openDrawer, newItemSignal, data } = useApp();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (newItemSignal) setAdding(true);
  }, [newItemSignal]);

  const list = useMemo(() => allPayments.filter((p) => allocTouches(p.project_alloc, project)), [allPayments, project]);
  const by = (g: PaymentGroup) => list.filter((p) => groupOf(p, today) === g).sort((a, b) => (g === "Paid" ? b.paid_date.localeCompare(a.paid_date) : a.due.localeCompare(b.due)));
  const overdue = by("Overdue");
  const next30 = by("Next 30 days");
  const share = (p: Payment) => round2(p.amount * shareOf(p.project_alloc, project));
  const lineName = (p: Payment) => {
    const owner = Object.keys(p.project_alloc)[0];
    return (data.budgets[owner] ?? []).find((l) => l.id === p.budget_line)?.line_item ?? p.category;
  };

  return (
    <>
      <Header
        title="Bookkeeping"
        actions={
          <>
            <button className="btn" onClick={() => saveTextFile("payments.ics", paymentsToICS(list, data.settings.currency), "text/calendar")}>Export to calendar (.ics)</button>
            <button className="btn" onClick={() => setImporting(true)}>Import CSV</button>
            <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Payment</button>
          </>
        }
      />
      <div className="content">
        <div className="tiles">
          <Tile label="Overdue" value={overdue.length} sub={money(overdue.reduce((s, p) => s + share(p), 0))} alert={overdue.length > 0} />
          <Tile label="Due in the next 30 days" value={money(next30.reduce((s, p) => s + share(p), 0))} sub={`${next30.length} payments`} />
          <Tile label="Scheduled later" value={money(by("Later").reduce((s, p) => s + share(p), 0))} />
          <Tile label="Paid" value={money(by("Paid").reduce((s, p) => s + share(p), 0))} />
        </div>
        {list.length ? (
          <div className="table-scroll"><table className="t">
            <thead>
              <tr>
                <th style={{ width: 36 }}><span className="sr-only">Paid</span></th>
                <th>Payment</th>
                <th>Payee</th>
                <th>Method</th>
                <th>Project</th>
                <th>Budget line</th>
                <th>Due</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            {GROUPS.map((g) => {
              const rows = by(g);
              if (!rows.length) return null;
              return (
                <tbody key={g}>
                  <tr className="group-head"><td colSpan={8}>{g} · {rows.length}</td></tr>
                  {rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => openDrawer({ kind: "payment", id: p.id })}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Mark ${p.title} paid`} checked={p.status === "paid"} onChange={(e) => void setPaid(p.id, e.target.checked)} />
                      </td>
                      <td>{p.title}{p.status === "paid" && <div className="muted small">Paid {fmtDate(p.paid_date)}</div>}</td>
                      <td>{p.payee}</td>
                      <td className="muted">{p.method}</td>
                      <td><AllocTags alloc={p.project_alloc} /></td>
                      <td className="muted">{lineName(p)}</td>
                      <td className={`num ${g === "Overdue" ? "neg" : ""}`} style={{ whiteSpace: "nowrap" }}>{g === "Overdue" && <span className="pill red" style={{ marginRight: 6 }}>Overdue</span>}{fmtDate(p.due)}</td>
                      <td className="r num">{money(share(p), { cents: true })}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table></div>
        ) : (
          <Empty title="No payments scheduled">
            <p>Schedule what you owe. Ticking one paid adds it to Bookkeeping with the project and category filled in.</p>
          </Empty>
        )}
      </div>
      {importing && <CsvImportModal kind="payments" title="Import payments" onClose={() => setImporting(false)} />}
      {adding && <PaymentModal onClose={() => setAdding(false)} />}
    </>
  );
}

export function PaymentModal({ onClose, existing, preset }: { onClose: () => void; existing?: Payment; preset?: Partial<Payment> }) {
  const { data, project, savePayment, today } = useApp();
  const def = project || data.projects.find((p) => !p.builtin)?.slug || "overhead";
  const [p, setP] = useState<Payment>(
    existing ?? {
      id: uid("p"), title: "", payee: "", method: "Checking", budget_line: "", category: "", due: today, amount: 0,
      status: "scheduled", paid_date: "", ledger_id: "", project_alloc: single(def), notes: "", ...preset,
    },
  );
  const [amt, setAmt] = useState(p.amount ? String(p.amount) : "");
  const [split, setSplit] = useState(Object.keys(p.project_alloc).length > 1);
  const set = <K extends keyof Payment>(k: K, v: Payment[K]) => setP((x) => ({ ...x, [k]: v }));
  const owner = Object.keys(p.project_alloc)[0];
  const lines = (data.budgets[owner] ?? []).filter((l) => l.type === "expense");
  const valid = p.title.trim() && Number(amt) > 0 && allocValid(p.project_alloc);
  const submit = async () => {
    if (!valid) return;
    const line = lines.find((l) => l.id === p.budget_line);
    await savePayment({ ...p, amount: round2(Number(amt)), category: line?.category ?? (p.category || "Other") });
    onClose();
  };
  return (
    <Modal title={existing ? "Edit payment" : "New payment"} onClose={onClose}>
      <div className="form-grid">
        <Field label="What for" wide><input autoFocus value={p.title} onChange={(e) => set("title", e.target.value)} placeholder="Venue deposit" /></Field>
        <Field label="Payee">
          <input list="mp-payees" value={p.payee} onChange={(e) => set("payee", e.target.value)} />
          <datalist id="mp-payees">{[...data.people.map((x) => x.name), ...data.venues.map((x) => x.name)].map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <Field label="Amount"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
        <Field label="Due"><input type="date" value={p.due} onChange={(e) => set("due", e.target.value)} /></Field>
        <Field label="Paid from">
          <select value={p.method} onChange={(e) => set("method", e.target.value)}>
            {data.settings.money_sources.map((s) => <option key={s.name}>{s.name}</option>)}
            <option>Venmo/Zelle</option>
          </select>
        </Field>
        <Field label="Project">
          <select value={split ? "__split" : owner} onChange={(e) => { if (e.target.value === "__split") setSplit(true); else { setSplit(false); set("project_alloc", single(e.target.value)); set("budget_line", ""); } }}>
            {data.projects.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            <option value="__split">Split between projects…</option>
          </select>
        </Field>
        <Field label="Budget line">
          <select value={p.budget_line} onChange={(e) => set("budget_line", e.target.value)}>
            <option value="">None</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.line_item} ({l.category})</option>)}
          </select>
        </Field>
        {!p.budget_line && (
          <Field label="Category">
            <select value={p.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Choose…</option>
              {data.settings.expense_categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        {split && <div className="wide"><SplitEditor alloc={p.project_alloc} onChange={(a) => set("project_alloc", a)} /></div>}
        <Field label="Notes" wide><input value={p.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}
