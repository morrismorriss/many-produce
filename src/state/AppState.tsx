import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { removeWithFees, upsertWithFees } from "../lib/ledger";
import { ledgerEntryForPayment } from "../lib/payments";
import type { BudgetLine, LedgerEntry, Payment, Person, Project, Settings, Sponsor, Venue, VaultData } from "../lib/types";
import { fmtMoney, primaryProject, todayISO, uid } from "../lib/util";
import type { VaultFS } from "../vault/fs";
import * as store from "../vault/store";

export type Screen =
  | "dashboard" | "collaborators" | "venues" | "bookkeeping" | "budget" | "payments" | "shopping"
  | "paperwork" | "schedule" | "timeline" | "stripboard" | "clearances" | "inventory" | "campaigns"
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
  | { kind: "project"; slug: string }
  | null;

interface Ctx {
  fs: VaultFS;
  data: VaultData;
  project: string; // "" = All projects
  setProject: (slug: string) => void;
  screen: Screen;
  setScreen: (s: Screen) => void;
  drawer: DrawerTarget;
  openDrawer: (t: DrawerTarget) => void;
  newItemSignal: number; // bumps on Cmd/Ctrl+N
  fireNewItem: () => void;
  toasts: Toast[];
  toast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  money: (n: number, opts?: { sign?: boolean; cents?: boolean }) => string;
  today: string;
  allPayments: Payment[];
  projectBySlug: (slug: string) => Project | undefined;
  // mutations
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
  reload: () => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

const yearsOf = (...entries: (LedgerEntry | undefined)[]) =>
  new Set(entries.filter(Boolean).map((e) => (e!.date || "").slice(0, 4) || "undated"));

export function AppProvider({ fs, initial, children }: { fs: VaultFS; initial: VaultData; children: ReactNode }) {
  const [data, setData] = useState<VaultData>(initial);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [drawer, openDrawer] = useState<DrawerTarget>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [newItemSignal, setNewItem] = useState(0);
  const today = todayISO();

  const project = data.projects.some((p) => p.slug === data.settings.last_project) ? data.settings.last_project : "";

  const update = useCallback((fn: (d: VaultData) => VaultData) => {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setData(next);
    return next;
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, undo?: () => void) => {
      const id = uid("t");
      setToasts((t) => [...t.slice(-2), { id, message, undo }]);
      setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  const fail = useCallback((err: unknown) => toast(`Couldn't save: ${String(err)}`), [toast]);

  const saveSettings = useCallback(
    async (s: Settings) => {
      update((d) => ({ ...d, settings: s }));
      await store.saveSettings(fs, s).catch(fail);
    },
    [fs, update, fail],
  );

  const setProject = useCallback(
    (slug: string) => void saveSettings({ ...dataRef.current.settings, last_project: slug }),
    [saveSettings],
  );

  const writeLedger = useCallback(
    async (next: LedgerEntry[], years: Set<string>) => {
      update((d) => ({ ...d, ledger: next }));
      await store.saveLedger(fs, next, years).catch(fail);
    },
    [fs, update, fail],
  );

  const saveEntry = useCallback(
    async (e: LedgerEntry) => {
      const d = dataRef.current;
      const prev = d.ledger.find((x) => x.id === e.id);
      const next = upsertWithFees(d.ledger, e, d.projects, d.sponsors);
      await writeLedger(next, yearsOf(prev, e));
    },
    [writeLedger],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const d = dataRef.current;
      const { next, removed } = removeWithFees(d.ledger, id);
      await writeLedger(next, yearsOf(...removed));
      // Unlink a payment that pointed at this entry.
      for (const [slug, list] of Object.entries(d.payments)) {
        const hit = list.find((p) => p.ledger_id === id);
        if (hit) {
          const nl = list.map((p) => (p.id === hit.id ? { ...p, status: "scheduled" as const, ledger_id: "", paid_date: "" } : p));
          update((dd) => ({ ...dd, payments: { ...dd.payments, [slug]: nl } }));
          await store.savePayments(fs, slug, nl).catch(fail);
        }
      }
      toast("Entry deleted", () => {
        const cur = dataRef.current.ledger;
        void writeLedger([...cur, ...removed], yearsOf(...removed));
      });
    },
    [fs, writeLedger, toast, update, fail],
  );

  const saveProject = useCallback(
    async (p: Project) => {
      update((d) => {
        const exists = d.projects.some((x) => x.slug === p.slug);
        return {
          ...d,
          projects: exists ? d.projects.map((x) => (x.slug === p.slug ? p : x)) : [...d.projects.filter((x) => !x.builtin), p, ...d.projects.filter((x) => x.builtin)],
          budgets: d.budgets[p.slug] ? d.budgets : { ...d.budgets, [p.slug]: [] },
          payments: d.payments[p.slug] ? d.payments : { ...d.payments, [p.slug]: [] },
        };
      });
      await store.saveProject(fs, p).catch(fail);
    },
    [fs, update, fail],
  );

  const deleteProject = useCallback(
    async (slug: string) => {
      const p = dataRef.current.projects.find((x) => x.slug === slug);
      if (!p || p.builtin) return;
      await fs.trash(`projects/${slug}`).catch(fail);
      update((d) => ({ ...d, projects: d.projects.filter((x) => x.slug !== slug) }));
      if (dataRef.current.settings.last_project === slug) setProject("");
      toast(`"${p.name}" moved to trash (.manyproduce/trash)`);
    },
    [fs, update, fail, toast, setProject],
  );

  const saveBudget = useCallback(
    async (slug: string, lines: BudgetLine[]) => {
      update((d) => ({ ...d, budgets: { ...d.budgets, [slug]: lines } }));
      await store.saveBudget(fs, slug, lines).catch(fail);
    },
    [fs, update, fail],
  );

  const ownerOf = (p: Payment) => primaryProject(p.project_alloc) || "overhead";

  const writePayments = useCallback(
    async (slug: string, list: Payment[]) => {
      update((d) => ({ ...d, payments: { ...d.payments, [slug]: list } }));
      await store.savePayments(fs, slug, list).catch(fail);
    },
    [fs, update, fail],
  );

  const savePayment = useCallback(
    async (p: Payment) => {
      const d = dataRef.current;
      const owner = ownerOf(p);
      // If the owning project changed, remove it from the old file.
      for (const [slug, list] of Object.entries(d.payments)) {
        if (slug !== owner && list.some((x) => x.id === p.id)) await writePayments(slug, list.filter((x) => x.id !== p.id));
      }
      const list = dataRef.current.payments[owner] ?? [];
      const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
      await writePayments(owner, next);
    },
    [writePayments],
  );

  const deletePayment = useCallback(
    async (id: string) => {
      for (const [slug, list] of Object.entries(dataRef.current.payments)) {
        const hit = list.find((x) => x.id === id);
        if (hit) {
          await writePayments(slug, list.filter((x) => x.id !== id));
          toast("Payment deleted", () => void savePayment(hit));
        }
      }
    },
    [writePayments, toast, savePayment],
  );

  const setPaid = useCallback(
    async (id: string, paid: boolean) => {
      const p = Object.values(dataRef.current.payments).flat().find((x) => x.id === id);
      if (!p) return;
      if (paid && p.status !== "paid") {
        const e = ledgerEntryForPayment(p, today);
        await saveEntry(e);
        await savePayment({ ...p, status: "paid", paid_date: today, ledger_id: e.id });
        toast(`Marked paid · added to Bookkeeping`, () => void setPaidRef.current(id, false));
      } else if (!paid && p.status === "paid") {
        if (p.ledger_id) {
          const { next, removed } = removeWithFees(dataRef.current.ledger, p.ledger_id);
          await writeLedger(next, yearsOf(...removed));
        }
        await savePayment({ ...p, status: "scheduled", paid_date: "", ledger_id: "" });
      }
    },
    [today, saveEntry, savePayment, toast, writeLedger],
  );
  const setPaidRef = useRef(setPaid);
  setPaidRef.current = setPaid;

  const savePerson = useCallback(
    async (p: Person) => {
      update((d) => ({ ...d, people: d.people.some((x) => x.slug === p.slug) ? d.people.map((x) => (x.slug === p.slug ? p : x)) : [...d.people, p] }));
      await store.savePerson(fs, p).catch(fail);
    },
    [fs, update, fail],
  );
  const deletePerson = useCallback(
    async (slug: string) => {
      const p = dataRef.current.people.find((x) => x.slug === slug);
      await fs.trash(`people/${slug}.md`).catch(fail);
      update((d) => ({ ...d, people: d.people.filter((x) => x.slug !== slug) }));
      openDrawer(null);
      if (p) toast(`${p.name} deleted`, () => void savePerson(p));
    },
    [fs, update, fail, toast, savePerson],
  );
  const saveVenue = useCallback(
    async (v: Venue) => {
      update((d) => ({ ...d, venues: d.venues.some((x) => x.slug === v.slug) ? d.venues.map((x) => (x.slug === v.slug ? v : x)) : [...d.venues, v] }));
      await store.saveVenue(fs, v).catch(fail);
    },
    [fs, update, fail],
  );
  const deleteVenue = useCallback(
    async (slug: string) => {
      const v = dataRef.current.venues.find((x) => x.slug === slug);
      await fs.trash(`venues/${slug}.md`).catch(fail);
      update((d) => ({ ...d, venues: d.venues.filter((x) => x.slug !== slug) }));
      openDrawer(null);
      if (v) toast(`${v.name} deleted`, () => void saveVenue(v));
    },
    [fs, update, fail, toast, saveVenue],
  );
  const saveSponsor = useCallback(
    async (s: Sponsor) => {
      update((d) => ({ ...d, sponsors: d.sponsors.some((x) => x.slug === s.slug) ? d.sponsors.map((x) => (x.slug === s.slug ? s : x)) : [...d.sponsors, s] }));
      await store.saveSponsor(fs, s).catch(fail);
    },
    [fs, update, fail],
  );

  const reload = useCallback(async () => {
    const fresh = await store.loadVault(fs);
    update(() => fresh);
    toast("Reloaded from the vault folder");
  }, [fs, update, toast]);

  // Desktop: pick up edits made in other apps when the window regains focus.
  useEffect(() => {
    if (fs.kind !== "desktop") return;
    const onFocus = () => void store.loadVault(fs).then((fresh) => update(() => fresh));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fs, update]);

  const allPayments = useMemo(() => Object.values(data.payments).flat(), [data.payments]);
  const money = useCallback((n: number, opts?: { sign?: boolean; cents?: boolean }) => fmtMoney(n, data.settings.currency, opts), [data.settings.currency]);
  const projectBySlug = useCallback((slug: string) => data.projects.find((p) => p.slug === slug), [data.projects]);

  const value: Ctx = {
    fs, data, project, setProject, screen, setScreen, drawer, openDrawer,
    newItemSignal, fireNewItem: () => setNewItem((n) => n + 1),
    toasts, toast, dismissToast, money, today, allPayments, projectBySlug,
    saveEntry, deleteEntry, saveProject, deleteProject, saveBudget, savePayment, deletePayment, setPaid,
    savePerson, deletePerson, saveVenue, deleteVenue, saveSponsor, saveSettings, reload,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
