// Todoist sync. Many Produce keeps the full plan; Todoist holds the producer's
// own to-dos. Either everything goes into one Todoist project you pick, with a
// section per show, or each show gets its own Todoist project (under a parent
// you choose) with sections for To do (the Dashboard list), Payments,
// Paperwork, Timeline, Shopping, Campaigns and Reports. General Dashboard
// to-dos count as Company overhead.
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
  tasks: Record<string, { id: string; hash: string; project: string; section?: string }>; // key -> task
  target?: string; // where tasks went last time (see targetOf)
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
  moved: number;
  completedInTodoist: string[]; // keys of tasks finished in Todoist since last sync
}

interface Page<T> { results: T[]; next_cursor?: string | null }

export async function listAll<T>(api: TodoistApi, path: string): Promise<T[]> {
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

/** Where tasks go, as stored in the sync state; changing it moves existing tasks. */
export const targetOf = (s: TodoistSettings) => (s.mode === "one" ? `one:${s.target_project_id}` : `per-project:${s.parent_project_id}`);

/**
 * One sync pass:
 * 1. Find tasks completed in Todoist (no longer active where we put them) — completion there wins.
 * 2. Make sure every project and section exists: either one section per show
 *    inside the Todoist project you picked, or a project per show with a
 *    section per kind (Payments, Timeline…).
 * 3. Create, update, move or close tasks so Todoist matches what the app wants.
 */
export async function runSync(api: TodoistApi, wanted: WantedTask[], projectNames: Record<string, string>, settings: TodoistSettings, prev: SyncState): Promise<SyncResult> {
  const state: SyncState = { projects: { ...prev.projects }, sections: { ...prev.sections }, tasks: { ...prev.tasks }, target: prev.target };
  const one = settings.mode === "one";
  const target = targetOf(settings);
  const existing = await listAll<{ id: string; name: string; parent_id?: string | null }>(api, "/api/v1/projects");
  const liveIds = new Set(existing.map((p) => p.id));

  // 1. Completed in Todoist: a task we made that's no longer active in the project we put it in.
  const completedInTodoist: string[] = [];
  const active = new Map<string, Set<string>>(); // Todoist project id -> active task ids
  for (const [key, t] of Object.entries(state.tasks)) {
    const pid = state.projects[t.project];
    // Its project is gone from Todoist (deleted, tasks and all): forget it quietly
    // instead of reporting it finished, so it's re-created if still wanted.
    if (!pid || !liveIds.has(pid)) { delete state.tasks[key]; continue; }
    if (!active.has(pid)) active.set(pid, new Set((await listAll<{ id: string }>(api, `/api/v1/tasks?project_id=${pid}`)).map((x) => x.id)));
    if (!active.get(pid)!.has(t.id)) {
      completedInTodoist.push(key);
      delete state.tasks[key];
    }
  }

  // 2. Projects and sections.
  // State from before you could pick one project has no target: it was a project per show.
  const before = state.target ?? (Object.keys(prev.tasks).length ? (one ? "per-project:" : target) : target);
  const moving = before !== target;
  if (moving) { state.projects = {}; state.sections = {}; }
  state.target = target;
  const slugs = [...new Set(wanted.map((w) => w.project))];
  if (one) {
    if (!settings.target_project_id) throw new Error("Choose the Todoist project to add tasks to in Settings → Todoist.");
    if (!liveIds.has(settings.target_project_id)) throw new Error(`The Todoist project "${settings.target_name || settings.target_project_id}" isn't there anymore. Pick another in Settings → Todoist.`);
    for (const slug of slugs) state.projects[slug] = settings.target_project_id;
  } else {
    for (const slug of slugs) {
      if (state.projects[slug] && liveIds.has(state.projects[slug])) continue;
      const name = projectNames[slug] ?? slug;
      const found = existing.find((p) => p.name === name && (p.parent_id ?? "") === (settings.parent_project_id || ""));
      const proj = found ?? ((await api.request("POST", "/api/v1/projects", { name, ...(settings.parent_project_id ? { parent_id: settings.parent_project_id } : {}) })) as { id: string });
      state.projects[slug] = proj.id;
      for (const k of Object.keys(state.sections)) if (k.startsWith(`${slug}|`)) delete state.sections[k];
    }
  }
  // One project: a section per show. A project per show: a section per kind.
  const secKey = (w: WantedTask) => (one ? `${w.project}|*` : `${w.project}|${w.section}`);
  const secName = (w: WantedTask) => (one ? projectNames[w.project] ?? w.project : w.section);
  const sectionLists = new Map<string, { id: string; name: string }[]>();
  const needed = [...new Map(wanted.map((w) => [secKey(w), w])).values()]
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));
  for (const w of needed) {
    const key = secKey(w);
    if (state.sections[key]) continue;
    const pid = state.projects[w.project];
    if (!sectionLists.has(pid)) sectionLists.set(pid, await listAll<{ id: string; name: string }>(api, `/api/v1/sections?project_id=${pid}`));
    const list = sectionLists.get(pid)!;
    const s = list.find((x) => x.name === secName(w)) ?? ((await api.request("POST", "/api/v1/sections", { name: secName(w), project_id: pid })) as { id: string; name: string });
    if (!list.includes(s)) list.push({ id: s.id, name: secName(w) });
    state.sections[key] = s.id;
  }

  // 3. Push.
  let created = 0, updated = 0, closed = 0, moved = 0;
  const wantedKeys = new Set(wanted.map((w) => w.key));
  for (const w of wanted) {
    if (completedInTodoist.includes(w.key)) continue; // done there; the app catches up instead
    const have = state.tasks[w.key];
    const sid = state.sections[secKey(w)];
    const body = { content: w.content, description: w.description, ...(w.due ? { due_date: w.due } : { due_string: "no date" }) };
    if (!have) {
      const t = (await api.request("POST", "/api/v1/tasks", { ...body, project_id: state.projects[w.project], section_id: sid })) as { id: string };
      state.tasks[w.key] = { id: t.id, hash: hashOf(w), project: w.project, section: sid };
      created++;
      continue;
    }
    // Moved when where-tasks-go changed in Settings (or the item moved to another section).
    if (have.section !== sid && (moving || have.section)) {
      await api.request("POST", `/api/v1/tasks/${have.id}/move`, { section_id: sid });
      moved++;
    }
    state.tasks[w.key] = { ...have, project: w.project, section: sid };
    if (have.hash !== hashOf(w)) {
      await api.request("POST", `/api/v1/tasks/${have.id}`, body);
      state.tasks[w.key].hash = hashOf(w);
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
  return { state, created, updated, closed, moved, completedInTodoist };
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
