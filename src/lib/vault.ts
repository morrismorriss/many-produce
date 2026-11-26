// Read and write the whole vault as plain files.
import { budgetFromCSV, budgetToCSV } from "./budget";
import { parseFrontmatter, stringifyFrontmatter } from "./files";
import { byYear, ledgerFromCSV, ledgerToCSV } from "./ledger";
import { paymentsFromMd, paymentsToMd } from "./payments";
import {
  DEFAULT_SETTINGS,
  OVERHEAD_SLUG,
  type BudgetLine,
  type LedgerEntry,
  type Payment,
  type Person,
  type Project,
  type Settings,
  type Sponsor,
  type Venue,
  type VaultData,
} from "./types";
import type { VaultFS } from "./fs";

export const SETTINGS_PATH = ".manyproduce/settings.json";

export const PRESET_SPONSORS: Sponsor[] = [
  {
    slug: "fractured-atlas",
    name: "Fractured Atlas",
    fee_rate: 0.08,
    fee_applies_to: "contributed income",
    contact: "",
    account_url: "https://www.fracturedatlas.org",
    review_required_for: ["solicitations", "grant applications"],
    report_schedule: "",
    notes: "Preset. Check your agreement; rates can change.",
  },
  {
    slug: "producer-hub",
    name: "Producer Hub",
    fee_rate: 0.02,
    fee_applies_to: "contributed income",
    contact: "",
    account_url: "",
    review_required_for: [],
    report_schedule: "",
    notes: "Preset. Check your agreement; rates can change.",
  },
];

export const OVERHEAD_PROJECT: Project = {
  slug: OVERHEAD_SLUG,
  name: "Company overhead",
  color: "#9AA3B2",
  subtitle: "Shared costs",
  status: "in production",
  type: "Other",
  start: "",
  end: "",
  opening: "",
  city: "",
  fiscal_sponsor: "",
  sponsor_fee_rate: null,
  builtin: true,
  notes: "Shared costs: website, insurance, software, general donations.",
};

/** Keys of d that aren't in known, so hand-added frontmatter survives a save. */
function extraKeys(d: Record<string, unknown>, known: string[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!known.includes(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

const PROJECT_KEYS = ["slug", "name", "color", "subtitle", "status", "type", "start", "end", "opening", "city", "fiscal_sponsor", "sponsor_fee_rate"];
const PERSON_KEYS = ["name", "roles", "projects", "email", "phone", "city", "rate", "rate_type", "status", "pronouns", "payment_method", "w9_on_file", "w9_date", "notes"];
const VENUE_KEYS = ["name", "type", "city", "capacity", "rate", "tech_notes", "status", "projects", "next_step", "contact", "hold_dates", "coi_on_file"];
const SPONSOR_KEYS = ["name", "fee_rate", "fee_applies_to", "contact", "account_url", "review_required_for", "report_schedule"];

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? String(v).split(/,\s*/) : []);

async function readDocs(fs: VaultFS, dir: string): Promise<{ slug: string; data: Record<string, unknown>; body: string }[]> {
  const out = [];
  for (const e of await fs.list(dir)) {
    if (e.is_dir || !e.name.endsWith(".md")) continue;
    const text = await fs.read(`${dir}/${e.name}`);
    if (text === null) continue;
    const { data, body } = parseFrontmatter<Record<string, unknown>>(text);
    out.push({ slug: e.name.replace(/\.md$/, ""), data, body });
  }
  return out;
}

function projectFromDoc(slug: string, d: Record<string, unknown>, body: string): Project {
  return {
    slug: str(d.slug) || slug,
    name: str(d.name) || slug,
    color: str(d.color) || "#EE8AAE",
    subtitle: str(d.subtitle),
    status: (["planning", "in production", "closed"].includes(str(d.status)) ? str(d.status) : "planning") as Project["status"],
    type: (["Theater", "Film", "Other"].includes(str(d.type)) ? str(d.type) : "Theater") as Project["type"],
    start: str(d.start),
    end: str(d.end),
    opening: str(d.opening),
    city: str(d.city),
    fiscal_sponsor: str(d.fiscal_sponsor),
    sponsor_fee_rate: d.sponsor_fee_rate === undefined || d.sponsor_fee_rate === null || d.sponsor_fee_rate === "" ? null : Number(d.sponsor_fee_rate),
    builtin: slug === OVERHEAD_SLUG,
    notes: body.trim(),
    extra: extraKeys(d, PROJECT_KEYS),
  };
}

export function projectToMd(p: Project): string {
  const { notes, builtin, extra, ...data } = p;
  void builtin;
  return stringifyFrontmatter({ ...extra, ...data }, notes);
}

function personFromDoc(slug: string, d: Record<string, unknown>, body: string): Person {
  return {
    slug,
    name: str(d.name) || slug,
    roles: arr(d.roles),
    projects: arr(d.projects),
    email: str(d.email),
    phone: str(d.phone),
    city: str(d.city),
    rate: str(d.rate),
    rate_type: str(d.rate_type) as Person["rate_type"],
    status: (str(d.status) || "Reached out") as Person["status"],
    pronouns: str(d.pronouns),
    payment_method: str(d.payment_method),
    w9_on_file: d.w9_on_file === true || d.w9_on_file === "yes",
    notes: body.trim() || str(d.notes),
    extra: extraKeys(d, PERSON_KEYS),
  };
}

export function personToMd(p: Person): string {
  const { slug, notes, w9_on_file, extra, ...data } = p;
  void slug;
  return stringifyFrontmatter({ ...extra, ...data, w9_on_file: w9_on_file ? "yes" : "no" }, notes);
}

function venueFromDoc(slug: string, d: Record<string, unknown>, body: string): Venue {
  return {
    slug,
    name: str(d.name) || slug,
    type: str(d.type),
    city: str(d.city),
    capacity: d.capacity === undefined || d.capacity === "" ? null : Number(d.capacity),
    rate: str(d.rate),
    tech_notes: str(d.tech_notes),
    status: (str(d.status) || "Contacted") as Venue["status"],
    projects: arr(d.projects),
    next_step: str(d.next_step),
    contact: str(d.contact),
    hold_dates: str(d.hold_dates),
    notes: body.trim(),
    extra: extraKeys(d, VENUE_KEYS),
  };
}

export function venueToMd(v: Venue): string {
  const { slug, notes, extra, ...data } = v;
  void slug;
  return stringifyFrontmatter({ ...extra, ...data }, notes);
}

function sponsorFromDoc(slug: string, d: Record<string, unknown>, body: string): Sponsor {
  return {
    slug,
    name: str(d.name) || slug,
    fee_rate: Number(d.fee_rate) || 0,
    fee_applies_to: str(d.fee_applies_to) || "contributed income",
    contact: str(d.contact),
    account_url: str(d.account_url),
    review_required_for: arr(d.review_required_for),
    report_schedule: str(d.report_schedule),
    notes: body.trim(),
    extra: extraKeys(d, SPONSOR_KEYS),
  };
}

export function sponsorToMd(s: Sponsor): string {
  const { slug, notes, extra, ...data } = s;
  void slug;
  return stringifyFrontmatter({ ...extra, ...data }, notes);
}

/** Make sure the built-in pieces exist (overhead project, sponsor presets, settings). */
export async function initVault(fs: VaultFS): Promise<void> {
  if ((await fs.read(`projects/${OVERHEAD_SLUG}/project.md`)) === null) {
    await fs.write(`projects/${OVERHEAD_SLUG}/project.md`, projectToMd(OVERHEAD_PROJECT));
  }
  if (!(await fs.list("sponsors")).length) {
    for (const s of PRESET_SPONSORS) await fs.write(`sponsors/${s.slug}.md`, sponsorToMd(s));
  }
  if ((await fs.read(SETTINGS_PATH)) === null) {
    await fs.write(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

export async function loadVault(fs: VaultFS): Promise<VaultData> {
  await initVault(fs);
  const projects: Project[] = [];
  const budgets: Record<string, BudgetLine[]> = {};
  const payments: Record<string, Payment[]> = {};
  for (const e of await fs.list("projects")) {
    if (!e.is_dir) continue;
    const text = await fs.read(`projects/${e.name}/project.md`);
    if (text === null) continue;
    const { data, body } = parseFrontmatter<Record<string, unknown>>(text);
    const p = projectFromDoc(e.name, data, body);
    p.slug = e.name; // folder name is the source of truth
    projects.push(p);
    budgets[p.slug] = budgetFromCSV((await fs.read(`projects/${p.slug}/budget.csv`)) ?? "");
    payments[p.slug] = paymentsFromMd((await fs.read(`projects/${p.slug}/payments.md`)) ?? "").payments;
  }
  projects.sort((a, b) => Number(!!a.builtin) - Number(!!b.builtin) || a.name.localeCompare(b.name));

  const ledger: LedgerEntry[] = [];
  for (const e of await fs.list("ledger")) {
    if (e.is_dir || !e.name.endsWith(".csv")) continue;
    ledger.push(...ledgerFromCSV((await fs.read(`ledger/${e.name}`)) ?? ""));
  }

  const people = (await readDocs(fs, "people")).map((d) => personFromDoc(d.slug, d.data, d.body));
  const venues = (await readDocs(fs, "venues")).map((d) => venueFromDoc(d.slug, d.data, d.body));
  const sponsors = (await readDocs(fs, "sponsors")).map((d) => sponsorFromDoc(d.slug, d.data, d.body));

  let settings: Settings = DEFAULT_SETTINGS;
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse((await fs.read(SETTINGS_PATH)) ?? "{}") };
  } catch {
    /* keep defaults if the file is broken */
  }

  return { projects, ledger, budgets, payments, people, venues, sponsors, settings };
}

// ---- writers ----

export async function saveLedger(fs: VaultFS, ledger: LedgerEntry[], touchedYears?: Set<string>): Promise<void> {
  const groups = byYear(ledger);
  const years = touchedYears ?? new Set(groups.keys());
  for (const y of years) await fs.write(`ledger/${y}.csv`, ledgerToCSV(groups.get(y) ?? []));
}

export const saveProject = (fs: VaultFS, p: Project) => fs.write(`projects/${p.slug}/project.md`, projectToMd(p));
export const saveBudget = (fs: VaultFS, slug: string, lines: BudgetLine[]) => fs.write(`projects/${slug}/budget.csv`, budgetToCSV(lines));
export const savePayments = (fs: VaultFS, slug: string, list: Payment[]) => fs.write(`projects/${slug}/payments.md`, paymentsToMd(list));
export const savePerson = (fs: VaultFS, p: Person) => fs.write(`people/${p.slug}.md`, personToMd(p));
export const saveVenue = (fs: VaultFS, v: Venue) => fs.write(`venues/${v.slug}.md`, venueToMd(v));
export const saveSponsor = (fs: VaultFS, s: Sponsor) => fs.write(`sponsors/${s.slug}.md`, sponsorToMd(s));
export const saveSettings = (fs: VaultFS, s: Settings) => fs.write(SETTINGS_PATH, JSON.stringify(s, null, 2));
