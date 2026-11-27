import type { Alloc } from "./types";

export function uid(prefix = ""): string {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-5);
  return `${prefix}${t}${r}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const s = slugify(base);
  if (!set.has(s)) return s;
  for (let i = 2; ; i++) if (!set.has(`${s}-${i}`)) return `${s}-${i}`;
}

// ---- dates (all YYYY-MM-DD strings, local time) ----

export function todayISO(now = new Date()): string {
  return toISO(now);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Monday of the week containing iso. */
export function weekStart(iso: string): string {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(iso: string, withYear = false): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ""}`;
}

// ---- money ----

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A currency code Intl accepts; anything else (a typo in settings.json) falls back to USD. */
export function safeCurrency(currency: string | undefined): string {
  const c = String(currency ?? "").trim().toUpperCase();
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: c });
    return c;
  } catch {
    return "USD";
  }
}

export function fmtMoney(n: number, currency = "USD", opts: { sign?: boolean; cents?: boolean } = {}): string {
  if (!Number.isFinite(n)) n = 0;
  const cents = opts.cents ?? Math.abs(n % 1) > 0.001;
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency(currency),
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Math.abs(n));
  if (n < 0) return `−${s}`;
  return opts.sign ? `+${s}` : s;
}

export function parseMoney(s: string): number {
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---- project allocation ("prodigy:0.6;made-men-reading:0.4") ----

export function parseAlloc(s: string): Alloc {
  const out: Alloc = {};
  for (const part of (s || "").split(";")) {
    const t = part.trim();
    if (!t) continue;
    const [slug, share] = t.split(":");
    out[slug.trim()] = share === undefined || share === "" ? 1 : Number(share);
  }
  return out;
}

export function formatAlloc(a: Alloc): string {
  const keys = Object.keys(a);
  if (keys.length === 1 && a[keys[0]] === 1) return keys[0];
  return keys.map((k) => `${k}:${+a[k].toFixed(4)}`).join(";");
}

/** Share of an allocation that belongs to project (""/undefined = all projects → 1). */
export function shareOf(a: Alloc, project: string | undefined): number {
  if (!project) return 1;
  return a[project] ?? 0;
}

export function allocTouches(a: Alloc, project: string | undefined): boolean {
  return !project || (a[project] ?? 0) > 0;
}

export function primaryProject(a: Alloc): string {
  let best = "";
  let bestShare = -1;
  for (const [k, v] of Object.entries(a)) if (v > bestShare) [best, bestShare] = [k, v];
  return best;
}

export function single(slug: string): Alloc {
  return { [slug]: 1 };
}

export function allocValid(a: Alloc): boolean {
  const vals = Object.values(a);
  if (!vals.length || vals.some((v) => !(v > 0))) return false;
  return Math.abs(vals.reduce((x, y) => x + y, 0) - 1) < 0.001;
}
