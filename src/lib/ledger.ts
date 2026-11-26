import { parseCSV, toCSV } from "./files";
import {
  AUTO_FEE_PREFIX,
  DIRECT_SOURCE,
  FISCAL_TAG,
  type LedgerEntry,
  type Project,
  type Sponsor,
} from "./types";
import { allocTouches, formatAlloc, parseAlloc, round2, shareOf } from "./util";

export const LEDGER_COLUMNS = [
  "id", "date", "kind", "amount", "description", "project_alloc", "category", "source",
  "counterparty", "tags", "receipt", "restricted_to", "linked_payment", "linked_shopping_item", "notes",
] as const;

export function ledgerFromCSV(text: string): LedgerEntry[] {
  return parseCSV(text).map((r) => ({
    id: r.id,
    date: r.date,
    kind: r.kind === "income" ? "income" : "expense",
    amount: Number(r.amount) || 0,
    description: r.description ?? "",
    project_alloc: parseAlloc(r.project_alloc),
    category: r.category ?? "",
    source: r.source ?? "",
    counterparty: r.counterparty ?? "",
    tags: (r.tags ?? "").split(";").map((t) => t.trim()).filter(Boolean),
    receipt: r.receipt ?? "",
    restricted_to: r.restricted_to ?? "",
    linked_payment: r.linked_payment ?? "",
    linked_shopping_item: r.linked_shopping_item ?? "",
    notes: r.notes ?? "",
  }));
}

export function ledgerToCSV(entries: LedgerEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((e) => ({ ...e, amount: e.amount.toFixed(2), project_alloc: formatAlloc(e.project_alloc), tags: e.tags.join(";") }));
  return toCSV(LEDGER_COLUMNS, rows);
}

/** Group entries by the year file they belong in (ledger/YYYY.csv). */
export function byYear(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const m = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const y = (e.date || "").slice(0, 4) || "undated";
    if (!m.has(y)) m.set(y, []);
    m.get(y)!.push(e);
  }
  return m;
}

/** Signed amount for a project filter ("" = all projects). */
export function signedShare(e: LedgerEntry, project?: string): number {
  const v = e.amount * shareOf(e.project_alloc, project);
  return e.kind === "income" ? v : -v;
}

export interface LedgerTotals {
  moneyIn: number;
  moneyOut: number;
  net: number;
  sponsorFees: number;
}

export function totals(entries: LedgerEntry[], project?: string): LedgerTotals {
  let moneyIn = 0, moneyOut = 0, sponsorFees = 0;
  for (const e of entries) {
    if (!allocTouches(e.project_alloc, project)) continue;
    const v = e.amount * shareOf(e.project_alloc, project);
    if (e.kind === "income") moneyIn += v;
    else {
      moneyOut += v;
      if (e.category === "Sponsor fees") sponsorFees += v;
    }
  }
  return { moneyIn: round2(moneyIn), moneyOut: round2(moneyOut), net: round2(moneyIn - moneyOut), sponsorFees: round2(sponsorFees) };
}

// ---- fiscal sponsor fees ----

export function isAutoFee(e: LedgerEntry): boolean {
  return e.notes.startsWith(AUTO_FEE_PREFIX);
}

export function autoFeeFor(e: LedgerEntry): string | null {
  return isAutoFee(e) ? e.notes.slice(AUTO_FEE_PREFIX.length).split(/\s/)[0] : null;
}

/** Fee rate for a project: the project's override, else its sponsor's rate. */
export function projectFeeRate(p: Project | undefined, sponsors: Sponsor[]): { rate: number; sponsor?: Sponsor } {
  if (!p || !p.fiscal_sponsor) return { rate: 0 };
  const s = sponsors.find((x) => x.slug === p.fiscal_sponsor);
  const rate = p.sponsor_fee_rate ?? s?.fee_rate ?? 0;
  return { rate, sponsor: s };
}

/**
 * The fee expense that should accompany an income entry, or null.
 * For split income, each project's share is charged at that project's rate;
 * the fee entry carries the same allocation weighted by fee.
 */
export function sponsorFeeEntry(
  income: LedgerEntry,
  projects: Project[],
  sponsors: Sponsor[],
  existingId?: string,
): LedgerEntry | null {
  if (income.kind !== "income" || !income.tags.includes(FISCAL_TAG)) return null;
  let fee = 0;
  const parts: Record<string, number> = {};
  const names = new Set<string>();
  const rates = new Set<number>();
  for (const [slug, share] of Object.entries(income.project_alloc)) {
    const { rate, sponsor } = projectFeeRate(projects.find((p) => p.slug === slug), sponsors);
    if (!rate) continue;
    const part = income.amount * share * rate;
    parts[slug] = part;
    fee += part;
    if (sponsor) names.add(sponsor.name);
    rates.add(rate);
  }
  fee = round2(fee);
  if (fee <= 0) return null;
  const alloc: Record<string, number> = {};
  for (const [k, v] of Object.entries(parts)) alloc[k] = v / fee;
  const sponsorName = [...names].join(" / ") || "Fiscal sponsor";
  const rateLabel = rates.size === 1 ? ` (${+([...rates][0] * 100).toFixed(2)}%)` : "";
  return {
    id: existingId ?? `${income.id}-fee`,
    date: income.date,
    kind: "expense",
    amount: fee,
    description: `${sponsorName} fee${rateLabel} on ${income.description || "income"}`,
    project_alloc: alloc,
    category: "Sponsor fees",
    source: income.source,
    counterparty: sponsorName,
    tags: [FISCAL_TAG],
    receipt: "",
    restricted_to: "",
    linked_payment: "",
    linked_shopping_item: "",
    notes: `${AUTO_FEE_PREFIX}${income.id}`,
  };
}

/**
 * Insert or update an entry, keeping its automatic sponsor fee in step.
 * Returns the new full ledger.
 */
export function upsertWithFees(
  ledger: LedgerEntry[],
  entry: LedgerEntry,
  projects: Project[],
  sponsors: Sponsor[],
): LedgerEntry[] {
  const existingFee = ledger.find((e) => autoFeeFor(e) === entry.id);
  let next = ledger.filter((e) => e.id !== entry.id && autoFeeFor(e) !== entry.id);
  next.push(entry);
  const fee = sponsorFeeEntry(entry, projects, sponsors, existingFee?.id);
  if (fee) next.push(fee);
  return next;
}

export function removeWithFees(ledger: LedgerEntry[], id: string): { next: LedgerEntry[]; removed: LedgerEntry[] } {
  const removed = ledger.filter((e) => e.id === id || autoFeeFor(e) === id);
  return { next: ledger.filter((e) => !removed.includes(e)), removed };
}

/** The gentle note for ticket sales routed through a sponsor. */
export function earnedIncomeNote(e: Pick<LedgerEntry, "kind" | "category" | "tags">): string | null {
  if (e.kind === "income" && e.category === "Ticket sales" && e.tags.includes(FISCAL_TAG)) {
    return `Ticket sales are earned income. Fiscal sponsors usually only handle contributed income (donations, grants), so these normally go to "${DIRECT_SOURCE}". Check with your sponsor.`;
  }
  return null;
}

/** Current balance of every money source: opening balance + ledger since opening date. */
export function sourceBalances(
  ledger: LedgerEntry[],
  sources: { name: string; opening_balance: number; opening_date: string }[],
  asOf: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sources) out[s.name] = s.opening_balance;
  for (const e of ledger) {
    if (e.date > asOf) continue;
    const s = sources.find((x) => x.name === e.source);
    if (!s) continue;
    if (s.opening_date && e.date < s.opening_date) continue;
    out[s.name] += e.kind === "income" ? e.amount : -e.amount;
  }
  for (const k of Object.keys(out)) out[k] = round2(out[k]);
  return out;
}
