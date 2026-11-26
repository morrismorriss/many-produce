// Reports: fiscal sponsor / funder reports, house reports, venue settlement
// and daily reports. All plain math over the vault's data.
import { expenseActuals } from "./budget";
import { parseFrontmatter, stringifyFrontmatter, toCSV } from "./files";
import { minutes } from "./schedule";
import {
  REPORT_SECTIONS,
  type BudgetLine,
  type DailyReport,
  type HouseReport,
  type LedgerEntry,
  type Payment,
  type Person,
  type Project,
  type ReportSection,
  type ReportSettings,
  type SavedReport,
  type TicketLine,
  type ScheduleEvent,
  type Sponsor,
  type Venue,
  type VenueDeal,
} from "./types";
import { fmtDate, round2, slugify } from "./util";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const n0 = (v: unknown) => Number(v) || 0;

// =====================================================================
// Fiscal sponsor / funder report
// =====================================================================

export const SECTION_LABEL: Record<ReportSection, string> = {
  income_by_source: "Income by source",
  expenses_by_category: "Expenses by category",
  budget_vs_actual: "Budget vs. actual",
  restricted_funds: "Restricted funds",
  sponsor_fees: "Sponsor fees",
  producer_notes: "Producer notes",
  receipts_appendix: "Receipts appendix",
};

export function defaultReportSettings(project: string, sponsor: string, from: string, to: string): ReportSettings {
  return { report_for: sponsor, funder_name: "", grant_number: "", projects: project ? [project] : [], from, to, include: [...REPORT_SECTIONS] };
}

export interface ReportRow {
  label: string;
  detail?: string;
  amount: number;
}

export interface RestrictedRow {
  restriction: string;
  received: number;
  spent: number;
  left: number;
}

export interface ReportData {
  title: string;
  sponsorLine: string;
  period: string;
  projects: string[];
  received: number;
  spent: number;
  balance: number;
  incomeBySource: ReportRow[];
  expensesByCategory: ReportRow[];
  budgetVsActual: { label: string; budgeted: number; actual: number }[];
  restricted: RestrictedRow[];
  sponsorFees: number;
  receipts: { date: string; description: string; amount: number; file: string }[];
}

function shareIn(e: LedgerEntry, projects: string[]): number {
  if (!projects.length) return 1;
  return projects.reduce((s, p) => s + (e.project_alloc[p] ?? 0), 0);
}

export function computeReport(
  s: ReportSettings,
  data: { ledger: LedgerEntry[]; projects: Project[]; sponsors: Sponsor[]; budgets: Record<string, BudgetLine[]> },
): ReportData {
  const inRange = (e: LedgerEntry) => (!s.from || e.date >= s.from) && (!s.to || e.date <= s.to);
  const entries = data.ledger.filter((e) => inRange(e) && shareIn(e, s.projects) > 0);
  const amt = (e: LedgerEntry) => round2(e.amount * shareIn(e, s.projects));
  const sponsor = data.sponsors.find((x) => x.slug === s.report_for);
  const projNames = (s.projects.length ? s.projects : data.projects.filter((p) => !p.builtin).map((p) => p.slug)).map((slug) => data.projects.find((p) => p.slug === slug)?.name ?? slug);

  const group = (list: LedgerEntry[], key: (e: LedgerEntry) => string, detail?: (e: LedgerEntry) => string) => {
    const m = new Map<string, ReportRow>();
    for (const e of list) {
      const k = key(e);
      const row = m.get(k) ?? { label: k, detail: detail?.(e), amount: 0 };
      row.amount = round2(row.amount + amt(e));
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };

  const income = entries.filter((e) => e.kind === "income");
  const expenses = entries.filter((e) => e.kind === "expense");
  const received = round2(income.reduce((x, e) => x + amt(e), 0));
  const spent = round2(expenses.reduce((x, e) => x + amt(e), 0));

  // Budget vs. actual by category (actuals in the period).
  const bva = new Map<string, { label: string; budgeted: number; actual: number }>();
  for (const slug of s.projects.length ? s.projects : data.projects.map((p) => p.slug)) {
    for (const row of expenseActuals(data.budgets[slug] ?? [], expenses, slug)) {
      const cur = bva.get(row.line.category) ?? { label: row.line.category, budgeted: 0, actual: 0 };
      cur.budgeted = round2(cur.budgeted + row.line.amount);
      bva.set(row.line.category, cur);
    }
  }
  for (const e of expenses) {
    const cur = bva.get(e.category) ?? { label: e.category, budgeted: 0, actual: 0 };
    cur.actual = round2(cur.actual + amt(e));
    bva.set(e.category, cur);
  }

  // Restricted funds: restricted gifts vs. expenses marked against the same restriction.
  const rmap = new Map<string, RestrictedRow>();
  const rkey = (e: LedgerEntry) => (e.restricted_to || "").trim();
  for (const e of data.ledger.filter((x) => shareIn(x, s.projects) > 0 && (!s.to || x.date <= s.to))) {
    const k = rkey(e);
    if (!k || (e.kind === "income" && !e.tags.includes("Restricted") && !e.restricted_to)) continue;
    const cur = rmap.get(k.toLowerCase()) ?? { restriction: k, received: 0, spent: 0, left: 0 };
    if (e.kind === "income") cur.received = round2(cur.received + amt(e));
    else cur.spent = round2(cur.spent + amt(e));
    rmap.set(k.toLowerCase(), cur);
  }
  const restricted = [...rmap.values()].filter((r) => r.received > 0).map((r) => ({ ...r, left: round2(r.received - r.spent) }));

  return {
    title: `${sponsor?.name ?? (s.funder_name || "Funder")} report`,
    sponsorLine: sponsor ? `Fiscally sponsored project of ${sponsor.name}` : s.grant_number ? `Grant ${s.grant_number}` : "",
    period: `${s.from ? fmtDate(s.from, true) : "Start"} – ${s.to ? fmtDate(s.to, true) : "today"}`,
    projects: projNames,
    received,
    spent,
    balance: round2(received - spent),
    incomeBySource: group(income, (e) => e.category, (e) => e.source),
    expensesByCategory: group(expenses, (e) => e.category),
    budgetVsActual: [...bva.values()].filter((r) => r.budgeted || r.actual).sort((a, b) => b.budgeted - a.budgeted),
    restricted,
    sponsorFees: round2(expenses.filter((e) => e.category === "Sponsor fees").reduce((x, e) => x + amt(e), 0)),
    receipts: entries.filter((e) => e.receipt).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ date: e.date, description: e.description, amount: amt(e), file: e.receipt })),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The report as a printable page (also the live preview). */
export function reportHtml(r: ReportData, s: ReportSettings, notes: string, preparer: string, money: (n: number) => string, notesHtml: string): string {
  const has = (k: ReportSection) => s.include.includes(k);
  const table = (head: string[], rows: string[][], foot?: string[]) =>
    `<table class="rt"><thead><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="r"' : ""}>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody>${foot ? `<tfoot><tr>${foot.map((c, i) => `<td${i ? ' class="r"' : ""}>${c}</td>`).join("")}</tr></tfoot>` : ""}</table>`;
  const parts = [
    `<header class="rh"><div><h1>${esc(r.title)}</h1><div class="sub">${esc(r.projects.join(", "))} · ${esc(r.period)}</div>${r.sponsorLine ? `<div class="sub">${esc(r.sponsorLine)}</div>` : ""}</div><div class="sub r">Prepared by ${esc(preparer || "the producer")}<br>${fmtDate(new Date().toISOString().slice(0, 10), true)}</div></header>`,
    `<div class="tiles3"><div><span>Received</span><b>${money(r.received)}</b></div><div><span>Spent</span><b>${money(r.spent)}</b></div><div><span>Balance</span><b>${money(r.balance)}</b></div></div>`,
  ];
  if (has("income_by_source")) parts.push(`<h2>Income by source</h2>${table(["Category", "Amount"], r.incomeBySource.map((x) => [`${esc(x.label)}${x.detail ? ` <span class="muted">(${esc(x.detail)})</span>` : ""}`, money(x.amount)]), ["Total", money(r.received)])}`);
  if (has("expenses_by_category")) parts.push(`<h2>Expenses by category</h2>${table(["Category", "Amount"], r.expensesByCategory.map((x) => [esc(x.label), money(x.amount)]), ["Total", money(r.spent)])}`);
  if (has("budget_vs_actual")) parts.push(`<h2>Budget vs. actual</h2>${table(["Category", "Budgeted", "Actual", "Difference"], r.budgetVsActual.map((x) => [esc(x.label), money(x.budgeted), money(x.actual), money(round2(x.budgeted - x.actual))]))}`);
  if (has("restricted_funds")) parts.push(`<h2>Restricted funds</h2>${r.restricted.length ? table(["Restriction", "Received", "Spent", "Left"], r.restricted.map((x) => [esc(x.restriction), money(x.received), money(x.spent), money(x.left)])) : '<p class="muted">No restricted gifts in this period.</p>'}`);
  if (has("sponsor_fees")) parts.push(`<h2>Sponsor fees</h2><p>${money(r.sponsorFees)} in fiscal sponsor fees this period.</p>`);
  if (has("producer_notes") && notes.trim()) parts.push(`<h2>Producer notes</h2><div class="notes">${notesHtml}</div>`);
  if (has("receipts_appendix")) parts.push(`<h2>Receipts</h2>${r.receipts.length ? table(["Date", "Description", "Amount"], r.receipts.map((x) => [fmtDate(x.date, true), esc(x.description), money(x.amount)])) + '<p class="muted">The receipt files are in the receipts appendix PDF.</p>' : '<p class="muted">No receipts attached in this period.</p>'}`);
  return parts.join("\n");
}

export const REPORT_CSS = `
.report { font: 10.5pt/1.5 "Inter", Helvetica, Arial, sans-serif; color: #111; }
.report h1 { font: 700 18pt/1.2 "Space Grotesk", Helvetica, Arial, sans-serif; margin: 0 0 4px; }
.report h2 { font: 700 12pt/1.3 "Space Grotesk", Helvetica, Arial, sans-serif; margin: 18px 0 6px; }
.report .rh { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
.report .sub { color: #555; font-size: 9.5pt; }
.report .tiles3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
.report .tiles3 div { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; }
.report .tiles3 span { display: block; color: #555; font-size: 9pt; }
.report .tiles3 b { font-size: 14pt; }
.report table.rt { width: 100%; border-collapse: collapse; }
.report table.rt th, .report table.rt td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
.report table.rt .r { text-align: right; font-variant-numeric: tabular-nums; }
.report table.rt tfoot td { font-weight: 700; border-bottom: 0; }
.report .muted { color: #666; }
.report .r { text-align: right; }
`;

export function reportMarkdown(r: ReportData, s: ReportSettings, notes: string, money: (n: number) => string): string {
  const L = [`# ${r.title}`, "", `${r.projects.join(", ")} · ${r.period}`, r.sponsorLine, "", `Received ${money(r.received)} · Spent ${money(r.spent)} · Balance ${money(r.balance)}`, ""];
  const has = (k: ReportSection) => s.include.includes(k);
  const tbl = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`, ...rows.map((r2) => `| ${r2.join(" | ")} |`), ""];
  if (has("income_by_source")) L.push("## Income by source", "", ...tbl(["Category", "Amount"], r.incomeBySource.map((x) => [x.label, money(x.amount)])));
  if (has("expenses_by_category")) L.push("## Expenses by category", "", ...tbl(["Category", "Amount"], r.expensesByCategory.map((x) => [x.label, money(x.amount)])));
  if (has("budget_vs_actual")) L.push("## Budget vs. actual", "", ...tbl(["Category", "Budgeted", "Actual"], r.budgetVsActual.map((x) => [x.label, money(x.budgeted), money(x.actual)])));
  if (has("restricted_funds") && r.restricted.length) L.push("## Restricted funds", "", ...tbl(["Restriction", "Received", "Spent", "Left"], r.restricted.map((x) => [x.restriction, money(x.received), money(x.spent), money(x.left)])));
  if (has("sponsor_fees")) L.push("## Sponsor fees", "", money(r.sponsorFees), "");
  if (has("producer_notes") && notes.trim()) L.push("## Producer notes", "", notes.trim(), "");
  if (has("receipts_appendix") && r.receipts.length) L.push("## Receipts", "", ...tbl(["Date", "Description", "Amount", "File"], r.receipts.map((x) => [x.date, x.description, money(x.amount), x.file])));
  return L.join("\n");
}

export function reportCSV(r: ReportData): string {
  const rows: Record<string, unknown>[] = [
    { section: "Summary", label: "Received", amount: r.received },
    { section: "Summary", label: "Spent", amount: r.spent },
    { section: "Summary", label: "Balance", amount: r.balance },
    ...r.incomeBySource.map((x) => ({ section: "Income by source", label: x.label, detail: x.detail ?? "", amount: x.amount })),
    ...r.expensesByCategory.map((x) => ({ section: "Expenses by category", label: x.label, amount: x.amount })),
    ...r.budgetVsActual.map((x) => ({ section: "Budget vs. actual", label: x.label, detail: `budgeted ${x.budgeted}`, amount: x.actual })),
    ...r.restricted.map((x) => ({ section: "Restricted funds", label: x.restriction, detail: `received ${x.received}, spent ${x.spent}`, amount: x.left })),
    { section: "Sponsor fees", label: "Total", amount: r.sponsorFees },
  ];
  return toCSV(["section", "label", "detail", "amount"], rows);
}

const REPORT_KEYS = ["title", "template", "settings", "sent", "snapshot"];

export function savedReportFromMd(path: string, text: string): SavedReport {
  const { data: d, body } = parseFrontmatter<Record<string, unknown>>(text);
  const st = (d.settings ?? {}) as Record<string, unknown>;
  void REPORT_KEYS;
  return {
    path,
    title: str(d.title) || path.split("/").pop()!.replace(/\.md$/, ""),
    template: d.template === true || path.includes("/report-templates/"),
    settings: {
      report_for: str(st.report_for),
      funder_name: str(st.funder_name),
      grant_number: str(st.grant_number),
      projects: Array.isArray(st.projects) ? st.projects.map(String) : [],
      from: str(st.from),
      to: str(st.to),
      include: (Array.isArray(st.include) ? st.include.map(String) : [...REPORT_SECTIONS]).filter((x): x is ReportSection => (REPORT_SECTIONS as readonly string[]).includes(x)),
    },
    sent: str(d.sent),
    snapshot: (d.snapshot as Record<string, unknown>) ?? null,
    notes: body.trim(),
  };
}

export function savedReportToMd(r: SavedReport): string {
  return stringifyFrontmatter({ title: r.title, template: r.template || undefined, settings: r.settings, sent: r.sent || undefined, snapshot: r.snapshot ?? undefined }, r.notes);
}

export function savedReportPath(title: string, date: string, template: boolean): string {
  return template ? `reports/report-templates/${slugify(title)}.md` : `reports/${date}-${slugify(title)}.md`;
}

// =====================================================================
// House reports
// =====================================================================

export function houseFromMd(path: string, text: string): HouseReport {
  const { data: d } = parseFrontmatter<Record<string, unknown>>(text);
  const parts = path.split("/");
  return {
    path,
    project: str(d.project) || parts[1] || "",
    date: str(d.date) || (parts[2] ?? "").replace(/\.md$/, ""),
    venue: str(d.venue),
    call_time: str(d.call_time),
    start_time: str(d.start_time),
    capacity: num(d.capacity),
    tickets: (Array.isArray(d.tickets) ? d.tickets : []).map((t: Record<string, unknown>) => ({ type: str(t.type), sold: n0(t.sold), price: n0(t.price) })),
    comps: (Array.isArray(d.comps) ? d.comps : []).map((c: Record<string, unknown>) => ({ who: str(c.who), why: str(c.why) })),
    walkups: n0(d.walkups),
    no_shows: n0(d.no_shows),
    attendance: num(d.attendance),
    gross: num(d.gross),
    platform_fees: n0(d.platform_fees),
    bar_sales: num(d.bar_sales),
    foh_notes: str(d.foh_notes),
    incidents: str(d.incidents),
    venue_notes: str(d.venue_notes),
  };
}

export function houseToMd(h: HouseReport): string {
  const { path, foh_notes, ...data } = h;
  void path;
  const c = houseCalc(h);
  return stringifyFrontmatter({ ...data, foh_notes }, `House report for ${h.date}. Attendance ${c.attendance}${h.capacity ? ` of ${h.capacity}` : ""}, gross ${c.gross.toFixed(2)}, net ${c.net.toFixed(2)}.`);
}

export function houseCalc(h: HouseReport) {
  const sold = h.tickets.reduce((s, t) => s + t.sold, 0);
  const ticketGross = round2(h.tickets.reduce((s, t) => s + t.sold * t.price, 0));
  const gross = h.gross ?? ticketGross;
  const attendance = h.attendance ?? Math.max(0, sold + h.comps.length - h.no_shows);
  return {
    sold,
    comps: h.comps.length,
    attendance,
    gross: round2(gross),
    net: round2(gross - h.platform_fees),
    pctCapacity: h.capacity ? Math.round((attendance / h.capacity) * 100) : null,
    avgPrice: sold ? round2(gross / sold) : 0,
  };
}

export interface RunSummary {
  nights: number;
  attendance: number;
  capacity: number;
  pctCapacity: number | null;
  gross: number;
  net: number;
  avgPrice: number;
  byType: { type: string; sold: number; revenue: number }[];
  best?: { date: string; attendance: number };
  worst?: { date: string; attendance: number };
  perNight: { date: string; attendance: number; capacity: number; gross: number }[];
}

export function runSummary(reports: HouseReport[]): RunSummary {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const per = sorted.map((h) => ({ h, c: houseCalc(h) }));
  const byType = new Map<string, { type: string; sold: number; revenue: number }>();
  for (const { h } of per) for (const t of h.tickets) {
    const cur = byType.get(t.type) ?? { type: t.type, sold: 0, revenue: 0 };
    cur.sold += t.sold;
    cur.revenue = round2(cur.revenue + t.sold * t.price);
    byType.set(t.type, cur);
  }
  const attendance = per.reduce((s, x) => s + x.c.attendance, 0);
  const capacity = per.reduce((s, x) => s + (x.h.capacity ?? 0), 0);
  const sold = per.reduce((s, x) => s + x.c.sold, 0);
  const gross = round2(per.reduce((s, x) => s + x.c.gross, 0));
  const ranked = [...per].sort((a, b) => b.c.attendance - a.c.attendance);
  return {
    nights: per.length,
    attendance,
    capacity,
    pctCapacity: capacity ? Math.round((attendance / capacity) * 100) : null,
    gross,
    net: round2(per.reduce((s, x) => s + x.c.net, 0)),
    avgPrice: sold ? round2(gross / sold) : 0,
    byType: [...byType.values()].sort((a, b) => b.revenue - a.revenue),
    best: ranked[0] && { date: ranked[0].h.date, attendance: ranked[0].c.attendance },
    worst: ranked.length > 1 ? { date: ranked[ranked.length - 1].h.date, attendance: ranked[ranked.length - 1].c.attendance } : undefined,
    perNight: per.map(({ h, c }) => ({ date: h.date, attendance: c.attendance, capacity: h.capacity ?? 0, gross: c.gross })),
  };
}

/** Performances that have happened with no house report yet. */
export function missingHouseReports(events: ScheduleEvent[], reports: HouseReport[], today: string, project?: string): ScheduleEvent[] {
  return events.filter((e) => e.type === "Performance" && e.date < today && (!project || e.project === project) && !reports.some((r) => r.project === e.project && r.date === e.date));
}

/**
 * Tickets from a ticketing platform export. The user picks which columns hold
 * the ticket type, quantity (blank = one ticket per row) and price or amount.
 */
export function ticketsFromRows(rows: Record<string, string>[], map: { type: string; quantity: string; amount: string; amountIsTotal: boolean; date?: string; dateValue?: string }): TicketLine[] {
  const m = new Map<string, { sold: number; revenue: number }>();
  for (const r of rows) {
    if (map.date && map.dateValue && !(r[map.date] ?? "").includes(map.dateValue)) continue;
    const type = (r[map.type] ?? "").trim() || "General";
    const q = map.quantity ? Number(String(r[map.quantity]).replace(/[^0-9.]/g, "")) || 0 : 1;
    const a = Number(String(r[map.amount] ?? "").replace(/[^0-9.\-]/g, "")) || 0;
    const cur = m.get(type) ?? { sold: 0, revenue: 0 };
    cur.sold += q;
    cur.revenue += map.amountIsTotal ? a : a * q;
    m.set(type, cur);
  }
  return [...m].map(([type, v]) => ({ type, sold: v.sold, price: v.sold ? round2(v.revenue / v.sold) : 0 }));
}

export function houseCSV(reports: HouseReport[]): string {
  return toCSV(
    ["date", "project", "capacity", "sold", "comps", "attendance", "gross", "platform_fees", "net", "bar_sales"],
    [...reports].sort((a, b) => a.date.localeCompare(b.date)).map((h) => {
      const c = houseCalc(h);
      return { date: h.date, project: h.project, capacity: h.capacity ?? "", sold: c.sold, comps: c.comps, attendance: c.attendance, gross: c.gross, platform_fees: h.platform_fees, net: c.net, bar_sales: h.bar_sales ?? "" };
    }),
  );
}

// =====================================================================
// Venue settlement
// =====================================================================

export const BLANK_DEAL: VenueDeal = { basis: "run", flat_rental: 0, door_split: 0, guarantee: 0, versus: false, bar_minimum: 0, venue_collects_box_office: false, fees: [] };

export interface Settlement {
  nights: number;
  gross: number;
  bar: number;
  lines: { label: string; amount: number }[]; // what the venue is due
  venueDue: number;
  depositsPaid: number;
  boxOfficeHeldByVenue: number;
  /** Positive: the producer owes the venue. Negative: the venue owes the producer. */
  balance: number;
}

export function settle(deal: VenueDeal, reports: HouseReport[], depositsPaid: number, fmt: (n: number) => string = (n) => n.toFixed(2)): Settlement {
  const nights = reports.length;
  const k = deal.basis === "night" ? nights : nights ? 1 : 0;
  const gross = round2(reports.reduce((s, h) => s + houseCalc(h).gross, 0));
  const bar = round2(reports.reduce((s, h) => s + (h.bar_sales ?? 0), 0));
  const lines: { label: string; amount: number }[] = [];
  if (deal.flat_rental) lines.push({ label: `Rental${deal.basis === "night" ? ` (${nights} × ${fmt(deal.flat_rental)})` : ""}`, amount: round2(deal.flat_rental * k) });
  const split = round2(gross * deal.door_split);
  const guarantee = round2(deal.guarantee * k);
  if (deal.versus) {
    lines.push(split >= guarantee ? { label: `Door split ${Math.round(deal.door_split * 100)}% (higher than the ${fmt(guarantee)} guarantee)`, amount: split } : { label: `Guarantee (higher than the ${Math.round(deal.door_split * 100)}% door split of ${fmt(split)})`, amount: guarantee });
  } else {
    if (deal.door_split) lines.push({ label: `Door split ${Math.round(deal.door_split * 100)}% of ${fmt(gross)}`, amount: split });
    if (deal.guarantee) lines.push({ label: "Guarantee", amount: guarantee });
  }
  if (deal.bar_minimum) {
    const min = round2(deal.bar_minimum * k);
    const short = round2(Math.max(0, min - bar));
    if (short) lines.push({ label: `Bar minimum shortfall (${fmt(bar)} of ${fmt(min)})`, amount: short });
  }
  for (const f of deal.fees) if (f.amount) lines.push({ label: `${f.label || "Fee"}${deal.basis === "night" && nights > 1 ? ` (${nights} × ${fmt(f.amount)})` : ""}`, amount: round2(f.amount * k) });
  const venueDue = round2(lines.reduce((s, l) => s + l.amount, 0));
  const held = deal.venue_collects_box_office ? gross : 0;
  return { nights, gross, bar, lines, venueDue, depositsPaid: round2(depositsPaid), boxOfficeHeldByVenue: held, balance: round2(venueDue - depositsPaid - held) };
}

export function dealFrom(v: Venue): VenueDeal {
  return { ...BLANK_DEAL, ...(v.deal ?? {}) };
}

/** Deposits already paid to a venue: paid payments to it for the project. */
export function depositsPaidTo(v: Venue, payments: Payment[], project: string): number {
  return round2(payments.filter((p) => p.status === "paid" && p.payee.trim().toLowerCase() === v.name.trim().toLowerCase() && (p.project_alloc[project] ?? 0) > 0).reduce((s, p) => s + p.amount, 0));
}

export function settlementHtml(venue: string, project: string, period: string, s: Settlement, money: (n: number) => string): string {
  const row = (l: string, a: string, b = false) => `<tr${b ? ' style="font-weight:700"' : ""}><td>${esc(l)}</td><td class="r">${a}</td></tr>`;
  return `<div class="report">
<header class="rh"><div><h1>Settlement: ${esc(venue)}</h1><div class="sub">${esc(project)} · ${esc(period)} · ${s.nights} performance${s.nights === 1 ? "" : "s"}</div></div></header>
<table class="rt"><tbody>
${row("Box office (gross)", money(s.gross))}
${s.bar ? row("Bar sales", money(s.bar)) : ""}
${s.lines.map((l) => row(l.label, money(l.amount))).join("\n")}
${row("Due to the venue", money(s.venueDue), true)}
${s.depositsPaid ? row("Deposits already paid", `−${money(s.depositsPaid)}`) : ""}
${s.boxOfficeHeldByVenue ? row("Box office held by the venue", `−${money(s.boxOfficeHeldByVenue)}`) : ""}
${row(s.balance >= 0 ? "Producer owes the venue" : "Venue owes the producer", money(Math.abs(s.balance)), true)}
</tbody></table>
<p style="margin-top:40px">______________________________ For the venue &nbsp;&nbsp; Date ________</p>
<p style="margin-top:28px">______________________________ For the producer &nbsp;&nbsp; Date ________</p>
</div>`;
}

// =====================================================================
// Daily reports
// =====================================================================

export const DAILY_DEPTS = ["Lighting", "Sound", "Costumes", "Props", "Set", "Camera", "Stage management"];

export function dailyFromMd(path: string, text: string): DailyReport {
  const { data: d } = parseFrontmatter<Record<string, unknown>>(text);
  const parts = path.split("/");
  return {
    path,
    project: str(d.project) || parts[1] || "",
    date: str(d.date) || (parts[2] ?? "").replace(/\.md$/, ""),
    kind: str(d.kind) || "Rehearsal",
    location: str(d.location),
    planned_end: str(d.planned_end),
    first_start: str(d.first_start),
    meal_start: str(d.meal_start),
    meal_end: str(d.meal_end),
    wrap: str(d.wrap),
    calls: (Array.isArray(d.calls) ? d.calls : []).map((c: Record<string, unknown>) => ({ person: str(c.person), call: str(c.call), in: str(c.in), out: str(c.out), late: c.late === true, absent: c.absent === true })),
    scenes: (Array.isArray(d.scenes) ? d.scenes : []).map((c: Record<string, unknown>) => ({ scene: str(c.scene), planned_pages: n0(c.planned_pages), shot_pages: n0(c.shot_pages), status: (["Done", "Partly done", "Moved", "Planned"].includes(str(c.status)) ? str(c.status) : "Planned") as DailyReport["scenes"][number]["status"] })),
    setups: num(d.setups),
    takes: num(d.takes),
    used_items: Array.isArray(d.used_items) ? d.used_items.map(String) : [],
    injuries: str(d.injuries),
    damage: str(d.damage),
    dept_notes: (d.dept_notes && typeof d.dept_notes === "object" ? Object.fromEntries(Object.entries(d.dept_notes as Record<string, unknown>).map(([k, v]) => [k, str(v)])) : {}) as Record<string, string>,
    tomorrow: str(d.tomorrow),
    followups_done: d.followups_done === true,
  };
}

export function dailyToMd(r: DailyReport, people: Person[]): string {
  const { path, ...data } = r;
  void path;
  return stringifyFrontmatter(data, dailyText(r, people, "", ""));
}

/** A new daily report, started from the Schedule for that date. */
export function dailyFromSchedule(project: string, date: string, events: ScheduleEvent[], sceneNumber: (id: string) => string, location: (loc: string) => string): DailyReport {
  const day = events.filter((e) => e.project === project && e.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const calls = new Map<string, string>();
  for (const e of day) for (const p of e.called) if (!calls.has(p) || e.start < calls.get(p)!) calls.set(p, e.start);
  const types = day.map((e) => e.type);
  return {
    path: `daily-reports/${project}/${date}.md`,
    project,
    date,
    kind: types.includes("Photo / video shoot") ? "Shoot day" : types.includes("Tech") ? "Tech" : types.includes("Rehearsal") ? "Rehearsal" : day[0]?.type ?? "Work day",
    location: day[0]?.location ? location(day[0].location) : "",
    planned_end: day.map((e) => e.end).filter(Boolean).sort().reverse()[0] ?? "",
    first_start: "",
    meal_start: "",
    meal_end: "",
    wrap: "",
    calls: [...calls].map(([person, call]) => ({ person, call, in: call, out: "", late: false, absent: false })),
    scenes: [...new Set(day.flatMap((e) => e.scenes))].map((id) => ({ scene: sceneNumber(id), planned_pages: 0, shot_pages: 0, status: "Planned" as const })),
    setups: null,
    takes: null,
    used_items: [],
    injuries: "",
    damage: "",
    dept_notes: {},
    tomorrow: "",
    followups_done: false,
  };
}

/** Hours worked: out − in, minus the meal break when it falls inside. */
export function hoursFor(c: { in: string; out: string; absent: boolean }, mealStart: string, mealEnd: string): number {
  if (c.absent) return 0;
  const a = minutes(c.in), b = minutes(c.out);
  if (a === null || b === null) return 0;
  let m = (b - a + 1440) % 1440;
  const ms = minutes(mealStart), me = minutes(mealEnd);
  if (ms !== null && me !== null && ms >= a && me <= (b < a ? b + 1440 : b)) m -= me - ms;
  return round2(Math.max(0, m) / 60);
}

export function dailyCalc(r: DailyReport) {
  const hours = Object.fromEntries(r.calls.map((c) => [c.person, hoursFor(c, r.meal_start, r.meal_end)]));
  const planned = r.scenes.reduce((s, x) => s + x.planned_pages, 0);
  const shot = r.scenes.reduce((s, x) => s + x.shot_pages, 0);
  const pe = minutes(r.planned_end), w = minutes(r.wrap);
  const overBy = pe !== null && w !== null && w > pe ? w - pe : 0;
  return { hours, plannedPages: planned, shotPages: shot, overMinutes: overBy, moved: r.scenes.filter((s) => s.status === "Moved").map((s) => s.scene) };
}

/** Eighths of a page as "2 3/8". */
export function eighths(n: number): string {
  const whole = Math.floor(n / 8), rest = n % 8;
  return whole && rest ? `${whole} ${rest}/8` : whole ? String(whole) : rest ? `${rest}/8` : "0";
}

export function dailyText(r: DailyReport, people: Person[], projectName: string, money: string): string {
  void money;
  const c = dailyCalc(r);
  const name = (s: string) => people.find((p) => p.slug === s)?.name ?? s;
  const L = [`Daily report · ${projectName ? `${projectName} · ` : ""}${r.kind} · ${fmtDate(r.date, true)}`, r.location ? `Location: ${r.location}` : "", ""];
  L.push(`Start ${r.first_start || "—"} · Meal ${r.meal_start || "—"}–${r.meal_end || "—"} · Wrap ${r.wrap || "—"}${r.planned_end ? ` (planned ${r.planned_end})` : ""}${c.overMinutes ? ` · OVER by ${c.overMinutes} min` : ""}`, "");
  if (r.calls.length) {
    L.push("CALLED");
    for (const x of r.calls) L.push(`  ${name(x.person)}: call ${x.call || "—"}, in ${x.absent ? "ABSENT" : x.in || "—"}, out ${x.out || "—"}${x.late ? " (late)" : ""} · ${c.hours[x.person] ?? 0} h`);
    L.push("");
  }
  if (r.scenes.length) {
    L.push(`SCENES (pages ${eighths(c.shotPages)} of ${eighths(c.plannedPages)} planned)`);
    for (const s of r.scenes) L.push(`  ${s.scene}: ${s.status}${s.planned_pages ? ` · ${eighths(s.shot_pages)}/${eighths(s.planned_pages)} pages` : ""}`);
    L.push("");
  }
  if (r.setups !== null || r.takes !== null) L.push(`Setups ${r.setups ?? "—"} · Takes ${r.takes ?? "—"}`, "");
  if (r.injuries) L.push(`INJURIES / INCIDENTS: ${r.injuries}`);
  if (r.damage) L.push(`DAMAGE: ${r.damage}`);
  const notes = Object.entries(r.dept_notes).filter(([, v]) => v.trim());
  if (notes.length) { L.push("", "NOTES BY DEPARTMENT"); for (const [k, v] of notes) L.push(`  ${k}: ${v}`); }
  if (r.tomorrow) L.push("", `FOR TOMORROW: ${r.tomorrow}`);
  return L.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim() + "\n";
}

export function dailyRunSummary(reports: DailyReport[]) {
  let hours = 0, shot = 0, planned = 0, daysOver = 0, incidents = 0;
  for (const r of reports) {
    const c = dailyCalc(r);
    hours += Object.values(c.hours).reduce((s, h) => s + h, 0);
    shot += c.shotPages;
    planned += c.plannedPages;
    if (c.overMinutes) daysOver++;
    if (r.injuries.trim() || r.damage.trim()) incidents++;
  }
  return { days: reports.length, hours: round2(hours), shotPages: shot, plannedPages: planned, daysOver, incidents };
}

/** Work days (from the Schedule) with no daily report. */
export function missingDailyReports(events: ScheduleEvent[], reports: DailyReport[], today: string, project?: string): string[] {
  // Only the last two weeks, so an old production doesn't flood the list.
  const since = new Date(today); since.setDate(since.getDate() - 14);
  const from = since.toISOString().slice(0, 10);
  const days = new Set(events.filter((e) => ["Rehearsal", "Tech", "Dress", "Photo / video shoot"].includes(e.type) && e.date < today && e.date >= from && (!project || e.project === project)).map((e) => `${e.project}|${e.date}`));
  return [...days].filter((k) => !reports.some((r) => `${r.project}|${r.date}` === k));
}
