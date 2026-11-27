// Todoist sync. Many Produce keeps the full plan; Todoist holds the producer's
// own to-dos. One Todoist project per Many Produce project (under a parent you
// choose), with sections for To do (the Dashboard list), Payments, Paperwork,
// Timeline, Shopping, Campaigns and Reports. General Dashboard to-dos go to
// the Company overhead project.
//
// Sync is a diff between what the app wants in Todoist and what it last put
// there (kept in .manyproduce/todoist.json), so anything changed while offline
// simply goes out on the next sync. Title and due-date edits made in the app
// win; completion in Todoist wins.
import { missingPaperwork } from "./paperwork";
import { missingHouseReports } from "./reports";
import { anchorsFor, resolveDue } from "./timeline";
import { OVERHEAD_SLUG, type TodoistSettings, type VaultData } from "./types";

export const SECTIONS = ["To do", "Payments", "Paperwork", "Timeline", "Shopping", "Campaigns", "Reports"] as const;
export type Section = (typeof SECTIONS)[number];

export interface WantedTask {
  key: string; // stable id of the item it comes from, e.g. "payment:p3"
  project: string; // Many Produce project slug
  section: Section;
  content: string;
  due: string; // YYYY-MM-DD or ""
  description: string; // a pointer back to the item in Many Produce
}

export interface SyncState {
  projects: Record<string, string>; // slug -> Todoist project id
  sections: Record<string, string>; // "slug|Section" -> section id
  tasks: Record<string, { id: string; hash: string; project: string }>; // key -> task
}

export const EMPTY_STATE: SyncState = { projects: {}, sections: {}, tasks: {} };

const hashOf = (t: WantedTask) => `${t.content}|${t.due}|${t.section}`;

/** Everything the app wants in Todoist right now, per the sync toggles. */
export function wantedTasks(data: VaultData, s: TodoistSettings, today: string, money: (n: number) => string): WantedTask[] {
  const out: WantedTask[] = [];
  const projects = data.projects.filter((p) => p.status !== "closed");
  const live = new Set(projects.map((p) => p.slug));
  const first = (alloc: Record<string, number>) => Object.keys(alloc).find((k) => live.has(k)) ?? "";

  if (s.sync.hub) {
    for (const t of data.todos) {
      if (t.done) continue;
      // General to-dos, and ones whose project is closed or gone, go to Company overhead.
      const proj = live.has(t.project) ? t.project : OVERHEAD_SLUG;
      out.push({ key: `hub:${t.id}`, project: proj, section: "To do", content: t.text, due: t.due, description: "Many Produce · Dashboard → To do" });
    }
  }
  if (s.sync.timeline) {
    for (const p of projects) {
      const a = anchorsFor(p, data.events);
      for (const t of data.timelines[p.slug] ?? []) {
        if (t.owner !== "producer" || t.status === "Done" || t.status === "Skipped") continue;
        out.push({ key: `timeline:${p.slug}:${t.id}`, project: p.slug, section: "Timeline", content: t.title, due: resolveDue(t, a), description: `Many Produce · ${p.name} · Schedule → Timeline` });
      }
    }
  }
  if (s.sync.payments) {
    for (const pay of Object.values(data.payments).flat()) {
      const proj = first(pay.project_alloc);
      if (pay.status !== "scheduled" || !proj) continue;
      out.push({ key: `payment:${pay.id}`, project: proj, section: "Payments", content: `Pay ${pay.payee || pay.title}: ${money(pay.amount)}`, due: pay.due, description: `Many Produce · Bookkeeping → Payments · ${pay.title}` });
    }
  }
  if (s.sync.paperwork) {
    for (const m of missingPaperwork(data, "", today)) {
      if (!m.project || !live.has(m.project) || m.kind === "expiring") continue;
      const who = m.person ? data.people.find((x) => x.slug === m.person)?.name : m.venue ? data.venues.find((x) => x.slug === m.venue)?.name : "";
      const content: Record<string, string> = {
        agreement: `Send agreement to ${who}`, w9: `Request W-9 from ${who}`, "venue-agreement": `Get rental agreement signed with ${who}`,
        coi: `Send certificate of insurance to ${who}`, sponsorship: "Sign the fiscal sponsorship agreement", expired: m.message,
      };
      out.push({ key: `paper:${m.kind}:${m.person ?? m.venue ?? m.doc ?? m.project}:${m.project}`, project: m.project, section: "Paperwork", content: content[m.kind] ?? m.message, due: "", description: `Many Produce · Paperwork · ${m.message}` });
    }
    for (const d of data.docs) {
      if ((d.status !== "Sent" && d.status !== "Signed by them") || !live.has(d.project)) continue;
      out.push({ key: `chase:${d.path}`, project: d.project, section: "Paperwork", content: d.status === "Sent" ? `Chase signature: ${d.title}` : `Countersign: ${d.title}`, due: "", description: `Many Produce · Paperwork · ${d.path}` });
    }
  }
  if (s.sync.shopping) {
    for (const i of Object.values(data.shopping).flat()) {
      if (i.buyer !== "producer" || i.status !== "Needed" || !live.has(i.project)) continue;
      out.push({ key: `shop:${i.id}`, project: i.project, section: "Shopping", content: `Buy ${i.item}${i.where ? ` (${i.where})` : ""}`, due: i.need_by, description: "Many Produce · Supplies → Shopping list" });
    }
  }
  if (s.sync.campaigns) {
    for (const c of data.campaigns) {
      if ((c.status !== "Scheduled" && c.status !== "Drafting") || !c.date || !live.has(c.project)) continue;
      out.push({ key: `campaign:${c.path}`, project: c.project, section: "Campaigns", content: `${c.type === "Fundraising" ? "Send" : "Post"}: ${c.title}${c.channel ? ` (${c.channel})` : ""}`, due: c.date, description: "Many Produce · Outreach → Campaigns" });
    }
  }
  if (s.sync.house_reports) {
    for (const e of missingHouseReports(data.events, data.houseReports, today)) {
      if (!live.has(e.project)) continue;
      out.push({ key: `house:${e.project}:${e.date}`, project: e.project, section: "Reports", content: `House report for ${e.date}${e.title ? ` (${e.title})` : ""}`, due: today, description: "Many Produce · Reports → House reports" });
    }
  }
  return out;
}

/** The Todoist API calls the sync needs. The desktop app sends them through Rust. */
export interface TodoistApi {
  request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown>;
}

export interface SyncResult {
  state: SyncState;
  created: number;
  updated: number;
  closed: number;
  completedInTodoist: string[]; // keys of tasks finished in Todoist since last sync
}

interface Page<T> { results: T[]; next_cursor?: string | null }

async function listAll<T>(api: TodoistApi, path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = (await api.request("GET", `${path}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ""}`)) as Page<T> | T[];
    if (Array.isArray(res)) return res;
    out.push(...(res.results ?? []));
    if (!res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

/**
 * One sync pass:
 * 1. Make sure every project and section exists.
 * 2. Find tasks completed in Todoist (no longer active) — completion there wins.
 * 3. Create, update or close tasks so Todoist matches what the app wants.
 */
export async function runSync(api: TodoistApi, wanted: WantedTask[], projectNames: Record<string, string>, settings: TodoistSettings, prev: SyncState): Promise<SyncResult> {
  const state: SyncState = { projects: { ...prev.projects }, sections: { ...prev.sections }, tasks: { ...prev.tasks } };

  // 1. Projects and sections.
  const slugs = [...new Set(wanted.map((w) => w.project))];
  const existing = await listAll<{ id: string; name: string; parent_id?: string | null }>(api, "/api/v1/projects");
  for (const slug of slugs) {
    if (state.projects[slug] && existing.some((p) => p.id === state.projects[slug])) continue;
    const name = projectNames[slug] ?? slug;
    const found = existing.find((p) => p.name === name && (p.parent_id ?? "") === (settings.parent_project_id || ""));
    const proj = found ?? ((await api.request("POST", "/api/v1/projects", { name, ...(settings.parent_project_id ? { parent_id: settings.parent_project_id } : {}) })) as { id: string });
    state.projects[slug] = proj.id;
    for (const k of Object.keys(state.sections)) if (k.startsWith(`${slug}|`)) delete state.sections[k];
    // The project we'd made is gone (deleted in Todoist, or never existed): its
    // tasks went with it. Forget them so they're re-created below, rather than
    // treated as "finished in Todoist" (which would mark every item done here).
    for (const [k, t] of Object.entries(state.tasks)) if (t.project === slug) delete state.tasks[k];
  }
  for (const slug of slugs) {
    const pid = state.projects[slug];
    const needed = new Set(wanted.filter((w) => w.project === slug).map((w) => w.section));
    const missing = [...needed].filter((sec) => !state.sections[`${slug}|${sec}`]);
    if (!missing.length) continue;
    const have = await listAll<{ id: string; name: string }>(api, `/api/v1/sections?project_id=${pid}`);
    for (const sec of SECTIONS) {
      if (!needed.has(sec) || state.sections[`${slug}|${sec}`]) continue;
      const s = have.find((x) => x.name === sec) ?? ((await api.request("POST", "/api/v1/sections", { name: sec, project_id: pid })) as { id: string });
      state.sections[`${slug}|${sec}`] = s.id;
    }
  }

  // 2. Completed in Todoist: a task we made that's no longer in its project's active list.
  const completedInTodoist: string[] = [];
  const trackedProjects = [...new Set(Object.values(state.tasks).map((t) => t.project))];
  const liveIds = new Set(existing.map((p) => p.id));
  for (const slug of trackedProjects) {
    const pid = state.projects[slug];
    // A project that's no longer in Todoist (and no longer wanted) took its tasks
    // with it: drop them quietly instead of reporting them finished.
    if (!pid || !liveIds.has(pid)) {
      for (const [k, t] of Object.entries(state.tasks)) if (t.project === slug && !wanted.some((w) => w.project === slug)) delete state.tasks[k];
      continue;
    }
    const active = new Set((await listAll<{ id: string }>(api, `/api/v1/tasks?project_id=${pid}`)).map((t) => t.id));
    for (const [key, t] of Object.entries(state.tasks)) {
      if (t.project === slug && !active.has(t.id)) {
        completedInTodoist.push(key);
        delete state.tasks[key];
      }
    }
  }

  // 3. Push.
  let created = 0, updated = 0, closed = 0;
  const wantedKeys = new Set(wanted.map((w) => w.key));
  for (const w of wanted) {
    if (completedInTodoist.includes(w.key)) continue; // done there; the app catches up instead
    const have = state.tasks[w.key];
    const body = { content: w.content, description: w.description, ...(w.due ? { due_date: w.due } : { due_string: "no date" }) };
    if (!have) {
      const t = (await api.request("POST", "/api/v1/tasks", { ...body, project_id: state.projects[w.project], section_id: state.sections[`${w.project}|${w.section}`] })) as { id: string };
      state.tasks[w.key] = { id: t.id, hash: hashOf(w), project: w.project };
      created++;
    } else if (have.hash !== hashOf(w)) {
      await api.request("POST", `/api/v1/tasks/${have.id}`, body);
      state.tasks[w.key] = { ...have, hash: hashOf(w) };
      updated++;
    }
  }
  // Done in the app (or no longer relevant): close it in Todoist.
  for (const [key, t] of Object.entries(state.tasks)) {
    if (wantedKeys.has(key)) continue;
    await api.request("POST", `/api/v1/tasks/${t.id}/close`);
    delete state.tasks[key];
    closed++;
  }
  return { state, created, updated, closed, completedInTodoist };
}

/** Remove every task the app created (when turning sync off and choosing to clean up). */
export async function deleteAllTasks(api: TodoistApi, state: SyncState): Promise<number> {
  let n = 0;
  for (const t of Object.values(state.tasks)) {
    await api.request("DELETE", `/api/v1/tasks/${t.id}`).catch(() => undefined);
    n++;
  }
  return n;
}

/** The desktop API: every call goes through the Rust side, which holds the token. */
export async function desktopApi(): Promise<TodoistApi> {
  const { invoke } = await import("@tauri-apps/api/core");
  return { request: (method, path, body) => invoke("todoist_request", { method, path, body: body ?? null }) };
}
