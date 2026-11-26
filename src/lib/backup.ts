// Backup (zip the whole vault) and "export everything to CSV".
import { strToU8 } from "fflate";
import type { VaultFS } from "./fs";
import { toCSV } from "./files";
import { ledgerToCSV } from "./ledger";
import { houseCalc } from "./reports";
import { anchorsFor, resolveDue } from "./timeline";
import type { LedgerEntry, VaultData } from "./types";
import { formatAlloc, parseAlloc, round2, uid } from "./util";

/** Every file in the vault (except the trash), as bytes for a zip. */
export async function collectVault(fs: VaultFS): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const walk = async (dir: string) => {
    for (const e of await fs.list(dir)) {
      const path = dir ? `${dir}/${e.name}` : e.name;
      if (path === ".manyproduce/trash" || path.endsWith(".mp-tmp")) continue;
      if (e.is_dir) await walk(path);
      else if (fs.readBase64) {
        const b64 = await fs.readBase64(path);
        if (b64 !== null) out[path] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } else {
        const t = await fs.read(path);
        if (t !== null) out[path] = strToU8(t);
      }
    }
  };
  await walk("");
  return out;
}

/** One CSV per kind of record, for spreadsheets or another app. */
export function exportAllCSV(data: VaultData): Record<string, string> {
  const proj = (slug: string) => data.projects.find((p) => p.slug === slug)?.name ?? slug;
  const files: Record<string, string> = {};
  files["ledger.csv"] = ledgerToCSV(data.ledger);
  files["budget.csv"] = toCSV(["project", "category", "type", "line_item", "quantity", "rate", "amount", "notes"], Object.entries(data.budgets).flatMap(([slug, lines]) => lines.map((l) => ({ ...l, project: proj(slug) }))));
  files["payments.csv"] = toCSV(["project", "title", "payee", "amount", "due", "status", "paid_date", "method", "category"], Object.values(data.payments).flat().map((p) => ({ ...p, project: formatAlloc(p.project_alloc) })));
  files["collaborators.csv"] = toCSV(["name", "roles", "projects", "email", "phone", "city", "rate", "rate_type", "status", "pronouns", "w9_on_file"], data.people.map((p) => ({ ...p, roles: p.roles.join("; "), projects: p.projects.map(proj).join("; "), w9_on_file: p.w9_on_file ? "yes" : "no" })));
  files["venues.csv"] = toCSV(["name", "type", "city", "capacity", "rate", "status", "projects", "contact", "next_step"], data.venues.map((v) => ({ ...v, projects: v.projects.map(proj).join("; ") })));
  files["paperwork.csv"] = toCSV(["title", "type", "project", "status", "sent", "signed", "expires", "amount", "folder"], data.docs.map((d) => ({ ...d, project: proj(d.project), folder: d.path })));
  files["schedule.csv"] = toCSV(["project", "date", "start", "end", "type", "title", "location", "called"], data.events.map((e) => ({ ...e, project: proj(e.project), called: e.called.join("; ") })));
  files["timeline.csv"] = toCSV(["project", "title", "due", "status", "owner", "department"], data.projects.flatMap((p) => { const a = anchorsFor(p, data.events); return (data.timelines[p.slug] ?? []).map((t) => ({ ...t, project: p.name, due: resolveDue(t, a) })); }));
  files["shopping.csv"] = toCSV(["project", "item", "where", "department", "buyer", "need_by", "est_cost", "actual_cost", "money", "status"], Object.values(data.shopping).flat().map((i) => ({ ...i, project: proj(i.project) })));
  files["equipment.csv"] = toCSV(["name", "category", "owner", "project", "serial", "value", "rental_house", "rental_end"], data.inventory.map((i) => ({ ...i, project: proj(i.project) })));
  files["campaigns.csv"] = toCSV(["title", "type", "project", "channel", "status", "date", "goal", "result_amount", "result_notes"], data.campaigns.map((c) => ({ ...c, project: proj(c.project) })));
  files["house-reports.csv"] = toCSV(["project", "date", "attendance", "capacity", "gross", "net"], data.houseReports.map((h) => { const c = houseCalc(h); return { project: proj(h.project), date: h.date, attendance: c.attendance, capacity: h.capacity ?? "", gross: c.gross, net: c.net }; }));
  files["clearances.csv"] = toCSV(["project", "item", "type", "status", "owner", "scope", "fee"], Object.values(data.clearances).flat().map((c) => ({ ...c, project: proj(c.project), scope: c.scope.join("; ") })));
  return files;
}

// ---- ledger CSV import (bank or card statement, a spreadsheet, another app) ----

export interface LedgerMapping {
  date: string;
  description: string;
  amount: string; // one signed column, or…
  moneyIn: string; // …separate in / out columns
  moneyOut: string;
  category: string;
  negativeIs: "expense" | "income";
}

export function guessMapping(columns: string[]): LedgerMapping {
  const find = (re: RegExp) => columns.find((c) => re.test(c)) ?? "";
  return {
    date: find(/date|posted|when/i),
    description: find(/desc|memo|payee|name|details|narrative/i),
    amount: find(/^amount$|^amt$|^value$|^total$/i),
    moneyIn: find(/credit|deposit|money in|^in$/i),
    moneyOut: find(/debit|withdrawal|money out|^out$/i),
    category: find(/category/i),
    negativeIs: "expense",
  };
}

const num = (s: string | undefined) => {
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith("-");
  const n = Number(s.replace(/[^0-9.]/g, "")) || 0;
  return neg ? -n : n;
};

function normDate(s: string): string {
  const t = s.trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t))) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Rows → ledger entries for one project and money source. Entries already in
 * the ledger (same date, amount and description) are skipped.
 */
export function ledgerFromRows(rows: Record<string, string>[], m: LedgerMapping, project: string, source: string, existing: LedgerEntry[]): { entries: LedgerEntry[]; skipped: number; bad: number } {
  const entries: LedgerEntry[] = [];
  let skipped = 0, bad = 0;
  const seen = new Set(existing.map((e) => `${e.date}|${e.amount.toFixed(2)}|${e.description.trim().toLowerCase()}`));
  for (const r of rows) {
    const date = normDate(r[m.date] ?? "");
    let signed = m.amount ? num(r[m.amount]) : num(r[m.moneyIn]) - Math.abs(num(r[m.moneyOut]));
    if (m.amount && m.negativeIs === "income") signed = -signed;
    if (!date || !signed) { bad++; continue; }
    const kind = signed < 0 ? "expense" : "income";
    const amount = round2(Math.abs(signed));
    const description = (r[m.description] ?? "").trim();
    const key = `${date}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    entries.push({
      id: uid("e"), date, kind, amount, description, project_alloc: parseAlloc(project), category: (m.category && r[m.category]) || "Other",
      source, counterparty: "", tags: [], receipt: "", restricted_to: "", linked_payment: "", linked_shopping_item: "", notes: "Imported",
    });
  }
  return { entries, skipped, bad };
}

