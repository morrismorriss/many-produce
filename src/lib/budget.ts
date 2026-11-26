import { parseCSV, toCSV } from "./files";
import type { BudgetLine, LedgerEntry, Payment, Project, Sponsor } from "./types";
import { projectFeeRate } from "./ledger";
import { round2, shareOf } from "./util";

/** First 7 columns match Many Apply's budget builder exactly. */
export const BUDGET_COLUMNS = [
  "category", "type", "line_item", "quantity", "rate", "amount", "notes",
  "id", "expected_date", "confidence", "through_sponsor", "source",
] as const;

export function budgetFromCSV(text: string): BudgetLine[] {
  return parseCSV(text).map((r, i) => {
    const quantity = r.quantity === "" || r.quantity === undefined ? 1 : Number(r.quantity);
    const rate = Number(r.rate) || 0;
    const amount = r.amount !== undefined && r.amount !== "" ? Number(r.amount) : quantity * rate;
    return {
      id: r.id || `b${i + 1}`,
      category: r.category ?? "Other",
      type: (r.type || "expense").toLowerCase() === "income" ? "income" : "expense",
      line_item: r.line_item ?? "",
      quantity,
      rate,
      amount,
      notes: r.notes ?? "",
      expected_date: r.expected_date ?? "",
      confidence: (r.confidence as BudgetLine["confidence"]) ?? "",
      through_sponsor: r.through_sponsor === "yes" || r.through_sponsor === "true",
      source: r.source ?? "",
    };
  });
}

export function budgetToCSV(lines: BudgetLine[]): string {
  return toCSV(
    BUDGET_COLUMNS,
    lines.map((l) => ({ ...l, through_sponsor: l.through_sponsor ? "yes" : "" })),
  );
}

/** Export just Many Apply's 7 columns. */
export function budgetToManyApplyCSV(lines: BudgetLine[]): string {
  return toCSV(BUDGET_COLUMNS.slice(0, 7), lines as unknown as Record<string, unknown>[]);
}

export interface ExpenseRow {
  line: BudgetLine;
  paid: number;
}

/**
 * Actual spend per expense line, pulled from the ledger by category.
 * When a category has several lines, actuals go to lines in order (filling each
 * up to its budget) and any overflow lands on the last one.
 */
export function expenseActuals(lines: BudgetLine[], ledger: LedgerEntry[], project: string): ExpenseRow[] {
  const spentByCat: Record<string, number> = {};
  for (const e of ledger) {
    if (e.kind !== "expense") continue;
    const s = shareOf(e.project_alloc, project);
    if (!s) continue;
    spentByCat[e.category] = (spentByCat[e.category] ?? 0) + e.amount * s;
  }
  const exp = lines.filter((l) => l.type === "expense");
  const rows: ExpenseRow[] = exp.map((line) => ({ line, paid: 0 }));
  const byCat = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    if (!byCat.has(r.line.category)) byCat.set(r.line.category, []);
    byCat.get(r.line.category)!.push(r);
  }
  for (const [cat, rs] of byCat) {
    let left = spentByCat[cat] ?? 0;
    rs.forEach((r, i) => {
      const take = i === rs.length - 1 ? left : Math.min(left, r.line.amount);
      r.paid = round2(take);
      left -= take;
    });
  }
  return rows;
}

export interface IncomeRow {
  line: BudgetLine;
  raised: number; // gross received so far
  goalNet: number; // goal after sponsor fee
  raisedNet: number;
  feeRate: number;
}

/** Income received per income line, matched by category (and source when set). */
export function incomeActuals(
  lines: BudgetLine[],
  ledger: LedgerEntry[],
  project: Project,
  sponsors: Sponsor[],
): IncomeRow[] {
  const { rate } = projectFeeRate(project, sponsors);
  const inc = lines.filter((l) => l.type === "income");
  const pool = ledger
    .filter((e) => e.kind === "income" && shareOf(e.project_alloc, project.slug) > 0)
    .map((e) => ({ e, left: e.amount * shareOf(e.project_alloc, project.slug) }));
  const rows: IncomeRow[] = inc.map((line) => ({ line, raised: 0, goalNet: 0, raisedNet: 0, feeRate: line.through_sponsor ? rate : 0 }));
  // First pass: lines with a source match category+source; second: category only.
  for (const strict of [true, false]) {
    for (const r of rows) {
      if (strict && !r.line.source) continue;
      for (const p of pool) {
        if (p.left <= 0 || p.e.category !== r.line.category) continue;
        if (strict && p.e.source !== r.line.source) continue;
        const room = r.line.amount - r.raised;
        if (room <= 0) break;
        const take = Math.min(room, p.left);
        r.raised += take;
        p.left -= take;
      }
    }
  }
  for (const r of rows) {
    r.raised = round2(r.raised);
    r.goalNet = round2(r.line.amount * (1 - r.feeRate));
    r.raisedNet = round2(r.raised * (1 - r.feeRate));
  }
  return rows;
}

export interface BudgetSummary {
  total: number;
  paid: number;
  stillToPay: number;
  incomeRaised: number;
  incomeProjected: number;
}

export function summarize(exp: ExpenseRow[], inc: IncomeRow[]): BudgetSummary {
  const total = round2(exp.reduce((s, r) => s + r.line.amount, 0));
  const paid = round2(exp.reduce((s, r) => s + r.paid, 0));
  return {
    total,
    paid,
    stillToPay: round2(Math.max(0, total - paid)),
    incomeRaised: round2(inc.reduce((s, r) => s + r.raisedNet, 0)),
    incomeProjected: round2(inc.reduce((s, r) => s + r.goalNet, 0)),
  };
}

/** Budgeted but neither paid nor scheduled as a payment yet. */
export function unscheduledAmount(row: ExpenseRow, payments: Payment[]): number {
  const scheduled = payments
    .filter((p) => p.status === "scheduled" && (p.budget_line === row.line.id || (!p.budget_line && p.category === row.line.category)))
    .reduce((s, p) => s + p.amount, 0);
  return round2(Math.max(0, row.line.amount - row.paid - scheduled));
}
