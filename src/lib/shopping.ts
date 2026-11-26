// Shopping list: everything a show needs to buy, rent or borrow, and who's getting it.
import { parseCSV, toCSV } from "./files";
import type { BuyerRole, LedgerEntry, MoneySource, Payment, Person, ShoppingItem } from "./types";
import { round2, uid } from "./util";

export const SHOPPING_COLUMNS = [
  "id", "item", "where", "link", "department", "buyer", "buyer_role", "need_by", "est_cost", "actual_cost",
  "money", "status", "receipt", "notes", "payment_id", "ledger_id", "inventory_id",
] as const;

const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : Number(s));

export function shoppingFromCSV(project: string, text: string): ShoppingItem[] {
  return parseCSV(text).map((r) => ({
    id: r.id || uid("sh"),
    project,
    item: r.item ?? "",
    where: r.where ?? "",
    link: r.link ?? "",
    department: r.department ?? "",
    buyer: r.buyer ?? "",
    buyer_role: (["producer", "designer", "other", "unassigned"].includes(r.buyer_role) ? r.buyer_role : "unassigned") as BuyerRole,
    need_by: r.need_by ?? "",
    est_cost: num(r.est_cost),
    actual_cost: num(r.actual_cost),
    money: r.money ?? "",
    status: r.status === "Got it" || r.status === "Reimbursed" ? r.status : "Needed",
    receipt: r.receipt ?? "",
    notes: r.notes ?? "",
    payment_id: r.payment_id ?? "",
    ledger_id: r.ledger_id ?? "",
    inventory_id: r.inventory_id ?? "",
  }));
}

export function shoppingToCSV(items: ShoppingItem[]): string {
  return toCSV(
    SHOPPING_COLUMNS,
    items.map((i) => ({ ...i, est_cost: i.est_cost ?? "", actual_cost: i.actual_cost ?? "" })),
  );
}

const DESIGN_ROLES = /design|lighting|sound|costume|set|props|wardrobe|hair|makeup|scenic|projection/i;

/** Producer, a designer, someone else, or unassigned (for the buyer pill and filters). */
export function buyerRole(buyer: string, people: Person[]): BuyerRole {
  if (!buyer) return "unassigned";
  if (buyer === "producer") return "producer";
  const p = people.find((x) => x.slug === buyer);
  return p && p.roles.some((r) => DESIGN_ROLES.test(r)) ? "designer" : "other";
}

/** Items bought by anyone but the producer default to Reimburse. */
export function defaultMoney(buyer: string): string {
  return buyer && buyer !== "producer" ? "Reimburse" : "Producer card";
}

export const cost = (i: ShoppingItem) => i.actual_cost ?? i.est_cost ?? 0;

/** Department → Bookkeeping category, so reimbursements land on the right budget line. */
export function categoryFor(department: string): string {
  const d = department.toLowerCase();
  if (d.includes("costume") || d.includes("hair") || d.includes("makeup")) return "Costumes";
  if (d.includes("prop") || d === "set") return "Set & props";
  if (d.includes("light") || d.includes("sound")) return "Lighting & sound";
  if (d.includes("market")) return "Marketing";
  return "Other";
}

export interface ShoppingSummary {
  count: number;
  open: number;
  estimated: number;
  toReimburse: number; // got it, money = Reimburse, no payment yet or payment not paid
}

export function summarize(items: ShoppingItem[], payments: Payment[]): ShoppingSummary {
  let estimated = 0, toReimburse = 0, open = 0;
  for (const i of items) {
    estimated += cost(i);
    if (i.status === "Needed") open++;
    if (i.money === "Reimburse" && i.status !== "Needed") {
      const p = payments.find((x) => x.id === i.payment_id);
      if (!p || p.status !== "paid") toReimburse += cost(i);
    }
  }
  return { count: items.length, open, estimated: round2(estimated), toReimburse: round2(toReimburse) };
}

/** What each person is buying and what they're owed (for their drawer). */
export function owedTo(person: string, items: ShoppingItem[], payments: Payment[]): { buying: ShoppingItem[]; owed: number } {
  const mine = items.filter((i) => i.buyer === person);
  const owed = mine
    .filter((i) => i.money === "Reimburse" && i.status !== "Needed")
    .filter((i) => payments.find((p) => p.id === i.payment_id)?.status !== "paid")
    .reduce((s, i) => s + cost(i), 0);
  return { buying: mine, owed: round2(owed) };
}

/** The payment that reimburses a collaborator for an item. */
export function reimbursementPayment(i: ShoppingItem, payee: string, method: string, due: string): Payment {
  return {
    id: uid("p"),
    title: `Reimburse: ${i.item}`,
    payee,
    method,
    budget_line: "",
    category: categoryFor(i.department),
    due,
    amount: round2(cost(i)),
    status: "scheduled",
    paid_date: "",
    ledger_id: "",
    project_alloc: { [i.project]: 1 },
    notes: `Shopping list: ${i.item}${i.where ? ` (${i.where})` : ""}`,
    shopping_item: i.id,
  };
}

/** The expense entry when the producer (or a sponsor fund) pays for an item directly. */
export function producerPurchaseEntry(i: ShoppingItem, date: string, sources: MoneySource[]): LedgerEntry | null {
  if (i.money === "In-kind" || i.money === "Paid by venue" || i.money === "Reimburse" || !(cost(i) > 0)) return null;
  const isFund = sources.some((s) => s.name === i.money);
  return {
    id: uid("e"),
    date,
    kind: "expense",
    amount: round2(cost(i)),
    description: i.item,
    project_alloc: { [i.project]: 1 },
    category: categoryFor(i.department),
    source: isFund ? i.money : "Card",
    counterparty: i.where,
    tags: i.receipt ? ["Has receipt"] : [],
    receipt: i.receipt,
    restricted_to: "",
    linked_payment: "",
    linked_shopping_item: i.id,
    notes: "",
  };
}

/** Plain-text list for one buyer (to text or email a designer just their items). */
export function buyerListText(title: string, items: ShoppingItem[], money: (n: number) => string): string {
  const lines = [title, ""];
  const byDept = new Map<string, ShoppingItem[]>();
  for (const i of items) {
    const k = i.department || "Other";
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k)!.push(i);
  }
  for (const [dept, list] of byDept) {
    lines.push(dept.toUpperCase());
    for (const i of list.sort((a, b) => (a.need_by || "9").localeCompare(b.need_by || "9"))) {
      const bits = [i.where && `from ${i.where}`, i.need_by && `by ${i.need_by}`, cost(i) ? `~${money(cost(i))}` : "", i.money === "Reimburse" ? "keep the receipt" : ""].filter(Boolean);
      lines.push(`[${i.status === "Needed" ? " " : "x"}] ${i.item}${bits.length ? ` (${bits.join(", ")})` : ""}${i.link ? `\n    ${i.link}` : ""}`);
    }
    lines.push("");
  }
  const total = items.reduce((s, i) => s + cost(i), 0);
  lines.push(`${items.length} items · about ${money(total)}`);
  return lines.join("\n");
}
