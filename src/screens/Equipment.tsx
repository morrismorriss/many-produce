import { useEffect, useMemo, useState } from "react";
import { CsvImportModal } from "../components/CsvImport";
import { Chips, Empty, Field, Modal, Plus, ProjectTag, Tile, printHtml } from "../components/bits";
import { Header } from "../components/Shell";
import { gearListText, gearWarnings, holderOf, isRental, ownerLabel, rentalOrders, signOutSheetHtml } from "../lib/inventory";
import { anchorsFor } from "../lib/timeline";
import { INVENTORY_CATEGORIES, type InventoryItem, type Payment } from "../lib/types";
import { addDays, fmtDate, uid } from "../lib/util";
import { useApp } from "../store";
import { PaymentModal } from "./Payments";
import { printText } from "./Schedule";

type View = "By item" | "By person" | "Overdue" | "Rentals";

export function useGearWarnings(project?: string) {
  const { data, today } = useApp();
  return useMemo(
    () => gearWarnings(data.inventory, data.checkouts, data.people, data.projects, (p) => anchorsFor(p, data.events).closing, today, project),
    [data.inventory, data.checkouts, data.people, data.projects, data.events, today, project],
  );
}

export function Equipment() {
  const { data, project, money, newItemSignal } = useApp();
  const [view, setView] = useState<View>("By item");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [checkingOut, setCheckingOut] = useState<InventoryItem | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (newItemSignal) setEditing(blankItem(project)); }, [newItemSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data.inventory.filter((i) => (!project || !i.project || i.project === project) && (!cat || i.category === cat));
  const out = items.filter((i) => holderOf(i.id, data.checkouts));
  const warnings = useGearWarnings(project);
  const value = items.reduce((s, i) => s + (i.value ?? 0), 0);
  const projName = data.projects.find((p) => p.slug === project)?.name;

  return (
    <>
      <Header
        title="Equipment log"
        actions={
          <>
            <button className="btn" onClick={() => printHtml("Sign-out sheet", signOutSheetHtml(`${projName ? `${projName}: ` : ""}sign-out sheet`, items))}>Print sign-out sheet</button>
            <button className="btn" onClick={() => printText("Gear list", gearListText(`${projName ? `${projName}: ` : ""}gear list`, items, data.checkouts, data.people))}>Print gear list</button>
            <button className="btn" onClick={() => setImporting(true)}>Import CSV</button>
            <button className="btn primary" onClick={() => setEditing(blankItem(project))}><Plus /> Item</button>
          </>
        }
      />
      <div className="content">
        <div className="tiles">
          <Tile label="Items" value={items.length} sub={value ? `${money(value)} replacement value` : undefined} />
          <Tile label="Checked out" value={out.length} />
          <Tile label="Needs attention" value={warnings.length} alert={warnings.length > 0} sub="Overdue, rentals due back, deposits" />
        </div>
        <div className="toolbar">
          <Chips label="View" options={["By item", "By person", "Overdue", "Rentals"] as const} value={view} onChange={setView} />
          <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {INVENTORY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {view === "By item" && <ByItem items={items} onEdit={setEditing} onCheckOut={setCheckingOut} />}
        {view === "By person" && <ByPerson />}
        {view === "Overdue" && (
          warnings.length ? (
            <ul className="attn">
              {warnings.map((w, i) => (
                <li key={i}>
                  <span className={`pill ${w.kind === "rental-due" ? "amber" : "red"}`}>{{ overdue: "Overdue", "rental-due": "Due back soon", "rental-late": "Rental late", "after-closing": "After closing", deposit: "Deposit out" }[w.kind]}</span>
                  <span>{w.message}</span>
                  {w.project && <ProjectTag slug={w.project} />}
                  <button className="btn small" onClick={() => setEditing(data.inventory.find((x) => x.id === w.item) ?? null)}>Open</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Nothing overdue. 🎉</p>
        )}
        {view === "Rentals" && <Rentals onEdit={setEditing} />}
      </div>
      {importing && <CsvImportModal kind="inventory" title="Import equipment" onClose={() => setImporting(false)} />}
      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} />}
      {checkingOut && <CheckOutModal item={checkingOut} onClose={() => setCheckingOut(null)} />}
    </>
  );
}

function blankItem(project: string): InventoryItem {
  return {
    id: uid("it"), name: "", category: "Props", owner: "producer", project, serial: "", value: null, rental_house: "", rental_order: "",
    rental_cost: null, rental_start: "", rental_end: "", deposit: null, deposit_returned: false, returned: false, condition: "", notes: "",
  };
}

function ByItem({ items, onEdit, onCheckOut }: { items: InventoryItem[]; onEdit: (i: InventoryItem) => void; onCheckOut: (i: InventoryItem) => void }) {
  const { data, today, money, checkIn } = useApp();
  if (!items.length) return <Empty title="Nothing in the log yet"><p>Add gear, props, costumes, keys and anything borrowed or rented. Things bought from the Shopping list can move here with one click.</p></Empty>;
  return (
    <table className="t">
      <thead><tr><th>Item</th><th>Category</th><th>Owner</th><th>Project</th><th className="r">Value</th><th>Who has it</th><th /></tr></thead>
      <tbody>
        {[...items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map((i) => {
          const co = holderOf(i.id, data.checkouts);
          const who = co && data.people.find((p) => p.slug === co.person);
          const late = co?.due_date && co.due_date < today;
          return (
            <tr key={i.id}>
              <td><button className="linklike" onClick={() => onEdit(i)}>{i.name}</button>{i.serial && <div className="muted small">{i.serial}</div>}</td>
              <td className="muted">{i.category}</td>
              <td>{isRental(i) ? <span className="pill amber">Rented · {i.rental_house}</span> : ownerLabel(i.owner, data.people, data.venues)}</td>
              <td>{i.project ? <ProjectTag slug={i.project} /> : <span className="muted small">Company</span>}</td>
              <td className="r num">{i.value ? money(i.value) : "—"}</td>
              <td>
                {co ? (
                  <span className={late ? "neg" : ""}>{who?.name ?? co.person}{co.due_date ? ` · back ${fmtDate(co.due_date)}` : ""}{late ? " (overdue)" : ""}</span>
                ) : isRental(i) && i.returned ? <span className="muted">Returned</span> : <span className="muted">In</span>}
              </td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>
                {co ? (
                  <button className="btn small" onClick={() => { const c = prompt(`Condition on return for ${i.name}?`, co.condition_out || "Good"); if (c !== null) void checkIn(co.id, c); }}>Check in</button>
                ) : !(isRental(i) && i.returned) ? (
                  <button className="btn small" onClick={() => onCheckOut(i)}>Check out</button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ByPerson() {
  const { data, project, today, checkIn } = useApp();
  const open = data.checkouts.filter((c) => !c.in_date);
  const people = data.people.filter((p) => open.some((c) => c.person === p.slug) && (!project || p.projects.includes(project)));
  if (!people.length) return <Empty title="Nobody has anything checked out"><p>Check things out from the By item view, or from a person&apos;s drawer.</p></Empty>;
  return (
    <div className="cards">
      {people.map((p) => (
        <div key={p.slug} className="card">
          <div className="card-head"><h3>{p.name}</h3></div>
          <ul className="attn">
            {open.filter((c) => c.person === p.slug).map((c) => {
              const it = data.inventory.find((x) => x.id === c.item);
              return (
                <li key={c.id}>
                  <span>{it?.name ?? c.item}</span>
                  <span className={`small ${c.due_date && c.due_date < today ? "neg" : "muted"}`}>{c.due_date ? `back ${fmtDate(c.due_date)}` : `since ${fmtDate(c.out_date)}`}</span>
                  <button className="btn small" onClick={() => void checkIn(c.id, c.condition_out)}>Check in</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Rentals({ onEdit }: { onEdit: (i: InventoryItem) => void }) {
  const { data, project, money, today, saveInventoryItem } = useApp();
  const [pay, setPay] = useState<Partial<Payment> | null>(null);
  const orders = rentalOrders(data.inventory.filter((i) => !project || !i.project || i.project === project));
  if (!orders.length) return <Empty title="No rentals"><p>Add an item with a rental house to track pickup, return and deposit.</p></Empty>;
  return (
    <>
      {orders.map((o) => (
        <section key={o.key} className="card">
          <div className="card-head">
            <h2>{o.house}</h2>
            <span className="muted small">Pickup {o.pickup ? fmtDate(o.pickup, true) : "—"} · return by {o.returnBy ? fmtDate(o.returnBy, true) : "—"}</span>
            {!o.returned && o.returnBy && o.returnBy < today && <span className="pill red">Late</span>}
            {o.returned && <span className="pill green">Returned</span>}
            <div className="spacer" />
            <span className="small">Rental {money(o.cost)}{o.deposit ? ` · deposit ${money(o.deposit)} ${o.depositBack ? "(back)" : "(out)"}` : ""}</span>
            {!o.returned && <button className="btn small" onClick={() => o.items.forEach((i) => void saveInventoryItem({ ...i, returned: true }))}>Mark returned</button>}
            {o.returned && o.deposit > 0 && !o.depositBack && <button className="btn small" onClick={() => o.items.forEach((i) => void saveInventoryItem({ ...i, deposit_returned: true }))}>Deposit came back</button>}
            <button className="btn small" title="Late return or damage fee" onClick={() => setPay({ payee: o.house, title: `${o.house}: late / damage fee`, category: "Other", project_alloc: o.items[0].project ? { [o.items[0].project]: 1 } : undefined })}>Fee…</button>
          </div>
          <ul className="attn">
            {o.items.map((i) => <li key={i.id} style={{ cursor: "pointer" }} onClick={() => onEdit(i)}><span>{i.name}</span><span className="muted small">{i.serial}</span><span className="small" style={{ marginLeft: "auto" }}>{i.rental_cost ? money(i.rental_cost) : ""}</span></li>)}
          </ul>
        </section>
      ))}
      {pay && <PaymentModal preset={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function ItemModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data, saveInventoryItem, deleteInventoryItem } = useApp();
  const [i, setI] = useState(item);
  const [rented, setRented] = useState(!!item.rental_house);
  const exists = data.inventory.some((x) => x.id === item.id);
  const history = data.checkouts.filter((c) => c.item === item.id).sort((a, b) => b.out_date.localeCompare(a.out_date));
  const num = (v: string) => (v === "" ? null : Number(v));
  const save = async () => { if (!i.name.trim()) return; await saveInventoryItem({ ...i, name: i.name.trim(), rental_house: rented ? i.rental_house : "" }); onClose(); };
  return (
    <Modal title={exists ? i.name || "Item" : "New item"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" wide><input autoFocus value={i.name} onChange={(e) => setI({ ...i, name: e.target.value })} /></Field>
        <Field label="Category"><select value={i.category} onChange={(e) => setI({ ...i, category: e.target.value })}>{INVENTORY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Project"><select value={i.project} onChange={(e) => setI({ ...i, project: e.target.value })}><option value="">Company-wide</option>{data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
        <Field label="Serial or ID"><input value={i.serial} onChange={(e) => setI({ ...i, serial: e.target.value })} /></Field>
        <Field label="Replacement value"><input type="number" value={i.value ?? ""} onChange={(e) => setI({ ...i, value: num(e.target.value) })} /></Field>
        <div className="wide"><label className="small"><input type="checkbox" checked={rented} onChange={(e) => setRented(e.target.checked)} /> Rented from a rental house</label></div>
        {rented ? (
          <>
            <Field label="Rental house"><input value={i.rental_house} onChange={(e) => setI({ ...i, rental_house: e.target.value })} /></Field>
            <Field label="Order # (groups items)"><input value={i.rental_order} onChange={(e) => setI({ ...i, rental_order: e.target.value })} /></Field>
            <Field label="Pickup"><input type="date" value={i.rental_start} onChange={(e) => setI({ ...i, rental_start: e.target.value })} /></Field>
            <Field label="Return by"><input type="date" value={i.rental_end} onChange={(e) => setI({ ...i, rental_end: e.target.value })} /></Field>
            <Field label="Rental cost"><input type="number" value={i.rental_cost ?? ""} onChange={(e) => setI({ ...i, rental_cost: num(e.target.value) })} /></Field>
            <Field label="Deposit"><input type="number" value={i.deposit ?? ""} onChange={(e) => setI({ ...i, deposit: num(e.target.value) })} /></Field>
          </>
        ) : (
          <Field label="Owner">
            <select value={i.owner} onChange={(e) => setI({ ...i, owner: e.target.value })}>
              <option value="producer">You</option>
              {data.people.map((p) => <option key={p.slug} value={`person:${p.slug}`}>{p.name}</option>)}
              {data.venues.map((v) => <option key={v.slug} value={`venue:${v.slug}`}>{v.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Condition" wide><input value={i.condition} onChange={(e) => setI({ ...i, condition: e.target.value })} placeholder="Good, scuff on left side…" /></Field>
        <Field label="Notes" wide><input value={i.notes} onChange={(e) => setI({ ...i, notes: e.target.value })} /></Field>
      </div>
      {history.length > 0 && (
        <div>
          <h3>History</h3>
          <ul className="attn" style={{ marginTop: 6 }}>
            {history.map((c) => (
              <li key={c.id} className="small">
                {data.people.find((p) => p.slug === c.person)?.name ?? c.person} · out {fmtDate(c.out_date)}{c.in_date ? ` · back ${fmtDate(c.in_date)}` : " · still out"}
                {c.condition_in && <span className="muted"> · returned: {c.condition_in}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="toolbar">
        {exists && <button className="btn danger" onClick={() => { void deleteInventoryItem(i.id); onClose(); }}>Delete</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!i.name.trim()} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

export function CheckOutModal({ item, person: presetPerson, onClose }: { item?: InventoryItem; person?: string; onClose: () => void }) {
  const { data, project, today, checkOut, toast } = useApp();
  const available = data.inventory.filter((i) => !holderOf(i.id, data.checkouts) && !(isRental(i) && i.returned) && (!project || !i.project || i.project === project));
  const [itemId, setItemId] = useState(item?.id ?? available[0]?.id ?? "");
  const [person, setPerson] = useState(presetPerson ?? data.people.find((p) => !project || p.projects.includes(project))?.slug ?? "");
  const [due, setDue] = useState(addDays(today, 7));
  const it = data.inventory.find((x) => x.id === itemId);
  const [condition, setCondition] = useState(it?.condition ?? "Good");
  const go = async () => {
    await checkOut(itemId, person, due, condition);
    toast(`${it?.name ?? "Item"} checked out to ${data.people.find((p) => p.slug === person)?.name ?? person}`);
    onClose();
  };
  return (
    <Modal title={item ? `Check out ${item.name}` : "Check something out"} onClose={onClose}>
      <div className="form-grid">
        {!item && (
          <Field label="Item"><select value={itemId} onChange={(e) => setItemId(e.target.value)}>{available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        )}
        {!presetPerson && (
          <Field label="To"><select autoFocus value={person} onChange={(e) => setPerson(e.target.value)}>{data.people.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
        )}
        <Field label="Due back"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Condition going out"><input value={condition} onChange={(e) => setCondition(e.target.value)} /></Field>
      </div>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!itemId || !person} onClick={go}>Check out</button></div>
    </Modal>
  );
}
