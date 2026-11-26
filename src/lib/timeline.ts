// Timeline: the production plan built backward from opening night.
import { parseFrontmatter, stringifyFrontmatter } from "./files";
import type { Anchor, PaperDoc, Payment, Project, ScheduleEvent, TaskStatus, TimelineTask, TimelineTemplate } from "./types";
import { addDays, daysBetween, uid } from "./util";

export const ANCHOR_LABEL: Record<Anchor, string> = {
  start: "Project start", first_rehearsal: "First rehearsal", tech: "Tech", opening: "Opening", closing: "Closing", end: "Project end",
};
export const TASK_STATUSES: TaskStatus[] = ["To do", "Doing", "Done", "Skipped"];
export const DEPARTMENTS = ["Producing", "Artistic", "Design", "Production", "Marketing", "Fundraising", "Box office", "Admin"];

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function taskFrom(x: Record<string, unknown>): TimelineTask {
  const rel = x.rel && typeof x.rel === "object" ? (x.rel as Record<string, unknown>) : null;
  return {
    id: str(x.id) || uid("t"),
    title: str(x.title),
    due: str(x.due),
    rel: rel && rel.anchor ? { anchor: str(rel.anchor) as Anchor, days: Number(rel.days) || 0 } : null,
    owner: str(x.owner) || "producer",
    status: (TASK_STATUSES as string[]).includes(str(x.status)) ? (str(x.status) as TaskStatus) : "To do",
    department: str(x.department),
    phase: str(x.phase),
    link: str(x.link),
    todoist: x.todoist === true,
    todoist_task_id: str(x.todoist_task_id),
  };
}

export function timelineFromMd(text: string): { tasks: TimelineTask[]; body: string } {
  const { data, body } = parseFrontmatter<{ tasks?: Record<string, unknown>[] }>(text);
  return { tasks: (data.tasks ?? []).map(taskFrom), body };
}

export function timelineToMd(tasks: TimelineTask[], body = ""): string {
  return stringifyFrontmatter(
    { tasks: tasks.map((t) => ({ ...t, rel: t.rel ?? undefined, todoist_task_id: t.todoist_task_id || undefined, link: t.link || undefined, phase: t.phase || undefined })) },
    body || "Production timeline. Tasks with `rel` move when their anchor date (e.g. opening) moves.",
  );
}

export function timelineTemplateFromMd(slug: string, text: string): TimelineTemplate {
  const { data } = parseFrontmatter<{ title?: string; description?: string; tasks?: Record<string, unknown>[] }>(text);
  return {
    slug,
    title: str(data.title) || slug,
    description: str(data.description),
    tasks: (data.tasks ?? []).map((x) => {
      const t = taskFrom(x);
      return { title: t.title, due: t.due, rel: t.rel, owner: t.owner, department: t.department, phase: t.phase, link: "", todoist: false };
    }),
  };
}

export function timelineTemplateToMd(t: TimelineTemplate): string {
  return stringifyFrontmatter({ title: t.title, description: t.description, tasks: t.tasks.map((x) => ({ title: x.title, rel: x.rel ?? undefined, due: x.rel ? undefined : x.due || undefined, owner: x.owner, department: x.department, phase: x.phase || undefined })) });
}

// ---- anchors and relative dates ----

export type Anchors = Record<Anchor, string>;

/** Key dates: from the project, else from the Schedule. */
export function anchorsFor(p: Project, events: ScheduleEvent[]): Anchors {
  const mine = events.filter((e) => e.project === p.slug).sort((a, b) => a.date.localeCompare(b.date));
  const first = (types: string[]) => mine.find((e) => types.includes(e.type))?.date ?? "";
  const perfs = mine.filter((e) => e.type === "Performance");
  return {
    start: p.start,
    first_rehearsal: first(["Rehearsal", "Read-through"]),
    tech: first(["Tech"]),
    opening: p.opening || perfs[0]?.date || "",
    closing: perfs[perfs.length - 1]?.date || p.end || "",
    end: p.end,
  };
}

export function resolveDue(t: Pick<TimelineTask, "due" | "rel">, a: Anchors): string {
  if (!t.rel) return t.due;
  const base = a[t.rel.anchor];
  return base ? addDays(base, t.rel.days) : "";
}

export function relLabel(rel: TimelineTask["rel"]): string {
  if (!rel) return "";
  const d = rel.days;
  const n = Math.abs(d);
  const amount = n === 0 ? "" : n % 7 === 0 ? `${n / 7} week${n === 7 ? "" : "s"}` : `${n} day${n === 1 ? "" : "s"}`;
  return d === 0 ? ANCHOR_LABEL[rel.anchor] : `${ANCHOR_LABEL[rel.anchor]} ${d < 0 ? "−" : "+"} ${amount}`;
}

/** How tasks would move if an anchor date changed (for the preview before saving). */
export function shiftPreview(tasks: TimelineTask[], anchor: Anchor, from: string, to: string): { task: TimelineTask; before: string; after: string }[] {
  if (!from || !to || from === to) return [];
  return tasks
    .filter((t) => t.rel?.anchor === anchor)
    .map((t) => ({ task: t, before: addDays(from, t.rel!.days), after: addDays(to, t.rel!.days) }));
}

/** Convert absolute tasks to "relative to opening" so a timeline can be reused as a template. */
export function toTemplate(title: string, description: string, tasks: TimelineTask[], a: Anchors): TimelineTemplate {
  return {
    slug: "",
    title,
    description,
    tasks: tasks
      .filter((t) => t.status !== "Skipped")
      .map((t) => {
        const due = resolveDue(t, a);
        const rel = t.rel ?? (a.opening && due ? { anchor: "opening" as Anchor, days: daysBetween(a.opening, due) } : null);
        return { title: t.title, due: rel ? "" : due, rel, owner: t.owner === "producer" ? "producer" : "producer", department: t.department, phase: t.phase, link: "", todoist: false };
      }),
  };
}

export function applyTemplate(t: TimelineTemplate): TimelineTask[] {
  return t.tasks.map((x) => ({ ...x, id: uid("t"), status: "To do" as TaskStatus, todoist_task_id: "" }));
}

// ---- milestones from other screens ----

export interface Milestone {
  date: string;
  title: string;
  kind: "payment" | "paperwork" | "schedule";
  target: { kind: "payment"; id: string } | { kind: "doc"; path: string } | null;
}

export function autoMilestones(p: Project, a: Anchors, payments: Payment[], docs: PaperDoc[]): Milestone[] {
  const out: Milestone[] = [];
  const sched: [Anchor, string][] = [["first_rehearsal", "First rehearsal"], ["tech", "Tech"], ["opening", "Opening"], ["closing", "Closing"]];
  for (const [k, label] of sched) if (a[k]) out.push({ date: a[k], title: label, kind: "schedule", target: null });
  for (const pay of payments) {
    if (pay.status === "scheduled" && pay.due && (pay.project_alloc[p.slug] ?? 0) > 0) out.push({ date: pay.due, title: `Pay: ${pay.title}`, kind: "payment", target: { kind: "payment", id: pay.id } });
  }
  for (const d of docs) {
    if (d.project !== p.slug || d.status === "Void") continue;
    if (d.expires) out.push({ date: d.expires, title: `Expires: ${d.title}`, kind: "paperwork", target: { kind: "doc", path: d.path } });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

// ---- starter timeline templates ----

const T = (title: string, anchor: Anchor, days: number, department: string, phase: string) => ({ title, due: "", rel: { anchor, days }, owner: "producer", department, phase, link: "", todoist: false });

export const STARTER_TIMELINE_TEMPLATES: TimelineTemplate[] = [
  {
    slug: "staged-reading",
    title: "Staged reading (4 weeks)",
    description: "One-night reading with a short rehearsal period.",
    tasks: [
      T("Confirm director and date", "opening", -28, "Producing", "Planning"),
      T("Book the space", "opening", -28, "Producing", "Planning"),
      T("Cast the reading", "opening", -21, "Artistic", "Planning"),
      T("Send agreements and collect W-9s", "opening", -18, "Admin", "Planning"),
      T("Announce on Instagram and newsletter", "opening", -14, "Marketing", "Marketing"),
      T("Print scripts", "opening", -4, "Production", "Rehearsal"),
      T("Rehearsal", "opening", -2, "Artistic", "Rehearsal"),
      T("Pay stipends", "opening", 1, "Admin", "Wrap-up"),
      T("Thank-you notes", "opening", 3, "Fundraising", "Wrap-up"),
    ],
  },
  {
    slug: "fringe-bar-show",
    title: "Fringe / bar show (8 weeks)",
    description: "A short run in a non-traditional space.",
    tasks: [
      T("Lock venue and dates", "opening", -56, "Producing", "Planning"),
      T("Budget and fundraising plan", "opening", -56, "Producing", "Planning"),
      T("Cast and creative team confirmed", "opening", -49, "Artistic", "Planning"),
      T("Agreements signed, W-9s in", "opening", -42, "Admin", "Planning"),
      T("Certificate of insurance to venue", "opening", -35, "Admin", "Planning"),
      T("Tickets on sale", "opening", -35, "Box office", "Marketing"),
      T("Photo shoot for marketing", "opening", -28, "Marketing", "Marketing"),
      T("First rehearsal", "opening", -28, "Artistic", "Rehearsal"),
      T("Props and costumes bought", "opening", -14, "Design", "Rehearsal"),
      T("Tech", "opening", -2, "Production", "Tech"),
      T("Final payments and reimbursements", "closing", 7, "Admin", "Wrap-up"),
    ],
  },
  {
    slug: "full-production",
    title: "Full production (16 weeks)",
    description: "A full run with designers, tech and a marketing campaign.",
    tasks: [
      T("Rights secured", "opening", -112, "Producing", "Planning"),
      T("Venue contract signed", "opening", -105, "Producing", "Planning"),
      T("Fiscal sponsor approval for solicitations", "opening", -98, "Fundraising", "Planning"),
      T("Crowdfunding campaign launch", "opening", -84, "Fundraising", "Fundraising"),
      T("Designers confirmed", "opening", -84, "Design", "Planning"),
      T("Auditions", "opening", -70, "Artistic", "Casting"),
      T("Cast agreements signed", "opening", -63, "Admin", "Casting"),
      T("Design meetings", "opening", -56, "Design", "Design"),
      T("Tickets on sale", "opening", -49, "Box office", "Marketing"),
      T("First rehearsal", "opening", -35, "Artistic", "Rehearsal"),
      T("Press release out", "opening", -28, "Marketing", "Marketing"),
      T("Load-in", "opening", -7, "Production", "Tech"),
      T("Tech", "opening", -5, "Production", "Tech"),
      T("Dress rehearsal", "opening", -1, "Production", "Tech"),
      T("Sponsor and funder reports", "closing", 30, "Admin", "Wrap-up"),
    ],
  },
  {
    slug: "closing-checklist",
    title: "Closing checklist",
    description: "Everything after the last show.",
    tasks: [
      T("Strike", "closing", 0, "Production", "Wrap-up"),
      T("Return rentals and borrowed gear", "closing", 2, "Production", "Wrap-up"),
      T("Final payments", "closing", 7, "Admin", "Wrap-up"),
      T("Reimbursements", "closing", 7, "Admin", "Wrap-up"),
      T("Thank-you notes to donors and company", "closing", 10, "Fundraising", "Wrap-up"),
      T("Final reports to sponsor and funders", "closing", 30, "Admin", "Wrap-up"),
      T("Archive photos and video", "closing", 30, "Marketing", "Wrap-up"),
    ],
  },
];
