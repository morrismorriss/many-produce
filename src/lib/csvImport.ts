// Import a CSV from a spreadsheet, another app or a contacts export into
// collaborators, venues, the budget, payments, the schedule, the shopping list
// or the equipment log.
//
// Every kind works the same way: the header row is matched to the app's fields
// (the user can change any match), each row becomes a record, and rows that are
// already in the vault are either updated or skipped, so importing the same
// sheet twice doesn't double anything.
import Papa from "papaparse";
import { parseLooseDate, parseLooseTime } from "./availabilityImport";
import { buyerRole } from "./shopping";
import { EVENT_TYPES, INVENTORY_CATEGORIES, type BudgetLine, type InventoryItem, type LedgerEntry, type Payment, type Person, type PersonStatus, type ScheduleEvent, type ShoppingItem, type VaultData, type Venue, type VenueStatus } from "./types";
import { ledgerEntryForPayment } from "./payments";
import { round2, uid, uniqueSlug } from "./util";

export type ImportKind = "people" | "venues" | "budget" | "payments" | "events" | "shopping" | "inventory";

export interface FieldDef {
  key: string;
  label: string;
  /** Header names that mean this field (lowercased, punctuation squashed to spaces). */
  aliases: string[];
  required?: boolean;
}

const F = (key: string, label: string, aliases: string[], required = false): FieldDef => ({ key, label, aliases: [key.replace(/_/g, " "), ...aliases], required });

const PROJECT = F("project", "Project", ["production", "show", "project name"]);
const NOTES = F("notes", "Notes", ["note", "comments", "comment", "memo", "description"]);

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  people: [
    F("name", "Name", ["full name", "contact", "contact name", "display name", "person", "who"]),
    F("first_name", "First name", ["first", "given name", "firstname"]),
    F("last_name", "Last name", ["last", "surname", "family name", "lastname"]),
    F("email", "Email", ["e mail", "email address", "e mail 1 value", "email 1", "primary email"]),
    F("phone", "Phone", ["mobile", "cell", "phone number", "telephone", "phone 1 value", "mobile phone", "primary phone"]),
    F("roles", "Roles", ["role", "position", "job", "job title", "title", "department", "organization title", "does"]),
    F("projects", "Projects", ["project", "productions", "shows"]),
    F("city", "City", ["location", "town", "address 1 city", "home city"]),
    F("rate", "Rate", ["fee", "pay", "pay rate"]),
    F("rate_type", "Rate type", ["rate basis", "pay type"]),
    F("status", "Status", ["stage"]),
    F("pronouns", "Pronouns", []),
    F("payment_method", "Payment method", ["paid via", "venmo", "pay by"]),
    F("w9_on_file", "W-9 on file", ["w9", "w 9", "w9 on file", "w 9 on file"]),
    NOTES,
  ],
  venues: [
    F("name", "Name", ["venue", "venue name", "space", "theater", "theatre", "location"], true),
    F("type", "Type", ["kind", "space type"]),
    F("city", "City", ["town", "neighborhood", "area", "address"]),
    F("capacity", "Capacity", ["seats", "house size", "seating", "cap"]),
    F("rate", "Rate", ["rental", "rental rate", "price", "cost", "fee"]),
    F("tech_notes", "Tech notes", ["tech", "technical", "specs"]),
    F("status", "Status", ["stage"]),
    F("contact", "Contact", ["contact name", "email", "phone", "manager"]),
    F("next_step", "Next step", ["next", "to do", "todo", "follow up"]),
    F("hold_dates", "Hold dates", ["holds", "dates", "availability"]),
    F("projects", "Projects", ["project", "production", "show"]),
    NOTES,
  ],
  budget: [
    F("category", "Category", ["group", "section", "account"]),
    F("type", "Type", ["kind", "income or expense"]),
    F("line_item", "Line item", ["item", "line", "description", "name", "budget line"], true),
    F("quantity", "Quantity", ["qty", "units", "count", "#"]),
    F("rate", "Rate", ["unit cost", "price", "each", "unit price"]),
    F("amount", "Amount", ["total", "budget", "budgeted", "cost", "subtotal"]),
    F("notes", "Notes", ["note", "comments", "comment", "memo"]),
    F("expected_date", "Expected date", ["expected", "date", "when"]),
    F("confidence", "Confidence", ["likelihood", "status"]),
    F("through_sponsor", "Through fiscal sponsor", ["through sponsor", "fiscal sponsor", "sponsor"]),
    F("source", "Lands in", ["money source", "fund", "account"]),
    PROJECT,
  ],
  payments: [
    F("title", "What it's for", ["description", "item", "for", "memo", "name"]),
    F("payee", "Payee", ["pay to", "to", "vendor", "recipient", "person", "who"]),
    F("amount", "Amount", ["total", "fee", "cost", "sum"], true),
    F("due", "Due", ["due date", "date", "pay by", "when"]),
    F("status", "Status", ["paid?", "is paid"]),
    F("paid_date", "Paid on", ["paid", "date paid", "payment date"]),
    F("method", "Paid from", ["money source", "source", "account", "payment method", "via"]),
    F("category", "Category", ["budget category", "type"]),
    F("budget_line", "Budget line", ["line item", "line"]),
    PROJECT,
    F("notes", "Notes", ["note", "comments", "comment"]),
  ],
  events: [
    F("date", "Date", ["day", "on"], true),
    F("time", "Time (one column)", ["times", "hours", "call", "call time"]),
    F("start", "Start", ["start time", "from", "begins"]),
    F("end", "End", ["end time", "to", "until", "ends"]),
    F("type", "Type", ["event type", "kind", "category"]),
    F("title", "Title", ["event", "what", "name", "summary", "subject", "description"]),
    F("location", "Location", ["venue", "where", "place", "room"]),
    F("called", "Called", ["people", "who", "attendees", "cast", "call list", "guests"]),
    PROJECT,
    F("notes", "Notes", ["note", "comments", "comment", "details"]),
  ],
  shopping: [
    F("item", "Item", ["name", "what", "thing", "description", "supply", "supplies"], true),
    F("where", "Where", ["store", "vendor", "shop", "source", "from"]),
    F("link", "Link", ["url", "website"]),
    F("department", "Department", ["dept", "category", "area"]),
    F("buyer", "Buyer", ["who", "assigned to", "getting it", "bought by", "owner"]),
    F("need_by", "Need by", ["due", "date", "needed by", "by"]),
    F("est_cost", "Estimated cost", ["estimate", "est", "budget", "cost", "price"]),
    F("actual_cost", "Actual cost", ["actual", "spent", "paid"]),
    F("money", "Paid with", ["payment", "money", "how paid"]),
    F("status", "Status", ["got it", "done", "bought"]),
    PROJECT,
    F("notes", "Notes", ["note", "comments", "comment"]),
  ],
  inventory: [
    F("name", "Item", ["item", "equipment", "gear", "description", "what"], true),
    F("category", "Category", ["type", "kind", "department"]),
    F("owner", "Owner", ["belongs to", "owned by", "from"]),
    F("serial", "Serial", ["serial number", "serial #", "s n", "sn", "asset tag", "tag"]),
    F("value", "Replacement value", ["value", "cost", "price", "replacement cost"]),
    F("rental_house", "Rental house", ["rented from", "rental company", "vendor"]),
    F("rental_order", "Rental order", ["order", "order #", "po"]),
    F("rental_cost", "Rental cost", ["rental", "rent"]),
    F("rental_start", "Pickup", ["rental start", "pick up", "out date"]),
    F("rental_end", "Return by", ["rental end", "return", "due back", "return date"]),
    F("deposit", "Deposit", []),
    F("condition", "Condition", ["state"]),
    PROJECT,
    F("notes", "Notes", ["note", "comments", "comment"]),
  ],
};

/** The kinds that belong to one project (rows without a project column go to the one picked). */
export const PER_PROJECT: Record<ImportKind, boolean> = { people: false, venues: false, budget: true, payments: true, events: true, shopping: true, inventory: false };

export const KIND_LABEL: Record<ImportKind, { one: string; many: string }> = {
  people: { one: "collaborator", many: "collaborators" },
  venues: { one: "venue", many: "venues" },
  budget: { one: "budget line", many: "budget lines" },
  payments: { one: "payment", many: "payments" },
  events: { one: "event", many: "events" },
  shopping: { one: "item", many: "items" },
  inventory: { one: "item", many: "items" },
};

// ---- reading the file ----

export interface Sheet {
  headers: string[];
  rows: Record<string, string>[];
}

export function readSheet(text: string): Sheet {
  if (!text.trim()) return { headers: [], rows: [] };
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, "").trim(), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (res.meta.fields ?? []).filter((h) => h !== "");
  return { headers, rows: res.data };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#?]+/g, " ").trim();

export type ColumnMap = Record<string, string>; // field key -> header ("" = not imported)

/** Match headers to fields: exact name first, then known aliases. Each header is used once. */
export function guessColumns(headers: string[], kind: ImportKind): ColumnMap {
  const fields = IMPORT_FIELDS[kind];
  const used = new Set<string>();
  const out: ColumnMap = Object.fromEntries(fields.map((f) => [f.key, ""]));
  const take = (f: FieldDef, test: (h: string) => boolean) => {
    if (out[f.key]) return;
    const h = headers.find((x) => !used.has(x) && test(norm(x)));
    if (h) { out[f.key] = h; used.add(h); }
  };
  for (const f of fields) take(f, (h) => h === norm(f.key) || h === norm(f.label));
  for (const f of fields) take(f, (h) => f.aliases.includes(h));
  // Google and Outlook exports number their columns ("E-mail 1 - Value", "Phone 2 - Type").
  for (const f of fields) take(f, (h) => !/type|label/.test(h) && f.aliases.some((a) => a.length > 3 && h.startsWith(a)));
  return out;
}

/** A header-only CSV the user can fill in. */
export function templateCSV(kind: ImportKind): string {
  const skip = new Set(kind === "people" ? ["first_name", "last_name"] : kind === "events" ? ["time"] : []);
  return IMPORT_FIELDS[kind].filter((f) => !skip.has(f.key)).map((f) => f.key).join(",") + "\n";
}

// ---- cell helpers ----

const cellOf = (r: Record<string, string>, map: ColumnMap) => (key: string) => (map[key] ? String(r[map[key]] ?? "").trim() : "");

/** "$1,200.50", "(45)", "1.200" → number, or null for blank. */
export function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-|^−/.test(t);
  const n = Number(t.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(t)) return null;
  return neg ? -n : n;
}

/** Dates in any of the usual spreadsheet shapes, or "" if unreadable. */
export function parseDate(s: string, today: string): string {
  const t = s.trim();
  if (!t) return "";
  const loose = parseLooseDate(t.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, ""), today);
  if (loose) return loose;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "7pm", "19:00", "7:00:00 PM" → "HH:MM", or "" if unreadable. */
export function parseTime(s: string): string {
  const t = s.trim().replace(/(\d{1,2}:\d{2}):\d{2}/, "$1").replace(/\.(?=m)/gi, "").replace(/\b([ap])\.?m\.?/i, "$1m");
  if (!t) return "";
  return parseLooseTime(t, false) ?? parseLooseTime(t.replace(/\s+/g, ""), false) ?? "";
}

/** "7-10pm", "6:30 PM – 9:30 PM", "10am to 2" → start and end. */
export function parseTimeRange(s: string): { start: string; end: string } {
  const parts = s.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  if (parts.length < 2) return { start: parseTime(s), end: "" };
  const endAp = /(am|pm|a|p)\.?m?\.?$/i.exec(parts[1].trim())?.[1];
  const startRaw = /(am|pm|a\.m\.|p\.m\.)$/i.test(parts[0].trim()) || !endAp ? parts[0] : `${parts[0]}${endAp.length === 1 ? `${endAp}m` : endAp}`;
  return { start: parseTime(startRaw), end: parseTime(parts[1]) };
}

const splitList = (s: string) => s.split(/\s*[;|\n]\s*|\s*,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
const yes = (s: string) => /^(y|yes|true|1|x|✓|✔|on file|paid|done|got it|received)$/i.test(s.trim());

function pick<T extends string>(raw: string, options: readonly T[]): T | "" {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  return options.find((o) => o.toLowerCase() === k) ?? options.find((o) => o.toLowerCase().startsWith(k) || k.startsWith(o.toLowerCase())) ?? "";
}

/** A project name or slug from the sheet → slug, or "" if it doesn't match. */
export function matchProject(raw: string, data: Pick<VaultData, "projects">): string {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  return data.projects.find((p) => p.slug === k || p.name.trim().toLowerCase() === k)?.slug ?? data.projects.find((p) => p.name.toLowerCase().startsWith(k))?.slug ?? "";
}

/** A name from the sheet → a collaborator: full name, email, then a unique first name. */
export function matchPerson(raw: string, people: Person[]): Person | undefined {
  const k = raw.trim().toLowerCase();
  if (!k) return undefined;
  const exact = people.find((p) => p.name.trim().toLowerCase() === k || (p.email && p.email.toLowerCase() === k) || p.slug === k);
  if (exact) return exact;
  const first = people.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === k.split(/\s+/)[0]);
  return first.length === 1 && !k.includes(" ") ? first[0] : undefined;
}

export function matchVenue(raw: string, venues: Venue[]): Venue | undefined {
  const k = raw.trim().toLowerCase();
  return k ? venues.find((v) => v.slug === k || v.name.trim().toLowerCase() === k) : undefined;
}

// ---- building the import ----

export interface ImportOptions {
  /** Project for rows with no project column (per-project kinds), or to add imported people/venues to. */
  project: string;
  /** Update records that are already in the vault with the file's values (otherwise they're skipped). */
  update: boolean;
  /** Budget: replace the project's whole budget instead of adding to it. */
  replace: boolean;
  /** Payments: paid rows also become Bookkeeping expenses (unless a matching one is there already). */
  addPaidToLedger: boolean;
  /** Schedule and shopping: names that aren't collaborators yet are added as new ones. */
  addPeople: boolean;
  today: string;
}

export interface ImportPlan<T> {
  add: T[];
  update: { before: T; after: T }[];
  duplicates: number; // already there, skipped
  problems: string[]; // rows skipped and why
  newPeople: Person[]; // created for names in the schedule or shopping list
  entries: LedgerEntry[]; // Bookkeeping expenses for paid payments
  /** Budget lines by project after the import (budget only). */
  budgets?: Record<string, BudgetLine[]>;
  /** Payments linked to entries already in the ledger. */
  linked: number;
}

const emptyPlan = <T,>(): ImportPlan<T> => ({ add: [], update: [], duplicates: 0, problems: [], newPeople: [], entries: [], linked: 0 });

type Ctx = { data: VaultData; opts: ImportOptions; plan: ImportPlan<unknown> };

/** Resolves a row's project, warning once per unknown name. */
function projectResolver(ctx: Ctx) {
  const warned = new Set<string>();
  return (raw: string): string => {
    const hit = matchProject(raw, ctx.data);
    if (raw && !hit && !warned.has(raw)) {
      warned.add(raw);
      ctx.plan.problems.push(`No project called "${raw}", so those rows went to the project picked below.`);
    }
    return hit || ctx.opts.project;
  };
}

/** Names → person slugs, adding new collaborators when allowed. */
function personResolver(ctx: Ctx, project: () => string) {
  const made = new Map<string, Person>();
  const unknown = new Set<string>();
  const fn = (raw: string): string => {
    const hit = matchPerson(raw, [...ctx.data.people, ...made.values()]);
    if (hit) return hit.slug;
    if (!ctx.opts.addPeople) { unknown.add(raw); return ""; }
    const slug = uniqueSlug(raw, [...ctx.data.people.map((p) => p.slug), ...[...made.values()].map((p) => p.slug)]);
    const p: Person = { slug, name: raw, roles: [], projects: project() ? [project()] : [], email: "", phone: "", city: "", rate: "", rate_type: "", status: "Reached out", pronouns: "", payment_method: "", w9_on_file: false, w9_date: "", notes: "Added from a CSV import." };
    made.set(raw.toLowerCase(), p);
    ctx.plan.newPeople.push(p);
    return slug;
  };
  return { fn, unknown };
}

const PERSON_STATUSES: PersonStatus[] = ["Reached out", "Offer out", "Confirmed", "Past collaborator"];
const VENUE_STATUSES: VenueStatus[] = ["Contacted", "Toured", "Hold", "Booked", "Passed"];
const RATE_TYPES = ["flat", "hourly", "per show", "stipend"] as const;

/** Fill blanks on the old record from the new one; lists are merged. */
function mergeInto<T extends object>(before: T, incoming: Partial<T>, overwrite: boolean): T {
  const out = { ...before } as Record<string, unknown>;
  for (const [k, v] of Object.entries(incoming)) {
    const cur = out[k];
    if (Array.isArray(v)) out[k] = [...new Set([...((cur as unknown[]) ?? []), ...v])];
    else if (v === "" || v === null || v === undefined) continue;
    else if (overwrite || cur === "" || cur === null || cur === undefined || cur === false) out[k] = v;
  }
  return out as T;
}

const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

function buildPeople(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<Person> {
  const plan = ctx.plan as ImportPlan<Person>;
  const taken = ctx.data.people.map((p) => p.slug);
  const seen: Person[] = [];
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const name = c("name") || [c("first_name"), c("last_name")].filter(Boolean).join(" ");
    if (!name) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no name.`); return; }
    const projects = c("projects") ? splitList(c("projects")).map((x) => matchProject(x, ctx.data)).filter(Boolean) : [];
    if (!projects.length && ctx.opts.project) projects.push(ctx.opts.project);
    const rate = c("rate");
    const incoming: Partial<Person> = {
      name,
      email: c("email"),
      phone: c("phone"),
      roles: splitList(c("roles")),
      projects,
      city: c("city"),
      rate: rate.replace(/^\$/, ""),
      rate_type: pick(c("rate_type") || (/hour|\/hr/i.test(rate) ? "hourly" : ""), RATE_TYPES),
      status: pick(c("status"), PERSON_STATUSES) || undefined,
      pronouns: c("pronouns"),
      payment_method: c("payment_method"),
      w9_on_file: c("w9_on_file") ? yes(c("w9_on_file")) : undefined,
      notes: c("notes"),
    };
    const existing = matchPerson(incoming.email || name, ctx.data.people) ?? ctx.data.people.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    const dupInFile = seen.find((p) => p.name.toLowerCase() === name.toLowerCase() || (!!incoming.email && p.email.toLowerCase() === incoming.email.toLowerCase()));
    if (dupInFile) { Object.assign(dupInFile, mergeInto(dupInFile, incoming, false)); plan.duplicates++; return; }
    if (existing) {
      if (!ctx.opts.update) { plan.duplicates++; return; }
      const after = mergeInto(existing, { ...incoming, name: existing.name }, true);
      if (changed(after, existing)) plan.update.push({ before: existing, after });
      else plan.duplicates++;
      return;
    }
    const slug = uniqueSlug(name, [...taken, ...plan.add.map((p) => p.slug)]);
    const p: Person = {
      slug, name, roles: incoming.roles ?? [], projects, email: incoming.email ?? "", phone: incoming.phone ?? "", city: incoming.city ?? "",
      rate: incoming.rate ?? "", rate_type: incoming.rate_type ?? "", status: incoming.status ?? "Reached out", pronouns: incoming.pronouns ?? "",
      payment_method: incoming.payment_method ?? "", w9_on_file: incoming.w9_on_file ?? false, w9_date: "", notes: incoming.notes ?? "",
    };
    plan.add.push(p);
    seen.push(p);
  });
  return plan;
}

function buildVenues(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<Venue> {
  const plan = ctx.plan as ImportPlan<Venue>;
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const name = c("name");
    if (!name) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no venue name.`); return; }
    const projects = c("projects") ? splitList(c("projects")).map((x) => matchProject(x, ctx.data)).filter(Boolean) : [];
    if (!projects.length && ctx.opts.project) projects.push(ctx.opts.project);
    const cap = parseAmount(c("capacity"));
    const incoming: Partial<Venue> = {
      name, type: c("type"), city: c("city"), capacity: cap === null ? null : Math.round(Math.abs(cap)), rate: c("rate"), tech_notes: c("tech_notes"),
      status: pick(c("status"), VENUE_STATUSES) || undefined, contact: c("contact"), next_step: c("next_step"), hold_dates: c("hold_dates"), projects, notes: c("notes"),
    };
    const existing = matchVenue(name, ctx.data.venues);
    if (plan.add.some((v) => v.name.toLowerCase() === name.toLowerCase())) { plan.duplicates++; return; }
    if (existing) {
      if (!ctx.opts.update) { plan.duplicates++; return; }
      const after = mergeInto(existing, { ...incoming, name: existing.name }, true);
      if (changed(after, existing)) plan.update.push({ before: existing, after });
      else plan.duplicates++;
      return;
    }
    plan.add.push({
      slug: uniqueSlug(name, [...ctx.data.venues.map((v) => v.slug), ...plan.add.map((v) => v.slug)]), name, type: incoming.type ?? "", city: incoming.city ?? "",
      capacity: incoming.capacity ?? null, rate: incoming.rate ?? "", tech_notes: incoming.tech_notes ?? "", status: incoming.status ?? "Contacted", projects,
      next_step: incoming.next_step ?? "", contact: incoming.contact ?? "", hold_dates: incoming.hold_dates ?? "", notes: incoming.notes ?? "",
    });
  });
  return plan;
}

function budgetType(raw: string, category: string, data: VaultData): BudgetLine["type"] {
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (/^(income|revenue|in|earned|support)/.test(v)) return "income";
  if (v === "in-kind" || v === "inkind") return "in-kind";
  if (v) return "expense";
  return data.settings.income_categories.some((c) => c.toLowerCase() === category.toLowerCase()) && category.toLowerCase() !== "other" ? "income" : "expense";
}

function buildBudget(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<BudgetLine> {
  const plan = ctx.plan as ImportPlan<BudgetLine>;
  const proj = projectResolver(ctx);
  const budgets: Record<string, BudgetLine[]> = {};
  const listFor = (slug: string) => (budgets[slug] ??= ctx.opts.replace ? [] : [...(ctx.data.budgets[slug] ?? [])]);
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const lineItem = c("line_item");
    const category = c("category");
    // Spreadsheets end with totals; they aren't lines.
    if (/^(total|subtotal|sub-total|grand total|gap|net|balance)\b/i.test(lineItem || category) && !(lineItem && category)) return;
    if (!lineItem && !category) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no line item.`); return; }
    const quantity = parseAmount(c("quantity"));
    const rate = parseAmount(c("rate"));
    let amount = parseAmount(c("amount"));
    if (amount === null) amount = (quantity ?? 1) * (rate ?? 0);
    const type = budgetType(c("type"), category, ctx.data);
    const slug = proj(c("project"));
    if (!slug) { plan.problems.push(`Row ${i + 2}: pick a project for budget lines.`); return; }
    const conf = pick(c("confidence"), ["Confirmed", "Likely", "Hoped for"] as const);
    const line: BudgetLine = {
      id: uid("b"), category: category || "Other", type, line_item: lineItem || category,
      quantity: quantity ?? 1, rate: rate ?? round2(Math.abs(amount) / (quantity || 1)), amount: round2(Math.abs(amount)), notes: c("notes"),
      expected_date: parseDate(c("expected_date"), ctx.opts.today), confidence: type === "income" ? conf || "Likely" : "",
      through_sponsor: c("through_sponsor") ? yes(c("through_sponsor")) : false, source: c("source"),
    };
    const list = listFor(slug);
    const key = (l: BudgetLine) => `${l.type}|${l.category.toLowerCase()}|${l.line_item.toLowerCase()}`;
    const hit = list.findIndex((l) => key(l) === key(line));
    if (hit >= 0) {
      const before = list[hit];
      if (!ctx.opts.update) { plan.duplicates++; return; }
      const after = { ...line, id: before.id, through_sponsor: c("through_sponsor") ? line.through_sponsor : before.through_sponsor, notes: line.notes || before.notes, source: line.source || before.source, expected_date: line.expected_date || before.expected_date };
      if (changed(after, before)) { list[hit] = after; plan.update.push({ before, after }); } else plan.duplicates++;
      return;
    }
    list.push(line);
    plan.add.push(line);
  });
  plan.budgets = budgets;
  return plan;
}

function buildPayments(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<Payment> {
  const plan = ctx.plan as ImportPlan<Payment>;
  const proj = projectResolver(ctx);
  const existing = Object.values(ctx.data.payments).flat();
  const key = (p: Pick<Payment, "payee" | "amount" | "due">) => `${p.payee.trim().toLowerCase()}|${p.amount.toFixed(2)}|${p.due}`;
  const keys = new Set(existing.map(key));
  const sources = ctx.data.settings.money_sources.map((s) => s.name);
  const usedEntries = new Set(existing.map((p) => p.ledger_id).filter(Boolean));
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const amount = parseAmount(c("amount"));
    if (amount === null || amount === 0) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no amount.`); return; }
    const slug = proj(c("project")) || "overhead";
    const payee = c("payee");
    const due = parseDate(c("due"), ctx.opts.today);
    const paidDate = parseDate(c("paid_date"), ctx.opts.today);
    const statusRaw = c("status");
    const paid = statusRaw ? yes(statusRaw) || /paid/i.test(statusRaw) && !/un ?paid|not/i.test(statusRaw) : !!paidDate;
    const line = (ctx.data.budgets[slug] ?? []).find((l) => c("budget_line") && l.line_item.toLowerCase() === c("budget_line").toLowerCase());
    const methodRaw = c("method");
    const p: Payment = {
      id: uid("p"), title: c("title") || (payee ? `Pay ${payee}` : "Payment"), payee, method: sources.find((s) => s.toLowerCase() === methodRaw.toLowerCase()) ?? methodRaw,
      budget_line: line?.id ?? "", category: c("category") || line?.category || "", due: due || paidDate, amount: round2(Math.abs(amount)),
      status: paid ? "paid" : "scheduled", paid_date: paid ? paidDate || due || ctx.opts.today : "", ledger_id: "", project_alloc: { [slug]: 1 }, notes: c("notes"),
    };
    if (keys.has(key(p))) { plan.duplicates++; return; }
    keys.add(key(p));
    if (p.status === "paid") {
      // Link to an expense already in the ledger before making a new one.
      const match = ctx.data.ledger.find((e) => e.kind === "expense" && !usedEntries.has(e.id) && e.date === p.paid_date && Math.abs(e.amount - p.amount) < 0.005 && (!e.linked_payment));
      if (match) { p.ledger_id = match.id; usedEntries.add(match.id); plan.linked++; }
      else if (ctx.opts.addPaidToLedger) {
        const e = { ...ledgerEntryForPayment(p, p.paid_date), notes: "Imported" };
        p.ledger_id = e.id;
        plan.entries.push(e);
      }
    }
    plan.add.push(p);
  });
  return plan;
}

function buildEvents(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<ScheduleEvent> {
  const plan = ctx.plan as ImportPlan<ScheduleEvent>;
  const proj = projectResolver(ctx);
  let rowProject = ctx.opts.project;
  const people = personResolver(ctx, () => rowProject);
  const key = (e: Pick<ScheduleEvent, "project" | "date" | "start" | "title">) => `${e.project}|${e.date}|${e.start}|${e.title.trim().toLowerCase()}`;
  const keys = new Map(ctx.data.events.map((e) => [key(e), e]));
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const date = parseDate(c("date"), ctx.opts.today);
    if (!date) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: couldn't read the date "${c("date")}".`); return; }
    rowProject = proj(c("project"));
    if (!rowProject) { plan.problems.push(`Row ${i + 2}: pick a project for schedule events.`); return; }
    let start = parseTime(c("start")), end = parseTime(c("end"));
    if (!start && (c("time") || c("start"))) { const rg = parseTimeRange(c("time") || c("start")); start = rg.start; end = end || rg.end; }
    const typeRaw = c("type");
    let title = c("title");
    // No type column: "Rehearsal: Act 1" gives the type and leaves "Act 1" as the title.
    const fromTitle = !typeRaw && title ? pick(title.split(/\s*[:\-–]\s*/)[0], EVENT_TYPES) : "";
    if (fromTitle && /[:\-–]/.test(title)) title = title.replace(/^[^:\-–]+[:\-–]\s*/, "");
    const type = pick(typeRaw, EVENT_TYPES) || fromTitle || (typeRaw ? "Other" : "Rehearsal");
    const venue = matchVenue(c("location"), ctx.data.venues);
    const called = splitList(c("called")).map(people.fn).filter(Boolean);
    const extraNote = typeRaw && type === "Other" && typeRaw.toLowerCase() !== "other" ? typeRaw : "";
    const e: ScheduleEvent = {
      id: uid("ev"), project: rowProject, date, start, end, type, title: title || (extraNote || type), location: venue?.slug ?? c("location"),
      called: [...new Set(called)], scenes: [], notes: [c("notes"), extraNote && title ? `Type: ${extraNote}` : ""].filter(Boolean).join("\n"),
    };
    const before = keys.get(key(e));
    if (before) {
      if (!ctx.opts.update) { plan.duplicates++; return; }
      const after = mergeInto(before, { ...e, id: before.id, scenes: before.scenes }, true);
      if (changed(after, before)) plan.update.push({ before, after }); else plan.duplicates++;
      return;
    }
    keys.set(key(e), e);
    plan.add.push(e);
  });
  if (people.unknown.size) plan.problems.push(`Not collaborators yet, so left off the call: ${[...people.unknown].slice(0, 8).join(", ")}${people.unknown.size > 8 ? "…" : ""}`);
  return plan;
}

const SHOP_STATUS = (raw: string): ShoppingItem["status"] | "" => {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  if (/reimbursed/.test(k)) return "Reimbursed";
  if (/^(got|bought|done|have|purchased|yes|y|x|✓|✔|true|1)/.test(k) || k === "got it") return "Got it";
  return "Needed";
};

function buildShopping(sheet: Sheet, map: ColumnMap, ctx: Ctx, departments: string[], moneyOptions: string[]): ImportPlan<ShoppingItem> {
  const plan = ctx.plan as ImportPlan<ShoppingItem>;
  const proj = projectResolver(ctx);
  let rowProject = ctx.opts.project;
  const people = personResolver(ctx, () => rowProject);
  const all = Object.values(ctx.data.shopping).flat();
  const key = (s: Pick<ShoppingItem, "project" | "item">) => `${s.project}|${s.item.trim().toLowerCase()}`;
  const keys = new Map(all.map((s) => [key(s), s]));
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const item = c("item");
    if (!item) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no item.`); return; }
    rowProject = proj(c("project"));
    if (!rowProject) { plan.problems.push(`Row ${i + 2}: pick a project for the shopping list.`); return; }
    const buyerRaw = c("buyer");
    const buyer = !buyerRaw ? "" : /^(me|producer|i|myself|self)$/i.test(buyerRaw) ? "producer" : people.fn(buyerRaw);
    const est = parseAmount(c("est_cost")), actual = parseAmount(c("actual_cost"));
    const moneyRaw = c("money");
    const s: ShoppingItem = {
      id: uid("sh"), project: rowProject, item, where: c("where"), link: c("link"), department: pick(c("department"), departments) || c("department"),
      buyer, buyer_role: buyerRole(buyer, [...ctx.data.people, ...plan.newPeople]), need_by: parseDate(c("need_by"), ctx.opts.today),
      est_cost: est === null ? null : Math.abs(est), actual_cost: actual === null ? null : Math.abs(actual),
      money: moneyOptions.find((m) => m.toLowerCase() === moneyRaw.toLowerCase()) ?? (moneyRaw || (buyer && buyer !== "producer" ? "Reimburse" : "Producer card")),
      status: SHOP_STATUS(c("status")) || "Needed", receipt: "", notes: c("notes"), payment_id: "", ledger_id: "", inventory_id: "",
    };
    const before = keys.get(key(s));
    if (before) {
      if (!ctx.opts.update) { plan.duplicates++; return; }
      // Keep links to payments, entries and the equipment log.
      const after = mergeInto(before, { ...s, id: before.id, payment_id: "", ledger_id: "", inventory_id: "", receipt: "" }, true);
      if (changed(after, before)) plan.update.push({ before, after }); else plan.duplicates++;
      return;
    }
    keys.set(key(s), s);
    plan.add.push(s);
  });
  if (people.unknown.size) plan.problems.push(`Buyers who aren't collaborators yet were left unassigned: ${[...people.unknown].slice(0, 8).join(", ")}`);
  return plan;
}

function buildInventory(sheet: Sheet, map: ColumnMap, ctx: Ctx): ImportPlan<InventoryItem> {
  const plan = ctx.plan as ImportPlan<InventoryItem>;
  const proj = projectResolver(ctx);
  const key = (x: Pick<InventoryItem, "name" | "serial">) => `${x.name.trim().toLowerCase()}|${x.serial.trim().toLowerCase()}`;
  const keys = new Map(ctx.data.inventory.map((x) => [key(x), x]));
  sheet.rows.forEach((r, i) => {
    const c = cellOf(r, map);
    const name = c("name");
    if (!name) { if (Object.values(r).some((v) => String(v ?? "").trim())) plan.problems.push(`Row ${i + 2}: no item name.`); return; }
    const ownerRaw = c("owner");
    const person = matchPerson(ownerRaw, ctx.data.people);
    const venue = matchVenue(ownerRaw, ctx.data.venues);
    const owner = !ownerRaw || /^(me|producer|mine|ours|company)$/i.test(ownerRaw) ? "producer" : person ? `person:${person.slug}` : venue ? `venue:${venue.slug}` : ownerRaw;
    const amt = (k: string) => { const n = parseAmount(c(k)); return n === null ? null : Math.abs(n); };
    const item: InventoryItem = {
      id: uid("inv"), name, category: pick(c("category"), INVENTORY_CATEGORIES) || c("category") || "Other", owner, project: c("project") ? proj(c("project")) : ctx.opts.project,
      serial: c("serial"), value: amt("value"), rental_house: c("rental_house"), rental_order: c("rental_order"), rental_cost: amt("rental_cost"),
      rental_start: parseDate(c("rental_start"), ctx.opts.today), rental_end: parseDate(c("rental_end"), ctx.opts.today), deposit: amt("deposit"),
      deposit_returned: false, returned: false, condition: c("condition"), notes: c("notes"),
    };
    const before = keys.get(key(item));
    if (before) {
      if (!ctx.opts.update) { plan.duplicates++; return; }
      const after = mergeInto(before, { ...item, id: before.id, deposit_returned: undefined, returned: undefined }, true);
      if (changed(after, before)) plan.update.push({ before, after }); else plan.duplicates++;
      return;
    }
    keys.set(key(item), item);
    plan.add.push(item);
  });
  return plan;
}

export type AnyRecord = Person | Venue | BudgetLine | Payment | ScheduleEvent | ShoppingItem | InventoryItem;

export function buildImport(kind: ImportKind, sheet: Sheet, map: ColumnMap, data: VaultData, opts: ImportOptions, extra: { departments?: string[]; moneyOptions?: string[] } = {}): ImportPlan<AnyRecord> {
  const ctx: Ctx = { data, opts, plan: emptyPlan() };
  switch (kind) {
    case "people": return buildPeople(sheet, map, ctx);
    case "venues": return buildVenues(sheet, map, ctx);
    case "budget": return buildBudget(sheet, map, ctx);
    case "payments": return buildPayments(sheet, map, ctx);
    case "events": return buildEvents(sheet, map, ctx);
    case "shopping": return buildShopping(sheet, map, ctx, extra.departments ?? [], extra.moneyOptions ?? []);
    case "inventory": return buildInventory(sheet, map, ctx);
  }
}

/** What's missing before an import can run (empty = ready). */
export function missingFields(kind: ImportKind, map: ColumnMap): string[] {
  if (kind === "people") return map.name || map.first_name || map.last_name ? [] : ["Name (or first and last name)"];
  if (kind === "budget") return map.line_item || map.category ? [] : ["Line item"];
  return IMPORT_FIELDS[kind].filter((f) => f.required && !map[f.key]).map((f) => f.label);
}

/** Columns and cells for the preview table. */
export function previewOf(kind: ImportKind, r: AnyRecord, names: { person: (slug: string) => string; venue: (slug: string) => string; project: (slug: string) => string }, money: (n: number) => string): { heads: string[]; cells: string[] } {
  switch (kind) {
    case "people": { const p = r as Person; return { heads: ["Name", "Roles", "Email", "Phone"], cells: [p.name, p.roles.join(", "), p.email, p.phone] }; }
    case "venues": { const v = r as Venue; return { heads: ["Name", "City", "Capacity", "Status"], cells: [v.name, v.city, v.capacity ? String(v.capacity) : "", v.status] }; }
    case "budget": { const l = r as BudgetLine; return { heads: ["Category", "Line item", "Type", "Amount"], cells: [l.category, l.line_item, l.type, money(l.amount)] }; }
    case "payments": { const p = r as Payment; return { heads: ["Payee", "For", "Due", "Amount", "Status"], cells: [p.payee, p.title, p.due, money(p.amount), p.status] }; }
    case "events": { const e = r as ScheduleEvent; return { heads: ["Date", "Time", "Event", "Where", "Called"], cells: [e.date, [e.start, e.end].filter(Boolean).join("–"), `${e.type}${e.title && e.title !== e.type ? `: ${e.title}` : ""}`, names.venue(e.location), e.called.map(names.person).join(", ")] }; }
    case "shopping": { const s = r as ShoppingItem; return { heads: ["Item", "Department", "Buyer", "Need by", "Est."], cells: [s.item, s.department, s.buyer === "producer" ? "Producer" : names.person(s.buyer), s.need_by, s.est_cost === null ? "" : money(s.est_cost)] }; }
    case "inventory": { const x = r as InventoryItem; return { heads: ["Item", "Category", "Owner", "Serial", "Value"], cells: [x.name, x.category, x.owner.replace(/^person:|^venue:/, ""), x.serial, x.value === null ? "" : money(x.value)] }; }
  }
}
