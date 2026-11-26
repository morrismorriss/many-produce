import type { Screen } from "../store";
import { Header, sectionOf } from "../components/Shell";

const PLANS: Partial<Record<Screen, string[]>> = {

  reports: ["Fiscal sponsor and funder reports with live preview and PDF export.", "House reports, venue settlement and daily reports."],
};

export function Placeholder({ screen }: { screen: Screen }) {
  const nav = sectionOf(screen)!;
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
