// Equipment log: gear, props, costumes, keys and anything borrowed, rented or handed out.
import { parseCSV, toCSV } from "./files";
import type { Checkout, InventoryItem, Person, Project, ShoppingItem, Venue } from "./types";
import { addDays, uid } from "./util";

export const ITEM_COLUMNS = [
  "id", "name", "category", "owner", "project", "serial", "value", "rental_house", "rental_order", "rental_cost",
  "rental_start", "rental_end", "deposit", "deposit_returned", "returned", "condition", "notes",
] as const;
export const CHECKOUT_COLUMNS = ["id", "item", "person", "out_date", "due_date", "in_date", "condition_out", "condition_in", "notes"] as const;

const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : Number(s));
const yes = (s: string | undefined) => s === "yes" || s === "true";

export function itemsFromCSV(text: string): InventoryItem[] {
  return parseCSV(text).map((r) => ({
    id: r.id || uid("it"),
    name: r.name ?? "",
    category: r.category || "Other",
    owner: r.owner || "producer",
    project: r.project ?? "",
    serial: r.serial ?? "",
    value: num(r.value),
    rental_house: r.rental_house ?? "",
    rental_order: r.rental_order ?? "",
    rental_cost: num(r.rental_cost),
    rental_start: r.rental_start ?? "",
    rental_end: r.rental_end ?? "",
    deposit: num(r.deposit),
    deposit_returned: yes(r.deposit_returned),
    returned: yes(r.returned),
    condition: r.condition ?? "",
    notes: r.notes ?? "",
  }));
}

export function itemsToCSV(items: InventoryItem[]): string {
  return toCSV(
    ITEM_COLUMNS,
    items.map((i) => ({
      ...i,
      value: i.value ?? "",
      rental_cost: i.rental_cost ?? "",
      deposit: i.deposit ?? "",
      deposit_returned: i.deposit_returned ? "yes" : "",
      returned: i.returned ? "yes" : "",
    })),
  );
}

export const checkoutsFromCSV = (text: string): Checkout[] =>
  parseCSV(text).map((r) => ({
    id: r.id || uid("co"),
    item: r.item ?? "",
    person: r.person ?? "",
    out_date: r.out_date ?? "",
    due_date: r.due_date ?? "",
    in_date: r.in_date ?? "",
    condition_out: r.condition_out ?? "",
    condition_in: r.condition_in ?? "",
    notes: r.notes ?? "",
  }));

export const checkoutsToCSV = (c: Checkout[]) =>
  toCSV(CHECKOUT_COLUMNS, [...c].sort((a, b) => a.out_date.localeCompare(b.out_date)) as unknown as Record<string, unknown>[]);

export const isRental = (i: InventoryItem) => !!i.rental_house;

/** The open check-out for an item, if someone has it. */
export function holderOf(item: string, checkouts: Checkout[]): Checkout | undefined {
  return checkouts.find((c) => c.item === item && !c.in_date);
}

export function ownerLabel(owner: string, people: Person[], venues: Venue[]): string {
  if (owner === "producer" || !owner) return "You";
  if (owner.startsWith("person:")) return people.find((p) => p.slug === owner.slice(7))?.name ?? owner.slice(7);
  if (owner.startsWith("venue:")) return venues.find((v) => v.slug === owner.slice(6))?.name ?? owner.slice(6);
  return owner;
}

export type GearWarningKind = "overdue" | "rental-due" | "rental-late" | "after-closing" | "deposit";

export interface GearWarning {
  kind: GearWarningKind;
  item: string;
  message: string;
  project: string;
}

/**
 * Overdue check-outs, rentals due back within 2 days (or late), deposits still
 * out after a return, and anything still checked out after a project's closing.
 */
export function gearWarnings(items: InventoryItem[], checkouts: Checkout[], people: Person[], projects: Project[], closing: (p: Project) => string, today: string, project?: string): GearWarning[] {
  const out: GearWarning[] = [];
  const name = (slug: string) => people.find((p) => p.slug === slug)?.name ?? slug;
  for (const i of items) {
    if (project && i.project && i.project !== project) continue;
    const co = holderOf(i.id, checkouts);
    if (co && co.due_date && co.due_date < today) out.push({ kind: "overdue", item: i.id, project: i.project, message: `${name(co.person)} has ${i.name}, due back ${co.due_date}` });
    if (isRental(i) && !i.returned && i.rental_end) {
      if (i.rental_end < today) out.push({ kind: "rental-late", item: i.id, project: i.project, message: `${i.name} was due back to ${i.rental_house} on ${i.rental_end}` });
      else if (i.rental_end <= addDays(today, 2)) out.push({ kind: "rental-due", item: i.id, project: i.project, message: `${i.name} goes back to ${i.rental_house} on ${i.rental_end}` });
    }
    if (isRental(i) && i.returned && (i.deposit ?? 0) > 0 && !i.deposit_returned) out.push({ kind: "deposit", item: i.id, project: i.project, message: `Deposit for ${i.name} hasn't come back from ${i.rental_house}` });
    const proj = projects.find((p) => p.slug === i.project);
    const close = proj ? closing(proj) : "";
    if (co && close && today > close) out.push({ kind: "after-closing", item: i.id, project: i.project, message: `${name(co.person)} still has ${i.name} after ${proj!.name} closed` });
  }
  return out;
}

export interface RentalOrder {
  key: string;
  house: string;
  items: InventoryItem[];
  pickup: string;
  returnBy: string;
  cost: number;
  deposit: number;
  returned: boolean;
  depositBack: boolean;
}

export function rentalOrders(items: InventoryItem[]): RentalOrder[] {
  const m = new Map<string, InventoryItem[]>();
  for (const i of items.filter(isRental)) {
    const k = `${i.rental_house}|${i.rental_order || i.rental_start}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return [...m].map(([key, list]) => ({
    key,
    house: list[0].rental_house,
    items: list,
    pickup: list.map((i) => i.rental_start).filter(Boolean).sort()[0] ?? "",
    returnBy: list.map((i) => i.rental_end).filter(Boolean).sort().reverse()[0] ?? "",
    cost: list.reduce((s, i) => s + (i.rental_cost ?? 0), 0),
    deposit: list.reduce((s, i) => s + (i.deposit ?? 0), 0),
    returned: list.every((i) => i.returned),
    depositBack: list.every((i) => !(i.deposit ?? 0) || i.deposit_returned),
  })).sort((a, b) => a.pickup.localeCompare(b.pickup));
}

/** A bought shopping item moves into the Equipment log once it arrives. */
export function itemFromShopping(s: ShoppingItem): InventoryItem {
  const cat: Record<string, string> = { Costumes: "Costumes", Props: "Props", Set: "Set pieces", Lighting: "Lighting", Sound: "Sound" };
  return {
    id: uid("it"), name: s.item, category: cat[s.department] ?? "Other", owner: "producer", project: s.project, serial: "",
    value: s.actual_cost ?? s.est_cost, rental_house: "", rental_order: "", rental_cost: null, rental_start: "", rental_end: "",
    deposit: null, deposit_returned: false, returned: false, condition: "New", notes: s.where ? `Bought from ${s.where}` : "",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Printable sign-out sheet: one row per item, with blank columns to fill by hand. */
export function signOutSheetHtml(title: string, items: InventoryItem[]): string {
  const rows = items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.serial)}</td><td></td><td></td><td></td><td></td></tr>`).join("");
  return `<h1>${esc(title)}</h1>
<table style="width:100%;border-collapse:collapse;font:10pt Helvetica,Arial,sans-serif" border="1" cellpadding="6">
<thead><tr><th align="left">Item</th><th align="left">Serial / ID</th><th>Name</th><th>Out</th><th>Back by</th><th>Returned</th></tr></thead>
<tbody>${rows}${"<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>".repeat(6)}</tbody></table>`;
}

/** Gear list for a shoot day or load-in, grouped by category with who has each item. */
export function gearListText(title: string, items: InventoryItem[], checkouts: Checkout[], people: Person[]): string {
  const lines = [title, ""];
  const cats = [...new Set(items.map((i) => i.category))].sort();
  for (const c of cats) {
    lines.push(c.toUpperCase());
    for (const i of items.filter((x) => x.category === c)) {
      const co = holderOf(i.id, checkouts);
      const who = co ? people.find((p) => p.slug === co.person)?.name ?? co.person : "";
      lines.push(`[ ] ${i.name}${i.serial ? ` (${i.serial})` : ""}${who ? ` · with ${who}` : ""}${i.rental_house ? ` · rented from ${i.rental_house}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
