import { budgetFromCSV, budgetToCSV, budgetToManyApplyCSV, expenseActuals, incomeActuals } from "../src/lib/budget";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/files";
import { buildForecast } from "../src/lib/forecast";
import {
  earnedIncomeNote,
  ledgerFromCSV,
  ledgerToCSV,
  removeWithFees,
  sourceBalances,
  sponsorFeeEntry,
  totals,
  upsertWithFees,
} from "../src/lib/ledger";
import { groupOf, ledgerEntryForPayment, paymentsFromMd, paymentsToICS, paymentsToMd } from "../src/lib/payments";
import { FISCAL_TAG, type LedgerEntry, type Payment, type Person, type Project, type ScheduleEvent, type ShoppingItem, type InventoryItem, type Sponsor } from "../src/lib/types";
import { buyerRole, defaultMoney, owedTo, producerPurchaseEntry, reimbursementPayment, shoppingFromCSV, shoppingToCSV, summarize as shopSummary } from "../src/lib/shopping";
import { checkoutsFromCSV, checkoutsToCSV, gearWarnings, holderOf, itemsFromCSV, itemsToCSV, rentalOrders } from "../src/lib/inventory";
import { matchNames, mergeConflicts, parseAvailabilityCSV, parseLooseDate, parseLooseTime } from "../src/lib/availabilityImport";
import { bestDates, calledForScenes, eventsToICS, hoursTally, parseScenesPaste, scheduleWarnings } from "../src/lib/schedule";
import { STARTER_TIMELINE_TEMPLATES, anchorsFor, applyTemplate, relLabel, resolveDue, shiftPreview, timelineFromMd, timelineToMd } from "../src/lib/timeline";
import { blankDoc, docFromMd, docToMd, fillTemplate, list1099CSV, markdownToHtml, missingPaperwork, paymentsForSchedule, splitFee, totals1099 } from "../src/lib/paperwork";
import { allocValid, formatAlloc, parseAlloc, shareOf, slugify, weekStart } from "../src/lib/util";
import { loadVault, personToMd } from "../src/lib/vault";
import { activeGoal, campaignFromMd, campaignRaised, campaignStats, campaignToMd, newCampaignPath, resultLine } from "../src/lib/campaigns";
import { MemoryFS } from "../src/lib/fs";
import { BUILTIN_THEMES, checkTheme, contrast, fixAll, mix, nearestPassing, themeFromJSON, themeToJSON, themeVars } from "../src/lib/themes";
import { EMPTY_STATE, runSync, wantedTasks } from "../src/lib/todoist";
import { collectVault, exportAllCSV, guessMapping, ledgerFromRows } from "../src/lib/backup";
import { addDay, boardWarnings, castNumbers, dayOutOfDays, dayPages, moveStrip, parseFdx, parseScreenplayText, shootDayEvents, sortUnscheduled, stripsFromCSV, stripsToCSV } from "../src/lib/stripboard";
import { clearanceWarnings, clearancesFromCSV, clearancesToCSV, cueSheetCSV, sceneClearance } from "../src/lib/clearances";
import {
  computeReport, dailyCalc, dailyFromMd, dailyFromSchedule, dailyText, dailyToMd, dealFrom, defaultReportSettings, eighths, houseCalc,
  missingHouseReports, reportCSV, reportHtml, reportMarkdown, runSummary, savedReportFromMd, savedReportToMd, settle, ticketsFromRows,
} from "../src/lib/reports";
import { sampleVault } from "../src/lib/seed";

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
    expect(v.projects.map((p) => p.slug)).toEqual(["made-men-reading", "night-shift", "prodigy", "overhead"]);
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

describe("Many Apply compatibility", () => {
  it("reads Expense/Income/In-kind types and skips totals rows", () => {
    const csv = [
      "category,type,line_item,quantity,rate,amount,notes",
      "Design,Expense,Set design,1,800,800,",
      "In-kind,In-kind,Donated lumber,1,300,300,",
      "Grants,Income,Arts council,1,2000,2000,",
      ",,Total expenses,,,800,",
      ",,Gap,,,-1500,",
    ].join("\n");
    const lines = budgetFromCSV(csv);
    expect(lines.map((l) => l.type)).toEqual(["expense", "in-kind", "income"]);
    const out = budgetToManyApplyCSV(lines).split("\n");
    expect(out[1]).toBe("Design,Expense,Set design,1,800,800,");
    expect(out[2]).toContain(",In-kind,");
  });

  it("never puts in-kind lines in the cash forecast", async () => {
    const today = "2026-11-26";
    const fs = new MemoryFS(sampleVault(today));
    const v = await loadVault(fs);
    v.budgets.prodigy.push({ ...v.budgets.prodigy[0], id: "ik", type: "in-kind", category: "In-kind", line_item: "Donated lights", amount: 900, expected_date: "2026-12-10", confidence: "Confirmed" });
    const f = buildForecast({ today, weeks: 12, scenario: "likely", cushion: 0, sources: v.settings.money_sources, ledger: v.ledger, payments: Object.values(v.payments).flat(), budgets: v.budgets, projects: v.projects, sponsors: v.sponsors, fmt: String });
    expect(f.weeks.flatMap((w) => w.items).some((i) => i.label === "Donated lights")).toBe(false);
  });

  it("keeps frontmatter keys the app doesn't know about", async () => {
    const fs = new MemoryFS(sampleVault("2026-11-26"));
    await fs.write("people/ana-reyes.md", (await fs.read("people/ana-reyes.md"))!.replace("---\n", "---\nobsidian_tag: favorite\n"));
    const v = await loadVault(fs);
    const ana = v.people.find((p) => p.slug === "ana-reyes")!;
    expect(ana.extra).toEqual({ obsidian_tag: "favorite" });
    expect(personToMd({ ...ana, phone: "555" })).toContain("obsidian_tag: favorite");
  });
});

describe("paperwork", () => {
  const today = "2026-11-26";
  it("round-trips paperwork.md, keeping unknown keys", () => {
    const d = blankDoc({ path: "paperwork/contracts/x", title: "X agreement", people: ["ana"], schedule: [{ amount: 100, due: "2026-12-01", payment_id: "" }], files: [{ label: "v1 sent", file: "v1-sent.pdf", added: today }] });
    const md = docToMd({ ...d, extra: { custom: 1 } });
    const back = docFromMd("paperwork/contracts/x", md);
    expect(back).toEqual({ ...d, extra: { custom: 1 } });
  });

  it("flags what's missing in the sample vault", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const m = missingPaperwork(v, "", today);
    const kinds = m.map((x) => `${x.kind}:${x.person ?? x.venue ?? x.project}`);
    expect(kinds).toContain("agreement:maya-ostrowski"); // confirmed, agreement only sent
    expect(kinds).not.toContain("agreement:ana-reyes"); // fully signed
    expect(kinds).toContain("coi:uptown-studio-theatre"); // booked, no COI
    expect(kinds).not.toContain("venue-agreement:uptown-studio-theatre");
    expect(kinds).toContain("sponsorship:made-men-reading"); // Producer Hub, no agreement
    expect(kinds).not.toContain("sponsorship:prodigy");
    expect(kinds.some((k) => k.startsWith("expiring:"))).toBe(true); // COI expires in 25 days
    // Maya is confirmed on two projects: one entry each.
    expect(m.filter((x) => x.kind === "agreement" && x.person === "maya-ostrowski")).toHaveLength(2);
    // Project filter.
    expect(missingPaperwork(v, "made-men-reading", today).every((x) => !x.project || x.project === "made-men-reading")).toBe(true);
  });

  it("flags people paid with no W-9", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    v.ledger.push({ ...v.ledger[0], id: "z", kind: "expense", counterparty: "Jun Park", amount: 100, category: "Design", tags: [], notes: "" });
    expect(missingPaperwork(v, "", today).some((x) => x.kind === "w9" && x.person === "jun-park")).toBe(true);
  });

  it("totals payments per payee for the 1099 tracker", () => {
    const people = [{ name: "Ana Reyes", w9_on_file: true } as Person];
    const l = [
      entry({ id: "1", kind: "expense", amount: 1500, counterparty: "Ana Reyes", date: "2026-03-01" }),
      entry({ id: "2", kind: "expense", amount: 700, counterparty: "ana reyes ", date: "2026-09-01" }),
      entry({ id: "3", kind: "expense", amount: 900, counterparty: "Ana Reyes", date: "2025-09-01" }),
      entry({ id: "4", kind: "expense", amount: 80, counterparty: "Fractured Atlas", category: "Sponsor fees", date: "2026-09-01" }),
      entry({ id: "5", kind: "expense", amount: 300, counterparty: "Print shop", date: "2026-09-01" }),
    ];
    const rows = totals1099(l, people, [], "2026", 2000, [{ payee: "Ana Reyes", issued_date: "2027-01-20", notes: "" }]);
    expect(rows.map((r) => [r.payee, r.total, r.needed, r.w9])).toEqual([["Ana Reyes", 2200, true, true], ["Print shop", 300, false, null]]);
    expect(rows[0].issued?.issued_date).toBe("2027-01-20");
    expect(list1099CSV(rows).split("\n")[1]).toBe("Ana Reyes,2200.00,yes,yes,2027-01-20");
  });

  it("fills templates and turns a fee schedule into payments", () => {
    expect(fillTemplate("Hi [First name], [Fee] for [Role]. [Unknown]", { "first name": "Ana", Fee: "$1,500", Role: "" })).toBe("Hi Ana, $1,500 for [Role]. [Unknown]");
    const sched = splitFee(1000, 3, "2026-12-01", 14);
    expect(sched.map((s) => s.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(sched.map((s) => s.due)).toEqual(["2026-12-01", "2026-12-15", "2026-12-29"]);
    const doc = blankDoc({ path: "paperwork/contracts/a", title: "Ana agreement", project: "prodigy", schedule: sched });
    doc.schedule[0].payment_id = "already";
    const { doc: d2, payments } = paymentsForSchedule(doc, "Ana Reyes", "overhead");
    expect(payments).toHaveLength(2);
    expect(payments[0]).toMatchObject({ payee: "Ana Reyes", category: "Artist fees", amount: 333.33, due: "2026-12-15", project_alloc: { prodigy: 1 } });
    expect(payments[0].title).toBe("Ana agreement, installment 2 of 3");
    expect(d2.schedule.every((s) => s.payment_id)).toBe(true);
  });

  it("seeds starter templates and renders drafts for printing", async () => {
    const v = await loadVault(new MemoryFS({}));
    expect(v.templates.map((t) => t.slug)).toContain("artist-agreement");
    expect(markdownToHtml("# Title\n\nSome **bold** text\n\n- one\n- two")).toBe("<h1>Title</h1>\n<p>Some <strong>bold</strong> text</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
  });
});

describe("availability import", () => {
  const today = "2026-11-26";
  const people = [
    { slug: "ana-reyes", name: "Ana Reyes", email: "ana@example.com" },
    { slug: "jun-park", name: "Jun Park", email: "" },
    { slug: "maya-ostrowski", name: "Maya Ostrowski", email: "" },
  ] as Person[];

  it("reads loose dates and times", () => {
    expect(parseLooseDate("12/8", today)).toBe("2026-12-08");
    expect(parseLooseDate("1/5", today)).toBe("2027-01-05"); // next occurrence
    expect(parseLooseDate("Mon 12/8/2026", today)).toBe("2026-12-08");
    expect(parseLooseDate("Dec 8", today)).toBe("2026-12-08");
    expect(parseLooseDate("8 Jan 2027", today)).toBe("2027-01-08");
    expect(parseLooseDate("2027-02-01", today)).toBe("2027-02-01");
    expect(parseLooseDate("Name", today)).toBeNull();
    expect(parseLooseTime("6pm")).toBe("18:00");
    expect(parseLooseTime("6:30")).toBe("18:30");
    expect(parseLooseTime("10")).toBe("10:00");
    expect(parseLooseTime("12am")).toBe("00:00");
  });

  it("turns an 'unavailable' grid into conflicts", () => {
    const csv = "Name,12/8,12/9,12/10\nAna Reyes,x,,after 6pm\nJun,,busy,2-5pm\nSam Lee,,,x\n";
    const p = parseAvailabilityCSV(csv, "unavailable", today);
    expect(p.shape).toBe("grid");
    expect(p.dates).toEqual(["2026-12-08", "2026-12-09", "2026-12-10"]);
    const ana = p.conflicts.filter((c) => c.name === "Ana Reyes");
    expect(ana).toEqual([
      { name: "Ana Reyes", date: "2026-12-08", start: "", end: "", note: "" },
      { name: "Ana Reyes", date: "2026-12-10", start: "18:00", end: "23:59", note: "after 6pm" },
    ]);
    const jun = p.conflicts.filter((c) => c.name === "Jun");
    expect(jun.map((c) => [c.date, c.start, c.end])).toEqual([["2026-12-09", "", ""], ["2026-12-10", "14:00", "17:00"]]);
    const m = matchNames(p.names, people);
    expect(m).toEqual({ "Ana Reyes": "ana-reyes", Jun: "jun-park", "Sam Lee": null });
  });

  it("turns an 'available' grid into conflicts for the unmarked days", () => {
    const p = parseAvailabilityCSV("Name,Dec 8,Dec 9\nMaya Ostrowski,yes,\n", "available", today);
    expect(p.conflicts).toEqual([{ name: "Maya Ostrowski", date: "2026-12-09", start: "", end: "", note: "Not marked available" }]);
  });

  it("reads one-row-per-conflict files and replaces old conflicts on re-import", () => {
    const p = parseAvailabilityCSV("name,date,start,end,note\nAna Reyes,12/8,18:00,21:00,class\nJun Park,nope,,,\n", "unavailable", today);
    expect(p.shape).toBe("rows");
    expect(p.conflicts).toEqual([{ name: "Ana Reyes", date: "2026-12-08", start: "18:00", end: "21:00", note: "class" }]);
    expect(p.warnings[0]).toContain("Row 3");
    const old = [
      { id: "1", person: "ana-reyes", date: "2026-12-08", start: "", end: "", note: "old" },
      { id: "2", person: "ana-reyes", date: "2026-12-20", start: "", end: "", note: "keep" },
    ];
    const { next, added, replaced } = mergeConflicts(old, p, matchNames(p.names, people));
    expect(replaced.map((c) => c.id)).toEqual(["1"]);
    expect(added).toHaveLength(1);
    expect(next.map((c) => c.note).sort()).toEqual(["class", "keep"]);
  });
});

describe("schedule + timeline", () => {
  const ev = (x: Partial<ScheduleEvent>): ScheduleEvent => ({ id: "e", project: "a", date: "2026-12-08", start: "18:00", end: "21:00", type: "Rehearsal", title: "", location: "", called: [], scenes: [], notes: "", ...x });
  it("finds conflicts, double bookings and too many hours", () => {
    const people = [{ slug: "ana", name: "Ana" }] as Person[];
    const events = [
      ev({ id: "1", called: ["ana"], location: "hall" }),
      ev({ id: "2", project: "b", start: "20:00", end: "22:00", location: "hall" }),
      ev({ id: "3", date: "2026-12-09", called: ["ana"] }),
    ];
    const conflicts = [{ id: "c", person: "ana", date: "2026-12-08", start: "19:00", end: "20:00", note: "class" }];
    const w = scheduleWarnings(events, conflicts, people, [], 5);
    expect(w.filter((x) => x.kind === "conflict").map((x) => x.event)).toEqual(["1"]);
    expect(w.filter((x) => x.kind === "double-booked").map((x) => x.event).sort()).toEqual(["1", "2"]);
    expect(w.some((x) => x.kind === "hours" && x.message.includes("6 hours"))).toBe(true);
    expect(hoursTally(events, "", "")).toEqual({ ana: { hours: 6, calls: 2 } });
  });
  it("calls the right people for a scene and finds the best dates", () => {
    const scenes = parseScenesPaste("1.1 Kitchen: ANA, Ben\n2.3, Ben, Cleo");
    expect(scenes.map((s) => [s.number, s.title, s.characters])).toEqual([["1.1", "Kitchen", ["ANA", "Ben"]], ["2.3", "", ["Ben", "Cleo"]]]);
    expect(calledForScenes([scenes[1].id], scenes, { Ben: "ben", Cleo: "cleo", Ana: "ana" }).sort()).toEqual(["ben", "cleo"]);
    expect(calledForScenes([scenes[0].id], scenes, { Ana: "ana" })).toEqual(["ana"]); // case-insensitive
    const best = bestDates(["ana", "ben"], ["2026-12-08", "2026-12-09"], "18:00", "21:00", [{ id: "c", person: "ana", date: "2026-12-08", start: "", end: "", note: "" }]);
    expect(best[0]).toEqual({ date: "2026-12-09", free: ["ana", "ben"], busy: [] });
  });
  it("exports a person's calls as .ics", () => {
    const ics = eventsToICS([ev({ id: "1", called: ["ana"] }), ev({ id: "2", called: ["ben"] })], "ana", [], []);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261208T180000");
  });
  it("resolves relative dates and previews a move", () => {
    const p = { slug: "a", opening: "2027-03-01", start: "", end: "" } as Project;
    const a = anchorsFor(p, [ev({ type: "Performance", date: "2027-03-01" }), ev({ type: "Performance", date: "2027-03-10" })]);
    expect(a.closing).toBe("2027-03-10");
    const tasks = applyTemplate(STARTER_TIMELINE_TEMPLATES[0]);
    expect(resolveDue(tasks[0], a)).toBe("2027-02-01");
    expect(relLabel(tasks[0].rel)).toBe("Opening − 4 weeks");
    const prev = shiftPreview(tasks, "opening", "2027-03-01", "2027-03-08");
    expect(prev[0]).toMatchObject({ before: "2027-02-01", after: "2027-02-08" });
    const md = timelineToMd(tasks);
    expect(timelineFromMd(md).tasks).toEqual(tasks);
  });
});

describe("shopping list", () => {
  const people = [
    { slug: "jun", name: "Jun Park", roles: ["Lighting"] },
    { slug: "maya", name: "Maya", roles: ["Actor"] },
  ] as Person[];
  const item = (x: Partial<ShoppingItem>): ShoppingItem => ({
    id: "i", project: "a", item: "Gel", where: "B&H", link: "", department: "Lighting", buyer: "", buyer_role: "unassigned", need_by: "2026-12-10",
    est_cost: 40, actual_cost: null, money: "Producer card", status: "Needed", receipt: "", notes: "", payment_id: "", ledger_id: "", inventory_id: "", ...x,
  });
  it("round-trips shopping.csv", () => {
    const i = item({ notes: "Rosco, 2 sheets" });
    expect(shoppingFromCSV("a", shoppingToCSV([i]))).toEqual([i]);
  });
  it("tags buyers and picks the default money", () => {
    expect(buyerRole("jun", people)).toBe("designer");
    expect(buyerRole("maya", people)).toBe("other");
    expect(buyerRole("producer", people)).toBe("producer");
    expect(buyerRole("", people)).toBe("unassigned");
    expect(defaultMoney("jun")).toBe("Reimburse");
    expect(defaultMoney("producer")).toBe("Producer card");
  });
  it("totals what's owed and creates reimbursements and producer expenses", () => {
    const items = [item({ id: "1", buyer: "jun", money: "Reimburse", status: "Got it", actual_cost: 55 }), item({ id: "2", buyer: "jun", money: "Reimburse" }), item({ id: "3", money: "In-kind", est_cost: 100 })];
    expect(shopSummary(items, [])).toEqual({ count: 3, open: 2, estimated: 195, toReimburse: 55 });
    expect(owedTo("jun", items, []).owed).toBe(55);
    const pay = reimbursementPayment(items[0], "Jun Park", "Checking", "2026-12-01");
    expect(pay).toMatchObject({ payee: "Jun Park", amount: 55, category: "Lighting & sound", shopping_item: "1", project_alloc: { a: 1 } });
    expect(ledgerEntryForPayment(pay, "2026-12-02").linked_shopping_item).toBe("1");
    expect(shopSummary(items, [{ ...pay, status: "paid" }]).toReimburse).toBe(55); // not linked yet
    expect(shopSummary([{ ...items[0], payment_id: pay.id }], [{ ...pay, status: "paid" }]).toReimburse).toBe(0);
    expect(producerPurchaseEntry(item({ money: "Producer card" }), "2026-12-01", [])).toMatchObject({ source: "Card", amount: 40, category: "Lighting & sound", linked_shopping_item: "i" });
    expect(producerPurchaseEntry(item({ money: "Fractured Atlas fund" }), "2026-12-01", [{ name: "Fractured Atlas fund", opening_balance: 0, opening_date: "" }])!.source).toBe("Fractured Atlas fund");
    expect(producerPurchaseEntry(item({ money: "In-kind" }), "2026-12-01", [])).toBeNull();
  });
  it("puts open shopping items in the cash forecast", async () => {
    const today = "2026-11-26";
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const shopping = [item({ id: "s1", project: "prodigy", item: "Gel", need_by: "2026-12-10", est_cost: 40 }), item({ id: "s2", project: "prodigy", money: "In-kind" })];
    const f = buildForecast({ today, weeks: 6, scenario: "confirmed", cushion: 0, sources: v.settings.money_sources, ledger: v.ledger, payments: Object.values(v.payments).flat(), budgets: v.budgets, projects: v.projects, sponsors: v.sponsors, shopping, fmt: String });
    const buys = f.weeks.flatMap((w) => w.items).filter((i) => i.kind === "shopping");
    expect(buys).toEqual([expect.objectContaining({ label: "Buy: Gel", amount: -40, source: "Card", date: "2026-12-10" })]);
  });
});

describe("equipment log", () => {
  const it0 = (x: Partial<InventoryItem>): InventoryItem => ({
    id: "c1", name: "Camera A", category: "Camera", owner: "producer", project: "a", serial: "123", value: 2000, rental_house: "", rental_order: "", rental_cost: null,
    rental_start: "", rental_end: "", deposit: null, deposit_returned: false, returned: false, condition: "", notes: "", ...x,
  });
  it("round-trips items and check-outs", () => {
    const i = it0({ rental_house: "Lens Co", deposit: 500, deposit_returned: true });
    expect(itemsFromCSV(itemsToCSV([i]))).toEqual([i]);
    const c = { id: "x", item: "c1", person: "ana", out_date: "2026-11-01", due_date: "2026-11-10", in_date: "", condition_out: "Good", condition_in: "", notes: "" };
    expect(checkoutsFromCSV(checkoutsToCSV([c]))).toEqual([c]);
  });
  it("warns about overdue gear, rentals due back, deposits and gear out after closing", () => {
    const people = [{ slug: "ana", name: "Ana" }] as Person[];
    const projects = [{ slug: "a", name: "Show A" }] as Project[];
    const items = [
      it0({ id: "1" }),
      it0({ id: "2", name: "Lens", rental_house: "Lens Co", rental_end: "2026-11-27" }),
      it0({ id: "3", name: "Dolly", rental_house: "Grip Co", rental_end: "2026-11-20", returned: true, deposit: 200 }),
    ];
    const checkouts = [{ id: "x", item: "1", person: "ana", out_date: "2026-11-01", due_date: "2026-11-10", in_date: "", condition_out: "", condition_in: "", notes: "" }];
    const w = gearWarnings(items, checkouts, people, projects, () => "2026-11-15", "2026-11-26");
    expect(w.map((x) => x.kind).sort()).toEqual(["after-closing", "deposit", "overdue", "rental-due"]);
    expect(holderOf("1", checkouts)?.person).toBe("ana");
    expect(rentalOrders(items).map((o) => o.house)).toEqual(expect.arrayContaining(["Lens Co", "Grip Co"]));
  });
});

describe("campaigns", () => {
  const today = "2026-11-26";
  it("round-trips campaign files", () => {
    const c = campaignFromMd("campaigns/x.md", "---\ntitle: Giving Tuesday\ntype: Fundraising\nstatus: Scheduled\ngoal: 6000\nlinked_entries: [e1]\nfoo: bar\n---\nBody");
    expect(c).toMatchObject({ title: "Giving Tuesday", status: "Scheduled", goal: 6000, linked_entries: ["e1"], body: "Body", extra: { foo: "bar" } });
    expect(campaignFromMd("campaigns/x.md", campaignToMd(c))).toEqual(c);
    expect(newCampaignPath({ title: "Giving Tuesday!", date: "2026-12-01" }, [])).toBe("campaigns/2026-12-01-giving-tuesday.md");
  });
  it("fills results from linked entries or dates, and finds the active goal", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const early = v.campaigns.find((c) => c.title === "Early donor asks")!;
    expect(campaignRaised(early, v.ledger)).toMatchObject({ amount: 1500, gifts: 1, source: "linked" });
    expect(resultLine(early, v.ledger, (n) => "$" + n)).toBe("1 gift · $1500");
    const goal = activeGoal(v.campaigns, today, "prodigy")!;
    expect(goal.title).toBe("Giving Tuesday push");
    const gift = { ...v.ledger.find((e) => e.id === "e1")!, id: "g2", date: "2026-12-05", amount: 250, counterparty: "Lee" };
    expect(campaignRaised(goal, [...v.ledger, gift])).toMatchObject({ amount: 250, donors: 1, source: "dates" });
    expect(campaignStats(v.campaigns, v.ledger, today)).toMatchObject({ asksSent: 25, responded: 10, raised: 1900 });
  });
});

describe("reports", () => {
  const today = "2026-11-26";
  it("builds a sponsor report with restricted funds and fees", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const s = defaultReportSettings("made-men-reading", "producer-hub", "2026-01-01", today);
    const r = computeReport(s, v);
    expect(r.title).toBe("Producer Hub report");
    expect(r.sponsorLine).toBe("Fiscally sponsored project of Producer Hub");
    expect(r.received).toBe(400);
    expect(r.spent).toBe(88); // 40% of $200 ads + $8 fee
    expect(r.sponsorFees).toBe(8);
    expect(r.restricted).toEqual([{ restriction: "Reading stipends", received: 400, spent: 0, left: 400 }]);
    const html = reportHtml(r, s, "Went well.", "Morgan", (n) => "$" + n, "<p>Went well.</p>");
    expect(html).toContain("Fiscally sponsored project of Producer Hub");
    expect(reportMarkdown(r, s, "Went well.", (n) => "$" + n)).toContain("## Restricted funds");
    expect(reportCSV(r).split("\n")[0]).toBe("section,label,detail,amount");
    const saved = { path: "reports/x.md", title: "Q4", template: false, settings: s, sent: today, snapshot: { received: 400 }, notes: "Went well." };
    expect(savedReportFromMd("reports/x.md", savedReportToMd(saved))).toEqual(saved);
  });

  it("totals a house report and a run", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const h = v.houseReports[0];
    const c = houseCalc(h);
    expect(c).toMatchObject({ sold: 56, comps: 2, attendance: 55, gross: 1208, net: 1146.5, pctCapacity: 69 });
    const run = runSummary([h, { ...h, date: "2026-11-20", tickets: [{ type: "Full", sold: 20, price: 25 }], comps: [], no_shows: 0 }]);
    expect(run).toMatchObject({ nights: 2, attendance: 75, gross: 1708 });
    expect(run.best?.attendance).toBe(55);
    expect(missingHouseReports(v.events, v.houseReports, today).map((e) => e.id)).toEqual(["ev8"]);
    const tickets = ticketsFromRows([{ Type: "Full", Qty: "2", Total: "50" }, { Type: "Student", Qty: "1", Total: "15" }, { Type: "Full", Qty: "1", Total: "25" }], { type: "Type", quantity: "Qty", amount: "Total", amountIsTotal: true });
    expect(tickets).toEqual([{ type: "Full", sold: 3, price: 25 }, { type: "Student", sold: 1, price: 15 }]);
  });

  it("settles with a venue: guarantee vs. door split, bar minimum, deposits", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const hop = v.venues.find((x) => x.slug === "hop-hall")!;
    const h = v.houseReports[0];
    const s = settle(dealFrom(hop), [h], 100);
    // 20% of 1208 = 241.60 < 300 guarantee → 300; bar 520 ≥ 400 → no shortfall; cleaning 50.
    expect(s.lines.map((l) => l.amount)).toEqual([300, 50]);
    expect(s).toMatchObject({ venueDue: 350, depositsPaid: 100, balance: 250 });
    const collects = settle({ ...dealFrom(hop), venue_collects_box_office: true }, [h], 0);
    expect(collects.balance).toBe(-858); // venue holds 1208, is due 350
    const low = settle(dealFrom(hop), [{ ...h, bar_sales: 300 }], 0);
    expect(low.lines.find((l) => l.label.startsWith("Bar minimum"))?.amount).toBe(100);
  });

  it("starts a daily report from the Schedule and works out hours", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const r = v.dailyReports[0];
    const c = dailyCalc(r);
    expect(c.hours).toEqual({ "ana-reyes": 3.08, "maya-ostrowski": 2.83 }); // minus the 15-minute meal
    expect(c.overMinutes).toBe(20);
    expect(dailyText(r, v.people, "Prodigy", "")).toContain("OVER by 20 min");
    const fresh = dailyFromSchedule("made-men-reading", "2027-02-01", [{ id: "x", project: "made-men-reading", date: "2027-02-01", start: "18:00", end: "21:00", type: "Rehearsal", title: "", location: "", called: ["leo-grant"], scenes: ["s1"], notes: "" }], () => "1.1", (l) => l);
    expect(fresh).toMatchObject({ kind: "Rehearsal", planned_end: "21:00", calls: [{ person: "leo-grant", call: "18:00" }], scenes: [{ scene: "1.1", status: "Planned" }] });
    expect(eighths(11)).toBe("1 3/8");
    expect(dailyFromMd(r.path, dailyToMd(r, v.people))).toEqual(r);
  });
});

describe("stripboard", () => {
  const today = "2026-11-26";
  it("imports Final Draft and plain screenplay text", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft><Content>
      <Paragraph Number="1" Type="Scene Heading"><Text>INT. DINER - NIGHT</Text></Paragraph>
      <Paragraph Type="Action"><Text>Mara wipes the counter.</Text></Paragraph>
      <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>We're closed.</Text></Paragraph>
      <Paragraph Type="Character"><Text>DEV (O.S.)</Text></Paragraph>
      <Paragraph Number="2" Type="Scene Heading"><Text>EXT. PARKING LOT - DAWN</Text></Paragraph>
    </Content></FinalDraft>`;
    const a = parseFdx(fdx);
    expect(a.map((s) => [s.number, s.ie, s.location, s.tod, s.characters])).toEqual([["1", "INT", "DINER", "NIGHT", ["MARA", "DEV"]], ["2", "EXT", "PARKING LOT", "DAWN", []]]);
    expect(a[0].description).toBe("Mara wipes the counter.");
    const b = parseScreenplayText("INT. MARA'S CAR - NIGHT\n\nRain on the glass.\n\nOLD MAN\nNeed a ride?\n\nMARA (V.O.)\nNo.\n\nEXT./INT. BUS STOP - DAY #4A#\n\nMARA\nFinally.");
    expect(b.map((s) => [s.number, s.ie, s.location, s.tod, s.characters])).toEqual([["1", "INT", "MARA'S CAR", "NIGHT", ["OLD MAN", "MARA"]], ["4A", "INT/EXT", "BUS STOP", "DAY", ["MARA"]]]);
  });
  it("moves strips, numbers cast, warns, and builds day out of days", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const strips = v.strips["night-shift"];
    let b = v.boards["night-shift"];
    expect(b.unscheduled).toEqual(["st2", "st3", "st4"]);
    b = addDay(b, "2027-01-20");
    const day2 = b.days[1].id;
    b = moveStrip(b, "st3", day2);
    b = moveStrip(b, "st4", day2, "st3");
    expect(b.days[1].scenes).toEqual(["st4", "st3"]);
    expect(b.unscheduled).toEqual(["st2"]);
    expect(castNumbers(strips)).toEqual({ MARA: 1, DEV: 2, "OLD MAN": 3 });
    expect(dayPages(b.days[0], strips)).toBe(16);
    const conflicts = [{ id: "c", person: "rosa-diaz", date: "2027-01-20", start: "", end: "", note: "Other gig" }];
    const w = boardWarnings({ ...b, page_limit: 15 }, strips, v.projects.find((p) => p.slug === "night-shift")!.cast!, conflicts, (s) => s);
    expect(w.map((x) => x.message)).toEqual(["Day 1 has 2 pages (limit 1 7/8)", "rosa-diaz (OLD MAN) has a conflict on day 2 (Other gig)"]);
    const dood = dayOutOfDays(b, strips);
    expect(dood.find((r) => r.character === "MARA")!.marks).toEqual(["SW", "WF"]);
    expect(dood.find((r) => r.character === "DEV")!.marks).toEqual(["SWF", ""]);
    const sorted = sortUnscheduled({ ...b, unscheduled: ["st5", "st2", "st1"] }, strips, "location");
    expect(sorted.unscheduled).toEqual(["st1", "st5", "st2"]);
    const { events, eventIds } = shootDayEvents(b, strips, "night-shift", { MARA: "maya-ostrowski", DEV: "leo-grant" });
    expect(events[0]).toMatchObject({ type: "Photo / video shoot", title: "Shoot day 1", called: ["maya-ostrowski", "leo-grant"] });
    expect(Object.keys(eventIds)).toHaveLength(2);
    expect(stripsFromCSV(stripsToCSV(strips))).toEqual(strips);
  });
});

describe("clearances", () => {
  const today = "2026-11-26";
  it("warns about deadlines, denials and scope, and exports a cue sheet", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const items = v.clearances["night-shift"];
    expect(clearancesFromCSV("night-shift", clearancesToCSV(items))).toEqual(items);
    const w = clearanceWarnings(items, "2026-12-10", "opening", 4, ["Festival", "Streaming"], today);
    expect(w.map((x) => x.kind).sort()).toEqual(["deadline", "deadline", "scope"]);
    expect(clearanceWarnings(items, "2027-06-01", "opening", 4, [], today)).toEqual([]);
    expect(sceneClearance(items, ["1", "3", "5"])).toEqual([{ scene: "1", total: 2, open: 1 }, { scene: "3", total: 1, open: 1 }, { scene: "5", total: 1, open: 0 }]);
    const cue = cueSheetCSV("Night Shift", items).split("\n");
    expect(cue[0]).toBe("cue,title,composer,publisher,rights_holder,timing,usage,scenes,status");
    expect(cue[1]).toContain("J. Ortiz");
  });
});

/** A tiny in-memory Todoist, enough to exercise the sync. */
function fakeTodoist() {
  let n = 0;
  const projects: { id: string; name: string; parent_id: string | null }[] = [];
  const sections: { id: string; name: string; project_id: string }[] = [];
  const tasks: { id: string; content: string; project_id: string; section_id?: string; due_date?: string; checked: boolean }[] = [];
  const calls: string[] = [];
  const api = {
    async request(method: string, path: string, body?: Record<string, string>) {
      calls.push(`${method} ${path}`);
      const [p, q] = path.split("?");
      const qp = new URLSearchParams(q ?? "");
      if (method === "GET" && p === "/api/v1/projects") return { results: projects, next_cursor: null };
      if (method === "POST" && p === "/api/v1/projects") { const x = { id: `p${++n}`, name: body!.name, parent_id: body!.parent_id ?? null }; projects.push(x); return x; }
      if (method === "GET" && p === "/api/v1/sections") return { results: sections.filter((s) => s.project_id === qp.get("project_id")) };
      if (method === "POST" && p === "/api/v1/sections") { const x = { id: `s${++n}`, name: body!.name, project_id: body!.project_id }; sections.push(x); return x; }
      if (method === "GET" && p === "/api/v1/tasks") return { results: tasks.filter((t) => t.project_id === qp.get("project_id") && !t.checked) };
      if (method === "POST" && p === "/api/v1/tasks") { const x = { id: `t${++n}`, content: body!.content, project_id: body!.project_id, section_id: body!.section_id, due_date: body!.due_date, checked: false }; tasks.push(x); return x; }
      const m = /^\/api\/v1\/tasks\/(\w+)(\/close)?$/.exec(p);
      if (m && method === "POST") { const t = tasks.find((x) => x.id === m[1])!; if (m[2]) t.checked = true; else Object.assign(t, { content: body!.content, due_date: body!.due_date }); return null; }
      if (m && method === "DELETE") { tasks.splice(tasks.findIndex((x) => x.id === m[1]), 1); return null; }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return { api, projects, sections, tasks, calls };
}

describe("todoist sync", () => {
  const today = "2026-11-26";
  it("creates projects, sections and tasks, then updates, closes and picks up completions", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const settings = { ...v.settings.todoist, enabled: true, parent_project_id: "" };
    const money = (n: number) => "$" + n;
    const wanted = wantedTasks(v, settings, today, money);
    const keys = wanted.map((w) => w.key);
    expect(keys).toContain("payment:p2");
    expect(keys).toContain("shop:sh2"); // producer is buying it
    expect(keys).not.toContain("shop:sh3"); // Maya is
    expect(keys.some((k) => k.startsWith("timeline:prodigy:"))).toBe(true);
    expect(keys).toContain("house:prodigy:" + v.events.find((e) => e.id === "ev8")!.date);
    expect(keys).toContain("chase:paperwork/contracts/prodigy-maya-ostrowski-actor-agreement");
    expect(wanted.find((w) => w.key === "payment:p2")!.content).toBe("Pay Ana Reyes: $500");

    const t = fakeTodoist();
    const names = Object.fromEntries(v.projects.map((p) => [p.slug, p.name]));
    const r1 = await runSync(t.api, wanted, names, settings, EMPTY_STATE);
    expect(r1.created).toBe(wanted.length);
    expect(t.projects.map((p) => p.name).sort()).toEqual([...new Set(wanted.map((w) => names[w.project]))].sort());
    expect(t.sections.some((s) => s.name === "Payments")).toBe(true);

    // Nothing changed: a second sync does nothing.
    const r2 = await runSync(t.api, wanted, names, settings, r1.state);
    expect([r2.created, r2.updated, r2.closed, r2.completedInTodoist.length]).toEqual([0, 0, 0, 0]);

    // Due date changed in the app → update; one item done in the app → close;
    // one ticked off in Todoist → reported back.
    const shopId = r1.state.tasks["shop:sh2"].id;
    t.tasks.find((x) => x.id === shopId)!.checked = true;
    const changed = wanted
      .filter((w) => w.key !== "payment:p4")
      .map((w) => (w.key === "payment:p2" ? { ...w, due: "2026-12-01" } : w));
    const r3 = await runSync(t.api, changed, names, settings, r2.state);
    expect(r3.updated).toBe(1);
    expect(r3.closed).toBe(1);
    expect(r3.completedInTodoist).toEqual(["shop:sh2"]);
    expect(t.tasks.find((x) => x.id === r1.state.tasks["payment:p2"].id)!.due_date).toBe("2026-12-01");
  });

  it("re-creates tasks, without marking anything done, when its Todoist project was deleted", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const settings = { ...v.settings.todoist, enabled: true, parent_project_id: "" };
    const wanted = wantedTasks(v, settings, today, String);
    const names = Object.fromEntries(v.projects.map((p) => [p.slug, p.name]));
    const t = fakeTodoist();
    const r1 = await runSync(t.api, wanted, names, settings, EMPTY_STATE);
    // The user deletes the "Prodigy" project in Todoist, tasks and all.
    const pid = r1.state.projects.prodigy;
    t.projects.splice(t.projects.findIndex((p) => p.id === pid), 1);
    for (let i = t.tasks.length - 1; i >= 0; i--) if (t.tasks[i].project_id === pid) t.tasks.splice(i, 1);
    const r2 = await runSync(t.api, wanted, names, settings, r1.state);
    expect(r2.completedInTodoist).toEqual([]);
    expect(r2.created).toBe(wanted.filter((w) => w.project === "prodigy").length);
  });

  it("syncs Dashboard to-dos into a To do section, general ones under Company overhead", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    v.todos.push({ id: "tdx", text: "Old show wrap-up", done: false, project: "no-such-project", due: "", created: "", done_date: "" });
    const settings = { ...v.settings.todoist, enabled: true, parent_project_id: "" };
    const hub = wantedTasks(v, settings, today, String).filter((w) => w.key.startsWith("hub:"));
    expect(hub.every((w) => w.section === "To do")).toBe(true);
    expect(hub.find((w) => w.key === "hub:td1")).toMatchObject({ project: "prodigy", content: "Send rehearsal report to the director" });
    expect(hub.find((w) => w.key === "hub:td3")!.project).toBe("overhead"); // general
    expect(hub.find((w) => w.key === "hub:tdx")!.project).toBe("overhead"); // unknown project
    expect(hub.some((w) => w.key === "hub:td4")).toBe(false); // already done

    const t = fakeTodoist();
    const names = Object.fromEntries(v.projects.map((p) => [p.slug, p.name]));
    const r1 = await runSync(t.api, hub, names, settings, EMPTY_STATE);
    expect(t.sections.filter((s) => s.name === "To do")).toHaveLength(2);
    t.tasks.find((x) => x.id === r1.state.tasks["hub:td1"].id)!.checked = true;
    const r2 = await runSync(t.api, hub, names, settings, r1.state);
    expect(r2.completedInTodoist).toEqual(["hub:td1"]);
    expect(wantedTasks(v, { ...settings, sync: { ...settings.sync, hub: false } }, today, String).some((w) => w.key.startsWith("hub:"))).toBe(false);
  });

  it("respects the sync toggles", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const off = { ...v.settings.todoist, sync: { hub: false, timeline: false, payments: true, paperwork: false, shopping: false, campaigns: false, house_reports: false } };
    expect(wantedTasks(v, off, today, String).every((w) => w.section === "Payments")).toBe(true);
  });
});

describe("backup and import", () => {
  const today = "2026-11-26";
  it("zips every vault file and exports CSVs", async () => {
    const fs = new MemoryFS(sampleVault(today));
    const v = await loadVault(fs);
    const files = await collectVault(fs);
    expect(Object.keys(files)).toContain("ledger/2026.csv");
    expect(Object.keys(files)).toContain(".manyproduce/settings.json");
    const csv = exportAllCSV(v);
    expect(Object.keys(csv)).toEqual(expect.arrayContaining(["ledger.csv", "collaborators.csv", "schedule.csv", "clearances.csv"]));
    expect(csv["collaborators.csv"].split("\n")[1]).toContain("Ana Reyes");
  });
  it("imports a bank statement, skipping what's already there", async () => {
    const v = await loadVault(new MemoryFS(sampleVault(today)));
    const rows = [
      { Date: "11/20/2026", Description: "GRAND STAGE RENTALS", Amount: "-120.00" },
      { Date: "11/21/2026", Description: "Venmo from Lee", Amount: "50" },
      { Date: "", Description: "pending", Amount: "-3" },
    ];
    const m = guessMapping(Object.keys(rows[0]));
    expect(m).toMatchObject({ date: "Date", description: "Description", amount: "Amount" });
    const r = ledgerFromRows(rows, m, "prodigy", "Card", v.ledger);
    expect(r.entries.map((e) => [e.date, e.kind, e.amount])).toEqual([["2026-11-20", "expense", 120], ["2026-11-21", "income", 50]]);
    expect(r.bad).toBe(1);
    const again = ledgerFromRows(rows, m, "prodigy", "Card", [...v.ledger, ...r.entries]);
    expect(again.skipped).toBe(2);
    const split = ledgerFromRows([{ Date: "2026-11-22", Memo: "x", Debit: "10", Credit: "" }], guessMapping(["Date", "Memo", "Debit", "Credit"]), "prodigy", "Card", []);
    expect(split.entries[0]).toMatchObject({ kind: "expense", amount: 10 });
  });
});

describe("themes", () => {
  it("measures contrast like WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBe(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  it("suggests the nearest shade that passes", () => {
    const fixed = nearestPassing("#f7a8c4", "#ffffff", 4.5);
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(fixed).not.toBe("#f7a8c4");
    const light = nearestPassing("#3a3a5a", "#101014", 4.5);
    expect(contrast(light, "#101014")).toBeGreaterThanOrEqual(4.5);
  });
  it("built-in themes pass every check", () => {
    for (const t of BUILTIN_THEMES) {
      const failing = checkTheme(t).filter((c) => !c.pass);
      expect([t.name, failing.map((f) => `${f.label} ${f.ratio}`)]).toEqual([t.name, []]);
    }
  });
  it("flags a hard-to-read theme and every fix passes", () => {
    const bad = { ...BUILTIN_THEMES[0], colors: { ...BUILTIN_THEMES[0].colors, muted: "#c8c8c8", primary: "#ffb3d1" }, tags: ["#222222"] };
    const failing = checkTheme(bad).filter((c) => !c.pass);
    expect(failing.map((f) => f.label)).toEqual(expect.arrayContaining(["Muted text on background", "Primary accent as text"]));
    // A pale accent gets dark button text instead of white, so its buttons stay readable.
    expect(checkTheme(bad).find((c) => c.label === "Text on primary buttons")).toMatchObject({ fg: "#16141b", pass: true });
    for (const f of failing) {
      const key = f.fix!.key;
      const fixed = key.startsWith("tag") ? { ...bad, tags: bad.tags.map((c, i) => (i === Number(key.slice(3)) ? f.fix!.value : c)) } : { ...bad, colors: { ...bad.colors, [key]: f.fix!.value } };
      expect(checkTheme(fixed).find((c) => c.label === f.label)!.pass).toBe(true);
    }
  });
  it("Fix all leaves nothing failing", () => {
    const awful = { ...BUILTIN_THEMES[0], colors: { ...BUILTIN_THEMES[0].colors, bg: "#f3f7f2", primary: "#8fd19e", secondary: "#a0d0ff", muted: "#b4c2b4", warning: "#ffd76a" }, tags: ["#111111", "#eeeeee"] };
    expect(checkTheme(awful).some((c) => !c.pass)).toBe(true);
    expect(checkTheme(fixAll(awful)).filter((c) => !c.pass)).toEqual([]);
  });
  it("reads and writes theme files, filling gaps safely", () => {
    const t = { ...BUILTIN_THEMES[1], id: "midnight", name: "Midnight" };
    expect(themeFromJSON(themeToJSON(t))).toEqual(t); // extra Many Write keys don't leak back in
    const partial = themeFromJSON(JSON.stringify({ name: "Half", colors: { bg: "#101010", primary: "nope" }, size: 99 }));
    expect(partial).toMatchObject({ id: "half", dark: true, size: 20, colors: { bg: "#101010", primary: BUILTIN_THEMES[1].colors.primary } });
    // A Many Write theme file (four colours) opens here, and our files keep Many Write's names.
    const mw = themeFromJSON(JSON.stringify({ name: "Sea", colors: { background: "#f4f9fb", sidebar: "#e6f1f5", text: "#203038", accent: "#1f6f8b" }, writingFont: "serif" }), "custom-sea");
    expect(mw.colors).toMatchObject({ bg: "#f4f9fb", surface: "#e6f1f5", text: "#203038", primary: "#1f6f8b" });
    expect(contrast(mw.colors.muted, mw.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(JSON.parse(themeToJSON(mw)).colors).toMatchObject({ background: "#f4f9fb", sidebar: "#e6f1f5", accent: "#1f6f8b" });
    expect(() => themeFromJSON('{"hello":1}')).toThrow("isn't a theme");
    expect(themeVars(t)["--font-head"]).toContain("EB Garamond");
  });
});

describe("safety helpers", () => {
  it("only opens web and email links", async () => {
    const { safeExternalUrl } = await import("../src/components/Support");
    expect(safeExternalUrl("https://www.ebay.com")).toBe("https://www.ebay.com/");
    expect(safeExternalUrl("www.ebay.com/item")).toBe("https://www.ebay.com/item");
    expect(safeExternalUrl("mailto:ana@example.com")).toBe("mailto:ana@example.com");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });

  it("formats money even with a bad currency code in settings", async () => {
    const { fmtMoney } = await import("../src/lib/util");
    expect(fmtMoney(12, "dollars")).toBe("$12");
    expect(fmtMoney(12, "eur")).toBe("€12");
    expect(fmtMoney(Number.NaN)).toBe("$0");
  });

  it("names the broken file when the vault can't be read", async () => {
    const fs = new MemoryFS(sampleVault("2026-11-26"));
    fs.files.set("people/broken.md", "---\nname: [unclosed\n---\n");
    await expect(loadVault(fs)).rejects.toThrow(/people\/broken\.md/);
  });
});
