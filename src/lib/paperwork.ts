// Paperwork: contracts, releases, insurance and tax documents, plus the rules
// for what's missing. The app records only whether a W-9 is on file — it
// never reads or stores taxpayer ID numbers.
import { parseCSV, parseFrontmatter, stringifyFrontmatter, toCSV } from "./files";
import {
  DOC_STATUSES,
  OVERHEAD_SLUG,
  type DocStatus,
  type Issued1099,
  type LedgerEntry,
  type PaperDoc,
  type Payment,
  type Person,
  type Project,
  type Template,
  type Venue,
  type VaultData,
} from "./types";
import { addDays, round2, slugify, uid } from "./util";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? String(v).split(/,\s*/) : []);

const DOC_KEYS = ["title", "type", "project", "people", "venues", "status", "sent", "signed", "effective", "expires", "amount", "schedule", "files", "template"];

export function docFromMd(path: string, text: string): PaperDoc {
  const { data: d, body } = parseFrontmatter<Record<string, unknown>>(text);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!DOC_KEYS.includes(k)) extra[k] = v;
  const status = str(d.status) as DocStatus;
  return {
    path,
    title: str(d.title) || path.split("/").pop() || "Untitled",
    type: str(d.type) || "Other",
    project: str(d.project),
    people: arr(d.people),
    venues: arr(d.venues),
    status: DOC_STATUSES.includes(status) ? status : "Needed",
    sent: str(d.sent),
    signed: str(d.signed),
    effective: str(d.effective),
    expires: str(d.expires),
    amount: d.amount === undefined || d.amount === null || d.amount === "" ? null : Number(d.amount),
    schedule: (Array.isArray(d.schedule) ? d.schedule : []).map((x: Record<string, unknown>) => ({
      amount: Number(x.amount) || 0,
      due: str(x.due),
      payment_id: str(x.payment_id),
    })),
    files: (Array.isArray(d.files) ? d.files : []).map((x: Record<string, unknown>) => ({
      label: str(x.label),
      file: str(x.file),
      added: str(x.added),
    })),
    template: str(d.template),
    notes: body.trim(),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export function docToMd(doc: PaperDoc): string {
  const { path, notes, extra, ...data } = doc;
  void path;
  return stringifyFrontmatter({ ...extra, ...data }, notes);
}

/** Tax types live under paperwork/tax/<year>/; everything else under paperwork/contracts/. */
export const TAX_TYPES = ["W-9", "1099 issued", "Tax document received"];

export function newDocPath(doc: Pick<PaperDoc, "title" | "type" | "project">, taken: string[], year: string): string {
  const base = TAX_TYPES.includes(doc.type)
    ? `paperwork/tax/${year}/${slugify(doc.title)}`
    : `paperwork/contracts/${slugify([doc.project, doc.title].filter(Boolean).join(" "))}`;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export function blankDoc(patch: Partial<PaperDoc> = {}): PaperDoc {
  return {
    path: "", title: "", type: "Artist agreement", project: "", people: [], venues: [], status: "Needed",
    sent: "", signed: "", effective: "", expires: "", amount: null, schedule: [], files: [], template: "", notes: "",
    ...patch,
  };
}

export const isDone = (d: PaperDoc) => d.status === "Fully signed";
export const isLive = (d: PaperDoc) => d.status !== "Void" && d.status !== "Expired";

// ---- missing paperwork rules ----

export type MissingKind = "agreement" | "w9" | "venue-agreement" | "coi" | "sponsorship" | "expiring" | "expired";

export interface Missing {
  kind: MissingKind;
  message: string;
  project: string;
  person?: string;
  venue?: string;
  doc?: string; // doc path
  /** What "Add document" should be prefilled with. */
  preset?: Partial<PaperDoc>;
}

const AGREEMENT_TYPES = ["Artist agreement", "Crew agreement"];

export function paidPeople(people: Person[], ledger: LedgerEntry[], project?: string): Person[] {
  return people.filter((p) =>
    ledger.some((e) => e.kind === "expense" && e.counterparty.trim().toLowerCase() === p.name.trim().toLowerCase() && (!project || (e.project_alloc[project] ?? 0) > 0)),
  );
}

export function missingPaperwork(data: Pick<VaultData, "projects" | "people" | "venues" | "docs" | "ledger" | "sponsors">, project: string, today: string): Missing[] {
  const out: Missing[] = [];
  const projects = data.projects.filter((p) => p.slug !== OVERHEAD_SLUG && p.status !== "closed" && (!project || p.slug === project));
  const name = (slug: string) => data.projects.find((p) => p.slug === slug)?.name ?? slug;
  const docsFor = (pred: (d: PaperDoc) => boolean) => data.docs.filter((d) => isLive(d) && pred(d));

  // Confirmed collaborator with no fully signed agreement for that project.
  for (const p of data.people) {
    if (p.status !== "Confirmed") continue;
    for (const proj of projects) {
      if (!p.projects.includes(proj.slug)) continue;
      const signed = docsFor((d) => AGREEMENT_TYPES.includes(d.type) && d.people.includes(p.slug) && (d.project === proj.slug || !d.project) && isDone(d));
      if (!signed.length) {
        const draft = docsFor((d) => AGREEMENT_TYPES.includes(d.type) && d.people.includes(p.slug) && d.project === proj.slug)[0];
        out.push({
          kind: "agreement",
          message: `${p.name} is confirmed on ${proj.name} with no fully signed agreement${draft ? ` (it's ${draft.status.toLowerCase()})` : ""}`,
          project: proj.slug,
          person: p.slug,
          doc: draft?.path,
          preset: { type: "Artist agreement", project: proj.slug, people: [p.slug], title: `${p.name} ${p.roles[0] ?? ""} agreement`.replace(/\s+/g, " ") },
        });
      }
    }
  }

  // Anyone paid with no W-9.
  for (const p of paidPeople(data.people, data.ledger, project)) {
    if (!p.w9_on_file) {
      out.push({ kind: "w9", message: `${p.name} has been paid but has no W-9 on file`, project, person: p.slug });
    }
  }

  // Booked venue without a signed rental agreement or a certificate of insurance.
  for (const v of data.venues) {
    if (v.status !== "Booked") continue;
    const vp = v.projects.filter((s) => !project || s === project);
    if (project && !vp.length) continue;
    const proj = vp[0] ?? "";
    if (!docsFor((d) => d.type === "Venue rental agreement" && d.venues.includes(v.slug) && isDone(d)).length) {
      out.push({ kind: "venue-agreement", message: `${v.name} is booked with no signed rental agreement`, project: proj, venue: v.slug, preset: { type: "Venue rental agreement", project: proj, venues: [v.slug], title: `${v.name} rental agreement` } });
    }
    if (!docsFor((d) => d.type === "Certificate of insurance (COI)" && d.venues.includes(v.slug) && isDone(d)).length) {
      out.push({ kind: "coi", message: `${v.name} is booked with no certificate of insurance on file`, project: proj, venue: v.slug, preset: { type: "Certificate of insurance (COI)", project: proj, venues: [v.slug], title: `COI for ${v.name}` } });
    }
  }

  // Project with a fiscal sponsor but no sponsorship agreement.
  for (const proj of projects) {
    if (!proj.fiscal_sponsor) continue;
    const ok = docsFor((d) => d.type === "Fiscal sponsorship agreement" && (d.project === proj.slug || !d.project) && isDone(d));
    if (!ok.length) {
      const sponsor = data.sponsors.find((s) => s.slug === proj.fiscal_sponsor)?.name ?? proj.fiscal_sponsor;
      out.push({ kind: "sponsorship", message: `${proj.name} has ${sponsor} as fiscal sponsor but no signed sponsorship agreement`, project: proj.slug, preset: { type: "Fiscal sponsorship agreement", project: proj.slug, title: `${sponsor} fiscal sponsorship (${name(proj.slug)})` } });
    }
  }

  // Expiring within 30 days, or already past its date.
  for (const d of data.docs) {
    if (!isLive(d) || !d.expires || (project && d.project && d.project !== project)) continue;
    if (d.expires < today) out.push({ kind: "expired", message: `${d.title} expired on ${d.expires}`, project: d.project, doc: d.path });
    else if (d.expires <= addDays(today, 30)) out.push({ kind: "expiring", message: `${d.title} expires on ${d.expires}`, project: d.project, doc: d.path });
  }
  return out;
}

// ---- 1099 tracker ----

export interface Payee1099 {
  payee: string;
  total: number;
  person?: Person;
  venue?: Venue;
  w9: boolean | null; // null = not tracked (not a collaborator)
  needed: boolean;
  issued?: Issued1099;
}

/** Totals paid per payee in a calendar year, from the ledger. Sponsor fees aren't payments to a person. */
export function totals1099(ledger: LedgerEntry[], people: Person[], venues: Venue[], year: string, threshold: number, issued: Issued1099[] = []): Payee1099[] {
  const by = new Map<string, number>();
  const label = new Map<string, string>();
  for (const e of ledger) {
    if (e.kind !== "expense" || !e.date.startsWith(year) || !e.counterparty.trim() || e.category === "Sponsor fees") continue;
    const k = e.counterparty.trim().toLowerCase();
    by.set(k, (by.get(k) ?? 0) + e.amount);
    if (!label.has(k)) label.set(k, e.counterparty.trim());
  }
  return [...by]
    .map(([k, total]) => {
      const person = people.find((p) => p.name.trim().toLowerCase() === k);
      const venue = venues.find((v) => v.name.trim().toLowerCase() === k);
      const payee = person?.name ?? venue?.name ?? label.get(k)!;
      return {
        payee,
        total: round2(total),
        person,
        venue,
        w9: person ? person.w9_on_file : null,
        needed: total >= threshold,
        issued: issued.find((i) => i.payee.trim().toLowerCase() === k),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export const ISSUED_COLUMNS = ["payee", "issued_date", "notes"] as const;
export const issuedFromCSV = (text: string): Issued1099[] =>
  parseCSV(text).map((r) => ({ payee: r.payee ?? "", issued_date: r.issued_date ?? "", notes: r.notes ?? "" }));
export const issuedToCSV = (rows: Issued1099[]) => toCSV(ISSUED_COLUMNS, rows as unknown as Record<string, unknown>[]);

export function list1099CSV(rows: Payee1099[]): string {
  return toCSV(
    ["payee", "total_paid", "w9_on_file", "1099_needed", "1099_issued"],
    rows.map((r) => ({
      payee: r.payee,
      total_paid: r.total.toFixed(2),
      w9_on_file: r.w9 === null ? "" : r.w9 ? "yes" : "no",
      "1099_needed": r.needed ? "yes" : "no",
      "1099_issued": r.issued?.issued_date ?? "",
    })),
  );
}

export function categoryTotalsCSV(ledger: LedgerEntry[], year: string): string {
  const m = new Map<string, { kind: string; category: string; total: number; count: number }>();
  for (const e of ledger) {
    if (!e.date.startsWith(year)) continue;
    const k = `${e.kind}|${e.category}`;
    const cur = m.get(k) ?? { kind: e.kind, category: e.category, total: 0, count: 0 };
    cur.total += e.amount;
    cur.count++;
    m.set(k, cur);
  }
  const rows = [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.total - a.total).map((r) => ({ ...r, total: r.total.toFixed(2) }));
  return toCSV(["kind", "category", "total", "count"], rows);
}

// ---- templates and contract drafting ----

const TEMPLATE_KEYS = ["title", "group", "doc_type", "subject", "solicitation"];

export function templateFromMd(slug: string, text: string): Template {
  const { data: d, body } = parseFrontmatter<Record<string, unknown>>(text);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!TEMPLATE_KEYS.includes(k)) extra[k] = v;
  return {
    slug,
    title: str(d.title) || slug,
    group: str(d.group) || "Other",
    doc_type: str(d.doc_type),
    subject: str(d.subject),
    solicitation: d.solicitation === true || d.solicitation === "yes",
    body: body.trim(),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export function templateToMd(t: Template): string {
  const { slug, body, extra, ...data } = t;
  void slug;
  return stringifyFrontmatter({ ...extra, ...data }, body);
}

/** Fill [Field] placeholders (case-insensitive). Unknown fields are left for the user. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v) lower[k.toLowerCase()] = v;
  return body.replace(/\[([^\]\n]{1,40})\]/g, (m, k: string) => lower[k.trim().toLowerCase()] ?? m);
}

export function templateFields(body: string): string[] {
  return [...new Set([...body.matchAll(/\[([^\]\n]{1,40})\]/g)].map((m) => m[1].trim()))];
}

/** Split a fee into n installments, the last one absorbing rounding. */
export function splitFee(total: number, n: number, firstDue: string, everyDays: number): { amount: number; due: string; payment_id: string }[] {
  const n2 = Math.max(1, Math.floor(n));
  const each = Math.floor((total / n2) * 100) / 100;
  return Array.from({ length: n2 }, (_, i) => ({
    amount: i === n2 - 1 ? round2(total - each * (n2 - 1)) : each,
    due: firstDue ? addDays(firstDue, i * everyDays) : "",
    payment_id: "",
  }));
}

export function scheduleText(schedule: { amount: number; due: string }[], money: (n: number) => string): string {
  if (!schedule.length) return "";
  if (schedule.length === 1) return `${money(schedule[0].amount)}${schedule[0].due ? ` due ${schedule[0].due}` : ""}`;
  return schedule.map((s, i) => `${i + 1}. ${money(s.amount)}${s.due ? ` due ${s.due}` : ""}`).join("\n");
}

const CATEGORY_FOR_TYPE: Record<string, string> = {
  "Artist agreement": "Artist fees",
  "Crew agreement": "Artist fees",
  "Venue rental agreement": "Venue rental",
  "Rights / licensing": "Other",
  "Certificate of insurance (COI)": "Insurance",
};

/** Payments for installments that don't have one yet. */
export function paymentsForSchedule(doc: PaperDoc, payee: string, defaultProject: string): { doc: PaperDoc; payments: Payment[] } {
  const project = doc.project || defaultProject;
  const payments: Payment[] = [];
  const n = doc.schedule.length;
  const schedule = doc.schedule.map((inst, i) => {
    if (inst.payment_id || !(inst.amount > 0)) return inst;
    const p: Payment = {
      id: uid("p"),
      title: n > 1 ? `${doc.title}, installment ${i + 1} of ${n}` : doc.title,
      payee,
      method: "Checking",
      budget_line: "",
      category: CATEGORY_FOR_TYPE[doc.type] ?? "Other",
      due: inst.due,
      amount: inst.amount,
      status: "scheduled",
      paid_date: "",
      ledger_id: "",
      project_alloc: { [project]: 1 },
      notes: `From ${doc.path}`,
    };
    payments.push(p);
    return { ...inst, payment_id: p.id };
  });
  return { doc: { ...doc, schedule }, payments };
}

export function draftValues(opts: {
  producer: string;
  company: string;
  today: string;
  project?: Project;
  person?: Person;
  venue?: Venue;
  role?: string;
  fee?: string;
  schedule?: string;
}): Record<string, string> {
  const { project, person, venue } = opts;
  return {
    Producer: opts.producer,
    Company: opts.company || opts.producer,
    Today: opts.today,
    Date: opts.today,
    Project: project?.name ?? "",
    Opening: project?.opening ?? "",
    Start: project?.start ?? "",
    End: project?.end ?? "",
    Dates: project?.start && project?.end ? `${project.start} to ${project.end}` : "",
    City: project?.city ?? venue?.city ?? "",
    Name: person?.name ?? venue?.name ?? "",
    Person: person?.name ?? "",
    "First name": person?.name.split(" ")[0] ?? "",
    Email: person?.email ?? "",
    Role: opts.role ?? person?.roles[0] ?? "",
    Fee: opts.fee ?? "",
    Amount: opts.fee ?? "",
    "Payment schedule": opts.schedule ?? "",
    Venue: venue?.name ?? "",
    Capacity: venue?.capacity ? String(venue.capacity) : "",
  };
}

// ---- tiny markdown → HTML for printing drafts (headings, lists, bold, italics) ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/_{3,}/g, "<span class=\"blank\">$&</span>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(line))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(line))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(line))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join("\n");
}
