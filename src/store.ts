// App state (zustand), same pattern as Many Apply's store.ts.
// Everything lives in memory and is rebuilt from the vault files on launch,
// so there's no database to corrupt. Every action writes its files right away.
import { useMemo } from "react";
import { create } from "zustand";
import type { VaultFS } from "./lib/fs";
import { removeWithFees, upsertWithFees } from "./lib/ledger";
import { ledgerEntryForPayment } from "./lib/payments";
import { newDocPath, paymentsForSchedule } from "./lib/paperwork";
import { EMPTY_STATE, deleteAllTasks, desktopApi, runSync, wantedTasks, type SyncState } from "./lib/todoist";
import type { Board, Campaign, Clearance, DailyReport, HouseReport, SavedReport, StripScene } from "./lib/types";
import { newCampaignPath } from "./lib/campaigns";
import type { Checkout, Conflict, InventoryItem, Scene, ScheduleEvent, ShoppingItem, TimelineTask, TimelineTemplate } from "./lib/types";
import { producerPurchaseEntry, reimbursementPayment } from "./lib/shopping";
import { itemFromShopping } from "./lib/inventory";
import type { BudgetLine, Issued1099, LedgerEntry, PaperDoc, Payment, Person, Project, Settings, Sponsor, Template, Venue, VaultData } from "./lib/types";
import { fmtMoney, primaryProject, todayISO, uid } from "./lib/util";
import * as vault from "./lib/vault";
import type { AnyRecord, ImportKind, ImportPlan } from "./lib/csvImport";

export type Screen =
  | "dashboard" | "collaborators" | "venues" | "bookkeeping" | "budget" | "payments" | "shopping"
  | "paperwork" | "schedule" | "inventory" | "campaigns"
  | "templates" | "reports" | "settings";

export interface Toast {
  id: string;
  message: string;
  undo?: () => void;
}

export type DrawerTarget =
  | { kind: "person"; slug: string }
  | { kind: "venue"; slug: string }
  | { kind: "entry"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "doc"; path: string }
  | { kind: "event"; id: string }
  | null;

interface State {
  fs: VaultFS;
  data: VaultData;
  screen: Screen;
  drawer: DrawerTarget;
  newItemSignal: number;
  toasts: Toast[];

  init: (fs: VaultFS, data: VaultData) => void;
  replaceData: (data: VaultData) => void;
  setScreen: (s: Screen) => void;
  openDrawer: (t: DrawerTarget) => void;
  fireNewItem: () => void;
  toast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  setProject: (slug: string) => void;

  saveEntry: (e: LedgerEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (slug: string) => Promise<void>;
  saveBudget: (slug: string, lines: BudgetLine[]) => Promise<void>;
  savePayment: (p: Payment) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  setPaid: (id: string, paid: boolean) => Promise<void>;
  savePerson: (p: Person) => Promise<void>;
  deletePerson: (slug: string) => Promise<void>;
  saveVenue: (v: Venue) => Promise<void>;
  deleteVenue: (slug: string) => Promise<void>;
  saveSponsor: (s: Sponsor) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  /** Create (when path is "") or update a document. Returns the saved doc. */
  saveDoc: (d: PaperDoc) => Promise<PaperDoc>;
  deleteDoc: (path: string) => Promise<void>;
  /** Desktop: pick a file and add it to the document as a new version. */
  attachDocFile: (path: string, label: string) => Promise<void>;
  /** Create scheduled payments for installments that don't have one yet. */
  createSchedulePayments: (path: string) => Promise<number>;
  saveIssued1099: (year: string, rows: Issued1099[]) => Promise<void>;
  saveTemplate: (t: Template) => Promise<void>;
  saveEvent: (e: ScheduleEvent) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  saveConflicts: (c: Conflict[]) => Promise<void>;
  saveScenes: (project: string, s: Scene[]) => Promise<void>;
  saveTimeline: (project: string, tasks: TimelineTask[]) => Promise<void>;
  saveTimelineTemplate: (t: TimelineTemplate) => Promise<void>;
  saveShoppingItem: (i: ShoppingItem) => Promise<void>;
  deleteShoppingItem: (i: ShoppingItem) => Promise<void>;
  /** Tick "got it". Producer-paid items get their expense entry; unticking removes it. */
  setGotIt: (i: ShoppingItem, got: boolean) => Promise<void>;
  /** Create the reimbursement payment to the buyer (optionally marked paid now). */
  reimburse: (i: ShoppingItem, opts: { method: string; due: string; paidNow: boolean }) => Promise<void>;
  moveToEquipment: (i: ShoppingItem) => Promise<void>;
  saveInventoryItem: (i: InventoryItem) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  checkOut: (item: string, person: string, due: string, condition: string) => Promise<void>;
  checkIn: (checkout: string, condition: string) => Promise<void>;
  saveCampaign: (c: Campaign) => Promise<Campaign>;
  deleteCampaign: (path: string) => Promise<void>;
  deleteTemplate: (slug: string) => Promise<void>;
  saveReport: (r: SavedReport) => Promise<void>;
  deleteReport: (path: string) => Promise<void>;
  saveHouseReport: (h: HouseReport) => Promise<void>;
  saveDailyReport: (r: DailyReport) => Promise<void>;
  deleteReportFile: (path: string) => Promise<void>;
  saveStrips: (project: string, s: StripScene[]) => Promise<void>;
  saveBoard: (project: string, b: Board) => Promise<void>;
  saveClearances: (project: string, c: Clearance[]) => Promise<void>;
  /** Write a CSV import in one go. Returns a function that undoes it. */
  applyImport: (kind: ImportKind, plan: ImportPlan<AnyRecord>) => Promise<() => Promise<void>>;
  /** Add ledger entries in one write (statement imports). Returns an undo. */
  importEntries: (entries: LedgerEntry[]) => Promise<() => Promise<void>>;
  /** Payments Todoist says are done; the user confirms the amount before they're marked paid. */
  todoistToConfirm: string[];
  syncTodoist: (manual?: boolean) => Promise<void>;
  todoistTurnOff: (deleteTasks: boolean) => Promise<void>;
  dismissTodoistConfirm: (paymentId: string) => void;
  reload: (quiet?: boolean) => Promise<void>;
}

const yearsOf = (...entries: (LedgerEntry | undefined)[]) =>
  new Set(entries.filter(Boolean).map((e) => (e!.date || "").slice(0, 4) || "undated"));

const upsert = <T,>(list: T[], item: T, key: (x: T) => string) =>
  list.some((x) => key(x) === key(item)) ? list.map((x) => (key(x) === key(item) ? item : x)) : [...list, item];

export const useStore = create<State>()((set, get) => {
  const patch = (fn: (d: VaultData) => Partial<VaultData>) => set((s) => ({ data: { ...s.data, ...fn(s.data) } }));
  const fail = (err: unknown) => get().toast(`Couldn't save: ${String(err)}`);

  const writeLedger = async (next: LedgerEntry[], years: Set<string>) => {
    patch(() => ({ ledger: next }));
    await vault.saveLedger(get().fs, next, years).catch(fail);
  };
  const writePayments = async (slug: string, list: Payment[]) => {
    patch((d) => ({ payments: { ...d.payments, [slug]: list } }));
    await vault.savePayments(get().fs, slug, list).catch(fail);
  };

  return {
    fs: null as unknown as VaultFS,
    data: null as unknown as VaultData,
    screen: "dashboard",
    drawer: null,
    newItemSignal: 0,
    toasts: [],

    init: (fs, data) => set({ fs, data, screen: "dashboard", drawer: null, toasts: [] }),
    replaceData: (data) => set({ data }),
    setScreen: (screen) => set({ screen }),
    openDrawer: (drawer) => set({ drawer }),
    fireNewItem: () => set((s) => ({ newItemSignal: s.newItemSignal + 1 })),
    toast: (message, undo) => {
      const id = uid("t");
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, undo }] }));
      setTimeout(() => get().dismissToast(id), 6000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setProject: (slug) => void get().saveSettings({ ...get().data.settings, last_project: slug }),

    saveSettings: async (s) => {
      patch(() => ({ settings: s }));
      await vault.saveSettings(get().fs, s).catch(fail);
    },

    saveEntry: async (e) => {
      const d = get().data;
      const prev = d.ledger.find((x) => x.id === e.id);
      await writeLedger(upsertWithFees(d.ledger, e, d.projects, d.sponsors), yearsOf(prev, e));
    },

    deleteEntry: async (id) => {
      const d = get().data;
      const { next, removed } = removeWithFees(d.ledger, id);
      await writeLedger(next, yearsOf(...removed));
      // A payment that pointed at this entry goes back to scheduled.
      for (const [slug, list] of Object.entries(d.payments)) {
        if (list.some((p) => p.ledger_id === id)) {
          await writePayments(slug, list.map((p) => (p.ledger_id === id ? { ...p, status: "scheduled" as const, ledger_id: "", paid_date: "" } : p)));
        }
      }
      get().toast("Entry deleted", () => void writeLedger([...get().data.ledger, ...removed], yearsOf(...removed)));
    },

    saveProject: async (p) => {
      patch((d) => {
        const exists = d.projects.some((x) => x.slug === p.slug);
        return {
          projects: exists ? d.projects.map((x) => (x.slug === p.slug ? p : x)) : [...d.projects.filter((x) => !x.builtin), p, ...d.projects.filter((x) => x.builtin)],
          budgets: d.budgets[p.slug] ? d.budgets : { ...d.budgets, [p.slug]: [] },
          payments: d.payments[p.slug] ? d.payments : { ...d.payments, [p.slug]: [] },
        };
      });
      await vault.saveProject(get().fs, p).catch(fail);
    },

    deleteProject: async (slug) => {
      const p = get().data.projects.find((x) => x.slug === slug);
      if (!p || p.builtin) return;
      await get().fs.trash(`projects/${slug}`).catch(fail);
      patch((d) => ({ projects: d.projects.filter((x) => x.slug !== slug) }));
      if (get().data.settings.last_project === slug) get().setProject("");
      get().toast(`"${p.name}" moved to the trash (.manyproduce/trash)`);
    },

    saveBudget: async (slug, lines) => {
      patch((d) => ({ budgets: { ...d.budgets, [slug]: lines } }));
      await vault.saveBudget(get().fs, slug, lines).catch(fail);
    },

    savePayment: async (p) => {
      const owner = primaryProject(p.project_alloc) || "overhead";
      // If the owning project changed, take it out of the old file.
      for (const [slug, list] of Object.entries(get().data.payments)) {
        if (slug !== owner && list.some((x) => x.id === p.id)) await writePayments(slug, list.filter((x) => x.id !== p.id));
      }
      await writePayments(owner, upsert(get().data.payments[owner] ?? [], p, (x) => x.id));
    },

    deletePayment: async (id) => {
      for (const [slug, list] of Object.entries(get().data.payments)) {
        const hit = list.find((x) => x.id === id);
        if (!hit) continue;
        await writePayments(slug, list.filter((x) => x.id !== id));
        get().toast("Payment deleted", () => void get().savePayment(hit));
      }
    },

    setPaid: async (id, paid) => {
      const p = Object.values(get().data.payments).flat().find((x) => x.id === id);
      if (!p) return;
      const today = todayISO();
      if (paid && p.status !== "paid") {
        const e = ledgerEntryForPayment(p, today);
        await get().saveEntry(e);
        await get().savePayment({ ...p, status: "paid", paid_date: today, ledger_id: e.id });
        get().toast("Marked paid · added to Bookkeeping", () => void get().setPaid(id, false));
      } else if (!paid && p.status === "paid") {
        if (p.ledger_id) {
          const { next, removed } = removeWithFees(get().data.ledger, p.ledger_id);
          await writeLedger(next, yearsOf(...removed));
        }
        await get().savePayment({ ...p, status: "scheduled", paid_date: "", ledger_id: "" });
      }
    },

    savePerson: async (p) => {
      patch((d) => ({ people: upsert(d.people, p, (x) => x.slug) }));
      await vault.savePerson(get().fs, p).catch(fail);
    },
    deletePerson: async (slug) => {
      const p = get().data.people.find((x) => x.slug === slug);
      await get().fs.trash(`people/${slug}.md`).catch(fail);
      patch((d) => ({ people: d.people.filter((x) => x.slug !== slug) }));
      set({ drawer: null });
      if (p) get().toast(`${p.name} deleted`, () => void get().savePerson(p));
    },
    saveVenue: async (v) => {
      patch((d) => ({ venues: upsert(d.venues, v, (x) => x.slug) }));
      await vault.saveVenue(get().fs, v).catch(fail);
    },
    deleteVenue: async (slug) => {
      const v = get().data.venues.find((x) => x.slug === slug);
      await get().fs.trash(`venues/${slug}.md`).catch(fail);
      patch((d) => ({ venues: d.venues.filter((x) => x.slug !== slug) }));
      set({ drawer: null });
      if (v) get().toast(`${v.name} deleted`, () => void get().saveVenue(v));
    },
    saveSponsor: async (s) => {
      patch((d) => ({ sponsors: upsert(d.sponsors, s, (x) => x.slug) }));
      await vault.saveSponsor(get().fs, s).catch(fail);
    },

    saveDoc: async (d) => {
      let doc = d;
      if (!doc.path) {
        const year = (doc.signed || doc.effective || todayISO()).slice(0, 4);
        doc = { ...doc, path: newDocPath(doc, get().data.docs.map((x) => x.path), year) };
      }
      patch((data) => ({ docs: upsert(data.docs, doc, (x) => x.path) }));
      await vault.saveDoc(get().fs, doc).catch(fail);
      return doc;
    },
    deleteDoc: async (path) => {
      const d = get().data.docs.find((x) => x.path === path);
      await get().fs.trash(path).catch(fail);
      patch((data) => ({ docs: data.docs.filter((x) => x.path !== path) }));
      set({ drawer: null });
      if (d) get().toast(`"${d.title}" moved to the trash (.manyproduce/trash)`);
    },
    attachDocFile: async (path, label) => {
      const { fs } = get();
      const d = get().data.docs.find((x) => x.path === path);
      if (!d) return;
      if (fs.kind !== "desktop" || !fs.importFile) {
        get().toast("Attaching files needs the desktop app.");
        return;
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const src = await open({ multiple: false, title: `Choose the file for "${label}"` });
      if (typeof src !== "string") return;
      const ext = (src.split(".").pop() ?? "pdf").toLowerCase();
      const v = d.files.length + 1;
      const file = `v${v}-${label.toLowerCase().replace(/^v\d+\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file"}.${ext}`;
      await fs.importFile(src, `${path}/${file}`).catch(fail);
      await get().saveDoc({ ...d, files: [...d.files, { label: label.match(/^v\d/) ? label : `v${v} ${label}`, file, added: todayISO() }] });
    },
    createSchedulePayments: async (path) => {
      const d = get().data.docs.find((x) => x.path === path);
      if (!d) return 0;
      const data = get().data;
      const payee = data.people.find((p) => p.slug === d.people[0])?.name ?? data.venues.find((v) => v.slug === d.venues[0])?.name ?? "";
      const { doc, payments } = paymentsForSchedule(d, payee, data.settings.last_project || "overhead");
      for (const p of payments) await get().savePayment(p);
      await get().saveDoc(doc);
      if (payments.length) get().toast(`${payments.length} scheduled payment${payments.length > 1 ? "s" : ""} added to Payments`);
      return payments.length;
    },
    saveIssued1099: async (year, rows) => {
      patch((d) => ({ issued1099: { ...d.issued1099, [year]: rows } }));
      await vault.saveIssued1099(get().fs, year, rows).catch(fail);
    },
    saveTemplate: async (t) => {
      patch((d) => ({ templates: upsert(d.templates, t, (x) => x.slug) }));
      await vault.saveTemplate(get().fs, t).catch(fail);
    },

    saveEvent: async (e) => {
      const prev = get().data.events.find((x) => x.id === e.id);
      patch((d) => ({ events: upsert(d.events, e, (x) => x.id) }));
      const all = get().data.events;
      await vault.saveEvents(get().fs, e.project, all).catch(fail);
      if (prev && prev.project !== e.project) await vault.saveEvents(get().fs, prev.project, all).catch(fail);
    },
    deleteEvent: async (id) => {
      const e = get().data.events.find((x) => x.id === id);
      if (!e) return;
      patch((d) => ({ events: d.events.filter((x) => x.id !== id) }));
      await vault.saveEvents(get().fs, e.project, get().data.events).catch(fail);
      set({ drawer: null });
      get().toast("Event deleted", () => void get().saveEvent(e));
    },
    saveConflicts: async (c) => {
      patch(() => ({ conflicts: c }));
      await vault.saveConflicts(get().fs, c).catch(fail);
    },
    saveScenes: async (project, sc) => {
      patch((d) => ({ scenes: { ...d.scenes, [project]: sc } }));
      await vault.saveScenes(get().fs, project, sc).catch(fail);
    },
    saveTimeline: async (project, tasks) => {
      patch((d) => ({ timelines: { ...d.timelines, [project]: tasks } }));
      await vault.saveTimeline(get().fs, project, tasks).catch(fail);
    },
    saveTimelineTemplate: async (t) => {
      patch((d) => ({ timelineTemplates: upsert(d.timelineTemplates, t, (x) => x.slug) }));
      await vault.saveTimelineTemplate(get().fs, t).catch(fail);
    },

    saveShoppingItem: async (i) => {
      const list = upsert(get().data.shopping[i.project] ?? [], i, (x) => x.id);
      // Moving an item to another project moves it between files.
      for (const [slug, l] of Object.entries(get().data.shopping)) {
        if (slug !== i.project && l.some((x) => x.id === i.id)) {
          const rest = l.filter((x) => x.id !== i.id);
          patch((d) => ({ shopping: { ...d.shopping, [slug]: rest } }));
          await vault.saveShopping(get().fs, slug, rest).catch(fail);
        }
      }
      patch((d) => ({ shopping: { ...d.shopping, [i.project]: list } }));
      await vault.saveShopping(get().fs, i.project, list).catch(fail);
    },
    deleteShoppingItem: async (i) => {
      const list = (get().data.shopping[i.project] ?? []).filter((x) => x.id !== i.id);
      patch((d) => ({ shopping: { ...d.shopping, [i.project]: list } }));
      await vault.saveShopping(get().fs, i.project, list).catch(fail);
      get().toast(`"${i.item}" removed`, () => void get().saveShoppingItem(i));
    },
    setGotIt: async (i, got) => {
      const today = todayISO();
      if (got) {
        let next: ShoppingItem = { ...i, status: "Got it", actual_cost: i.actual_cost ?? i.est_cost };
        const e = producerPurchaseEntry(next, today, get().data.settings.money_sources);
        if (e && !i.ledger_id) {
          await get().saveEntry(e);
          next = { ...next, ledger_id: e.id };
        }
        await get().saveShoppingItem(next);
        if (e) get().toast(`Got it · ${e.description} added to Bookkeeping`);
      } else {
        if (i.ledger_id) {
          const { next, removed } = removeWithFees(get().data.ledger, i.ledger_id);
          await writeLedger(next, yearsOf(...removed));
        }
        await get().saveShoppingItem({ ...i, status: "Needed", ledger_id: "" });
      }
    },
    reimburse: async (i, { method, due, paidNow }) => {
      const person = get().data.people.find((p) => p.slug === i.buyer);
      const pay = reimbursementPayment(i, person?.name ?? i.buyer, method, due);
      await get().savePayment(pay);
      await get().saveShoppingItem({ ...i, status: "Reimbursed", payment_id: pay.id });
      if (paidNow) await get().setPaid(pay.id, true);
      else get().toast(`Reimbursement to ${pay.payee} added to Payments`);
    },
    moveToEquipment: async (i) => {
      const item = itemFromShopping(i);
      await get().saveInventoryItem(item);
      await get().saveShoppingItem({ ...i, inventory_id: item.id });
      get().toast(`"${i.item}" added to the Equipment log`);
    },
    saveInventoryItem: async (i) => {
      patch((d) => ({ inventory: upsert(d.inventory, i, (x) => x.id) }));
      await vault.saveInventory(get().fs, get().data.inventory).catch(fail);
    },
    deleteInventoryItem: async (id) => {
      const it = get().data.inventory.find((x) => x.id === id);
      patch((d) => ({ inventory: d.inventory.filter((x) => x.id !== id) }));
      await vault.saveInventory(get().fs, get().data.inventory).catch(fail);
      if (it) get().toast(`"${it.name}" removed`, () => void get().saveInventoryItem(it));
    },
    checkOut: async (item, person, due, condition) => {
      const c: Checkout = { id: uid("co"), item, person, out_date: todayISO(), due_date: due, in_date: "", condition_out: condition, condition_in: "", notes: "" };
      patch((d) => ({ checkouts: [...d.checkouts, c] }));
      await vault.saveCheckouts(get().fs, get().data.checkouts).catch(fail);
    },
    checkIn: async (id, condition) => {
      patch((d) => ({ checkouts: d.checkouts.map((c) => (c.id === id ? { ...c, in_date: todayISO(), condition_in: condition } : c)) }));
      await vault.saveCheckouts(get().fs, get().data.checkouts).catch(fail);
    },

    saveCampaign: async (c) => {
      const camp = c.path ? c : { ...c, path: newCampaignPath(c, get().data.campaigns.map((x) => x.path)) };
      patch((d) => ({ campaigns: upsert(d.campaigns, camp, (x) => x.path) }));
      await vault.saveCampaign(get().fs, camp).catch(fail);
      return camp;
    },
    deleteCampaign: async (path) => {
      const c = get().data.campaigns.find((x) => x.path === path);
      await get().fs.trash(path).catch(fail);
      patch((d) => ({ campaigns: d.campaigns.filter((x) => x.path !== path) }));
      if (c) get().toast(`"${c.title}" moved to the trash`);
    },
    deleteTemplate: async (slug) => {
      const t = get().data.templates.find((x) => x.slug === slug);
      await get().fs.trash(`templates/${slug}.md`).catch(fail);
      patch((d) => ({ templates: d.templates.filter((x) => x.slug !== slug) }));
      if (t) get().toast(`"${t.title}" moved to the trash`, () => void get().saveTemplate(t));
    },

    saveReport: async (r) => {
      patch((d) => ({ reports: upsert(d.reports, r, (x) => x.path) }));
      await vault.saveReport(get().fs, r).catch(fail);
    },
    deleteReport: async (path) => {
      await get().fs.trash(path).catch(fail);
      patch((d) => ({ reports: d.reports.filter((x) => x.path !== path) }));
    },
    saveHouseReport: async (h) => {
      patch((d) => ({ houseReports: upsert(d.houseReports, h, (x) => x.path) }));
      await vault.saveHouseReport(get().fs, h).catch(fail);
    },
    saveDailyReport: async (r) => {
      patch((d) => ({ dailyReports: upsert(d.dailyReports, r, (x) => x.path) }));
      await vault.saveDailyReport(get().fs, r, get().data.people).catch(fail);
    },
    deleteReportFile: async (path) => {
      await get().fs.trash(path).catch(fail);
      patch((d) => ({ houseReports: d.houseReports.filter((x) => x.path !== path), dailyReports: d.dailyReports.filter((x) => x.path !== path) }));
      get().toast("Report moved to the trash");
    },

    saveStrips: async (project, sc) => {
      patch((d) => ({ strips: { ...d.strips, [project]: sc } }));
      await vault.saveStrips(get().fs, project, sc).catch(fail);
    },
    saveBoard: async (project, b) => {
      patch((d) => ({ boards: { ...d.boards, [project]: b } }));
      await vault.saveBoard(get().fs, project, b).catch(fail);
    },
    saveClearances: async (project, c) => {
      patch((d) => ({ clearances: { ...d.clearances, [project]: c } }));
      await vault.saveClearances(get().fs, project, c).catch(fail);
    },

    importEntries: async (entries) => {
      const d = get().data;
      let next = d.ledger;
      for (const e of entries) next = upsertWithFees(next, e, d.projects, d.sponsors);
      const years = yearsOf(...entries);
      await writeLedger(next, years);
      return async () => {
        let kept = get().data.ledger;
        for (const e of entries) kept = removeWithFees(kept, e.id).next;
        await writeLedger(kept, years);
      };
    },

    applyImport: async (kind, plan) => {
      const d = get().data;
      const undo: (() => Promise<void>)[] = [];

      // People: imported contacts, or names found in the schedule or shopping list.
      const people = kind === "people" ? (plan.add as Person[]) : plan.newPeople;
      const peopleUpdates = kind === "people" ? (plan.update as { before: Person; after: Person }[]) : [];
      if (people.length || peopleUpdates.length) {
        const changed = [...people, ...peopleUpdates.map((u) => u.after)];
        patch((x) => ({ people: changed.reduce((l, p) => upsert(l, p, (y) => y.slug), x.people) }));
        for (const p of changed) await vault.savePerson(get().fs, p).catch(fail);
        undo.push(async () => {
          for (const p of people) await get().fs.trash(`people/${p.slug}.md`).catch(fail);
          const gone = new Set(people.map((p) => p.slug));
          patch((x) => ({ people: peopleUpdates.reduce((l, u) => upsert(l, u.before, (y) => y.slug), x.people.filter((p) => !gone.has(p.slug))) }));
          for (const u of peopleUpdates) await vault.savePerson(get().fs, u.before).catch(fail);
        });
      }

      if (kind === "venues") {
        const add = plan.add as Venue[], ups = plan.update as { before: Venue; after: Venue }[];
        const changed = [...add, ...ups.map((u) => u.after)];
        patch((x) => ({ venues: changed.reduce((l, v) => upsert(l, v, (y) => y.slug), x.venues) }));
        for (const v of changed) await vault.saveVenue(get().fs, v).catch(fail);
        undo.push(async () => {
          for (const v of add) await get().fs.trash(`venues/${v.slug}.md`).catch(fail);
          const gone = new Set(add.map((v) => v.slug));
          patch((x) => ({ venues: ups.reduce((l, u) => upsert(l, u.before, (y) => y.slug), x.venues.filter((v) => !gone.has(v.slug))) }));
          for (const u of ups) await vault.saveVenue(get().fs, u.before).catch(fail);
        });
      }

      if (kind === "budget" && plan.budgets) {
        for (const [slug, lines] of Object.entries(plan.budgets)) {
          const before = d.budgets[slug] ?? [];
          await get().saveBudget(slug, lines);
          undo.push(() => get().saveBudget(slug, before));
        }
      }

      if (kind === "payments") {
        const add = plan.add as Payment[];
        const bySlug: Record<string, Payment[]> = {};
        for (const p of add) (bySlug[primaryProject(p.project_alloc) || "overhead"] ??= []).push(p);
        for (const [slug, list] of Object.entries(bySlug)) {
          const before = get().data.payments[slug] ?? [];
          await writePayments(slug, [...before, ...list]);
          undo.push(() => writePayments(slug, before));
        }
        // Paid payments: new Bookkeeping entries, and links to entries already there.
        const linked = new Map(add.filter((p) => p.ledger_id).map((p) => [p.ledger_id, p.id]));
        const ledgerBefore = get().data.ledger;
        let next = ledgerBefore.map((e) => (linked.has(e.id) && !plan.entries.some((x) => x.id === e.id) ? { ...e, linked_payment: linked.get(e.id)! } : e));
        for (const e of plan.entries) next = upsertWithFees(next, e, d.projects, d.sponsors);
        if (plan.entries.length || plan.linked) {
          const years = yearsOf(...plan.entries, ...ledgerBefore.filter((e) => linked.has(e.id)));
          await writeLedger(next, years);
          undo.push(() => writeLedger(ledgerBefore, years));
        }
      }

      if (kind === "events") {
        const before = d.events;
        const changed = [...(plan.add as ScheduleEvent[]), ...(plan.update as { after: ScheduleEvent }[]).map((u) => u.after)];
        const touched = new Set(changed.map((e) => e.project));
        patch((x) => ({ events: changed.reduce((l, e) => upsert(l, e, (y) => y.id), x.events) }));
        for (const slug of touched) await vault.saveEvents(get().fs, slug, get().data.events).catch(fail);
        undo.push(async () => {
          patch(() => ({ events: before }));
          for (const slug of touched) await vault.saveEvents(get().fs, slug, before).catch(fail);
        });
      }

      if (kind === "shopping") {
        const changed = [...(plan.add as ShoppingItem[]), ...(plan.update as { after: ShoppingItem }[]).map((u) => u.after)];
        const touched = [...new Set(changed.map((i) => i.project))];
        for (const slug of touched) {
          const before = get().data.shopping[slug] ?? [];
          const list = changed.filter((i) => i.project === slug).reduce((l, i) => upsert(l, i, (y) => y.id), before);
          patch((x) => ({ shopping: { ...x.shopping, [slug]: list } }));
          await vault.saveShopping(get().fs, slug, list).catch(fail);
          undo.push(async () => {
            patch((x) => ({ shopping: { ...x.shopping, [slug]: before } }));
            await vault.saveShopping(get().fs, slug, before).catch(fail);
          });
        }
      }

      if (kind === "inventory") {
        const before = d.inventory;
        const changed = [...(plan.add as InventoryItem[]), ...(plan.update as { after: InventoryItem }[]).map((u) => u.after)];
        patch((x) => ({ inventory: changed.reduce((l, i) => upsert(l, i, (y) => y.id), x.inventory) }));
        await vault.saveInventory(get().fs, get().data.inventory).catch(fail);
        undo.push(async () => {
          patch(() => ({ inventory: before }));
          await vault.saveInventory(get().fs, before).catch(fail);
        });
      }

      return async () => { for (const u of undo.reverse()) await u(); };
    },

    todoistToConfirm: [],
    dismissTodoistConfirm: (id) => set((st) => ({ todoistToConfirm: st.todoistToConfirm.filter((x) => x !== id) })),
    syncTodoist: async (manual) => {
      const { fs, data } = get();
      const ts = data.settings.todoist;
      if (fs.kind !== "desktop" || !ts.enabled) {
        if (manual) get().toast(fs.kind !== "desktop" ? "Todoist sync works in the desktop app." : "Turn on Todoist sync first.");
        return;
      }
      const statePath = ".manyproduce/todoist.json";
      let prev: SyncState = EMPTY_STATE;
      try { prev = { ...EMPTY_STATE, ...JSON.parse((await fs.read(statePath)) ?? "{}") }; } catch { /* start fresh */ }
      const today = todayISO();
      const money = (n: number) => fmtMoney(n, data.settings.currency);
      try {
        const api = await desktopApi();
        const wanted = wantedTasks(data, ts, today, money);
        const names = Object.fromEntries(data.projects.map((p) => [p.slug, p.name]));
        const res = await runSync(api, wanted, names, ts, prev);
        await fs.write(statePath, JSON.stringify(res.state, null, 2));
        // Completion in Todoist wins.
        const confirm: string[] = [];
        for (const key of res.completedInTodoist) {
          const [kind, ...rest] = key.split(":");
          const d = get().data;
          if (kind === "timeline") {
            const [slug, id] = rest;
            const list = d.timelines[slug] ?? [];
            if (list.some((t) => t.id === id)) await get().saveTimeline(slug, list.map((t) => (t.id === id ? { ...t, status: "Done" as const } : t)));
          } else if (kind === "payment") {
            if (Object.values(d.payments).flat().some((p) => p.id === rest[0] && p.status !== "paid")) confirm.push(rest[0]);
          } else if (kind === "shop") {
            const item = Object.values(d.shopping).flat().find((i) => i.id === rest[0]);
            if (item && item.status === "Needed") await get().setGotIt(item, true);
          } else if (kind === "campaign") {
            const c = d.campaigns.find((x) => x.path === rest.join(":"));
            if (c && c.status !== "Done") await get().saveCampaign({ ...c, status: "Done" });
          }
        }
        set((st) => ({ todoistToConfirm: [...new Set([...st.todoistToConfirm, ...confirm])] }));
        await get().saveSettings({ ...get().data.settings, todoist: { ...get().data.settings.todoist, last_sync: new Date().toISOString(), last_error: "" } });
        if (manual) get().toast(`Todoist: ${res.created} added, ${res.updated} updated, ${res.closed} closed${res.completedInTodoist.length ? `, ${res.completedInTodoist.length} finished in Todoist` : ""}`);
      } catch (e) {
        const msg = String(e);
        await get().saveSettings({ ...get().data.settings, todoist: { ...get().data.settings.todoist, last_error: msg.includes("offline") ? "Offline. Changes will sync next time." : msg } });
        if (manual) get().toast(msg.includes("offline") ? "Offline: changes will sync next time." : `Todoist sync failed: ${msg}`);
      }
    },
    todoistTurnOff: async (deleteTasks) => {
      const { fs } = get();
      if (deleteTasks && fs.kind === "desktop") {
        try {
          const state = { ...EMPTY_STATE, ...JSON.parse((await fs.read(".manyproduce/todoist.json")) ?? "{}") } as SyncState;
          const n = await deleteAllTasks(await desktopApi(), state);
          await fs.write(".manyproduce/todoist.json", JSON.stringify({ ...state, tasks: {} }, null, 2));
          get().toast(`Removed ${n} tasks from Todoist`);
        } catch (e) {
          get().toast(`Couldn't remove tasks: ${String(e)}`);
        }
      }
      await get().saveSettings({ ...get().data.settings, todoist: { ...get().data.settings.todoist, enabled: false } });
    },

    reload: async (quiet) => {
      const fresh = await vault.loadVault(get().fs);
      set({ data: fresh });
      if (!quiet) get().toast("Reloaded from the vault folder");
    },
  };
});

/** The whole store plus a few derived helpers. Screens use this. */
export function useApp() {
  const s = useStore();
  const { data } = s;
  const project = data.projects.some((p) => p.slug === data.settings.last_project) ? data.settings.last_project : "";
  const allPayments = useMemo(() => Object.values(data.payments).flat(), [data.payments]);
  const currency = data.settings.currency;
  const money = useMemo(() => (n: number, opts?: { sign?: boolean; cents?: boolean }) => fmtMoney(n, currency, opts), [currency]);
  const projectBySlug = useMemo(() => (slug: string) => data.projects.find((p) => p.slug === slug), [data.projects]);
  return { ...s, project, allPayments, money, projectBySlug, today: todayISO() };
}
