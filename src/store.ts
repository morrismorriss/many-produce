// App state (zustand), same pattern as Many Apply's store.ts.
// Everything lives in memory and is rebuilt from the vault files on launch,
// so there's no database to corrupt. Every action writes its files right away.
import { useMemo } from "react";
import { create } from "zustand";
import type { VaultFS } from "./lib/fs";
import { removeWithFees, upsertWithFees } from "./lib/ledger";
import { ledgerEntryForPayment } from "./lib/payments";
import { newDocPath, paymentsForSchedule } from "./lib/paperwork";
import type { Campaign } from "./lib/types";
import { newCampaignPath } from "./lib/campaigns";
import type { Checkout, Conflict, InventoryItem, Scene, ScheduleEvent, ShoppingItem, TimelineTask, TimelineTemplate } from "./lib/types";
import { producerPurchaseEntry, reimbursementPayment } from "./lib/shopping";
import { itemFromShopping } from "./lib/inventory";
import type { BudgetLine, Issued1099, LedgerEntry, PaperDoc, Payment, Person, Project, Settings, Sponsor, Template, Venue, VaultData } from "./lib/types";
import { fmtMoney, primaryProject, todayISO, uid } from "./lib/util";
import * as vault from "./lib/vault";

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
