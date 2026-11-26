// A small sample vault so the app has something to show on first run
// ("Try with sample data") and in the browser demo. Dates are relative to today.
import { budgetToCSV } from "./budget";
import { ledgerToCSV, upsertWithFees } from "./ledger";
import { paymentsToMd } from "./payments";
import {
  DEFAULT_SETTINGS,
  FISCAL_TAG,
  DIRECT_SOURCE,
  type BudgetLine,
  type LedgerEntry,
  type Payment,
  type Person,
  type Project,
  type Settings,
  type PaperDoc,
  type Venue,
} from "./types";
import { addDays, todayISO } from "./util";
import { docToMd } from "./paperwork";
import { OVERHEAD_PROJECT, PRESET_SPONSORS, SETTINGS_PATH, personToMd, projectToMd, sponsorToMd, venueToMd } from "./vault";

export function sampleVault(today = todayISO()): Record<string, string> {
  const d = (n: number) => addDays(today, n);
  const files: Record<string, string> = {};

  const projects: Project[] = [
    {
      ...OVERHEAD_PROJECT,
    },
    {
      slug: "prodigy",
      name: "Prodigy",
      color: "#EE8AAE",
      subtitle: "Summer 2027 · Chicago",
      status: "planning",
      type: "Theater",
      start: d(-40),
      end: d(230),
      opening: d(220),
      city: "Chicago",
      fiscal_sponsor: "fractured-atlas",
      sponsor_fee_rate: null,
      notes: "New play, 6 actors, black box run of 12 performances.",
    },
    {
      slug: "made-men-reading",
      name: "Made Men reading",
      color: "#6FB3E0",
      subtitle: "Staged reading · Feb 2027",
      status: "in production",
      type: "Theater",
      start: d(-20),
      end: d(80),
      opening: d(75),
      city: "Chicago",
      fiscal_sponsor: "producer-hub",
      sponsor_fee_rate: null,
      notes: "One-night staged reading with talkback.",
    },
  ];
  for (const p of projects) files[`projects/${p.slug}/project.md`] = projectToMd(p);
  for (const s of PRESET_SPONSORS) files[`sponsors/${s.slug}.md`] = sponsorToMd(s);

  const budget = (slug: string, lines: Partial<BudgetLine>[]) => {
    files[`projects/${slug}/budget.csv`] = budgetToCSV(
      lines.map((l, i) => ({
        id: `b${i + 1}`,
        category: "Other",
        type: "expense",
        line_item: "",
        quantity: 1,
        rate: l.amount ?? 0,
        amount: 0,
        notes: "",
        expected_date: "",
        confidence: "",
        through_sponsor: false,
        source: "",
        ...l,
      })),
    );
  };
  budget("prodigy", [
    { category: "Venue rental", line_item: "Uptown Studio Theatre, 3 weeks", amount: 4800, notes: "Deposit + balance" },
    { category: "Artist fees", line_item: "Director", amount: 1500 },
    { category: "Artist fees", line_item: "Actors (6 × $400)", quantity: 6, rate: 400, amount: 2400 },
    { category: "Design", line_item: "Lighting + set designers", amount: 1200 },
    { category: "Costumes", line_item: "Costumes", amount: 400 },
    { category: "Marketing", line_item: "Instagram ads + postcards", amount: 600 },
    { category: "Insurance", line_item: "Event liability", amount: 350 },
    { type: "income", category: "Donations", line_item: "Crowdfunding (Fractured Atlas fund)", amount: 6000, expected_date: d(52), confidence: "Confirmed", through_sponsor: true, source: "Fractured Atlas fund" },
    { type: "income", category: "Grants", line_item: "City arts micro-grant", amount: 2500, expected_date: d(95), confidence: "Likely", through_sponsor: true, source: "Fractured Atlas fund" },
    { type: "income", category: "Ticket sales", line_item: "Ticket sales (12 shows)", amount: 4200, expected_date: d(222), confidence: "Hoped for", source: DIRECT_SOURCE },
  ]);
  budget("made-men-reading", [
    { category: "Venue rental", line_item: "Gallery rental, one night", amount: 300 },
    { category: "Artist fees", line_item: "Reading stipends (5 × $100)", quantity: 5, rate: 100, amount: 500 },
    { category: "Marketing", line_item: "Instagram ads share", amount: 120 },
    { type: "income", category: "Donations", line_item: "Reading night donations", amount: 900, expected_date: d(76), confidence: "Likely", through_sponsor: true, source: "Producer Hub fund" },
  ]);
  budget("overhead", [
    { category: "Software", line_item: "Website + domain", amount: 240 },
    { category: "Insurance", line_item: "General liability (annual)", amount: 500 },
  ]);

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    cushion: 200,
    money_sources: [
      { name: "Checking", opening_balance: 2900, opening_date: d(-60) },
      { name: "Card", opening_balance: 0, opening_date: d(-60) },
      { name: "Cash", opening_balance: 60, opening_date: d(-60) },
      { name: "Fractured Atlas fund", opening_balance: 0, opening_date: d(-60), sponsor: "fractured-atlas" },
      { name: "Producer Hub fund", opening_balance: 0, opening_date: d(-60), sponsor: "producer-hub" },
      { name: DIRECT_SOURCE, opening_balance: 0, opening_date: d(-60) },
    ],
  };
  files[SETTINGS_PATH] = JSON.stringify(settings, null, 2);

  const e = (x: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "date" | "kind" | "amount">): LedgerEntry => ({
    description: "",
    project_alloc: { prodigy: 1 },
    category: "Other",
    source: "Checking",
    counterparty: "",
    tags: [],
    receipt: "",
    restricted_to: "",
    linked_payment: "",
    linked_shopping_item: "",
    notes: "",
    ...x,
  });
  const allProjects = projects;
  let ledger: LedgerEntry[] = [];
  const add = (x: LedgerEntry) => (ledger = upsertWithFees(ledger, x, allProjects, PRESET_SPONSORS));
  add(e({ id: "e1", date: d(-34), kind: "income", amount: 1500, description: "Early donors (5 gifts)", category: "Donations", source: "Fractured Atlas fund", tags: [FISCAL_TAG] }));
  add(e({ id: "e2", date: d(-30), kind: "expense", amount: 150, description: "Rehearsal room, 3 sessions", category: "Venue rental", counterparty: "Uptown Studio Theatre", source: "Card", tags: ["Has receipt"] }));
  add(e({ id: "e3", date: d(-21), kind: "expense", amount: 500, description: "Director, first installment", category: "Artist fees", counterparty: "Ana Reyes", linked_payment: "p1" }));
  add(e({ id: "e4", date: d(-14), kind: "expense", amount: 200, description: "Instagram ads", category: "Marketing", source: "Card", project_alloc: { prodigy: 0.6, "made-men-reading": 0.4 } }));
  add(e({ id: "e5", date: d(-12), kind: "income", amount: 400, description: "Reading sponsor gift", category: "Donations", source: "Producer Hub fund", project_alloc: { "made-men-reading": 1 }, tags: [FISCAL_TAG, "Restricted"], restricted_to: "Reading stipends" }));
  add(e({ id: "e6", date: d(-9), kind: "expense", amount: 240, description: "Website + domain renewal", category: "Software", source: "Card", project_alloc: { overhead: 1 } }));
  add(e({ id: "e7", date: d(-5), kind: "expense", amount: 300, description: "Uptown Studio Theatre deposit (1 of 2)", category: "Venue rental", source: "Fractured Atlas fund", counterparty: "Uptown Studio Theatre" }));
  files[`ledger/${today.slice(0, 4)}.csv`] = ledgerToCSV(ledger.filter((x) => x.date.slice(0, 4) === today.slice(0, 4)));
  const prevYear = ledger.filter((x) => x.date.slice(0, 4) !== today.slice(0, 4));
  if (prevYear.length) files[`ledger/${prevYear[0].date.slice(0, 4)}.csv`] = ledgerToCSV(prevYear);

  const pay = (x: Partial<Payment> & Pick<Payment, "id" | "title" | "due" | "amount">): Payment => ({
    payee: "",
    method: "Checking",
    budget_line: "",
    category: "Other",
    status: "scheduled",
    paid_date: "",
    ledger_id: "",
    project_alloc: { prodigy: 1 },
    notes: "",
    ...x,
  });
  files["projects/prodigy/payments.md"] = paymentsToMd([
    pay({ id: "p1", title: "Director, installment 1 of 3", payee: "Ana Reyes", category: "Artist fees", budget_line: "b2", due: d(-21), amount: 500, status: "paid", paid_date: d(-21), ledger_id: "e3" }),
    pay({ id: "p2", title: "Director, installment 2 of 3", payee: "Ana Reyes", category: "Artist fees", budget_line: "b2", due: d(-3), amount: 500 }),
    pay({ id: "p3", title: "Venue deposit (2 of 2)", payee: "Uptown Studio Theatre", category: "Venue rental", budget_line: "b1", due: d(40), amount: 1500, method: "Fractured Atlas fund" }),
    pay({ id: "p4", title: "Event liability insurance", payee: "Insurer", category: "Insurance", budget_line: "b7", due: d(18), amount: 350 }),
    pay({ id: "p5", title: "Lighting designer fee", payee: "Jun Park", category: "Design", budget_line: "b4", due: d(70), amount: 600 }),
  ]);
  files["projects/made-men-reading/payments.md"] = paymentsToMd([
    pay({ id: "p6", title: "Gallery rental", payee: "Fulton Gallery", category: "Venue rental", budget_line: "b1", due: d(60), amount: 300, project_alloc: { "made-men-reading": 1 } }),
    pay({ id: "p7", title: "Reading stipends", payee: "Cast", category: "Artist fees", budget_line: "b2", due: d(76), amount: 500, method: "Producer Hub fund", project_alloc: { "made-men-reading": 1 } }),
  ]);
  files["projects/overhead/payments.md"] = paymentsToMd([
    pay({ id: "p8", title: "General liability (annual)", payee: "Insurer", category: "Insurance", due: d(25), amount: 500, project_alloc: { overhead: 1 } }),
  ]);

  const people: Person[] = [
    { slug: "ana-reyes", name: "Ana Reyes", roles: ["Director"], projects: ["prodigy"], email: "ana@example.com", phone: "", city: "Chicago", rate: "1500", rate_type: "flat", status: "Confirmed", pronouns: "she/her", payment_method: "Zelle", w9_on_file: true, w9_date: d(-25), notes: "Directed our 2025 reading." },
    { slug: "jun-park", name: "Jun Park", roles: ["Lighting"], projects: ["prodigy"], email: "jun@example.com", phone: "", city: "Chicago", rate: "600", rate_type: "flat", status: "Offer out", pronouns: "they/them", payment_method: "Venmo", w9_on_file: false, w9_date: "", notes: "" },
    { slug: "maya-ostrowski", name: "Maya Ostrowski", roles: ["Actor"], projects: ["prodigy", "made-men-reading"], email: "maya@example.com", phone: "", city: "Evanston", rate: "400", rate_type: "stipend", status: "Confirmed", pronouns: "", payment_method: "", w9_on_file: false, w9_date: "", notes: "" },
    { slug: "dev-okafor", name: "Dev Okafor", roles: ["Stage manager"], projects: ["made-men-reading"], email: "dev@example.com", phone: "", city: "Chicago", rate: "25", rate_type: "hourly", status: "Reached out", pronouns: "he/him", payment_method: "", w9_on_file: false, w9_date: "", notes: "" },
  ];
  for (const p of people) files[`people/${p.slug}.md`] = personToMd(p);

  const venues: Venue[] = [
    { slug: "uptown-studio-theatre", name: "Uptown Studio Theatre", type: "black box", city: "Chicago", capacity: 60, rate: "$1,600/week", tech_notes: "12 dimmers, no fly space", status: "Booked", projects: ["prodigy"], next_step: "Send COI", contact: "Lee (house manager)", hold_dates: "", notes: "" },
    { slug: "fulton-gallery", name: "Fulton Gallery", type: "gallery", city: "Chicago", capacity: 45, rate: "$300/night", tech_notes: "Bring a PA", status: "Hold", projects: ["made-men-reading"], next_step: "Confirm date", contact: "", hold_dates: d(75), notes: "" },
    { slug: "hop-hall", name: "Hop Hall Brewery", type: "brewery", city: "Chicago", capacity: 80, rate: "Bar minimum $800", tech_notes: "", status: "Toured", projects: [], next_step: "Ask about Monday nights", contact: "", hold_dates: "", notes: "" },
  ];
  for (const v of venues) files[`venues/${v.slug}.md`] = venueToMd(v);

  // Paperwork
  const doc = (path: string, x: Partial<PaperDoc>) => {
    files[`${path}/paperwork.md`] = docToMd({
      path, title: "", type: "Other", project: "", people: [], venues: [], status: "Needed", sent: "", signed: "", effective: "",
      expires: "", amount: null, schedule: [], files: [], template: "", notes: "", ...x,
    });
  };
  doc("paperwork/contracts/prodigy-ana-reyes-director-agreement", {
    title: "Ana Reyes director agreement", type: "Artist agreement", project: "prodigy", people: ["ana-reyes"], status: "Fully signed",
    sent: d(-30), signed: d(-26), effective: d(-26), amount: 1500, template: "artist-agreement",
    schedule: [{ amount: 500, due: d(-21), payment_id: "p1" }, { amount: 500, due: d(-3), payment_id: "p2" }, { amount: 500, due: d(200), payment_id: "" }],
  });
  doc("paperwork/contracts/prodigy-maya-ostrowski-actor-agreement", {
    title: "Maya Ostrowski actor agreement", type: "Artist agreement", project: "prodigy", people: ["maya-ostrowski"], status: "Sent",
    sent: d(-4), amount: 400, template: "artist-agreement",
  });
  doc("paperwork/contracts/prodigy-uptown-studio-theatre-rental", {
    title: "Uptown Studio Theatre rental", type: "Venue rental agreement", project: "prodigy", venues: ["uptown-studio-theatre"], status: "Fully signed",
    signed: d(-8), amount: 4800,
  });
  doc("paperwork/contracts/prodigy-fractured-atlas-sponsorship", {
    title: "Fractured Atlas fiscal sponsorship (Prodigy)", type: "Fiscal sponsorship agreement", project: "prodigy", status: "Fully signed",
    signed: d(-50), effective: d(-50),
  });
  doc("paperwork/contracts/overhead-general-liability-coi", {
    title: "General liability certificate", type: "Certificate of insurance (COI)", project: "overhead", status: "Fully signed",
    effective: d(-340), expires: d(25),
  });
  files["paperwork/tax/" + today.slice(0, 4) + "/1099s.csv"] = "payee,issued_date,notes\n";

  return files;
}
