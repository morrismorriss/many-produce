import { describe, expect, it } from "vitest";
import { buildImport, guessColumns, missingFields, parseAmount, parseDate, parseTimeRange, readSheet, templateCSV, type ImportKind, type ImportOptions } from "../src/lib/csvImport";
import { guessMapping, ledgerFromRows } from "../src/lib/backup";
import { MemoryFS } from "../src/lib/fs";
import { sampleVault } from "../src/lib/seed";
import { SHOP_DEPARTMENTS, SHOP_MONEY, type BudgetLine, type InventoryItem, type Payment, type Person, type ScheduleEvent, type ShoppingItem, type VaultData, type Venue } from "../src/lib/types";
import { loadVault } from "../src/lib/vault";
import { shouldAsk } from "../src/components/Support";

const today = "2026-11-26";
const vault = () => loadVault(new MemoryFS(sampleVault(today)));
const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({ project: "prodigy", update: false, replace: false, addPaidToLedger: true, addPeople: true, today, ...o });
const plan = (kind: ImportKind, csv: string, data: VaultData, o: Partial<ImportOptions> = {}) => {
  const sheet = readSheet(csv);
  return buildImport(kind, sheet, guessColumns(sheet.headers, kind), data, opts(o), { departments: SHOP_DEPARTMENTS, moneyOptions: SHOP_MONEY });
};

describe("csv import helpers", () => {
  it("reads money, dates and times the way spreadsheets write them", () => {
    expect(parseAmount("$1,200.50")).toBe(1200.5);
    expect(parseAmount("(45)")).toBe(-45);
    expect(parseAmount("")).toBeNull();
    expect(parseDate("12/8/2026", today)).toBe("2026-12-08");
    expect(parseDate("2026-12-08", today)).toBe("2026-12-08");
    expect(parseDate("Dec 8, 2026", today)).toBe("2026-12-08");
    expect(parseDate("12/08/2026 0:00:00", today)).toBe("2026-12-08");
    expect(parseTimeRange("6-9:30pm")).toEqual({ start: "18:00", end: "21:30" });
    expect(parseTimeRange("10am to 2pm")).toEqual({ start: "10:00", end: "14:00" });
    expect(parseTimeRange("7:00:00 PM")).toEqual({ start: "19:00", end: "" });
  });

  it("matches a Google Contacts export's columns", () => {
    const m = guessColumns(["First Name", "Last Name", "E-mail 1 - Type", "E-mail 1 - Value", "Phone 1 - Value", "Organization Title", "Notes"], "people");
    expect(m).toMatchObject({ first_name: "First Name", last_name: "Last Name", email: "E-mail 1 - Value", phone: "Phone 1 - Value", roles: "Organization Title", notes: "Notes" });
    expect(missingFields("people", m)).toEqual([]);
  });

  it("offers a template for every kind", () => {
    for (const k of ["people", "venues", "budget", "payments", "events", "shopping", "inventory"] as ImportKind[]) {
      const sheet = readSheet(templateCSV(k));
      expect(missingFields(k, guessColumns(sheet.headers, k))).toEqual([]);
    }
  });
});

describe("csv import", () => {
  it("imports contacts, skipping or filling in people already there", async () => {
    const v = await vault();
    const someone = v.people[0];
    const csv = `First Name,Last Name,Email,Phone,Role\nRia,Chen,ria@example.com,555-0101,Sound designer; Composer\n${someone.name.split(" ")[0]},${someone.name.split(" ").slice(1).join(" ")},,555-9999,\nRia,Chen,,,\n`;
    const p = plan("people", csv, v);
    expect(p.add).toHaveLength(1);
    expect(p.add[0] as Person).toMatchObject({ name: "Ria Chen", email: "ria@example.com", roles: ["Sound designer", "Composer"], projects: ["prodigy"], slug: "ria-chen" });
    expect(p.duplicates).toBe(2);
    const up = plan("people", csv, v, { update: true });
    expect(up.update).toHaveLength(1);
    expect((up.update[0].after as Person).phone).toBe("555-9999");
    expect((up.update[0].after as Person).name).toBe(someone.name);
  });

  it("imports venues", async () => {
    const v = await vault();
    const p = plan("venues", "Venue,City,Seats,Rental rate,Status\nThe Brick,Brooklyn,\"1,200\",$400/night,hold\n", v, { project: "" });
    expect(p.add[0] as Venue).toMatchObject({ name: "The Brick", city: "Brooklyn", capacity: 1200, rate: "$400/night", status: "Hold", projects: [] });
  });

  it("imports a budget, leaving out totals and matching lines already there", async () => {
    const v = await vault();
    const csv = "Category,Line item,Qty,Rate,Total\nDesign,Lighting designer,1,1500,\nArtist fees,Actors,4,$500,\"$2,000\"\nTotal,,,,3500\n";
    const p = plan("budget", csv, v);
    expect(p.add.map((l) => (l as BudgetLine).amount)).toEqual([1500, 2000]);
    expect(p.budgets!.prodigy.length).toBe((v.budgets.prodigy ?? []).length + 2);
    const replaced = plan("budget", csv, v, { replace: true });
    expect(replaced.budgets!.prodigy).toHaveLength(2);
    const income = plan("budget", "Category,Line item,Amount\nGrants,City arts grant,5000\n", v);
    expect((income.add[0] as BudgetLine).type).toBe("income");
  });

  it("imports payments, adding paid ones to Bookkeeping once", async () => {
    const v = await vault();
    const csv = "Payee,For,Amount,Due,Status\nRia Chen,Sound design,$800,12/15/2026,\nRia Chen,Deposit,200,11/20/2026,Paid\n";
    const p = plan("payments", csv, v);
    expect(p.add).toHaveLength(2);
    const [due, paid] = p.add as Payment[];
    expect(due).toMatchObject({ status: "scheduled", due: "2026-12-15", amount: 800, project_alloc: { prodigy: 1 } });
    expect(paid).toMatchObject({ status: "paid", paid_date: "2026-11-20" });
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ kind: "expense", amount: 200, linked_payment: paid.id, counterparty: "Ria Chen" });
    // Same sheet again: nothing new.
    const again = plan("payments", csv, { ...v, payments: { ...v.payments, prodigy: [...(v.payments.prodigy ?? []), ...(p.add as Payment[])] } });
    expect(again.add).toHaveLength(0);
    expect(again.duplicates).toBe(2);
  });

  it("imports a schedule, matching people and venues", async () => {
    const v = await vault();
    const person = v.people.find((x) => x.projects.includes("prodigy"))!;
    const venue = v.venues[0];
    const csv = `Date,Time,Event,Location,Called\n12/8/2026,6-9:30pm,Rehearsal: Act 1,${venue.name},"${person.name}; Dana Newcomer"\nDec 9 2026,10am-2pm,Tech,Somewhere else,\n`;
    const p = plan("events", csv, v);
    const [a, b] = p.add as ScheduleEvent[];
    expect(a).toMatchObject({ date: "2026-12-08", start: "18:00", end: "21:30", type: "Rehearsal", title: "Act 1", location: venue.slug, project: "prodigy" });
    expect(a.called).toContain(person.slug);
    expect(p.newPeople.map((x) => x.name)).toEqual(["Dana Newcomer"]);
    expect(b).toMatchObject({ type: "Tech", title: "Tech", location: "Somewhere else" });
    const noNew = plan("events", csv, v, { addPeople: false });
    expect(noNew.newPeople).toHaveLength(0);
    expect(noNew.problems.join(" ")).toMatch(/Dana Newcomer/);
  });

  it("imports a supplies list and an equipment log", async () => {
    const v = await vault();
    const shop = plan("shopping", "Item,Dept,Who,Need by,Cost,Status\nFake blood,props,me,12/1/2026,$24.99,\nTop hat,Costumes,,,,bought\n", v);
    expect(shop.add[0] as ShoppingItem).toMatchObject({ item: "Fake blood", department: "Props", buyer: "producer", need_by: "2026-12-01", est_cost: 24.99, money: "Producer card", status: "Needed" });
    expect((shop.add[1] as ShoppingItem).status).toBe("Got it");
    const gear = plan("inventory", "Item,Category,Serial #,Value,Rented from,Return\nSM58,Sound,A123,$99,,\nLeko,Lighting,,,BMI Supply,12/20/2026\n", v, { project: "" });
    expect(gear.add[0] as InventoryItem).toMatchObject({ name: "SM58", category: "Sound", serial: "A123", value: 99, owner: "producer" });
    expect(gear.add[1] as InventoryItem).toMatchObject({ rental_house: "BMI Supply", rental_end: "2026-12-20" });
  });

  it("reads extra ledger columns from a spreadsheet", async () => {
    const v = await vault();
    const rows = [{ Date: "2026-11-02", Description: "Gaff tape", Amount: "30", Type: "Expense", Payee: "B&H", Project: "Prodigy", Tags: "Has receipt" }];
    const m = guessMapping(Object.keys(rows[0]));
    expect(m).toMatchObject({ kind: "Type", counterparty: "Payee", project: "Project", tags: "Tags" });
    const r = ledgerFromRows(rows, m, "overhead", "Card", [], v.projects);
    expect(r.entries[0]).toMatchObject({ kind: "expense", amount: 30, counterparty: "B&H", project_alloc: { prodigy: 1 }, tags: ["Has receipt"] });
  });
});

describe("support pop-up", () => {
  it("waits a few launches, snoozes, and stops when asked", () => {
    expect(shouldAsk({ launches: 2, next: "", never: false }, today)).toBe(false);
    expect(shouldAsk({ launches: 5, next: "", never: false }, today)).toBe(true);
    expect(shouldAsk({ launches: 9, next: "2027-01-01", never: false }, today)).toBe(false);
    expect(shouldAsk({ launches: 9, next: "", never: true }, today)).toBe(false);
  });
});
