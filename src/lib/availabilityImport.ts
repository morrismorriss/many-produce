// Import everyone's availability from a CSV and turn it into conflicts.
//
// Two shapes are understood:
//   Grid:  Name, 12/8, 12/9, 12/10 …   (one row per person, one column per date)
//          cells like "x", "yes", "no", "after 6pm", "2-5pm", "unavailable"
//   Rows:  name, date, start, end, note   (one row per conflict)
//
// The user says whether a marked cell means "available" or "unavailable".
import Papa from "papaparse";
import type { Conflict, Person } from "./types";
import { addDays, toISO, uid } from "./util";

export type CellMeaning = "unavailable" | "available";

export interface ImportedConflict extends Omit<Conflict, "id" | "person"> {
  name: string; // as written in the sheet
}

export interface AvailabilityParse {
  shape: "grid" | "rows";
  conflicts: ImportedConflict[];
  names: string[];
  dates: string[];
  warnings: string[];
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Parse a date header or cell. Years are optional; a missing year means the next time that date comes around. */
export function parseLooseDate(raw: string, today: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*[,.\s]*/, "");
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let mt;
  if ((mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(s))) {
    [m, d] = [Number(mt[1]), Number(mt[2])];
    if (mt[3]) y = mt[3].length === 2 ? 2000 + Number(mt[3]) : Number(mt[3]);
  } else if ((mt = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s)) && MONTHS[mt[1].slice(0, 4)] !== undefined || (mt && MONTHS[mt[1].slice(0, 3)])) {
    m = MONTHS[mt![1].slice(0, 4)] ?? MONTHS[mt![1].slice(0, 3)];
    d = Number(mt![2]);
    if (mt![3]) y = Number(mt![3]);
  } else if ((mt = /^(\d{1,2})\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?$/.exec(s)) && (MONTHS[mt[2].slice(0, 4)] ?? MONTHS[mt[2].slice(0, 3)])) {
    d = Number(mt[1]);
    m = MONTHS[mt[2].slice(0, 4)] ?? MONTHS[mt[2].slice(0, 3)];
    if (mt[3]) y = Number(mt[3]);
  } else return null;
  if (!m || !d || m > 12 || d > 31) return null;
  if (y === undefined) {
    const ty = Number(today.slice(0, 4));
    const cand = toISO(new Date(ty, m - 1, d));
    // A date more than two months in the past is probably next year's.
    y = cand < addDays(today, -60) ? ty + 1 : ty;
  }
  const out = toISO(new Date(y, m - 1, d));
  return Number(out.slice(5, 7)) === m ? out : null;
}

/** "6pm", "6:30 pm", "18:00", "6" → "HH:MM". Bare hours 1–7 are read as afternoon/evening. */
export function parseLooseTime(raw: string, assumePm = true): string | null {
  const mt = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(raw.trim().toLowerCase());
  if (!mt) return null;
  let h = Number(mt[1]);
  const min = Number(mt[2] ?? 0);
  const ap = mt[3]?.[0];
  if (ap === "p" && h < 12) h += 12;
  else if (ap === "a" && h === 12) h = 0;
  else if (!ap && assumePm && h >= 1 && h <= 7) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// Words that mean the same thing whichever way the sheet was set up…
const BUSY = /^(busy|conflict|unavailable|not available|cant|can't|cannot|out|away)$/i;
const FREE = /^(free|avail|available|can|open)$/i;
// …and marks whose meaning depends on the sheet ("x" = marked).
const MARK = /^(x|✓|✔|y|yes|ok|1|true)$/i;
const UNMARK = /^(n|no|0|false|-)$/i;

/**
 * What one grid cell means, as a conflict range (or null = no conflict).
 * Times in a cell narrow the conflict: "after 6pm" = busy until 6pm.
 */
export function cellToConflict(cellRaw: string, meaning: CellMeaning): { start: string; end: string; note: string } | null | "unknown" {
  const cell = cellRaw.trim();
  const lower = cell.toLowerCase();
  const note = cell;
  if (!cell) return meaning === "available" ? { start: "", end: "", note: "Not marked available" } : null;

  // Time phrases mean partial availability or partial conflict.
  let mt;
  if ((mt = /^(?:free |available |avail )?(?:after|from)\s+(.+)$/.exec(lower))) {
    const t = parseLooseTime(mt[1]);
    if (t) return meaning === "available" || /free|avail/.test(lower) ? { start: "00:00", end: t, note } : { start: t, end: "23:59", note };
  }
  if ((mt = /^(?:free |available |avail )?(?:before|until|till|til)\s+(.+)$/.exec(lower))) {
    const t = parseLooseTime(mt[1]);
    if (t) return meaning === "available" || /free|avail/.test(lower) ? { start: t, end: "23:59", note } : { start: "00:00", end: t, note };
  }
  if ((mt = /^(?:busy |out |free |available )?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)$/.exec(lower))) {
    const endAp = /(am|pm|a|p)$/.exec(mt[2].trim())?.[1];
    const startRaw = /(am|pm|a|p)$/.test(mt[1].trim()) || !endAp ? mt[1] : `${mt[1]}${endAp}`;
    const a = parseLooseTime(startRaw), b = parseLooseTime(mt[2]);
    if (a && b) {
      const isFreeRange = meaning === "available" || /^(free|available)/.test(lower);
      // A free window becomes two conflicts; keep it simple and record the busy part before it.
      return isFreeRange ? { start: "00:00", end: a, note: `Free ${a}–${b} only` } : { start: a, end: b, note };
    }
  }
  if (BUSY.test(lower)) return { start: "", end: "", note: "" };
  if (FREE.test(lower)) return null;
  if (MARK.test(lower)) return meaning === "available" ? null : { start: "", end: "", note: "" };
  if (UNMARK.test(lower)) return meaning === "available" ? { start: "", end: "", note: "" } : null;
  return "unknown";
}

function rowsOf(text: string): string[][] {
  return Papa.parse<string[]>(text.trim(), { skipEmptyLines: true }).data;
}

export function parseAvailabilityCSV(text: string, meaning: CellMeaning, today: string): AvailabilityParse {
  const rows = rowsOf(text);
  const warnings: string[] = [];
  if (!rows.length) return { shape: "grid", conflicts: [], names: [], dates: [], warnings: ["The file is empty."] };
  const head = rows[0].map((h) => h.trim());
  const lowerHead = head.map((h) => h.toLowerCase());
  const nameCol = lowerHead.findIndex((h) => /^(name|full name|person|who|cast member|your name)$/.test(h));
  const dateCol = lowerHead.findIndex((h) => h === "date" || h === "day");

  // Rows shape: has a "date" column.
  if (dateCol >= 0) {
    const nc = nameCol >= 0 ? nameCol : 0;
    const col = (re: RegExp) => lowerHead.findIndex((h) => re.test(h));
    const sc = col(/^(start|from|start time)$/), ec = col(/^(end|to|until|end time)$/), noteCol = col(/^(note|notes|why|reason)$/);
    const conflicts: ImportedConflict[] = [];
    rows.slice(1).forEach((r, i) => {
      const name = (r[nc] ?? "").trim();
      const date = parseLooseDate(r[dateCol] ?? "", today);
      if (!name) return;
      if (!date) { warnings.push(`Row ${i + 2}: couldn't read the date "${r[dateCol] ?? ""}".`); return; }
      const start = sc >= 0 ? parseLooseTime(r[sc] ?? "", false) ?? "" : "";
      const end = ec >= 0 ? parseLooseTime(r[ec] ?? "", false) ?? "" : "";
      conflicts.push({ name, date, start, end, note: noteCol >= 0 ? (r[noteCol] ?? "").trim() : "" });
    });
    return { shape: "rows", conflicts, names: [...new Set(conflicts.map((c) => c.name))], dates: [...new Set(conflicts.map((c) => c.date))].sort(), warnings };
  }

  // Grid shape: one column per date.
  const nc = nameCol >= 0 ? nameCol : 0;
  const dateCols: { i: number; date: string }[] = [];
  head.forEach((h, i) => {
    if (i === nc) return;
    const d = parseLooseDate(h, today);
    if (d) dateCols.push({ i, date: d });
  });
  if (!dateCols.length) {
    return { shape: "grid", conflicts: [], names: [], dates: [], warnings: ["Couldn't find any dates in the header row. Put one date per column (like 12/8 or Dec 8), or use columns name, date, start, end."] };
  }
  const conflicts: ImportedConflict[] = [];
  const names: string[] = [];
  const unknownCells = new Set<string>();
  for (const r of rows.slice(1)) {
    const name = (r[nc] ?? "").trim();
    if (!name) continue;
    names.push(name);
    for (const { i, date } of dateCols) {
      const res = cellToConflict(r[i] ?? "", meaning);
      if (res === "unknown") {
        unknownCells.add((r[i] ?? "").trim());
        conflicts.push({ name, date, start: "", end: "", note: (r[i] ?? "").trim() });
      } else if (res) conflicts.push({ name, date, ...res });
    }
  }
  if (unknownCells.size) {
    warnings.push(`Treated these cells as all-day conflicts, with the text kept as a note: ${[...unknownCells].slice(0, 6).map((c) => `"${c}"`).join(", ")}${unknownCells.size > 6 ? "…" : ""}`);
  }
  return { shape: "grid", conflicts, names, dates: dateCols.map((d) => d.date), warnings };
}

/** Match sheet names to collaborators: exact, then first name if it's unique. */
export function matchNames(names: string[], people: Person[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const n of names) {
    const k = n.trim().toLowerCase();
    let p = people.find((x) => x.name.trim().toLowerCase() === k);
    if (!p) {
      const first = people.filter((x) => x.name.trim().toLowerCase().split(/\s+/)[0] === k.split(/\s+/)[0]);
      if (first.length === 1) p = first[0];
    }
    if (!p) p = people.find((x) => x.email && x.email.toLowerCase() === k);
    out[n] = p?.slug ?? null;
  }
  return out;
}

/**
 * Merge imported conflicts into the existing list. For each matched person,
 * their old conflicts on the imported dates are replaced (so re-importing an
 * updated sheet doesn't duplicate anything).
 */
export function mergeConflicts(existing: Conflict[], parsed: AvailabilityParse, match: Record<string, string | null>): { next: Conflict[]; added: Conflict[]; replaced: Conflict[] } {
  const dates = new Set(parsed.dates.length ? parsed.dates : parsed.conflicts.map((c) => c.date));
  const people = new Set(Object.values(match).filter(Boolean) as string[]);
  const replaced = existing.filter((c) => people.has(c.person) && dates.has(c.date));
  const added: Conflict[] = parsed.conflicts
    .filter((c) => match[c.name])
    .map((c) => ({ id: uid("c"), person: match[c.name]!, date: c.date, start: c.start, end: c.end, note: c.note }));
  return { next: [...existing.filter((c) => !replaced.includes(c)), ...added], added, replaced };
}
