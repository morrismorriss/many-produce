import { budgetFromCSV, budgetToCSV, budgetToManyApplyCSV, expenseActuals, incomeActuals } from "./budget";
import { parseFrontmatter, stringifyFrontmatter } from "./files";
import { buildForecast } from "./forecast";
import {
  earnedIncomeNote,
  ledgerFromCSV,
  ledgerToCSV,
  removeWithFees,
  sourceBalances,
  sponsorFeeEntry,
  totals,
  upsertWithFees,
} from "./ledger";
import { groupOf, ledgerEntryForPayment, paymentsFromMd, paymentsToICS, paymentsToMd } from "./payments";
import { FISCAL_TAG, type LedgerEntry, type Payment, type Project, type Sponsor } from "./types";
import { allocValid, formatAlloc, parseAlloc, shareOf, slugify, weekStart } from "./util";
import { loadVault } from "../vault/store";
import { MemoryFS } from "../vault/fs";
import { sampleVault } from "../vault/seed";

const sponsors: Sponsor[] = [
  { slug: "fa", name: "Fractured Atlas", fee_rate: 0.08, fee_applies_to: "", contact: "", account_url: "", review_required_for: [], report_schedule: "", notes: "" },
  { slug: "ph", name: "Producer Hub", fee_rate: 0.02, fee_applies_to: "", contact: "", account_url: "", review_required_for: [], report_schedule: "", notes: "" },
];
const proj = (slug: string, fiscal_sponsor = ""): Project => ({
  slug, name: slug, color: "", subtitle: "", status: "planning", type: "Theater", start: "", end: "", opening: "", city: "",
  fiscal_sponsor, sponsor_fee_rate: null, notes: "",
});
const projects = [proj("a", "fa"), proj("b", "ph"), proj("c")];
const entry = (x: Partial<LedgerEntry>): LedgerEntry => ({
  id: "x", date: "2026-11-01", kind: "income", amount: 100, description: "Gift", project_alloc: { a: 1 }, category: "Donations",
  source: "Checking", counterparty: "", tags: [], receipt: "", restricted_to: "", linked_payment: "", linked_shopping_item: "", notes: "", ...x,
});

describe("util", () => {
  it("parses and formats allocations", () => {
    const a = parseAlloc("prodigy:0.6;made-men-reading:0.4");
    expect(a).toEqual({ prodigy: 0.6, "made-men-reading": 0.4 });
    expect(formatAlloc(a)).toBe("prodigy:0.6;made-men-reading:0.4");
    expect(formatAlloc({ prodigy: 1 })).toBe("prodigy");
    expect(parseAlloc("prodigy")).toEqual({ prodigy: 1 });
    expect(shareOf(a, "prodigy")).toBe(0.6);
    expect(shareOf(a, "")).toBe(1);
    expect(allocValid(a)).toBe(true);
    expect(allocValid({ a: 0.5 })).toBe(false);
  });
  it("slugifies and finds week starts", () => {
    expect(slugify("Made Men: Reading!")).toBe("made-men-reading");
    expect(weekStart("2026-11-26")).toBe("2026-11-23"); // Thursday -> Monday
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
  });
});

describe("files", () => {
  it("round-trips frontmatter", () => {
    const t = stringifyFrontmatter({ name: "Ana", roles: ["Director"] }, "Notes here");
    const { data, body } = parseFrontmatter<{ name: string; roles: string[] }>(t);
    expect(data).toEqual({ name: "Ana", roles: ["Director"] });
    expect(body.trim()).toBe("Notes here");
  });
});

describe("ledger", () => {
  it("round-trips CSV with commas and splits", () => {
    const e = entry({ id: "e1", description: 'Gift, "big" one', project_alloc: { a: 0.6, b: 0.4 }, tags: ["Restricted", FISCAL_TAG] });
    const back = ledgerFromCSV(ledgerToCSV([e]));
    expect(back[0]).toEqual(e);
    expect(ledgerToCSV([e]).split("\n")[0]).toBe(
      "id,date,kind,amount,description,project_alloc,category,source,counterparty,tags,receipt,restricted_to,linked_payment,linked_shopping_item,notes",
    );
  });

  it("adds an automatic sponsor fee for fiscal-sponsor income", () => {
    const inc = entry({ id: "i1", amount: 1000, tags: [FISCAL_TAG] });
    const fee = sponsorFeeEntry(inc, projects, sponsors)!;
    expect(fee.amount).toBe(80);
    expect(fee.category).toBe("Sponsor fees");
    expect(fee.kind).toBe("expense");
    expect(fee.description).toContain("Fractured Atlas fee (8%)");
    expect(sponsorFeeEntry(entry({ tags: [] }), projects, sponsors)).toBeNull();
    expect(sponsorFeeEntry(entry({ project_alloc: { c: 1 }, tags: [FISCAL_TAG] }), projects, sponsors)).toBeNull();
  });

  it("charges each project's share of split income at its own rate", () => {
    const inc = entry({ id: "i2", amount: 1000, project_alloc: { a: 0.5, b: 0.5 }, tags: [FISCAL_TAG] });
    const fee = sponsorFeeEntry(inc, projects, sponsors)!;
    expect(fee.amount).toBe(50); // 40 + 10
    expect(fee.project_alloc.a).toBeCloseTo(0.8);
    expect(fee.project_alloc.b).toBeCloseTo(0.2);
  });

  it("keeps fees in step on edit and delete", () => {
    let l = upsertWithFees([], entry({ id: "i1", amount: 1000, tags: [FISCAL_TAG] }), projects, sponsors);
    expect(l).toHaveLength(2);
    l = upsertWithFees(l, entry({ id: "i1", amount: 500, tags: [FISCAL_TAG] }), projects, sponsors);
    expect(l).toHaveLength(2);
    expect(l.find((e) => e.category === "Sponsor fees")!.amount).toBe(40);
    l = upsertWithFees(l, entry({ id: "i1", amount: 500, tags: [] }), projects, sponsors);
    expect(l).toHaveLength(1);
    l = upsertWithFees(l, entry({ id: "i1", amount: 500, tags: [FISCAL_TAG] }), projects, sponsors);
    const { next, removed } = removeWithFees(l, "i1");
    expect(next).toHaveLength(0);
    expect(removed).toHaveLength(2);
  });

  it("totals by project share", () => {
    const l = [
      entry({ id: "1", amount: 1000 }),
      entry({ id: "2", kind: "expense", amount: 200, project_alloc: { a: 0.6, b: 0.4 }, category: "Marketing" }),
      entry({ id: "3", kind: "expense", amount: 80, category: "Sponsor fees" }),
    ];
    expect(totals(l, "a")).toEqual({ moneyIn: 1000, moneyOut: 200, net: 800, sponsorFees: 80 });
    expect(totals(l, "b")).toEqual({ moneyIn: 0, moneyOut: 80, net: -80, sponsorFees: 0 });
    expect(totals(l).moneyOut).toBe(280);
  });

  it("notes ticket sales through a sponsor", () => {
    expect(earnedIncomeNote({ kind: "income", category: "Ticket sales", tags: [FISCAL_TAG] })).toMatch(/earned income/);
    expect(earnedIncomeNote({ kind: "income", category: "Donations", tags: [FISCAL_TAG] })).toBeNull();
  });

  it("computes source balances from opening balance and ledger", () => {
    const l = [entry({ id: "1", amount: 100, date: "2026-10-01" }), entry({ id: "2", kind: "expense", amount: 30, date: "2026-11-01" }), entry({ id: "3", amount: 999, date: "2026-12-30" })];
    expect(sourceBalances(l, [{ name: "Checking", opening_balance: 50, opening_date: "2026-10-15" }], "2026-11-26")).toEqual({ Checking: 20 });
  });
});

describe("budget", () => {
  it("reads Many Apply's 7-column budget format", () => {
    const csv = "category,type,line_item,quantity,rate,amount,notes\nArtist fees,expense,Actors,6,400,2400,\nGrants,income,City grant,1,2500,2500,\n";
    const lines = budgetFromCSV(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ category: "Artist fees", type: "expense", quantity: 6, rate: 400, amount: 2400 });
    expect(budgetToManyApplyCSV(lines).split("\n")[0]).toBe("category,type,line_item,quantity,rate,amount,notes");
    expect(budgetFromCSV(budgetToCSV(lines))).toEqual(lines);
  });

  it("rolls ledger actuals into lines by category", () => {
    const lines = budgetFromCSV("category,type,line_item,quantity,rate,amount,notes\nArtist fees,expense,Director,1,1500,1500,\nArtist fees,expense,Actors,1,2400,2400,\n");
    const l = [entry({ kind: "expense", amount: 2000, category: "Artist fees" })];
    const rows = expenseActuals(lines, l, "a");
    expect(rows.map((r) => r.paid)).toEqual([1500, 500]);
  });

  it("shows sponsored income net of fee", () => {
    const lines = budgetFromCSV("category,type,line_item,quantity,rate,amount,notes,id,expected_date,confidence,through_sponsor,source\nDonations,income,Crowdfunding,1,6000,6000,,i1,,Confirmed,yes,\n");
    const rows = incomeActuals(lines, [entry({ amount: 1000 })], projects[0], sponsors);
    expect(rows[0]).toMatchObject({ raised: 1000, raisedNet: 920, goalNet: 5520, feeRate: 0.08 });
  });
});

describe("payments", () => {
  const p: Payment = { id: "p1", title: "Venue deposit", payee: "Uptown", method: "Checking", budget_line: "b1", category: "Venue rental", due: "2026-12-01", amount: 500, status: "scheduled", paid_date: "", ledger_id: "", project_alloc: { a: 1 }, notes: "" };
  it("groups by due date", () => {
    expect(groupOf(p, "2026-12-05")).toBe("Overdue");
    expect(groupOf(p, "2026-11-20")).toBe("Next 30 days");
    expect(groupOf(p, "2026-10-01")).toBe("Later");
    expect(groupOf({ ...p, status: "paid" }, "2026-12-05")).toBe("Paid");
  });
  it("creates a filled-in ledger entry when ticked paid", () => {
    const e = ledgerEntryForPayment(p, "2026-11-30");
    expect(e).toMatchObject({ kind: "expense", amount: 500, category: "Venue rental", source: "Checking", counterparty: "Uptown", linked_payment: "p1", date: "2026-11-30" });
  });
  it("round-trips payments.md and exports .ics", () => {
    expect(paymentsFromMd(paymentsToMd([p])).payments).toEqual([p]);
    const ics = paymentsToICS([p]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201");
    expect(ics).toContain("SUMMARY:Pay Uptown: $500.00");
  });
});

describe("sample vault + forecast", () => {
  const today = "2026-11-26";
  it("loads the sample vault and warns about the low point", async () => {
    const fs = new MemoryFS(sampleVault(today));
    const v = await loadVault(fs);
    expect(v.projects.map((p) => p.slug)).toEqual(["made-men-reading", "prodigy", "overhead"]);
    expect(v.ledger.some((e) => e.category === "Sponsor fees")).toBe(true);
    const f = buildForecast({
      today, weeks: 12, scenario: "confirmed", cushion: 0, sources: v.settings.money_sources, ledger: v.ledger,
      payments: Object.values(v.payments).flat(), budgets: v.budgets, projects: v.projects, sponsors: v.sponsors,
      fmt: (n) => `$${n}`,
    });
    expect(f.weeks).toHaveLength(12);
    expect(f.start["Fractured Atlas fund"]).toBe(1080); // 1500 − 120 fee − 300 deposit
    const low = f.lowPoints.find((l) => l.source === "Fractured Atlas fund");
    expect(low).toBeTruthy();
    expect(low!.balance).toBe(-420);
    expect(low!.message).toContain("Venue deposit");
    // The crowdfunding payout lands later, net of the 8% fee on what's left.
    const payout = f.weeks.flatMap((w) => w.items).find((i) => i.label.startsWith("Crowdfunding"));
    expect(payout!.amount).toBe(4140); // (6000 − 1500) × 0.92
    // Likely income appears only in the "including likely" scenario.
    const likely = buildForecast({ ...{ today, weeks: 26, cushion: 0, sources: v.settings.money_sources, ledger: v.ledger, payments: Object.values(v.payments).flat(), budgets: v.budgets, projects: v.projects, sponsors: v.sponsors, fmt: String }, scenario: "likely" });
    expect(likely.weeks.flatMap((w) => w.items).some((i) => i.confidence === "Likely")).toBe(true);
    expect(f.unscheduled.length).toBeGreaterThan(0);
  });
});
