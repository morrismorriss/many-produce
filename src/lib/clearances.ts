// Clearances: every right and permission a project needs before it can be
// shown, recorded or sold.
import { parseCSV, toCSV } from "./files";
import { CLEARANCE_STATUSES, type Clearance, type ClearanceStatus, type Payment } from "./types";
import { addDays, uid } from "./util";

const list = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
export const CLEARANCE_COLUMNS = [
  "id", "item", "type", "scenes", "owner", "contact", "scope", "territory", "term", "fee", "status", "requested", "cleared",
  "document", "payment_id", "composer", "publisher", "timing", "usage", "notes",
] as const;

export function clearancesFromCSV(project: string, text: string): Clearance[] {
  return parseCSV(text).map((r) => ({
    id: r.id || uid("cl"),
    project,
    item: r.item ?? "",
    type: r.type || "Other",
    scenes: list(r.scenes),
    owner: r.owner ?? "",
    contact: r.contact ?? "",
    scope: list(r.scope),
    territory: r.territory ?? "",
    term: r.term ?? "",
    fee: r.fee === undefined || r.fee === "" ? null : Number(r.fee),
    status: ((CLEARANCE_STATUSES as readonly string[]).includes(r.status) ? r.status : "Needed") as ClearanceStatus,
    requested: r.requested ?? "",
    cleared: r.cleared ?? "",
    document: r.document ?? "",
    payment_id: r.payment_id ?? "",
    composer: r.composer ?? "",
    publisher: r.publisher ?? "",
    timing: r.timing ?? "",
    usage: r.usage ?? "",
    notes: r.notes ?? "",
  }));
}

export function clearancesToCSV(c: Clearance[]): string {
  return toCSV(CLEARANCE_COLUMNS, c.map((x) => ({ ...x, scenes: x.scenes.join(";"), scope: x.scope.join(";"), fee: x.fee ?? "" })));
}

export function blankClearance(project: string, patch: Partial<Clearance> = {}): Clearance {
  return {
    id: uid("cl"), project, item: "", type: "Music (sync)", scenes: [], owner: "", contact: "", scope: [], territory: "Worldwide", term: "",
    fee: null, status: "Needed", requested: "", cleared: "", document: "", payment_id: "", composer: "", publisher: "", timing: "", usage: "", notes: "", ...patch,
  };
}

/** Done means nothing more to do: cleared, replaced, or not needed. */
export const isSettled = (c: Clearance) => c.status === "Cleared" || c.status === "Replaced" || c.status === "Not needed";

export interface ClearanceWarning {
  id: string;
  kind: "deadline" | "scope" | "denied";
  message: string;
}

/**
 * Anything not cleared within `weeks` of the deadline (opening, a festival
 * deadline or picture lock), anything denied and not replaced, and cleared
 * items whose scope doesn't cover a planned use.
 */
export function clearanceWarnings(items: Clearance[], deadline: string, deadlineLabel: string, weeks: number, plannedUses: string[], today: string): ClearanceWarning[] {
  const out: ClearanceWarning[] = [];
  const soon = deadline && today >= addDays(deadline, -weeks * 7);
  for (const c of items) {
    if (c.status === "Denied") out.push({ id: c.id, kind: "denied", message: `${c.item} was denied: replace it or cut it` });
    else if (!isSettled(c) && soon) out.push({ id: c.id, kind: "deadline", message: `${c.item} isn't cleared and ${deadlineLabel} is ${deadline}` });
    if (c.status === "Cleared" && plannedUses.length && c.scope.length) {
      const missing = plannedUses.filter((u) => !c.scope.includes(u));
      if (missing.length) out.push({ id: c.id, kind: "scope", message: `${c.item} is cleared for ${c.scope.join(", ")} but not ${missing.join(", ")}` });
    }
  }
  return out;
}

/** Per scene: is everything in it settled? */
export function sceneClearance(items: Clearance[], scenes: string[]): { scene: string; total: number; open: number }[] {
  return scenes.map((s) => {
    const inScene = items.filter((c) => c.scenes.includes(s));
    return { scene: s, total: inScene.length, open: inScene.filter((c) => !isSettled(c)).length };
  });
}

export function cueSheetCSV(projectName: string, items: Clearance[]): string {
  const music = items.filter((c) => c.type.startsWith("Music") && c.status !== "Replaced" && c.status !== "Not needed");
  void projectName;
  return toCSV(
    ["cue", "title", "composer", "publisher", "rights_holder", "timing", "usage", "scenes", "status"],
    music.map((c, i) => ({ cue: i + 1, title: c.item, composer: c.composer, publisher: c.publisher, rights_holder: c.owner, timing: c.timing, usage: c.usage, scenes: c.scenes.join(" "), status: c.status })),
  );
}

export function clearanceFeePayment(c: Clearance, due: string): Payment {
  return {
    id: uid("p"), title: `Clearance: ${c.item}`, payee: c.owner || c.item, method: "Checking", budget_line: "", category: "Other", due,
    amount: c.fee ?? 0, status: "scheduled", paid_date: "", ledger_id: "", project_alloc: { [c.project]: 1 }, notes: `${c.type}${c.scope.length ? ` · ${c.scope.join(", ")}` : ""}`,
  };
}

/** Clearance type suggested for a breakdown element. */
export function clearanceTypeFor(kind: string): string {
  if (kind === "sound") return "Music (sync)";
  if (kind === "set_dressing") return "Artwork and posters";
  if (kind === "location") return "Location";
  if (kind === "cast" || kind === "extras") return "Talent / appearance";
  return "Other";
}
