// Core data model. Every type here maps to a plain file in the vault
// (see docs/FILE-FORMATS.md).

export type ProjectStatus = "planning" | "in production" | "closed";
export type ProjectType = "Theater" | "Film" | "Other";

export interface Project {
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

export type BudgetType = "expense" | "income";
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
}

export type PersonStatus = "Reached out" | "Offer out" | "Confirmed" | "Past collaborator";
export interface Person {
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
  notes: string;
}

export type VenueStatus = "Contacted" | "Toured" | "Hold" | "Booked" | "Passed";
export interface Venue {
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
};

export interface VaultData {
  projects: Project[];
  ledger: LedgerEntry[];
  budgets: Record<string, BudgetLine[]>; // by project slug
  payments: Record<string, Payment[]>; // by project slug (owning project = first in alloc)
  people: Person[];
  venues: Venue[];
  sponsors: Sponsor[];
  settings: Settings;
}
