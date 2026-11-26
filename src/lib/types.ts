// Core data model. Every type here maps to a plain file in the vault
// (see docs/FILE-FORMATS.md).

export type ProjectStatus = "planning" | "in production" | "closed";
export type ProjectType = "Theater" | "Film" | "Other";

export interface Project {
  /** Frontmatter keys the app doesn't know about, kept as-is on save. */
  extra?: Record<string, unknown>;
  slug: string;
  name: string;
  color: string;
  subtitle: string;
  status: ProjectStatus;
  type: ProjectType;
  start: string; // YYYY-MM-DD or ""
  end: string;
  opening: string;
  city: string;
  fiscal_sponsor: string; // sponsor slug or ""
  sponsor_fee_rate: number | null; // overrides the sponsor's rate when set
  builtin?: boolean; // Company overhead
  /** Scene breakdown cast list: character name -> person slug. */
  cast?: Record<string, string>;
  notes: string; // markdown body
}

export const OVERHEAD_SLUG = "overhead";

/** project slug -> share (0..1). Shares add up to 1. */
export type Alloc = Record<string, number>;

export type EntryKind = "income" | "expense";

export interface LedgerEntry {
  id: string;
  date: string;
  kind: EntryKind;
  amount: number; // always positive; kind gives the sign
  description: string;
  project_alloc: Alloc;
  category: string;
  source: string; // money source: Checking, Card, Cash, a sponsor fund...
  counterparty: string;
  tags: string[];
  receipt: string;
  restricted_to: string;
  linked_payment: string;
  linked_shopping_item: string;
  notes: string;
}

export const AUTO_FEE_PREFIX = "auto-fee:";

/** Matches Many Apply's budget types. In-kind lines count toward income but never move cash. */
export type BudgetType = "expense" | "income" | "in-kind";
export type Confidence = "Confirmed" | "Likely" | "Hoped for";

/** Same 7 leading columns as Many Apply's budget builder, plus extras. */
export interface BudgetLine {
  id: string;
  category: string;
  type: BudgetType;
  line_item: string;
  quantity: number;
  rate: number;
  amount: number;
  notes: string;
  // income extras
  expected_date: string;
  confidence: Confidence | "";
  through_sponsor: boolean;
  source: string; // where income lands (e.g. "Fractured Atlas fund")
}

export type PaymentStatus = "scheduled" | "paid";

export interface Payment {
  id: string;
  title: string;
  payee: string;
  method: string; // money source it will be paid from
  budget_line: string; // budget line id (optional)
  category: string;
  due: string;
  amount: number;
  status: PaymentStatus;
  paid_date: string;
  ledger_id: string;
  project_alloc: Alloc;
  notes: string;
  shopping_item?: string; // set for reimbursements from the Shopping list
}

export type PersonStatus = "Reached out" | "Offer out" | "Confirmed" | "Past collaborator";
export interface Person {
  /** Frontmatter keys the app doesn't know about, kept as-is on save. */
  extra?: Record<string, unknown>;
  slug: string;
  name: string;
  roles: string[];
  projects: string[];
  email: string;
  phone: string;
  city: string;
  rate: string;
  rate_type: "flat" | "hourly" | "per show" | "stipend" | "";
  status: PersonStatus;
  pronouns: string;
  payment_method: string;
  w9_on_file: boolean;
  w9_date: string; // when the W-9 arrived; the form itself is never read
  notes: string;
}

export type VenueStatus = "Contacted" | "Toured" | "Hold" | "Booked" | "Passed";
/** A venue's deal terms, used by the venue settlement. */
export interface VenueDeal {
  basis: "night" | "run"; // are flat amounts per performance or for the whole run?
  flat_rental: number;
  door_split: number; // venue's share of box office, 0..1
  guarantee: number; // with versus: venue gets whichever is higher, guarantee or door split
  versus: boolean;
  bar_minimum: number; // producer covers the shortfall if bar sales come in under it
  venue_collects_box_office: boolean;
  fees: { label: string; amount: number }[]; // cleaning, tech, …
}

export interface Venue {
  deal?: VenueDeal;
  /** Frontmatter keys the app doesn't know about, kept as-is on save. */
  extra?: Record<string, unknown>;
  slug: string;
  name: string;
  type: string;
  city: string;
  capacity: number | null;
  rate: string;
  tech_notes: string;
  status: VenueStatus;
  projects: string[];
  next_step: string;
  contact: string;
  hold_dates: string;
  notes: string;
}

export interface Sponsor {
  /** Frontmatter keys the app doesn't know about, kept as-is on save. */
  extra?: Record<string, unknown>;
  slug: string;
  name: string;
  fee_rate: number;
  fee_applies_to: string;
  contact: string;
  account_url: string;
  review_required_for: string[];
  report_schedule: string;
  notes: string;
}

export interface MoneySource {
  name: string;
  opening_balance: number;
  opening_date: string; // ledger entries on/after this date move the balance
  sponsor?: string; // sponsor slug, for sponsor funds
}

export type ThemeName = "light" | "dark" | "pink" | "system";

export interface Settings {
  currency: string;
  theme: ThemeName;
  cushion: number;
  money_sources: MoneySource[];
  expense_categories: string[];
  income_categories: string[];
  tags: string[];
  last_project: string; // "" = All projects
  forecast_weeks: 6 | 12 | 26;
  producer_name: string; // fills [Producer] in templates
  company_name: string; // fills [Company]
  threshold_1099: number; // user-set, since IRS rules change
  doc_types: string[];
  max_hours_week: number; // rehearsal hours per person per week before a warning; 0 = off
}

export const FISCAL_TAG = "Through fiscal sponsor";
export const DIRECT_SOURCE = "Direct (earned income)";

export const DEFAULT_SETTINGS: Settings = {
  currency: "USD",
  theme: "light",
  cushion: 0,
  money_sources: [
    { name: "Checking", opening_balance: 0, opening_date: "" },
    { name: "Card", opening_balance: 0, opening_date: "" },
    { name: "Cash", opening_balance: 0, opening_date: "" },
  ],
  expense_categories: [
    "Venue rental", "Artist fees", "Design", "Set & props", "Costumes", "Lighting & sound",
    "Marketing", "Insurance", "Software", "Travel", "Sponsor fees", "Other",
  ],
  income_categories: ["Donations", "Grants", "Ticket sales", "Fundraiser", "In-kind", "Other"],
  tags: [FISCAL_TAG, "Restricted", "In-kind", "Reimbursable", "Has receipt"],
  last_project: "",
  forecast_weeks: 12,
  producer_name: "",
  company_name: "",
  threshold_1099: 2000,
  doc_types: [],
  max_hours_week: 0,
};

// ---- Paperwork ----

export const DOC_TYPES = [
  "Artist agreement", "Crew agreement", "Venue rental agreement", "Rights / licensing",
  "Fiscal sponsorship agreement", "Grant agreement", "Certificate of insurance (COI)",
  "Photo / video release", "Permit", "W-9", "1099 issued", "Tax document received", "Other",
] as const;

export const DOC_STATUSES = ["Needed", "Drafted", "Sent", "Signed by them", "Fully signed", "Expired", "Void"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export interface DocFile {
  label: string; // "v1 sent", "v2 signed"
  file: string; // file name inside the document's folder
  added: string;
}

export interface Installment {
  amount: number;
  due: string;
  payment_id: string; // set once the matching payment is created
}

export interface PaperDoc {
  /** Folder relative to the vault, e.g. paperwork/contracts/prodigy-ana-reyes-director-agreement */
  path: string;
  title: string;
  type: string;
  project: string; // slug or "" (company-wide)
  people: string[]; // person slugs
  venues: string[]; // venue slugs
  status: DocStatus;
  sent: string;
  signed: string;
  effective: string;
  expires: string;
  amount: number | null;
  schedule: Installment[];
  files: DocFile[];
  template: string; // template it was drafted from
  notes: string; // markdown body
  extra?: Record<string, unknown>;
}

export interface Issued1099 {
  payee: string;
  issued_date: string;
  notes: string;
}

export interface Template {
  slug: string;
  title: string;
  group: string; // "Agreements", "Ask letters", ...
  doc_type: string; // for agreement templates: the Paperwork type it makes
  subject: string;
  solicitation: boolean; // "Needs fiscal sponsor review"
  body: string;
  extra?: Record<string, unknown>;
}

// ---- Schedule ----

export const EVENT_TYPES = ["Rehearsal", "Read-through", "Fitting", "Design meeting", "Tech", "Dress", "Performance", "Photo / video shoot", "Strike", "Other"] as const;

export interface ScheduleEvent {
  id: string;
  project: string;
  date: string;
  start: string; // HH:MM
  end: string;
  type: string;
  title: string;
  location: string; // venue slug, or free text
  called: string[]; // person slugs
  scenes: string[]; // scene ids
  notes: string;
}

export interface Conflict {
  id: string;
  person: string; // slug
  date: string;
  start: string; // blank = all day
  end: string;
  note: string;
}

export interface Scene {
  id: string;
  number: string; // "2.3"
  title: string;
  characters: string[];
}

// ---- Timeline ----

export type TaskStatus = "To do" | "Doing" | "Done" | "Skipped";
export type Anchor = "start" | "first_rehearsal" | "tech" | "opening" | "closing" | "end";

export interface TimelineTask {
  id: string;
  title: string;
  due: string; // absolute date, used when rel is empty
  rel: { anchor: Anchor; days: number } | null; // e.g. opening − 56
  owner: string; // "producer" or a person slug
  status: TaskStatus;
  department: string;
  phase: string;
  link: string; // optional link to another item, e.g. "payment:p3"
  todoist: boolean;
  todoist_task_id: string;
}

export interface TimelineTemplate {
  slug: string;
  title: string;
  description: string;
  tasks: Omit<TimelineTask, "id" | "status" | "todoist_task_id">[];
}

// ---- Shopping list ----

export type BuyerRole = "producer" | "designer" | "other" | "unassigned";
export const SHOP_DEPARTMENTS = ["Costumes", "Props", "Set", "Lighting", "Sound", "Stage management", "Marketing", "Hair & makeup", "Other"];
/** How an item is paid for. Sponsor funds (money sources linked to a sponsor) are also allowed. */
export const SHOP_MONEY = ["Producer card", "Reimburse", "In-kind", "Paid by venue"];

export interface ShoppingItem {
  id: string;
  project: string;
  item: string;
  where: string;
  link: string;
  department: string;
  buyer: string; // "producer", a person slug, or "" (unassigned)
  buyer_role: BuyerRole;
  need_by: string;
  est_cost: number | null;
  actual_cost: number | null;
  money: string; // one of SHOP_MONEY or a sponsor fund name
  status: "Needed" | "Got it" | "Reimbursed";
  receipt: string;
  notes: string;
  payment_id: string; // reimbursement payment
  ledger_id: string; // expense entry for producer-paid items
  inventory_id: string; // once moved into the Equipment log
}

// ---- Equipment log ----

export const INVENTORY_CATEGORIES = ["Camera", "Lighting", "Sound", "Grip", "Props", "Costumes", "Set pieces", "Keys / access", "Laptop / hard drives", "Other"];

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  owner: string; // "producer", "person:<slug>", "venue:<slug>", or a rental house name
  project: string;
  serial: string;
  value: number | null; // replacement value
  rental_house: string; // set for rented items
  rental_order: string; // groups items rented together
  rental_cost: number | null;
  rental_start: string; // pickup
  rental_end: string; // return by
  deposit: number | null;
  deposit_returned: boolean;
  returned: boolean; // rented item returned to the rental house
  condition: string;
  notes: string;
}

export interface Checkout {
  id: string;
  item: string; // item id
  person: string; // person slug
  out_date: string;
  due_date: string;
  in_date: string; // blank = still out
  condition_out: string;
  condition_in: string;
  notes: string;
}

// ---- Campaigns ----

export const CAMPAIGN_STATUSES = ["Ideas", "Drafting", "Scheduled", "Done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CHANNELS = ["Email", "Newsletter", "Instagram", "Facebook", "TikTok", "Print", "Event", "Phone", "In person", "Crowdfunding page", "Other"];

export interface Campaign {
  path: string; // campaigns/<date>-<slug>.md
  title: string;
  type: "Fundraising" | "Marketing";
  project: string;
  channel: string;
  status: CampaignStatus;
  date: string;
  end_date: string; // for crowdfunding pushes with an end
  template: string; // template slug
  goal: number | null;
  asks_sent: number | null;
  responses: number | null;
  result_amount: number | null; // typed in, or filled from linked entries
  result_notes: string; // e.g. "31 presale tickets"
  linked_entries: string[]; // ledger ids
  body: string;
  extra?: Record<string, unknown>;
}

// ---- Reports ----

export const REPORT_SECTIONS = ["income_by_source", "expenses_by_category", "budget_vs_actual", "restricted_funds", "sponsor_fees", "producer_notes", "receipts_appendix"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportSettings {
  report_for: string; // sponsor slug, or "" for another funder
  funder_name: string;
  grant_number: string;
  projects: string[]; // empty = all
  from: string;
  to: string;
  include: ReportSection[];
}

export interface SavedReport {
  path: string; // reports/<date>-<slug>.md, or reports/report-templates/<slug>.md
  title: string;
  template: boolean;
  settings: ReportSettings;
  sent: string; // date it was saved as sent
  snapshot: Record<string, unknown> | null; // numbers at the time it was sent
  notes: string; // producer notes (markdown body)
}

export interface TicketLine {
  type: string; // full, student, pay-what-you-can…
  sold: number;
  price: number; // average price per ticket
}

export interface HouseReport {
  path: string; // house-reports/<project>/<date>.md
  project: string;
  date: string;
  venue: string;
  call_time: string;
  start_time: string; // actual start
  capacity: number | null;
  tickets: TicketLine[];
  comps: { who: string; why: string }[];
  walkups: number;
  no_shows: number;
  attendance: number | null; // typed in; otherwise sold + comps − no-shows
  gross: number | null; // typed in; otherwise from tickets
  platform_fees: number;
  bar_sales: number | null;
  foh_notes: string;
  incidents: string;
  venue_notes: string;
}

export interface DailyCall {
  person: string;
  call: string; // scheduled call
  in: string; // actual in
  out: string;
  late: boolean;
  absent: boolean;
}

export interface DailyScene {
  scene: string; // number
  planned_pages: number; // eighths of a page, e.g. 3 = 3/8
  shot_pages: number;
  status: "Done" | "Partly done" | "Moved" | "Planned";
}

export interface DailyReport {
  path: string; // daily-reports/<project>/<date>.md
  project: string;
  date: string;
  kind: string; // Shoot day, Rehearsal, Tech, Work day
  location: string;
  planned_end: string;
  first_start: string;
  meal_start: string;
  meal_end: string;
  wrap: string;
  calls: DailyCall[];
  scenes: DailyScene[];
  setups: number | null;
  takes: number | null;
  used_items: string[]; // Equipment log ids
  injuries: string;
  damage: string;
  dept_notes: Record<string, string>;
  tomorrow: string;
  followups_done: boolean;
}

export interface VaultData {
  projects: Project[];
  ledger: LedgerEntry[];
  budgets: Record<string, BudgetLine[]>; // by project slug
  payments: Record<string, Payment[]>; // by project slug (owning project = first in alloc)
  people: Person[];
  venues: Venue[];
  sponsors: Sponsor[];
  settings: Settings;
  docs: PaperDoc[];
  issued1099: Record<string, Issued1099[]>; // by year
  templates: Template[];
  events: ScheduleEvent[];
  conflicts: Conflict[];
  scenes: Record<string, Scene[]>; // by project
  timelines: Record<string, TimelineTask[]>; // by project
  timelineTemplates: TimelineTemplate[];
  shopping: Record<string, ShoppingItem[]>; // by project
  inventory: InventoryItem[];
  checkouts: Checkout[];
  campaigns: Campaign[];
  reports: SavedReport[];
  houseReports: HouseReport[];
  dailyReports: DailyReport[];
}
