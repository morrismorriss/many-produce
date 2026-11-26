import { useEffect, useMemo, useState } from "react";
import { Chips, Field, Modal, Plus, Progress, ProjectTag, Tile } from "../components/bits";
import { Header } from "../components/Shell";
import { activeGoal, campaignRaised, campaignStats, resultLine } from "../lib/campaigns";
import { draftValues, fillTemplate } from "../lib/paperwork";
import { CAMPAIGN_STATUSES, CHANNELS, type Campaign, type CampaignStatus } from "../lib/types";
import { daysBetween, fmtDate } from "../lib/util";
import { useApp } from "../store";

type Filter = "Everything" | "Fundraising" | "Marketing";

export function blankCampaign(project: string, patch: Partial<Campaign> = {}): Campaign {
  return {
    path: "", title: "", type: "Fundraising", project, channel: "Email", status: "Ideas", date: "", end_date: "", template: "",
    goal: null, asks_sent: null, responses: null, result_amount: null, result_notes: "", linked_entries: [], body: "", ...patch,
  };
}

export function Campaigns() {
  const { data, project, today, money, saveCampaign, newItemSignal } = useApp();
  const [filter, setFilter] = useState<Filter>("Everything");
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [dragging, setDragging] = useState("");
  const defProject = project || data.projects.find((p) => !p.builtin)?.slug || "overhead";
  useEffect(() => { if (newItemSignal) setEditing(blankCampaign(defProject)); }, [newItemSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(
    () => data.campaigns.filter((c) => (!project || c.project === project) && (filter === "Everything" || c.type === filter)),
    [data.campaigns, project, filter],
  );
  const stats = campaignStats(data.campaigns.filter((c) => !project || c.project === project), data.ledger, today);
  const goal = activeGoal(data.campaigns, today, project);
  const nextPush = goal && data.campaigns.filter((c) => c.project === goal.project && c.status === "Scheduled" && c.date >= today && c.path !== goal.path).sort((a, b) => a.date.localeCompare(b.date))[0];

  const move = (path: string, status: CampaignStatus) => {
    const c = data.campaigns.find((x) => x.path === path);
    if (c && c.status !== status) void saveCampaign({ ...c, status });
  };

  return (
    <>
      <Header title="Campaigns" actions={<button className="btn primary" onClick={() => setEditing(blankCampaign(defProject))}><Plus /> Campaign</button>} />
      <div className="content">
        {goal && <GoalTracker c={goal} next={nextPush} onOpen={() => setEditing(goal)} />}
        <div className="tiles">
          <Tile label="Asks sent" value={stats.asksSent} sub={stats.asksSent ? `${stats.responded} responded (${Math.round((stats.responded / stats.asksSent) * 100)}%)` : undefined} />
          <Tile label="Posts this month" value={stats.postsThisMonth} />
          <Tile label="Raised by finished campaigns" value={<span className="in">{money(stats.raised)}</span>} />
        </div>
        <div className="toolbar"><Chips label="Type" options={["Everything", "Fundraising", "Marketing"] as const} value={filter} onChange={setFilter} /></div>
        <div className="board">
          {CAMPAIGN_STATUSES.map((s) => {
            const cards = list.filter((c) => c.status === s).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
            return (
              <section
                key={s}
                className={`column${dragging ? " droppable" : ""}`}
                aria-label={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); move(e.dataTransfer.getData("text/plain"), s); setDragging(""); }}
              >
                <div className="column-head"><h3>{s}</h3><span className="muted small">{cards.length}</span></div>
                {cards.map((c) => (
                  <article
                    key={c.path}
                    className="ccard"
                    draggable
                    tabIndex={0}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.path); setDragging(c.path); }}
                    onDragEnd={() => setDragging("")}
                    onClick={() => setEditing(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditing(c);
                      // Keyboard: move between columns with [ and ].
                      const i = CAMPAIGN_STATUSES.indexOf(c.status);
                      if (e.key === "]" && i < 3) move(c.path, CAMPAIGN_STATUSES[i + 1]);
                      if (e.key === "[" && i > 0) move(c.path, CAMPAIGN_STATUSES[i - 1]);
                    }}
                    aria-label={`${c.title}, ${c.type}, ${c.status}. Press ] or [ to move.`}
                  >
                    <div className="chips" style={{ gap: 4 }}>
                      <span className={`pill ${c.type === "Fundraising" ? "pink" : "blue"}`}>{c.type}</span>
                      {!project && <ProjectTag slug={c.project} />}
                    </div>
                    <strong>{c.title}</strong>
                    <span className="small muted">{[c.channel, c.date && fmtDate(c.date)].filter(Boolean).join(" · ")}</span>
                    {c.status === "Done" && resultLine(c, data.ledger, (n) => money(n)) && <span className="small in">{resultLine(c, data.ledger, (n) => money(n))}</span>}
                  </article>
                ))}
                <button className="btn ghost small" onClick={() => setEditing(blankCampaign(defProject, { status: s, type: filter === "Marketing" ? "Marketing" : "Fundraising" }))}>+ Add</button>
              </section>
            );
          })}
        </div>
      </div>
      {editing && <CampaignModal campaign={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GoalTracker({ c, next, onOpen }: { c: Campaign; next?: Campaign; onOpen: () => void }) {
  const { data, today, money } = useApp();
  const r = campaignRaised(c, data.ledger);
  const goal = c.goal ?? 0;
  const left = c.end_date ? daysBetween(today, c.end_date) : null;
  return (
    <section className="card goal" aria-label="Goal tracker" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h2>{c.title}</h2>
        <ProjectTag slug={c.project} />
        <div className="spacer" />
        <button className="btn small" onClick={onOpen}>Open</button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span className="goal-num in">{money(r.amount)}</span>
        <span className="muted">raised of {money(goal)} goal ({goal ? Math.round((r.amount / goal) * 100) : 0}%)</span>
      </div>
      <Progress blue value={r.amount} max={goal} />
      <div className="small muted" style={{ marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>{r.donors} donor{r.donors === 1 ? "" : "s"} · {r.gifts} gift{r.gifts === 1 ? "" : "s"}</span>
        {c.end_date && <span>Ends {fmtDate(c.end_date, true)}{left !== null && left >= 0 ? ` (${left} day${left === 1 ? "" : "s"} left)` : ""}</span>}
        {next && <span>Next push: {next.title}, {fmtDate(next.date)}</span>}
        <span>{r.source === "dates" ? "Counting donations to this project between its dates." : r.source === "linked" ? "Counting the entries linked to it." : ""}</span>
      </div>
    </section>
  );
}

export function CampaignModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { data, today, money, saveCampaign, deleteCampaign, toast } = useApp();
  const [c, setC] = useState(campaign);
  const set = <K extends keyof Campaign>(k: K, v: Campaign[K]) => setC((x) => ({ ...x, [k]: v }));
  const tpl = data.templates.find((t) => t.slug === c.template);
  const sponsor = data.sponsors.find((s) => s.slug === data.projects.find((p) => p.slug === c.project)?.fiscal_sponsor);
  const income = data.ledger.filter((e) => e.kind === "income" && (!c.project || (e.project_alloc[c.project] ?? 0) > 0)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const r = campaignRaised(c, data.ledger);
  const num = (v: string) => (v === "" ? null : Number(v));

  const pickTemplate = (slug: string) => {
    const t = data.templates.find((x) => x.slug === slug);
    set("template", slug);
    if (t && !c.body.trim()) {
      const proj = data.projects.find((p) => p.slug === c.project);
      set("body", fillTemplate(`${t.subject ? `Subject: ${t.subject}\n\n` : ""}${t.body}`, draftValues({ producer: data.settings.producer_name, company: data.settings.company_name, today, project: proj, fee: c.goal ? money(c.goal) : "" })));
    }
  };
  const save = async () => { if (!c.title.trim()) return; await saveCampaign({ ...c, title: c.title.trim() }); onClose(); };

  return (
    <Modal title={campaign.path ? c.title || "Campaign" : "New campaign"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Title" wide><input autoFocus value={c.title} onChange={(e) => set("title", e.target.value)} placeholder="Giving Tuesday push" /></Field>
        <Field label="Type">
          <select value={c.type} onChange={(e) => set("type", e.target.value as Campaign["type"])}><option>Fundraising</option><option>Marketing</option></select>
        </Field>
        <Field label="Project">
          <select value={c.project} onChange={(e) => set("project", e.target.value)}>{data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
        </Field>
        <Field label="Channel">
          <input list="mp-channels" value={c.channel} onChange={(e) => set("channel", e.target.value)} />
          <datalist id="mp-channels">{CHANNELS.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Status">
          <select value={c.status} onChange={(e) => set("status", e.target.value as CampaignStatus)}>{CAMPAIGN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="Date"><input type="date" value={c.date} onChange={(e) => set("date", e.target.value)} /></Field>
        {c.type === "Fundraising" && (
          <>
            <Field label="Ends (optional)"><input type="date" value={c.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
            <Field label="Goal"><input type="number" value={c.goal ?? ""} onChange={(e) => set("goal", num(e.target.value))} /></Field>
            <Field label="Asks sent"><input type="number" value={c.asks_sent ?? ""} onChange={(e) => set("asks_sent", num(e.target.value))} /></Field>
            <Field label="Responded"><input type="number" value={c.responses ?? ""} onChange={(e) => set("responses", num(e.target.value))} /></Field>
          </>
        )}
        <Field label="Template">
          <select value={c.template} onChange={(e) => pickTemplate(e.target.value)}>
            <option value="">None</option>
            {data.templates.filter((t) => !t.doc_type).map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}
          </select>
        </Field>
      </div>
      {tpl?.solicitation && sponsor?.review_required_for.includes("solicitations") && (
        <p className="note small">{sponsor.name} asks to review written solicitations. Send this to them before it goes out.</p>
      )}
      <Field label="Draft / notes" wide><textarea style={{ minHeight: 140 }} value={c.body} onChange={(e) => set("body", e.target.value)} /></Field>

      {c.type === "Fundraising" && (
        <details>
          <summary>Results: {r.amount ? money(r.amount) : "nothing linked yet"}{r.gifts ? ` from ${r.gifts} gifts` : ""}</summary>
          <p className="small muted" style={{ margin: "6px 0" }}>Tick the Bookkeeping entries this campaign brought in, and the result fills itself in. {c.date && c.end_date ? "With nothing ticked, donations to the project between its dates count." : ""}</p>
          <div className="link-list">
            {income.map((e) => (
              <label key={e.id} className="small">
                <input type="checkbox" checked={c.linked_entries.includes(e.id)} onChange={(x) => set("linked_entries", x.target.checked ? [...c.linked_entries, e.id] : c.linked_entries.filter((id) => id !== e.id))} />
                {fmtDate(e.date)} · {e.description || e.category} · <span className="in">{money(e.amount)}</span>
              </label>
            ))}
            {!income.length && <span className="muted small">No income entries for this project yet.</span>}
          </div>
        </details>
      )}
      <div className="form-grid">
        {c.type === "Fundraising" && <Field label="Result amount (overrides the linked total)"><input type="number" value={c.result_amount ?? ""} onChange={(e) => set("result_amount", num(e.target.value))} /></Field>}
        <Field label="Result notes"><input value={c.result_notes} onChange={(e) => set("result_notes", e.target.value)} placeholder="31 presale tickets" /></Field>
      </div>
      <div className="toolbar">
        {campaign.path && <button className="btn danger" onClick={() => { void deleteCampaign(campaign.path); onClose(); }}>Delete</button>}
        {c.body && <button className="btn" onClick={() => void navigator.clipboard.writeText(c.body).then(() => toast("Copied"))}>Copy draft</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!c.title.trim()} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
