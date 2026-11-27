// Quick hub on the Dashboard: a to-do list and a list of links you keep
// reaching for (Canva, the fundraising page, the shared drive…).
// Saved as hub/todos.csv and hub/links.csv.
import { parseCSV, toCSV } from "./files";
import type { HubLink, HubTodo } from "./types";
import { uid } from "./util";

export const TODO_COLUMNS = ["id", "text", "done", "project", "due", "created", "done_date"] as const;
export const LINK_COLUMNS = ["id", "title", "url", "group", "notes"] as const;

export const TODOS_PATH = "hub/todos.csv";
export const LINKS_PATH = "hub/links.csv";

const yes = (s: string | undefined) => s === "yes" || s === "true";

export const todosFromCSV = (text: string): HubTodo[] =>
  parseCSV(text)
    .filter((r) => (r.text ?? "").trim())
    .map((r) => ({
      id: r.id || uid("td"),
      text: r.text ?? "",
      done: yes(r.done),
      project: r.project ?? "",
      due: r.due ?? "",
      created: r.created ?? "",
      done_date: r.done_date ?? "",
    }));

export const todosToCSV = (t: HubTodo[]) =>
  toCSV(TODO_COLUMNS, t.map((x) => ({ ...x, done: x.done ? "yes" : "" })));

export const linksFromCSV = (text: string): HubLink[] =>
  parseCSV(text)
    .filter((r) => (r.url ?? "").trim())
    .map((r) => ({ id: r.id || uid("ln"), title: r.title ?? "", url: r.url ?? "", group: r.group ?? "", notes: r.notes ?? "" }));

export const linksToCSV = (l: HubLink[]) => toCSV(LINK_COLUMNS, l as unknown as Record<string, unknown>[]);

/** "https://www.canva.com/design/abc" -> "canva.com". */
export function hostOf(url: string): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return u.protocol === "mailto:" ? u.pathname : u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Links whose title, address, group or notes contain every word of the query. */
export function filterLinks(links: HubLink[], q: string): HubLink[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return links;
  return links.filter((l) => {
    const hay = `${l.title} ${l.url} ${l.group} ${l.notes}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Links grouped by their group name, in first-seen order; ungrouped ones last. */
export function groupLinks(links: HubLink[]): { group: string; links: HubLink[] }[] {
  const m = new Map<string, HubLink[]>();
  for (const l of links) {
    const g = l.group.trim();
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(l);
  }
  const out = [...m].map(([group, links]) => ({ group, links }));
  return [...out.filter((g) => g.group), ...out.filter((g) => !g.group)];
}

/** Open to-dos first (dated ones by due date, then in the order added), then done ones, newest first. */
export function sortTodos(t: HubTodo[]): HubTodo[] {
  const open = t.filter((x) => !x.done);
  const dated = open.filter((x) => x.due).sort((a, b) => a.due.localeCompare(b.due));
  const undated = open.filter((x) => !x.due);
  const done = t.filter((x) => x.done).sort((a, b) => b.done_date.localeCompare(a.done_date));
  return [...dated, ...undated, ...done];
}
