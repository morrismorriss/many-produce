import { parseFrontmatter, stringifyFrontmatter } from "./files";
import type { LedgerEntry, Payment } from "./types";
import { addDays, formatAlloc, parseAlloc, round2, safeCurrency, uid } from "./util";

interface PaymentsFile {
  payments?: (Omit<Payment, "project_alloc"> & { project_alloc: string })[];
}

export function paymentsFromMd(text: string): { payments: Payment[]; body: string } {
  const { data, body } = parseFrontmatter<PaymentsFile>(text);
  const payments = (data.payments ?? []).map((p) => ({
    id: String(p.id),
    title: p.title ?? "",
    payee: p.payee ?? "",
    method: p.method ?? "",
    budget_line: p.budget_line ?? "",
    category: p.category ?? "",
    due: String(p.due ?? ""),
    amount: Number(p.amount) || 0,
    status: p.status === "paid" ? "paid" : "scheduled",
    paid_date: String(p.paid_date ?? ""),
    ledger_id: p.ledger_id ?? "",
    project_alloc: parseAlloc(String(p.project_alloc ?? "")),
    notes: p.notes ?? "",
    ...(p.shopping_item ? { shopping_item: String(p.shopping_item) } : {}),
  })) as Payment[];
  return { payments, body };
}

export function paymentsToMd(payments: Payment[], body = ""): string {
  const sorted = [...payments].sort((a, b) => a.due.localeCompare(b.due));
  return stringifyFrontmatter(
    { payments: sorted.map((p) => ({ ...p, project_alloc: formatAlloc(p.project_alloc) })) },
    body ||
      "Scheduled payments for this project. Managed by Many Produce; safe to edit by hand.",
  );
}

export type PaymentGroup = "Overdue" | "Next 30 days" | "Later" | "Paid";

export function groupOf(p: Payment, today: string): PaymentGroup {
  if (p.status === "paid") return "Paid";
  if (p.due && p.due < today) return "Overdue";
  if (!p.due || p.due <= addDays(today, 30)) return "Next 30 days";
  return "Later";
}

/** The ledger expense created when a payment is ticked paid. */
export function ledgerEntryForPayment(p: Payment, paidDate: string): LedgerEntry {
  return {
    id: uid("e"),
    date: paidDate,
    kind: "expense",
    amount: round2(p.amount),
    description: p.title,
    project_alloc: { ...p.project_alloc },
    category: p.category || "Other",
    source: p.method,
    counterparty: p.payee,
    tags: [],
    receipt: "",
    restricted_to: "",
    linked_payment: p.id,
    linked_shopping_item: p.shopping_item ?? "",
    notes: "",
  };
}

// ---- .ics export ----

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function paymentsToICS(payments: Payment[], currency = "USD"): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Many Produce//Payments//EN", "CALSCALE:GREGORIAN"];
  for (const p of payments) {
    if (!p.due || p.status === "paid") continue;
    const d = p.due.replace(/-/g, "");
    const end = addDays(p.due, 1).replace(/-/g, "");
    const amt = new Intl.NumberFormat("en-US", { style: "currency", currency: safeCurrency(currency) }).format(p.amount);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${p.id}@manyproduce`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsEscape(`Pay ${p.payee || p.title}: ${amt}`)}`,
      `DESCRIPTION:${icsEscape(`${p.title}${p.method ? ` · from ${p.method}` : ""}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
