import { useEffect, useMemo, useRef, useState } from "react";
import { groupOf } from "../lib/payments";
import type { Project } from "../lib/types";
import { uniqueSlug } from "../lib/util";
import { useApp, type Screen } from "../store";
import { Field, Modal, Plus } from "./bits";

export const NAV: { id: Screen; label: string; phase?: number }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "collaborators", label: "Collaborators" },
  { id: "venues", label: "Venues" },
  { id: "bookkeeping", label: "Bookkeeping" },
  { id: "budget", label: "Budget" },
  { id: "payments", label: "Payments" },
  { id: "shopping", label: "Shopping list", phase: 6 },
  { id: "paperwork", label: "Paperwork", phase: 4 },
  { id: "schedule", label: "Schedule", phase: 5 },
  { id: "timeline", label: "Timeline", phase: 5 },
  { id: "stripboard", label: "Stripboard", phase: 9 },
  { id: "clearances", label: "Clearances", phase: 9 },
  { id: "inventory", label: "Who has what", phase: 6 },
  { id: "campaigns", label: "Campaigns", phase: 7 },
  { id: "templates", label: "Templates", phase: 7 },
  { id: "reports", label: "Reports", phase: 8 },
  { id: "settings", label: "Settings" },
];

export function Sidebar() {
  const { data, project, setProject, screen, setScreen, allPayments, today, people, } = useSidebarData();
  const [creating, setCreating] = useState(false);

  const counts: Partial<Record<Screen, { text: string; alert?: boolean }>> = useMemo(() => {
    const ps = allPayments.filter((p) => !project || (p.project_alloc[project] ?? 0) > 0);
    const open = ps.filter((p) => p.status !== "paid");
    const overdue = open.filter((p) => groupOf(p, today) === "Overdue").length;
    const ledger = data.ledger.filter((e) => !project || (e.project_alloc[project] ?? 0) > 0).length;
    return {
      payments: open.length ? { text: overdue ? `${overdue} overdue` : `${open.length} open`, alert: overdue > 0 } : undefined,
      bookkeeping: ledger ? { text: String(ledger) } : undefined,
      collaborators: people ? { text: String(people) } : undefined,
      venues: data.venues.length ? { text: String(data.venues.filter((v) => !project || v.projects.includes(project)).length) } : undefined,
    };
  }, [allPayments, data, project, today, people]);

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        Many Produce
      </div>
      <div className="switcher" role="group" aria-label="Project">
        <div className="switcher-label">Project</div>
        <button className="proj-btn" aria-pressed={project === ""} onClick={() => setProject("")}>
          <span className="dot" style={{ background: "conic-gradient(#EE8AAE 0 33%, #6FB3E0 0 66%, #F4A6A0 0)" }} aria-hidden />
          <span>
            <span className="t">All projects</span>
          </span>
        </button>
        {data.projects.map((p) => (
          <button key={p.slug} className="proj-btn" aria-pressed={project === p.slug} onClick={() => setProject(p.slug)}>
            <span className="dot" style={{ background: p.color }} aria-hidden />
            <span>
              <span className="t">{p.name}</span>
              {p.subtitle && <span className="s">{p.subtitle}</span>}
            </span>
          </button>
        ))}
        <button className="proj-btn muted" onClick={() => setCreating(true)}>
          <span style={{ marginTop: 2 }}>
            <Plus />
          </span>
          <span>New project</span>
        </button>
      </div>
      <div className="nav">
        {NAV.map((n, i) => (
          <div key={n.id}>
            {(i === 6 || i === 16) && <div className="nav-sep" />}
            <button aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}>
              <span>{n.label}</span>
              {n.phase ? (
                <span className="later" title={`Planned for build phase ${n.phase}`}>soon</span>
              ) : counts[n.id] ? (
                <span className={`count${counts[n.id]!.alert ? " alert" : ""}`}>{counts[n.id]!.text}</span>
              ) : null}
            </button>
          </div>
        ))}
      </div>
      {creating && <ProjectModal onClose={() => setCreating(false)} />}
    </nav>
  );
}

function useSidebarData() {
  const a = useApp();
  const people = a.data.people.filter((p) => !a.project || p.projects.includes(a.project)).length;
  return { ...a, people };
}

const COLORS = ["#EE8AAE", "#6FB3E0", "#F4A6A0", "#9B8AE0", "#6CC4A1", "#E8B04A", "#9AA3B2"];

export function ProjectModal({ onClose, existing }: { onClose: () => void; existing?: Project }) {
  const { data, saveProject, setProject, deleteProject } = useApp();
  const [p, setP] = useState<Project>(
    existing ?? {
      slug: "",
      name: "",
      color: COLORS[data.projects.length % COLORS.length],
      subtitle: "",
      status: "planning",
      type: "Theater",
      start: "",
      end: "",
      opening: "",
      city: "",
      fiscal_sponsor: "",
      sponsor_fee_rate: null,
      notes: "",
    },
  );
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!p.name.trim()) return;
    const slug = existing ? existing.slug : uniqueSlug(p.name, data.projects.map((x) => x.slug));
    await saveProject({ ...p, slug, name: p.name.trim() });
    if (!existing) setProject(slug);
    onClose();
  };
  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New project"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" wide>
          <input autoFocus value={p.name} onChange={(e) => set("name", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        <Field label="Subtitle" wide>
          <input placeholder="Summer 2027 · Chicago" value={p.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
        </Field>
        <Field label="Color">
          <input type="color" value={p.color} onChange={(e) => set("color", e.target.value)} />
        </Field>
        <Field label="Type">
          <select value={p.type} onChange={(e) => set("type", e.target.value as Project["type"])}>
            <option>Theater</option>
            <option>Film</option>
            <option>Other</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={p.status} onChange={(e) => set("status", e.target.value as Project["status"])}>
            <option>planning</option>
            <option>in production</option>
            <option>closed</option>
          </select>
        </Field>
        <Field label="City">
          <input value={p.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Start">
          <input type="date" value={p.start} onChange={(e) => set("start", e.target.value)} />
        </Field>
        <Field label="Opening">
          <input type="date" value={p.opening} onChange={(e) => set("opening", e.target.value)} />
        </Field>
        <Field label="End">
          <input type="date" value={p.end} onChange={(e) => set("end", e.target.value)} />
        </Field>
        <Field label="Fiscal sponsor">
          <select value={p.fiscal_sponsor} onChange={(e) => set("fiscal_sponsor", e.target.value)}>
            <option value="">None</option>
            {data.sponsors.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} ({+(s.fee_rate * 100).toFixed(2)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fee rate override (%)">
          <input
            type="number"
            step="any"
            placeholder="Sponsor's rate"
            value={p.sponsor_fee_rate === null ? "" : +(p.sponsor_fee_rate * 100).toFixed(4)}
            onChange={(e) => set("sponsor_fee_rate", e.target.value === "" ? null : Number(e.target.value) / 100)}
          />
        </Field>
        <Field label="Notes" wide>
          <textarea value={p.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      <div className="toolbar">
        {existing && !existing.builtin && (
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(`Move "${existing.name}" to the trash? Its ledger entries stay in the ledger.`)) {
                void deleteProject(existing.slug);
                onClose();
              }
            }}
          >
            Delete project
          </button>
        )}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={!p.name.trim()}>
          {existing ? "Save" : "Create project"}
        </button>
      </div>
    </Modal>
  );
}

export function Header({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const { project, projectBySlug } = useApp();
  const p = projectBySlug(project);
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <header className="header">
      <h1>{title}</h1>
      <span className="pill" style={p ? { background: p.color + "33" } : undefined}>
        <span className="dot" style={{ background: p?.color ?? "var(--muted)" }} aria-hidden />
        {p?.name ?? "All projects"}
      </span>
      <div className="spacer" />
      <div className="search">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input id="global-search" aria-label="Search everything" placeholder="Search  ⌘K" onFocus={(e) => { e.currentTarget.blur(); setPaletteOpen(true); }} readOnly />
      </div>
      {actions}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </header>
  );
}

interface Cmd {
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { data, setScreen, openDrawer, setProject, money } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const all: Cmd[] = useMemo(() => {
    const go = (s: Screen) => () => setScreen(s);
    return [
      ...NAV.map((n) => ({ label: n.label, hint: "Screen", run: go(n.id) })),
      ...data.projects.map((p) => ({ label: p.name, hint: "Project", run: () => setProject(p.slug) })),
      ...data.people.map((p) => ({ label: p.name, hint: p.roles.join(", ") || "Person", run: () => { setScreen("collaborators"); openDrawer({ kind: "person", slug: p.slug }); } })),
      ...data.venues.map((v) => ({ label: v.name, hint: "Venue", run: () => { setScreen("venues"); openDrawer({ kind: "venue", slug: v.slug }); } })),
      ...data.ledger.map((e) => ({ label: e.description || "(no description)", hint: `${e.date} · ${money(e.kind === "income" ? e.amount : -e.amount, { sign: true })}`, run: () => { setProject(""); setScreen("bookkeeping"); openDrawer({ kind: "entry", id: e.id }); } })),
      ...Object.values(data.payments).flat().map((p) => ({ label: p.title, hint: `Payment · ${p.due}`, run: () => { setScreen("payments"); openDrawer({ kind: "payment", id: p.id }); } })),
    ];
  }, [data, setScreen, openDrawer, setProject, money]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? all.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(t)) : all).slice(0, 40);
  }, [q, all]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={ref}
          value={q}
          placeholder="Jump to a screen, person, venue, entry…"
          aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter" && list[sel]) { list[sel].run(); onClose(); }
          }}
        />
        <ul role="listbox">
          {list.map((c, i) => (
            <li key={`${c.hint}-${c.label}-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => { c.run(); onClose(); }}>
              <span>{c.label}</span>
              <span className="muted small">{c.hint}</span>
            </li>
          ))}
          {!list.length && <li className="muted">Nothing matches “{q}”</li>}
        </ul>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.message}
          {t.undo && (
            <button onClick={() => { t.undo!(); dismissToast(t.id); }}>Undo</button>
          )}
        </div>
      ))}
    </div>
  );
}
