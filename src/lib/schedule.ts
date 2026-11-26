// Schedule builder: events, conflicts, availability, warnings and outputs.
import { parseCSV, toCSV } from "./files";
import type { Conflict, Person, Project, Scene, ScheduleEvent, Venue } from "./types";
import { addDays, fmtDate, parseISO, round2, uid, weekStart } from "./util";

const list = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);

export const EVENT_COLUMNS = ["id", "date", "start", "end", "type", "title", "location", "called", "scenes", "notes"] as const;
export const CONFLICT_COLUMNS = ["id", "person", "date", "start", "end", "note"] as const;
export const SCENE_COLUMNS = ["id", "number", "title", "characters"] as const;

export function eventsFromCSV(project: string, text: string): ScheduleEvent[] {
  return parseCSV(text).map((r) => ({
    id: r.id || uid("ev"),
    project,
    date: r.date ?? "",
    start: r.start ?? "",
    end: r.end ?? "",
    type: r.type || "Rehearsal",
    title: r.title ?? "",
    location: r.location ?? "",
    called: list(r.called),
    scenes: list(r.scenes),
    notes: r.notes ?? "",
  }));
}

export function eventsToCSV(events: ScheduleEvent[]): string {
  const rows = [...events]
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map((e) => ({ ...e, called: e.called.join(";"), scenes: e.scenes.join(";") }));
  return toCSV(EVENT_COLUMNS, rows);
}

export const conflictsFromCSV = (text: string): Conflict[] =>
  parseCSV(text).map((r) => ({ id: r.id || uid("c"), person: r.person ?? "", date: r.date ?? "", start: r.start ?? "", end: r.end ?? "", note: r.note ?? "" }));

export const conflictsToCSV = (c: Conflict[]) =>
  toCSV(CONFLICT_COLUMNS, [...c].sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person)) as unknown as Record<string, unknown>[]);

export const scenesFromCSV = (text: string): Scene[] =>
  parseCSV(text).map((r) => ({ id: r.id || uid("s"), number: r.number ?? "", title: r.title ?? "", characters: list(r.characters) }));

export const scenesToCSV = (s: Scene[]) => toCSV(SCENE_COLUMNS, s.map((x) => ({ ...x, characters: x.characters.join(";") })));

/**
 * Paste a scene list, one scene per line:
 *   "1.1 The kitchen: Ana, Ben, Cleo"  or  "1.1, Ana, Ben"  or  "1.1 - Ana, Ben".
 */
export function parseScenesPaste(text: string): Scene[] {
  const out: Scene[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\S+)\s*(?:[-–:,]\s*)?(.*)$/.exec(line);
    if (!m) continue;
    let [, number, rest] = m;
    number = number.replace(/[,:]$/, "");
    let title = "";
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      title = rest.slice(0, colon).trim();
      rest = rest.slice(colon + 1);
    }
    out.push({ id: uid("s"), number, title, characters: rest.split(/[,;]/).map((x) => x.trim()).filter(Boolean) });
  }
  return out;
}

// ---- time math ----

export function minutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function eventHours(e: Pick<ScheduleEvent, "start" | "end">): number {
  const a = minutes(e.start), b = minutes(e.end);
  if (a === null || b === null) return 0;
  return round2(((b - a + 1440) % 1440) / 60);
}

/** Do two same-day time ranges overlap? A blank range means all day. */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a1 = minutes(aStart), a2 = minutes(aEnd), b1 = minutes(bStart), b2 = minutes(bEnd);
  if (a1 === null || b1 === null) return true;
  return a1 < (b2 ?? 1440) && b1 < (a2 ?? 1440);
}

export function conflictsForEvent(e: ScheduleEvent, conflicts: Conflict[], people?: string[]): Conflict[] {
  const who = people ?? e.called;
  return conflicts.filter((c) => c.date === e.date && who.includes(c.person) && timesOverlap(e.start, e.end, c.start, c.end));
}

export function isFree(person: string, date: string, start: string, end: string, conflicts: Conflict[]): boolean {
  return !conflicts.some((c) => c.person === person && c.date === date && timesOverlap(start, end, c.start, c.end));
}

/** People called for a set of scenes, through the project's cast list. */
export function calledForScenes(sceneIds: string[], scenes: Scene[], cast: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const s of scenes) {
    if (!sceneIds.includes(s.id)) continue;
    for (const ch of s.characters) {
      const who = cast[ch] ?? Object.entries(cast).find(([k]) => k.toLowerCase() === ch.toLowerCase())?.[1];
      if (who) out.add(who);
    }
  }
  return [...out];
}

// ---- warnings ----

export interface ScheduleWarning {
  event: string;
  kind: "conflict" | "double-booked" | "hours";
  message: string;
}

export function scheduleWarnings(
  events: ScheduleEvent[],
  conflicts: Conflict[],
  people: Person[],
  venues: Venue[],
  maxHoursWeek: number,
): ScheduleWarning[] {
  const out: ScheduleWarning[] = [];
  const name = (slug: string) => people.find((p) => p.slug === slug)?.name ?? slug;
  const place = (loc: string) => venues.find((v) => v.slug === loc)?.name ?? loc;
  for (const e of events) {
    const hits = conflictsForEvent(e, conflicts);
    for (const c of hits) out.push({ event: e.id, kind: "conflict", message: `${name(c.person)} has a conflict${c.start ? ` ${c.start}–${c.end || "end of day"}` : " all day"}${c.note ? ` (${c.note})` : ""}` });
  }
  // Same space, same date, overlapping times (across all projects).
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      if (!a.location || a.location !== b.location || a.date !== b.date) continue;
      if (!timesOverlap(a.start, a.end, b.start, b.end)) continue;
      out.push({ event: a.id, kind: "double-booked", message: `${place(a.location)} is also booked for "${b.title || b.type}"` });
      out.push({ event: b.id, kind: "double-booked", message: `${place(b.location)} is also booked for "${a.title || a.type}"` });
    }
  }
  if (maxHoursWeek > 0) {
    const byWeek = new Map<string, number>();
    for (const e of events) for (const p of e.called) {
      const k = `${p}|${weekStart(e.date)}`;
      byWeek.set(k, (byWeek.get(k) ?? 0) + eventHours(e));
    }
    for (const e of events) for (const p of e.called) {
      const h = byWeek.get(`${p}|${weekStart(e.date)}`) ?? 0;
      if (h > maxHoursWeek) out.push({ event: e.id, kind: "hours", message: `${name(p)} is called ${h} hours the week of ${fmtDate(weekStart(e.date))} (limit ${maxHoursWeek})` });
    }
  }
  return out;
}

// ---- availability ----

export function dateRange(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

export interface DateScore {
  date: string;
  free: string[];
  busy: string[];
}

/** For each date, who in the group is free for the given times. Best dates first. */
export function bestDates(group: string[], dates: string[], start: string, end: string, conflicts: Conflict[]): DateScore[] {
  return dates
    .map((date) => {
      const free = group.filter((p) => isFree(p, date, start, end, conflicts));
      return { date, free, busy: group.filter((p) => !free.includes(p)) };
    })
    .sort((a, b) => b.free.length - a.free.length || a.date.localeCompare(b.date));
}

export function hoursTally(events: ScheduleEvent[], from: string, to: string): Record<string, { hours: number; calls: number }> {
  const out: Record<string, { hours: number; calls: number }> = {};
  for (const e of events) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const p of e.called) {
      out[p] ??= { hours: 0, calls: 0 };
      out[p].hours = round2(out[p].hours + eventHours(e));
      out[p].calls++;
    }
  }
  return out;
}

// ---- outputs ----

const timeRange = (e: ScheduleEvent) => (e.start ? `${e.start}${e.end ? `–${e.end}` : ""}` : "Time TBD");

export function callSheetText(date: string, events: ScheduleEvent[], people: Person[], venues: Venue[], projects: Project[], scenes: Scene[]): string {
  const day = events.filter((e) => e.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const lines = [`Call sheet · ${parseISO(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`, ""];
  if (!day.length) lines.push("Nothing scheduled.");
  for (const e of day) {
    const proj = projects.find((p) => p.slug === e.project)?.name ?? e.project;
    lines.push(`${timeRange(e)}  ${e.type}${e.title ? `: ${e.title}` : ""} (${proj})`);
    if (e.location) lines.push(`  Where: ${venues.find((v) => v.slug === e.location)?.name ?? e.location}`);
    const sc = scenes.filter((s) => e.scenes.includes(s.id)).map((s) => `${s.number}${s.title ? ` ${s.title}` : ""}`);
    if (sc.length) lines.push(`  Scenes: ${sc.join(", ")}`);
    if (e.called.length) lines.push(`  Called: ${e.called.map((c) => people.find((p) => p.slug === c)?.name ?? c).join(", ")}`);
    if (e.notes) lines.push(`  Notes: ${e.notes}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function weeklyText(from: string, events: ScheduleEvent[], people: Person[], venues: Venue[], projects: Project[], scenes: Scene[]): string {
  const out = [`Schedule · week of ${fmtDate(from, true)}`, ""];
  for (const d of dateRange(from, 7)) {
    const day = events.filter((e) => e.date === d);
    if (!day.length) continue;
    out.push(callSheetText(d, events, people, venues, projects, scenes).replace(/^Call sheet · /, "").trimEnd(), "");
  }
  if (out.length === 2) out.push("Nothing scheduled this week.");
  return out.join("\n").trimEnd() + "\n";
}

/** A printable conflicts form to send to the company: a calendar grid per week. */
export function conflictsFormText(projectName: string, from: string, to: string): string {
  const lines = [
    `${projectName}: conflicts form`,
    "",
    "Name: ______________________________",
    "",
    "Mark every date and time you are NOT available, and add a note if it helps (e.g. \"after 6pm only\").",
    "",
  ];
  let w = weekStart(from);
  while (w <= to) {
    const days = dateRange(w, 7);
    lines.push(days.map((d) => parseISO(d).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }).padEnd(14)).join(""));
    lines.push(days.map(() => "[ ] ________  ").join(""));
    lines.push("");
    w = addDays(w, 7);
  }
  return lines.join("\n");
}

function icsEsc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** An .ics file with only one person's calls (or every event, when person is ""). */
export function eventsToICS(events: ScheduleEvent[], person: string, projects: Project[], venues: Venue[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Many Produce//Schedule//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    if (person && !e.called.includes(person)) continue;
    const d = e.date.replace(/-/g, "");
    const proj = projects.find((p) => p.slug === e.project)?.name ?? "";
    L.push("BEGIN:VEVENT", `UID:${e.id}@manyproduce`, `DTSTAMP:${stamp}`);
    if (e.start) {
      L.push(`DTSTART:${d}T${e.start.replace(":", "")}00`);
      if (e.end) L.push(`DTEND:${minutes(e.end)! < minutes(e.start)! ? addDays(e.date, 1).replace(/-/g, "") : d}T${e.end.replace(":", "")}00`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, "")}`);
    }
    L.push(`SUMMARY:${icsEsc(`${proj ? `${proj}: ` : ""}${e.type}${e.title ? ` – ${e.title}` : ""}`)}`);
    if (e.location) L.push(`LOCATION:${icsEsc(venues.find((v) => v.slug === e.location)?.name ?? e.location)}`);
    if (e.notes) L.push(`DESCRIPTION:${icsEsc(e.notes)}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}
