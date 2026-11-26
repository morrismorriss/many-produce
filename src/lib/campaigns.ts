// Campaigns: the marketing and fundraising board.
import { parseFrontmatter, stringifyFrontmatter } from "./files";
import { CAMPAIGN_STATUSES, type Campaign, type CampaignStatus, type LedgerEntry } from "./types";
import { round2, slugify } from "./util";

const KEYS = ["title", "type", "project", "channel", "status", "date", "end_date", "template", "goal", "asks_sent", "responses", "result_amount", "result_notes", "linked_entries"];
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export function campaignFromMd(path: string, text: string): Campaign {
  const { data: d, body } = parseFrontmatter<Record<string, unknown>>(text);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!KEYS.includes(k)) extra[k] = v;
  const status = str(d.status) as CampaignStatus;
  return {
    path,
    title: str(d.title) || path.split("/").pop()!.replace(/\.md$/, ""),
    type: str(d.type) === "Marketing" ? "Marketing" : "Fundraising",
    project: str(d.project),
    channel: str(d.channel),
    status: (CAMPAIGN_STATUSES as readonly string[]).includes(status) ? status : "Ideas",
    date: str(d.date),
    end_date: str(d.end_date),
    template: str(d.template),
    goal: num(d.goal),
    asks_sent: num(d.asks_sent),
    responses: num(d.responses),
    result_amount: num(d.result_amount),
    result_notes: str(d.result_notes),
    linked_entries: Array.isArray(d.linked_entries) ? d.linked_entries.map(String) : [],
    body: body.trim(),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export function campaignToMd(c: Campaign): string {
  const { path, body, extra, ...data } = c;
  void path;
  return stringifyFrontmatter({ ...extra, ...data }, body);
}

export function newCampaignPath(c: Pick<Campaign, "title" | "date">, taken: string[]): string {
  const base = `campaigns/${c.date ? `${c.date}-` : ""}${slugify(c.title)}`;
  if (!taken.includes(`${base}.md`)) return `${base}.md`;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}.md`)) return `${base}-${i}.md`;
}

const GIFT_CATEGORIES = ["Donations", "Fundraiser", "Grants"];

/**
 * Money a campaign brought in: its linked ledger entries, or — for a
 * fundraising push with dates — donations to its project between its start
 * and end dates. A typed-in result wins.
 */
export function campaignRaised(c: Campaign, ledger: LedgerEntry[]): { amount: number; gifts: number; donors: number; source: "typed" | "linked" | "dates" | "none" } {
  const gifts = (list: LedgerEntry[]) => ({ amount: round2(list.reduce((s, e) => s + e.amount * (c.project ? (e.project_alloc[c.project] ?? 0) || 1 : 1), 0)), gifts: list.length, donors: new Set(list.map((e) => e.counterparty.trim().toLowerCase() || e.id)).size });
  if (c.linked_entries.length) {
    const list = ledger.filter((e) => c.linked_entries.includes(e.id) && e.kind === "income");
    const g = gifts(list);
    return c.result_amount !== null ? { ...g, amount: c.result_amount, source: "typed" } : { ...g, source: "linked" };
  }
  if (c.result_amount !== null) return { amount: c.result_amount, gifts: 0, donors: 0, source: "typed" };
  if (c.type === "Fundraising" && c.date && c.end_date) {
    const list = ledger.filter((e) => e.kind === "income" && GIFT_CATEGORIES.includes(e.category) && e.date >= c.date && e.date <= c.end_date && (!c.project || (e.project_alloc[c.project] ?? 0) > 0));
    return { ...gifts(list), source: "dates" };
  }
  return { amount: 0, gifts: 0, donors: 0, source: "none" };
}

/** The crowdfunding goal to show at the top: an active fundraising campaign with a goal. */
export function activeGoal(campaigns: Campaign[], today: string, project?: string): Campaign | undefined {
  return campaigns
    .filter((c) => c.type === "Fundraising" && (c.goal ?? 0) > 0 && (!project || c.project === project))
    .filter((c) => (!c.end_date || c.end_date >= today) && c.status !== "Ideas")
    .sort((a, b) => (a.end_date || "9999").localeCompare(b.end_date || "9999"))[0];
}

export interface CampaignStats {
  asksSent: number;
  responded: number;
  postsThisMonth: number;
  raised: number;
}

export function campaignStats(campaigns: Campaign[], ledger: LedgerEntry[], today: string): CampaignStats {
  const month = today.slice(0, 7);
  let asksSent = 0, responded = 0, postsThisMonth = 0, raised = 0;
  for (const c of campaigns) {
    if (c.type === "Fundraising") {
      asksSent += c.asks_sent ?? 0;
      responded += c.responses ?? 0;
      if (c.status === "Done") raised += campaignRaised(c, ledger).amount;
    } else if (c.status === "Done" && c.date.startsWith(month)) postsThisMonth++;
  }
  return { asksSent, responded, postsThisMonth, raised: round2(raised) };
}

/** A short result line for a card, e.g. "14 gifts · $780". */
export function resultLine(c: Campaign, ledger: LedgerEntry[], money: (n: number) => string): string {
  const r = campaignRaised(c, ledger);
  const parts: string[] = [];
  if (r.gifts) parts.push(`${r.gifts} gift${r.gifts > 1 ? "s" : ""}`);
  if (r.amount) parts.push(money(r.amount));
  if (c.result_notes) parts.push(c.result_notes);
  return parts.join(" · ");
}
