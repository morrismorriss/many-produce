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
import { docFromMd, docToMd, issuedFromCSV, issuedToCSV, templateFromMd, templateToMd } from "./paperwork";
import { STARTER_TEMPLATES } from "./starterTemplates";
import type { Conflict, Issued1099, PaperDoc, Scene, ScheduleEvent, Template, TimelineTask, TimelineTemplate } from "./types";
import { conflictsFromCSV, conflictsToCSV, eventsFromCSV, eventsToCSV, scenesFromCSV, scenesToCSV } from "./schedule";
import { shoppingFromCSV, shoppingToCSV } from "./shopping";
import { checkoutsFromCSV, checkoutsToCSV, itemsFromCSV, itemsToCSV } from "./inventory";
import type { Campaign, Checkout, InventoryItem, ShoppingItem } from "./types";
import { campaignFromMd, campaignToMd } from "./campaigns";
import { dailyFromMd, dailyToMd, houseFromMd, houseToMd, savedReportFromMd, savedReportToMd } from "./reports";
import type { Board, Clearance, DailyReport, HouseReport, SavedReport, StripScene, VenueDeal } from "./types";
import { boardFromJSON, normalizeBoard, stripsFromCSV, stripsToCSV } from "./stripboard";
import { clearancesFromCSV, clearancesToCSV } from "./clearances";
import { STARTER_TIMELINE_TEMPLATES, timelineFromMd, timelineTemplateFromMd, timelineTemplateToMd, timelineToMd } from "./timeline";

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

const PROJECT_KEYS = ["cast", "stripboard", "planned_uses", "slug", "name", "color", "subtitle", "status", "type", "start", "end", "opening", "city", "fiscal_sponsor", "sponsor_fee_rate"];
const PERSON_KEYS = ["name", "roles", "projects", "email", "phone", "city", "rate", "rate_type", "status", "pronouns", "payment_method", "w9_on_file", "w9_date", "notes"];
const VENUE_KEYS = ["deal", "name", "type", "city", "capacity", "rate", "tech_notes", "status", "projects", "next_step", "contact", "hold_dates", "coi_on_file"];
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
    stripboard: d.stripboard === true ? true : undefined,
    planned_uses: Array.isArray(d.planned_uses) ? d.planned_uses.map(String) : undefined,
    cast: d.cast && typeof d.cast === "object" ? Object.fromEntries(Object.entries(d.cast as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined,
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
    w9_date: str(d.w9_date),
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
    deal: d.deal && typeof d.deal === "object" ? (d.deal as VenueDeal) : undefined,
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
  if (!(await fs.list("timeline/timeline-templates")).length) {
    for (const t of STARTER_TIMELINE_TEMPLATES) await fs.write(`timeline/timeline-templates/${t.slug}.md`, timelineTemplateToMd(t));
  }
  if (!(await fs.list("templates")).length) {
    for (const t of STARTER_TEMPLATES) await fs.write(`templates/${t.slug}.md`, templateToMd(t));
  }
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
  const shopping: Record<string, ShoppingItem[]> = {};
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
    shopping[p.slug] = shoppingFromCSV(p.slug, (await fs.read(`projects/${p.slug}/shopping.csv`)) ?? "");
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
    const raw = JSON.parse((await fs.read(SETTINGS_PATH)) ?? "{}");
    settings = { ...DEFAULT_SETTINGS, ...raw, todoist: { ...DEFAULT_SETTINGS.todoist, ...(raw.todoist ?? {}), sync: { ...DEFAULT_SETTINGS.todoist.sync, ...(raw.todoist?.sync ?? {}) } } };
  } catch {
    /* keep defaults if the file is broken */
  }

  // Paperwork: paperwork/contracts/<doc>/ and paperwork/tax/<year>/<doc>/
  const docs: PaperDoc[] = [];
  const readDocFolder = async (dir: string) => {
    const text = await fs.read(`${dir}/paperwork.md`);
    if (text !== null) docs.push(docFromMd(dir, text));
  };
  for (const e of await fs.list("paperwork/contracts")) if (e.is_dir) await readDocFolder(`paperwork/contracts/${e.name}`);
  const issued1099: Record<string, Issued1099[]> = {};
  for (const y of await fs.list("paperwork/tax")) {
    if (!y.is_dir) continue;
    for (const e of await fs.list(`paperwork/tax/${y.name}`)) {
      if (e.is_dir) await readDocFolder(`paperwork/tax/${y.name}/${e.name}`);
      else if (e.name === "1099s.csv") issued1099[y.name] = issuedFromCSV((await fs.read(`paperwork/tax/${y.name}/1099s.csv`)) ?? "");
    }
  }

  const templates: Template[] = [];
  for (const e of await fs.list("templates")) {
    if (e.is_dir || !e.name.endsWith(".md")) continue;
    const text = await fs.read(`templates/${e.name}`);
    if (text !== null) templates.push(templateFromMd(e.name.replace(/\.md$/, ""), text));
  }

  // Schedule: schedule/<project>.csv, schedule/<project>-scenes.csv, schedule/conflicts.csv
  const events: ScheduleEvent[] = [];
  const scenes: Record<string, Scene[]> = {};
  let conflicts: Conflict[] = [];
  for (const e of await fs.list("schedule")) {
    if (e.is_dir || !e.name.endsWith(".csv")) continue;
    const text = (await fs.read(`schedule/${e.name}`)) ?? "";
    if (e.name === "conflicts.csv") conflicts = conflictsFromCSV(text);
    else if (e.name.endsWith("-scenes.csv")) scenes[e.name.slice(0, -"-scenes.csv".length)] = scenesFromCSV(text);
    else events.push(...eventsFromCSV(e.name.slice(0, -4), text));
  }

  // Timeline: timeline/<project>.md and timeline/timeline-templates/<slug>.md
  const timelines: Record<string, TimelineTask[]> = {};
  for (const e of await fs.list("timeline")) {
    if (e.is_dir || !e.name.endsWith(".md")) continue;
    timelines[e.name.slice(0, -3)] = timelineFromMd((await fs.read(`timeline/${e.name}`)) ?? "").tasks;
  }
  const timelineTemplates: TimelineTemplate[] = [];
  for (const e of await fs.list("timeline/timeline-templates")) {
    if (e.is_dir || !e.name.endsWith(".md")) continue;
    timelineTemplates.push(timelineTemplateFromMd(e.name.slice(0, -3), (await fs.read(`timeline/timeline-templates/${e.name}`)) ?? ""));
  }

  const inventory: InventoryItem[] = itemsFromCSV((await fs.read("inventory/items.csv")) ?? "");
  const checkouts: Checkout[] = checkoutsFromCSV((await fs.read("inventory/checkouts.csv")) ?? "");

  const campaigns: Campaign[] = [];
  for (const e of await fs.list("campaigns")) {
    if (e.is_dir || !e.name.endsWith(".md")) continue;
    campaigns.push(campaignFromMd(`campaigns/${e.name}`, (await fs.read(`campaigns/${e.name}`)) ?? ""));
  }

  // Reports: reports/*.md and reports/report-templates/*.md
  const reports: SavedReport[] = [];
  for (const dir of ["reports", "reports/report-templates"]) {
    for (const e of await fs.list(dir)) {
      if (e.is_dir || !e.name.endsWith(".md")) continue;
      reports.push(savedReportFromMd(`${dir}/${e.name}`, (await fs.read(`${dir}/${e.name}`)) ?? ""));
    }
  }
  const readPerProject = async <T,>(root: string, parse: (path: string, text: string) => T): Promise<T[]> => {
    const out: T[] = [];
    for (const pd of await fs.list(root)) {
      if (!pd.is_dir) continue;
      for (const e of await fs.list(`${root}/${pd.name}`)) {
        if (e.is_dir || !e.name.endsWith(".md")) continue;
        const path = `${root}/${pd.name}/${e.name}`;
        out.push(parse(path, (await fs.read(path)) ?? ""));
      }
    }
    return out;
  };
  const houseReports: HouseReport[] = await readPerProject("house-reports", houseFromMd);
  const dailyReports: DailyReport[] = await readPerProject("daily-reports", dailyFromMd);

  // Stripboard and clearances, per project
  const strips: Record<string, StripScene[]> = {};
  const boards: Record<string, Board> = {};
  for (const pd of await fs.list("stripboard")) {
    if (!pd.is_dir) continue;
    strips[pd.name] = stripsFromCSV((await fs.read(`stripboard/${pd.name}/scenes.csv`)) ?? "");
    boards[pd.name] = normalizeBoard(boardFromJSON(await fs.read(`stripboard/${pd.name}/board.json`)), strips[pd.name]);
  }
  const clearances: Record<string, Clearance[]> = {};
  for (const e of await fs.list("clearances")) {
    if (e.is_dir || !e.name.endsWith(".csv")) continue;
    const slug = e.name.slice(0, -4);
    clearances[slug] = clearancesFromCSV(slug, (await fs.read(`clearances/${e.name}`)) ?? "");
  }

  return { projects, ledger, budgets, payments, people, venues, sponsors, settings, docs, issued1099, templates, events, conflicts, scenes, timelines, timelineTemplates, shopping, inventory, checkouts, campaigns, reports, houseReports, dailyReports, strips, boards, clearances };
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
export const saveDoc = (fs: VaultFS, d: PaperDoc) => fs.write(`${d.path}/paperwork.md`, docToMd(d));
export const saveIssued1099 = (fs: VaultFS, year: string, rows: Issued1099[]) => fs.write(`paperwork/tax/${year}/1099s.csv`, issuedToCSV(rows));
export const saveTemplate = (fs: VaultFS, t: Template) => fs.write(`templates/${t.slug}.md`, templateToMd(t));
export const saveEvents = (fs: VaultFS, project: string, all: ScheduleEvent[]) => fs.write(`schedule/${project}.csv`, eventsToCSV(all.filter((e) => e.project === project)));
export const saveConflicts = (fs: VaultFS, c: Conflict[]) => fs.write("schedule/conflicts.csv", conflictsToCSV(c));
export const saveScenes = (fs: VaultFS, project: string, s: Scene[]) => fs.write(`schedule/${project}-scenes.csv`, scenesToCSV(s));
export const saveTimeline = (fs: VaultFS, project: string, tasks: TimelineTask[]) => fs.write(`timeline/${project}.md`, timelineToMd(tasks));
export const saveTimelineTemplate = (fs: VaultFS, t: TimelineTemplate) => fs.write(`timeline/timeline-templates/${t.slug}.md`, timelineTemplateToMd(t));
export const saveShopping = (fs: VaultFS, project: string, items: ShoppingItem[]) => fs.write(`projects/${project}/shopping.csv`, shoppingToCSV(items));
export const saveInventory = (fs: VaultFS, items: InventoryItem[]) => fs.write("inventory/items.csv", itemsToCSV(items));
export const saveCheckouts = (fs: VaultFS, c: Checkout[]) => fs.write("inventory/checkouts.csv", checkoutsToCSV(c));
export const saveCampaign = (fs: VaultFS, c: Campaign) => fs.write(c.path, campaignToMd(c));
export const saveReport = (fs: VaultFS, r: SavedReport) => fs.write(r.path, savedReportToMd(r));
export const saveHouseReport = (fs: VaultFS, h: HouseReport) => fs.write(h.path, houseToMd(h));
export const saveDailyReport = (fs: VaultFS, r: DailyReport, people: import("./types").Person[]) => fs.write(r.path, dailyToMd(r, people));
export const saveStrips = (fs: VaultFS, project: string, s: StripScene[]) => fs.write(`stripboard/${project}/scenes.csv`, stripsToCSV(s));
export const saveBoard = (fs: VaultFS, project: string, b: Board) => fs.write(`stripboard/${project}/board.json`, JSON.stringify(b, null, 2));
export const saveClearances = (fs: VaultFS, project: string, c: Clearance[]) => fs.write(`clearances/${project}.csv`, clearancesToCSV(c));
export const saveSettings = (fs: VaultFS, s: Settings) => fs.write(SETTINGS_PATH, JSON.stringify(s, null, 2));
