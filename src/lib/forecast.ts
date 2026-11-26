// Week-by-week cash flow forecast (Dashboard's main chart).
import { expenseActuals, incomeActuals, unscheduledAmount } from "./budget";
import { projectFeeRate, sourceBalances } from "./ledger";
import type { BudgetLine, LedgerEntry, MoneySource, Payment, Project, Sponsor } from "./types";
import { addDays, round2, shareOf, weekStart } from "./util";

export type Scenario = "confirmed" | "likely";

export interface ForecastItem {
  date: string;
  amount: number; // signed
  source: string;
  label: string;
  kind: "payment" | "income";
  ref: { project: string; id: string };
  confidence?: string;
}

export interface ForecastWeek {
  start: string;
  moneyIn: number;
  moneyOut: number;
  balance: number; // total, end of week
  bySource: Record<string, number>; // end of week
  items: ForecastItem[];
  low: LowPoint[];
}

export interface LowPoint {
  week: string;
  source: string; // "" = total
  balance: number;
  message: string;
  causes: ForecastItem[];
}

export interface Unscheduled {
  project: string;
  line: BudgetLine;
  amount: number;
}

export interface Forecast {
  start: Record<string, number>;
  startTotal: number;
  weeks: ForecastWeek[];
  lowPoints: LowPoint[];
  unscheduled: Unscheduled[];
}

export interface ForecastInput {
  today: string;
  weeks: number;
  project?: string; // "" or undefined = all
  scenario: Scenario;
  cushion: number;
  sources: MoneySource[];
  ledger: LedgerEntry[];
  payments: Payment[];
  budgets: Record<string, BudgetLine[]>;
  projects: Project[];
  sponsors: Sponsor[];
  fmt: (n: number) => string;
}

function sponsorFund(project: Project, sources: MoneySource[]): string | undefined {
  return sources.find((s) => s.sponsor && s.sponsor === project.fiscal_sponsor)?.name;
}

export function buildForecast(inp: ForecastInput): Forecast {
  const { today, project } = inp;
  const first = weekStart(today);

  // Starting balances.
  let start: Record<string, number>;
  if (!project) {
    start = sourceBalances(inp.ledger, inp.sources, today);
  } else {
    start = {};
    for (const s of inp.sources) start[s.name] = 0;
    for (const e of inp.ledger) {
      if (e.date > today) continue;
      const share = shareOf(e.project_alloc, project);
      if (!share) continue;
      const v = e.amount * share * (e.kind === "income" ? 1 : -1);
      start[e.source] = (start[e.source] ?? 0) + v;
    }
  }
  for (const k of Object.keys(start)) start[k] = round2(start[k]);

  // Future items.
  const items: ForecastItem[] = [];
  for (const p of inp.payments) {
    if (p.status !== "scheduled") continue;
    const share = shareOf(p.project_alloc, project);
    if (!share) continue;
    items.push({
      date: p.due && p.due >= first ? p.due : first,
      amount: -round2(p.amount * share),
      source: p.method || "Checking",
      label: `${p.title}${p.payee ? ` (${p.payee})` : ""}`,
      kind: "payment",
      ref: { project: Object.keys(p.project_alloc)[0], id: p.id },
    });
  }

  const unscheduled: Unscheduled[] = [];
  for (const proj of inp.projects) {
    if (project && proj.slug !== project) continue;
    const lines = inp.budgets[proj.slug] ?? [];
    const projPayments = inp.payments.filter((p) => shareOf(p.project_alloc, proj.slug) > 0);
    for (const row of expenseActuals(lines, inp.ledger, proj.slug)) {
      const amt = unscheduledAmount(row, projPayments);
      if (amt > 0) unscheduled.push({ project: proj.slug, line: row.line, amount: amt });
    }
    const { rate } = projectFeeRate(proj, inp.sponsors);
    const fund = sponsorFund(proj, inp.sources);
    for (const r of incomeActuals(lines, inp.ledger, proj, inp.sponsors)) {
      const c = r.line.confidence;
      if (!r.line.expected_date || r.line.type === "in-kind") continue; // in-kind never moves cash
      if (!(c === "Confirmed" || (inp.scenario === "likely" && c === "Likely"))) continue;
      const remaining = r.line.amount - r.raised;
      if (remaining <= 0.005) continue;
      const net = round2(remaining * (r.line.through_sponsor ? 1 - rate : 1));
      items.push({
        date: r.line.expected_date >= first ? r.line.expected_date : first,
        amount: net,
        source: r.line.source || (r.line.through_sponsor && fund) || "Checking",
        label: r.line.line_item + (r.line.through_sponsor && rate ? ` (net of ${+(rate * 100).toFixed(2)}% fee)` : ""),
        kind: "income",
        ref: { project: proj.slug, id: r.line.id },
        confidence: c,
      });
    }
  }

  // Bucket into weeks.
  const bal: Record<string, number> = { ...start };
  const weeks: ForecastWeek[] = [];
  const lowPoints: LowPoint[] = [];
  for (let w = 0; w < inp.weeks; w++) {
    const ws = addDays(first, w * 7);
    const we = addDays(ws, 7);
    const wItems = items.filter((i) => i.date >= ws && i.date < we).sort((a, b) => a.date.localeCompare(b.date));
    let mi = 0, mo = 0;
    for (const i of wItems) {
      bal[i.source] = round2((bal[i.source] ?? 0) + i.amount);
      if (i.amount > 0) mi += i.amount;
      else mo -= i.amount;
    }
    const total = round2(Object.values(bal).reduce((a, b) => a + b, 0));
    const week: ForecastWeek = { start: ws, moneyIn: round2(mi), moneyOut: round2(mo), balance: total, bySource: { ...bal }, items: wItems, low: [] };
    for (const [src, b] of Object.entries(bal)) {
      // In a single-project view, only sponsor funds are truly that project's
      // money; a project's "share" of Checking going negative isn't a real problem.
      if (project && !inp.sources.find((s) => s.name === src)?.sponsor) continue;
      if (b < 0 && wItems.some((i) => i.source === src)) {
        const causes = wItems.filter((i) => i.source === src && i.amount < 0);
        const incomeLater = items.find((i) => i.source === src && i.amount > 0 && i.date >= we);
        let msg = `${src} ${inp.fmt(b)}.`;
        if (causes[0] && incomeLater) msg += ` ${causes[0].label} is due before ${incomeLater.label}.`;
        week.low.push({ week: ws, source: src, balance: b, message: msg, causes });
      }
    }
    // The cushion is company-wide; a single project is only flagged below zero.
    const floor = project ? 0 : inp.cushion;
    if (total < floor && !week.low.length) {
      week.low.push({
        week: ws,
        source: "",
        balance: total,
        message: project
          ? `This project's money ${inp.fmt(total)}: it has spent more than it has raised.`
          : `Total balance ${inp.fmt(total)}${inp.cushion ? `, below your ${inp.fmt(inp.cushion)} cushion` : ""}.`,
        causes: wItems.filter((i) => i.amount < 0),
      });
    }
    lowPoints.push(...week.low);
    weeks.push(week);
  }

  return {
    start,
    startTotal: round2(Object.values(start).reduce((a, b) => a + b, 0)),
    weeks,
    lowPoints,
    unscheduled,
  };
}

export function forecastToCSV(f: Forecast): string {
  const srcs = Object.keys(f.start);
  const head = ["week_of", "money_in", "money_out", "balance", ...srcs.map((s) => `balance_${s}`), "items"];
  const rows = f.weeks.map((w) =>
    [w.start, w.moneyIn, w.moneyOut, w.balance, ...srcs.map((s) => w.bySource[s] ?? 0), w.items.map((i) => `${i.label} ${i.amount}`).join(" | ")]
      .map((v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v)))
      .join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}
