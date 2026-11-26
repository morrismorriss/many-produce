import type { Screen } from "../store";
import { Header, NAV } from "../components/Shell";

const PLANS: Partial<Record<Screen, string[]>> = {
  shopping: ["Everything a show needs to buy, rent or borrow, with buyer tags (Producer, designers, someone else, unassigned).", "Reimbursements that turn into payments and ledger entries.", "Printable buyer lists."],
  paperwork: ["Every contract and tax document, with status and file versions.", "Missing-paperwork rules (no signed agreement, no W-9, no COI).", "Contract drafting from templates; fee schedules create payments.", "W-9 and 1099 trackers and a year-end packet."],
  schedule: ["Rehearsals, tech and performances built around everyone's conflicts.", "Availability grid, scene breakdown, warnings and hours tally.", "Call sheets, per-person .ics files and rehearsal reports."],
  timeline: ["The production plan built backward from opening night.", "Relative dates (Opening − 8 weeks) that move with opening.", "Timeline templates: staged reading, fringe show, full production, closing checklist."],
  stripboard: ["Breakdown sheets, a drag-and-drop board and day out of days.", "Imports from Many Write and Final Draft (.fdx)."],
  clearances: ["Every right and permission (music, footage, locations, talent).", "Scope checks and music cue sheet export."],
  inventory: ["Check-out tracker for gear, props, costumes and keys.", "Rentals, deposits and overdue warnings."],
  campaigns: ["Marketing and fundraising board (Ideas · Drafting · Scheduled · Done).", "Crowdfunding goal tracker fed by the ledger."],
  templates: ["Ask letters, calls to action and thank-yous with [Fill-in] fields.", "Needs fiscal sponsor review badges."],
  reports: ["Fiscal sponsor and funder reports with live preview and PDF export.", "House reports, venue settlement and daily reports."],
};

export function Placeholder({ screen }: { screen: Screen }) {
  const nav = NAV.find((n) => n.id === screen)!;
  return (
    <>
      <Header title={nav.label} />
      <div className="content">
        <div className="placeholder card">
          <span className="pill amber">Build phase {nav.phase}</span>
          <h2 style={{ marginTop: 10 }}>{nav.label} is coming in a later build</h2>
          <p className="muted">This first build covers the vault, projects, Bookkeeping, Budget, Payments, the Dashboard forecast, Collaborators and Venues. Here&apos;s what {nav.label} will do:</p>
          <ul>{(PLANS[screen] ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </>
  );
}
