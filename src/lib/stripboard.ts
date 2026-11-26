// Stripboard: breakdown sheets, the board, day out of days, and imports
// from Final Draft (.fdx) and plain screenplay text (Fountain / Many Write).
import { parseCSV, toCSV } from "./files";
import type { Board, Conflict, ElementKind, ScheduleEvent, ShootDay, StripScene } from "./types";
import { ELEMENT_KINDS } from "./types";
import { uid } from "./util";

export const ELEMENT_LABEL: Record<ElementKind, string> = {
  extras: "Background / extras", props: "Props", wardrobe: "Wardrobe", set_dressing: "Set dressing", vehicles: "Vehicles",
  animals: "Animals", sfx: "Special effects", makeup: "Makeup / hair", sound: "Sound / music", equipment: "Special equipment",
};

const list = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
const STRIP_COLUMNS = ["id", "number", "ie", "location", "venue", "tod", "pages", "description", "characters", ...ELEMENT_KINDS, "notes"] as const;

export function emptyElements(): Record<ElementKind, string[]> {
  return Object.fromEntries(ELEMENT_KINDS.map((k) => [k, []])) as unknown as Record<ElementKind, string[]>;
}

export function stripsFromCSV(text: string): StripScene[] {
  return parseCSV(text).map((r) => ({
    id: r.id || uid("st"),
    number: r.number ?? "",
    ie: r.ie ?? "INT",
    location: r.location ?? "",
    venue: r.venue ?? "",
    tod: r.tod ?? "DAY",
    pages: Number(r.pages) || 0,
    description: r.description ?? "",
    characters: list(r.characters),
    elements: Object.fromEntries(ELEMENT_KINDS.map((k) => [k, list(r[k])])) as unknown as Record<ElementKind, string[]>,
    notes: r.notes ?? "",
  }));
}

export function stripsToCSV(strips: StripScene[]): string {
  return toCSV(STRIP_COLUMNS, strips.map((s) => ({ ...s, characters: s.characters.join(";"), ...Object.fromEntries(ELEMENT_KINDS.map((k) => [k, s.elements[k].join(";")])) })));
}

export function blankBoard(): Board {
  return { days: [], unscheduled: [], page_limit: 40, minutes_per_page: 90, event_ids: {} };
}

export function boardFromJSON(text: string | null): Board {
  if (!text) return blankBoard();
  try {
    return { ...blankBoard(), ...JSON.parse(text) };
  } catch {
    return blankBoard();
  }
}

/** Keep the board in step with the scenes: drop unknown ids, put new scenes in Unscheduled. */
export function normalizeBoard(b: Board, strips: StripScene[]): Board {
  const ids = new Set(strips.map((s) => s.id));
  const days = b.days.map((d) => ({ ...d, scenes: d.scenes.filter((x) => ids.has(x)) }));
  const placed = new Set(days.flatMap((d) => d.scenes));
  const un = b.unscheduled.filter((x) => ids.has(x) && !placed.has(x));
  for (const s of strips) if (!placed.has(s.id) && !un.includes(s.id)) un.push(s.id);
  return { ...b, days, unscheduled: un };
}

/** Move a strip to a day (or "" for Unscheduled), before another strip or at the end. */
export function moveStrip(b: Board, strip: string, toDay: string, before?: string): Board {
  const days = b.days.map((d) => ({ ...d, scenes: d.scenes.filter((x) => x !== strip) }));
  let un = b.unscheduled.filter((x) => x !== strip);
  const insert = (arr: string[]) => {
    const i = before ? arr.indexOf(before) : -1;
    return i >= 0 ? [...arr.slice(0, i), strip, ...arr.slice(i)] : [...arr, strip];
  };
  if (!toDay) un = insert(un);
  return { ...b, unscheduled: un, days: days.map((d) => (d.id === toDay ? { ...d, scenes: insert(d.scenes) } : d)) };
}

export function addDay(b: Board, date: string): Board {
  return { ...b, days: [...b.days, { id: uid("day"), date, call: "07:00", wrap: "19:00", scenes: [], notes: "" }] };
}

export type GroupBy = "number" | "location" | "tod" | "ie" | "cast";

/** Reorder the Unscheduled strips to group similar scenes together. */
export function sortUnscheduled(b: Board, strips: StripScene[], by: GroupBy, castName?: string): Board {
  const get = (id: string) => strips.find((s) => s.id === id)!;
  const key = (s: StripScene): string => {
    if (by === "location") return s.location.toLowerCase();
    if (by === "tod") return s.tod;
    if (by === "ie") return s.ie;
    if (by === "cast") return castName && s.characters.includes(castName) ? "0" : "1";
    return "";
  };
  const num = (s: StripScene) => s.number.replace(/\d+/g, (d) => d.padStart(5, "0"));
  return { ...b, unscheduled: [...b.unscheduled].sort((x, y) => key(get(x)).localeCompare(key(get(y))) || num(get(x)).localeCompare(num(get(y)))) };
}

/** Cast numbers: characters ordered by how many scenes they're in (lead = 1). */
export function castNumbers(strips: StripScene[]): Record<string, number> {
  const count = new Map<string, number>();
  for (const s of strips) for (const c of s.characters) count.set(c, (count.get(c) ?? 0) + 1);
  return Object.fromEntries([...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c], i) => [c, i + 1]));
}

export function dayPages(d: ShootDay, strips: StripScene[]): number {
  return d.scenes.reduce((s, id) => s + (strips.find((x) => x.id === id)?.pages ?? 0), 0);
}

export interface DayWarning {
  day: string;
  message: string;
}

export function boardWarnings(b: Board, strips: StripScene[], cast: Record<string, string>, conflicts: Conflict[], names: (slug: string) => string): DayWarning[] {
  const out: DayWarning[] = [];
  b.days.forEach((d, i) => {
    const pages = dayPages(d, strips);
    if (b.page_limit && pages > b.page_limit) out.push({ day: d.id, message: `Day ${i + 1} has ${eighthsLabel(pages)} pages (limit ${eighthsLabel(b.page_limit)})` });
    if (!d.date) return;
    const chars = new Set(d.scenes.flatMap((id) => strips.find((x) => x.id === id)?.characters ?? []));
    for (const ch of chars) {
      const person = personFor(ch, cast);
      if (!person) continue;
      const c = conflicts.find((x) => x.person === person && x.date === d.date);
      if (c) out.push({ day: d.id, message: `${names(person)} (${ch}) has a conflict on day ${i + 1}${c.note ? ` (${c.note})` : ""}` });
    }
  });
  return out;
}

export function personFor(character: string, cast: Record<string, string>): string | undefined {
  return cast[character] ?? Object.entries(cast).find(([k]) => k.toLowerCase() === character.toLowerCase())?.[1];
}

export function eighthsLabel(n: number): string {
  const whole = Math.floor(n / 8), rest = n % 8;
  return whole && rest ? `${whole} ${rest}/8` : whole ? String(whole) : rest ? `${rest}/8` : "0";
}

/** Estimated time for a day, from its page count. */
export function dayMinutes(d: ShootDay, strips: StripScene[], minutesPerPage: number): number {
  return Math.round((dayPages(d, strips) / 8) * minutesPerPage);
}

// ---- day out of days ----

export type DoodMark = "SW" | "W" | "H" | "WF" | "SWF" | "";

export interface DoodRow {
  character: string;
  number: number;
  marks: DoodMark[]; // one per shoot day
  work: number;
  hold: number;
  start: number; // day index, or -1
  finish: number;
}

export function dayOutOfDays(b: Board, strips: StripScene[]): DoodRow[] {
  const nums = castNumbers(strips);
  const chars = Object.keys(nums);
  return chars.map((ch) => {
    const works = b.days.map((d) => d.scenes.some((id) => strips.find((x) => x.id === id)?.characters.includes(ch)));
    const first = works.indexOf(true), last = works.lastIndexOf(true);
    const marks: DoodMark[] = works.map((w, i) => {
      if (first < 0 || i < first || i > last) return "";
      if (first === last && i === first) return "SWF";
      if (i === first) return "SW";
      if (i === last) return "WF";
      return w ? "W" : "H";
    });
    return { character: ch, number: nums[ch], marks, work: works.filter(Boolean).length, hold: marks.filter((m) => m === "H").length, start: first, finish: last };
  }).sort((a, b) => a.number - b.number);
}

export function doodCSV(b: Board, rows: DoodRow[]): string {
  const head = ["#", "character", ...b.days.map((d, i) => `day ${i + 1}${d.date ? ` (${d.date})` : ""}`), "work", "hold"];
  const lines = rows.map((r) => [r.number, r.character, ...r.marks, r.work, r.hold].map((v) => (typeof v === "string" && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

/** Each dated shoot day becomes (or updates) a Schedule event. */
export function shootDayEvents(b: Board, strips: StripScene[], project: string, cast: Record<string, string>): { events: ScheduleEvent[]; eventIds: Record<string, string> } {
  const eventIds = { ...b.event_ids };
  const events: ScheduleEvent[] = [];
  b.days.forEach((d, i) => {
    if (!d.date) return;
    const scenes = d.scenes.map((id) => strips.find((x) => x.id === id)).filter(Boolean) as StripScene[];
    const called = [...new Set(scenes.flatMap((s) => s.characters.map((c) => personFor(c, cast)).filter(Boolean) as string[]))];
    const id = eventIds[d.id] ?? `ev-${d.id}`;
    eventIds[d.id] = id;
    events.push({
      id, project, date: d.date, start: d.call, end: d.wrap, type: "Photo / video shoot", title: `Shoot day ${i + 1}`,
      location: scenes.find((s) => s.venue)?.venue ?? scenes[0]?.location ?? "", called, scenes: [],
      notes: `Scenes ${scenes.map((s) => s.number).join(", ")}${d.notes ? `\n${d.notes}` : ""}`,
    });
  });
  return { events, eventIds };
}

/** The one-line schedule: one line per scene, grouped by day. */
export function oneLineSchedule(title: string, b: Board, strips: StripScene[]): string {
  const nums = castNumbers(strips);
  const line = (s: StripScene) => `  ${s.number.padEnd(6)} ${`${s.ie}. ${s.location}`.padEnd(34).slice(0, 34)} ${s.tod.padEnd(6)} ${eighthsLabel(s.pages).padStart(6)} pgs  cast ${s.characters.map((c) => nums[c]).sort((a, b) => a - b).join(",")}`;
  const L = [title, ""];
  b.days.forEach((d, i) => {
    L.push(`DAY ${i + 1}${d.date ? ` · ${d.date}` : ""} · call ${d.call || "—"} · ${eighthsLabel(dayPages(d, strips))} pages`);
    for (const id of d.scenes) { const s = strips.find((x) => x.id === id); if (s) L.push(line(s)); }
    L.push("");
  });
  if (b.unscheduled.length) {
    L.push("NOT SCHEDULED");
    for (const id of b.unscheduled) { const s = strips.find((x) => x.id === id); if (s) L.push(line(s)); }
  }
  return L.join("\n");
}

// ---- imports ----

const HEADING = /^(INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST)[.\s]+(.+?)(?:\s+[-–—]\s+(.+))?$/i;

function headingToStrip(text: string, number: string): StripScene | null {
  const m = HEADING.exec(text.trim().replace(/^\./, ""));
  if (!m) return null;
  const raw = m[1].toUpperCase().replace(/\./g, "");
  const ie = raw === "EXT/INT" || raw === "I/E" ? "INT/EXT" : raw;
  return { id: uid("st"), number, ie, location: m[2].trim().replace(/\s+#?\d+[A-Z]?#?$/, ""), venue: "", tod: (m[3] ?? "DAY").trim().toUpperCase(), pages: 0, description: "", characters: [], elements: emptyElements(), notes: "" };
}

const cleanCharacter = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").replace(/\^$/, "").trim();

/** Page length in eighths from a line count (about 55 lines a page). */
const toEighths = (lines: number) => Math.max(1, Math.round((lines / 55) * 8));

/** Final Draft .fdx (XML). Works without a DOM, so it also runs in tests. */
export function parseFdx(xml: string): StripScene[] {
  const out: StripScene[] = [];
  const paras = [...xml.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)];
  let cur: StripScene | null = null;
  let lines = 0;
  const close = () => { if (cur) { cur.pages = toEighths(lines); out.push(cur); } };
  for (const p of paras) {
    const type = /Type="([^"]+)"/.exec(p[1])?.[1] ?? "";
    const numberAttr = /Number="([^"]+)"/.exec(p[1])?.[1];
    const text = [...p[2].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((t) => t[1]).join("").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim();
    if (type === "Scene Heading") {
      close();
      cur = headingToStrip(text, numberAttr ?? String(out.length + 1));
      lines = 1;
      if (!cur) cur = { id: uid("st"), number: numberAttr ?? String(out.length + 1), ie: "INT", location: text, venue: "", tod: "DAY", pages: 0, description: "", characters: [], elements: emptyElements(), notes: "" };
    } else if (cur) {
      lines += Math.max(1, Math.ceil(text.length / 60));
      if (type === "Character") { const c = cleanCharacter(text).toUpperCase(); if (c && !cur.characters.includes(c)) cur.characters.push(c); }
      if (type === "Action" && !cur.description) cur.description = text.slice(0, 120);
    }
  }
  close();
  return out;
}

/**
 * Plain screenplay text: Fountain, or a Many Write screenplay exported as
 * markdown. Scene headings start with INT./EXT.; a character cue is a line
 * in capitals followed by dialogue.
 */
export function parseScreenplayText(text: string): StripScene[] {
  const out: StripScene[] = [];
  const rows = text.replace(/\r/g, "").split("\n");
  let cur: StripScene | null = null;
  let lines = 0;
  const close = () => { if (cur) { cur.pages = toEighths(lines); out.push(cur); } };
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (!raw) { if (cur) lines++; continue; }
    const forced = raw.startsWith(".") && !raw.startsWith("..");
    if (HEADING.test(raw.replace(/^\./, "")) && (forced || /^(INT|EXT|EST|I\/E)/i.test(raw))) {
      close();
      const num = /#(\w+)#\s*$/.exec(raw)?.[1] ?? String(out.length + 1);
      cur = headingToStrip(raw.replace(/#\w+#\s*$/, ""), num);
      lines = 1;
      continue;
    }
    if (!cur) continue;
    lines++;
    const next = (rows[i + 1] ?? "").trim();
    const isCue = (/^[A-Z][A-Z0-9 .'\-]+(\s*\(.*\))?\^?$/.test(raw) || raw.startsWith("@")) && next && !/^(CUT TO|FADE|DISSOLVE)/.test(raw);
    if (isCue) {
      const c = cleanCharacter(raw.replace(/^@/, "")).toUpperCase();
      if (c.length > 1 && !cur.characters.includes(c)) cur.characters.push(c);
    } else if (!cur.description && !/^[(\[]/.test(raw)) cur.description = raw.slice(0, 120);
  }
  close();
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Printable stripboard: each strip as a colored row with its text (never color alone). */
export function stripboardHtml(title: string, b: Board, strips: StripScene[]): string {
  const nums = castNumbers(strips);
  const color = (s: StripScene) => (s.ie.startsWith("EXT") ? (s.tod === "NIGHT" ? "#cfe3f5" : "#fff3b0") : s.tod === "NIGHT" ? "#d9d2f2" : "#ffffff");
  const row = (s: StripScene) => `<tr style="background:${color(s)}"><td>${esc(s.number)}</td><td>${esc(s.ie)}</td><td>${esc(s.location)}</td><td>${esc(s.tod)}</td><td>${eighthsLabel(s.pages)}</td><td>${s.characters.map((c) => nums[c]).sort((a, b) => a - b).join(", ")}</td><td>${esc(s.description)}</td></tr>`;
  const head = "<tr><th>Sc</th><th>I/E</th><th>Location</th><th>D/N</th><th>Pages</th><th>Cast</th><th>Description</th></tr>";
  const parts = [`<h1>${esc(title)}</h1>`, `<p style="font-size:9pt">Cast: ${Object.entries(nums).map(([c, n]) => `${n}. ${esc(c)}`).join(" · ")}</p>`, `<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%;font:9pt Helvetica,Arial,sans-serif">${head}`];
  b.days.forEach((d, i) => {
    for (const id of d.scenes) { const s = strips.find((x) => x.id === id); if (s) parts.push(row(s)); }
    parts.push(`<tr style="background:#222;color:#fff"><td colspan="7">END OF DAY ${i + 1}${d.date ? ` · ${d.date}` : ""} · ${eighthsLabel(dayPages(d, strips))} pages</td></tr>`);
  });
  for (const id of b.unscheduled) { const s = strips.find((x) => x.id === id); if (s) parts.push(row(s)); }
  parts.push("</table>");
  return parts.join("\n");
}
