import { useState } from "react";
import { isAutoFee } from "../lib/ledger";
import { fmtDate } from "../lib/util";
import { EntryForm } from "../screens/Bookkeeping";
import { PersonModal, VenueModal } from "../screens/People";
import { DocModal, DraftModal, STATUS_PILL } from "../screens/Paperwork";
import { PaymentModal } from "../screens/Payments";
import { missingPaperwork } from "../lib/paperwork";
import type { PaperDoc } from "../lib/types";
import { DocDrawerBody } from "./DocDrawer";
import { cost, owedTo } from "../lib/shopping";
import { CheckOutModal } from "../screens/Equipment";
import { useApp } from "../store";
import { AllocTags, Initials, ProjectTag, X } from "./bits";

export function Drawer() {
  const { drawer, openDrawer } = useApp();
  const [full, setFull] = useState(false);
  if (!drawer) return null;
  return (
    <aside className={`drawer${full ? " full" : ""}`} aria-label="Details">
      <DrawerContent full={full} onToggleFull={() => setFull((f) => !f)} onClose={() => { setFull(false); openDrawer(null); }} />
    </aside>
  );
}

function Head({ title, onClose, full, onToggleFull, actions }: { title: React.ReactNode; onClose: () => void; full: boolean; onToggleFull: () => void; actions?: React.ReactNode }) {
  return (
    <div className="drawer-head">
      <h2>{title}</h2>
      {actions}
      <button className="icon-btn" aria-label={full ? "Exit full screen" : "Expand to full screen"} onClick={onToggleFull}>{full ? "⤡" : "⤢"}</button>
      <button className="icon-btn" aria-label="Close details" onClick={onClose}><X /></button>
    </div>
  );
}

function DrawerContent({ onClose, full, onToggleFull }: { onClose: () => void; full: boolean; onToggleFull: () => void }) {
  const app = useApp();
  const { drawer, data, money, deleteEntry, deletePayment, setPaid, deletePerson, deleteVenue, allPayments, fs } = app;
  const [editing, setEditing] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const h = { onClose, full, onToggleFull };

  if (drawer?.kind === "doc") {
    const d = data.docs.find((x) => x.path === drawer.path);
    if (!d) return <Head title="Document not found" {...h} />;
    return (
      <>
        <Head title={d.title} {...h} />
        <div className="drawer-body"><DocDrawerBody doc={d} /></div>
      </>
    );
  }

  if (drawer?.kind === "entry") {
    const e = data.ledger.find((x) => x.id === drawer.id);
    if (!e) return <Head title="Entry not found" {...h} />;
    return (
      <>
        <Head title={e.kind === "income" ? "Income" : "Expense"} {...h} actions={<button className="btn small danger" onClick={() => { void deleteEntry(e.id); onClose(); }}>Delete</button>} />
        <div className="drawer-body">
          {isAutoFee(e) && <p className="note info">Added automatically for a fiscal-sponsor income entry. It updates when that entry changes. You can still edit it.</p>}
          <EntryForm key={e.id} existing={e} onDone={onClose} />
        </div>
      </>
    );
  }

  if (drawer?.kind === "payment") {
    const p = allPayments.find((x) => x.id === drawer.id);
    if (!p) return <Head title="Payment not found" {...h} />;
    return (
      <>
        <Head title={p.title} {...h} />
        <div className="drawer-body">
          <dl className="kv">
            <dt>Payee</dt><dd>{p.payee || "—"}</dd>
            <dt>Amount</dt><dd className="num">{money(p.amount, { cents: true })}</dd>
            <dt>Due</dt><dd>{fmtDate(p.due, true)}</dd>
            <dt>Paid from</dt><dd>{p.method}</dd>
            <dt>Project</dt><dd><AllocTags alloc={p.project_alloc} /></dd>
            <dt>Category</dt><dd>{p.category}</dd>
            <dt>Status</dt><dd>{p.status === "paid" ? <span className="pill green">Paid {fmtDate(p.paid_date)}</span> : <span className="pill">Scheduled</span>}</dd>
            {p.notes && (<><dt>Notes</dt><dd>{p.notes}</dd></>)}
          </dl>
          <div className="toolbar">
            <button className="btn primary" onClick={() => void setPaid(p.id, p.status !== "paid")}>{p.status === "paid" ? "Mark unpaid" : "Mark paid"}</button>
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <div className="spacer" />
            <button className="btn danger" onClick={() => { void deletePayment(p.id); onClose(); }}>Delete</button>
          </div>
          {p.status === "paid" && <p className="small muted">Marking it unpaid removes the matching Bookkeeping entry.</p>}
        </div>
        {editing && <PaymentModal existing={p} onClose={() => setEditing(false)} />}
      </>
    );
  }

  if (drawer?.kind === "person") {
    const p = data.people.find((x) => x.slug === drawer.slug);
    if (!p) return <Head title="Not found" {...h} />;
    const paid = data.ledger.filter((e) => e.kind === "expense" && e.counterparty === p.name);
    const paidTotal = paid.reduce((s, e) => s + e.amount, 0);
    const upcoming = allPayments.filter((x) => x.payee === p.name && x.status === "scheduled");
    return (
      <>
        <Head title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><Initials name={p.name} lg />{p.name}</span>} {...h} />
        <div className="drawer-body">
          <dl className="kv">
            <dt>Roles</dt><dd>{p.roles.join(", ") || "—"}</dd>
            <dt>Pronouns</dt><dd>{p.pronouns || "—"}</dd>
            <dt>Email</dt><dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : "—"}</dd>
            <dt>Phone</dt><dd>{p.phone || "—"}</dd>
            <dt>Rate</dt><dd>{p.rate ? `$${p.rate} ${p.rate_type}` : "—"}</dd>
            <dt>Status</dt><dd>{p.status}</dd>
            <dt>Payment method</dt><dd>{p.payment_method || "—"}</dd>
            <dt>W-9</dt><dd>{p.w9_on_file ? <span className="pill green">On file</span> : <span className="pill amber">Not on file</span>}</dd>
            <dt>Paid to date</dt><dd className="num"><strong>{money(paidTotal)}</strong> <span className="muted small">({paid.length} entries)</span></dd>
            <dt>Worked together on</dt><dd className="chips" style={{ gap: 4 }}>{p.projects.map((s) => <ProjectTag key={s} slug={s} />)}</dd>
          </dl>
          {upcoming.length > 0 && (
            <div>
              <h3>Scheduled payments</h3>
              <ul className="attn" style={{ marginTop: 6 }}>{upcoming.map((x) => <li key={x.id}>{fmtDate(x.due)} · {x.title} · {money(x.amount)}</li>)}</ul>
            </div>
          )}
          <StuffSection person={p.slug} />
          <PaperworkSection docs={data.docs.filter((d) => d.people.includes(p.slug))} missing={missingPaperwork(data, "", app.today).filter((m) => m.person === p.slug)} preset={{ people: [p.slug], project: p.projects[0] ?? "" }} draft={{ person: p.slug }} />
          {p.notes && <div><h3>Notes</h3><p style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p></div>}
          <div className="toolbar">
            <button className="btn primary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" onClick={() => setSchedule(true)}>Schedule payment</button>
            <OpenMd path={`people/${p.slug}.md`} root={fs.root} />
            <div className="spacer" />
            <button className="btn danger" onClick={() => void deletePerson(p.slug)}>Delete</button>
          </div>
        </div>
        {editing && <PersonModal existing={p} onClose={() => setEditing(false)} />}
        {schedule && <PaymentModal preset={{ payee: p.name, title: `${p.name} fee`, category: "Artist fees", project_alloc: p.projects[0] ? { [p.projects[0]]: 1 } : undefined }} onClose={() => setSchedule(false)} />}
      </>
    );
  }

  if (drawer?.kind === "venue") {
    const v = data.venues.find((x) => x.slug === drawer.slug);
    if (!v) return <Head title="Not found" {...h} />;
    const deposits = allPayments.filter((x) => x.payee === v.name);
    return (
      <>
        <Head title={v.name} {...h} />
        <div className="drawer-body">
          <dl className="kv">
            <dt>Type</dt><dd>{v.type || "—"}</dd>
            <dt>City</dt><dd>{v.city || "—"}</dd>
            <dt>Capacity</dt><dd>{v.capacity ?? "—"}</dd>
            <dt>Rate</dt><dd>{v.rate || "—"}</dd>
            <dt>Status</dt><dd>{v.status}</dd>
            <dt>Contact</dt><dd>{v.contact || "—"}</dd>
            <dt>Hold dates</dt><dd>{v.hold_dates || "—"}</dd>
            <dt>Tech notes</dt><dd>{v.tech_notes || "—"}</dd>
            <dt>Next step</dt><dd>{v.next_step || "—"}</dd>
            <dt>Projects</dt><dd className="chips" style={{ gap: 4 }}>{v.projects.map((s) => <ProjectTag key={s} slug={s} />)}</dd>
          </dl>
          <div>
            <h3>Deposit schedule</h3>
            {deposits.length ? (
              <ul className="attn" style={{ marginTop: 6 }}>{deposits.map((x) => <li key={x.id}><span className={`pill ${x.status === "paid" ? "green" : ""}`}>{x.status === "paid" ? "Paid" : "Due"}</span>{fmtDate(x.due)} · {x.title} · {money(x.amount)}</li>)}</ul>
            ) : <p className="muted small">No payments to this venue yet.</p>}
          </div>
          <PaperworkSection docs={data.docs.filter((d) => d.venues.includes(v.slug))} missing={missingPaperwork(data, "", app.today).filter((m) => m.venue === v.slug)} preset={{ venues: [v.slug], project: v.projects[0] ?? "", type: "Venue rental agreement" }} draft={{ venue: v.slug }} />
          {v.notes && <div><h3>Notes</h3><p style={{ whiteSpace: "pre-wrap" }}>{v.notes}</p></div>}
          <div className="toolbar">
            <button className="btn primary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" onClick={() => setSchedule(true)}>Schedule deposit</button>
            <OpenMd path={`venues/${v.slug}.md`} root={fs.root} />
            <div className="spacer" />
            <button className="btn danger" onClick={() => void deleteVenue(v.slug)}>Delete</button>
          </div>
        </div>
        {editing && <VenueModal existing={v} onClose={() => setEditing(false)} />}
        {schedule && <PaymentModal preset={{ payee: v.name, title: `${v.name} deposit`, category: "Venue rental", project_alloc: v.projects[0] ? { [v.projects[0]]: 1 } : undefined }} onClose={() => setSchedule(false)} />}
      </>
    );
  }
  return null;
}

/** Shows where the item's markdown file lives, so it can be opened in any editor. */
function OpenMd({ path, root }: { path: string; root: string }) {
  return <span className="small muted" title={`${root}/${path}`}>{path}</span>;
}


/** The Paperwork section in a collaborator's or venue's drawer. */
function PaperworkSection({ docs, missing, preset, draft }: { docs: PaperDoc[]; missing: ReturnType<typeof missingPaperwork>; preset: Partial<PaperDoc>; draft: { person?: string; venue?: string } }) {
  const { openDrawer } = useApp();
  const [adding, setAdding] = useState<Partial<PaperDoc> | null>(null);
  const [drafting, setDrafting] = useState(false);
  return (
    <div>
      <div className="section-title">
        <h3>Paperwork</h3>
        <button className="btn small" onClick={() => setDrafting(true)}>Draft…</button>
        <button className="btn small" onClick={() => setAdding(preset)}>+ Document</button>
      </div>
      {missing.length > 0 && (
        <ul className="attn" style={{ marginBottom: 6 }}>
          {missing.map((m, i) => (
            <li key={i}>
              <span className="pill red">Missing</span>
              <span className="small">{m.message}</span>
              {m.preset && <button className="btn small" onClick={() => setAdding(m.preset!)}>Add</button>}
            </li>
          ))}
        </ul>
      )}
      {docs.length ? (
        <ul className="attn">
          {docs.map((d) => (
            <li key={d.path} style={{ cursor: "pointer" }} onClick={() => openDrawer({ kind: "doc", path: d.path })}>
              <span className={`pill ${STATUS_PILL[d.status]}`}>{d.status}</span>
              <span>{d.title}</span>
              <span className="muted small" style={{ marginLeft: "auto" }}>{d.type}</span>
            </li>
          ))}
        </ul>
      ) : !missing.length ? <p className="muted small">No documents yet.</p> : null}
      {adding && <DocModal preset={adding} onClose={() => setAdding(null)} />}
      {drafting && <DraftModal preset={draft} onClose={() => setDrafting(false)} />}
    </div>
  );
}

/** What a collaborator is buying, what they're owed, and what they're holding. */
function StuffSection({ person }: { person: string }) {
  const { data, allPayments, money, setScreen, checkIn, today } = useApp();
  const [checkingOut, setCheckingOut] = useState(false);
  const { buying, owed } = owedTo(person, Object.values(data.shopping).flat(), allPayments);
  const holding = data.checkouts.filter((c) => c.person === person && !c.in_date);
  return (
    <div>
      <div className="section-title">
        <h3>Buying and holding</h3>
        {owed > 0 && <span className="pill amber">Owed {money(owed)}</span>}
        <button className="btn small" onClick={() => setCheckingOut(true)}>Check out…</button>
      </div>
      {buying.length > 0 && (
        <ul className="attn" style={{ marginBottom: 6 }}>
          {buying.map((i) => (
            <li key={i.id} style={{ cursor: "pointer" }} onClick={() => setScreen("shopping")}>
              <span className={`pill ${i.status === "Needed" ? "" : "green"}`}>{i.status === "Needed" ? "To buy" : i.status}</span>
              <span>{i.item}</span>
              <span className="muted small" style={{ marginLeft: "auto" }}>{i.need_by ? `by ${fmtDate(i.need_by)}` : ""} {cost(i) ? money(cost(i)) : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {holding.length > 0 && (
        <ul className="attn">
          {holding.map((c) => (
            <li key={c.id}>
              <span className={`pill ${c.due_date && c.due_date < today ? "red" : "blue"}`}>Has</span>
              <span>{data.inventory.find((x) => x.id === c.item)?.name ?? c.item}</span>
              <span className="muted small">{c.due_date ? `back ${fmtDate(c.due_date)}` : ""}</span>
              <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => void checkIn(c.id, c.condition_out)}>Check in</button>
            </li>
          ))}
        </ul>
      )}
      {!buying.length && !holding.length && <p className="muted small">Not buying anything or holding any gear.</p>}
      {checkingOut && <CheckOutModal person={person} onClose={() => setCheckingOut(false)} />}
    </div>
  );
}
