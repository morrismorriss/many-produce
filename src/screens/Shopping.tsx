import { useEffect, useMemo, useState } from "react";
import { Chips, EditCell, Empty, Field, Modal, Plus, ProjectTag, Tile, printHtml, saveTextFile } from "../components/bits";
import { Header } from "../components/Shell";
import { buyerListText, buyerRole, cost, defaultMoney, summarize } from "../lib/shopping";
import { SHOP_DEPARTMENTS, SHOP_MONEY, type BuyerRole, type ShoppingItem } from "../lib/types";
import { uid } from "../lib/util";
import { useApp } from "../store";

type BuyerFilter = "Everyone" | "Producer" | "Designers" | "Someone else" | "Unassigned";
const FILTER_ROLE: Record<BuyerFilter, BuyerRole | null> = { Everyone: null, Producer: "producer", Designers: "designer", "Someone else": "other", Unassigned: "unassigned" };

export function BuyerPill({ item }: { item: ShoppingItem }) {
  const { data } = useApp();
  const name = item.buyer === "producer" ? "Producer" : item.buyer ? data.people.find((p) => p.slug === item.buyer)?.name ?? item.buyer : "Unassigned";
  return <span className={`buyer buyer-${item.buyer_role}`}>{name}</span>;
}

export function moneyOptions(sources: { name: string; sponsor?: string }[]): string[] {
  return [...SHOP_MONEY, ...sources.filter((s) => s.sponsor).map((s) => s.name)];
}

export function Shopping() {
  const { data, project, allPayments, money, newItemSignal, saveShoppingItem, setGotIt, deleteShoppingItem, moveToEquipment } = useApp();
  const [filter, setFilter] = useState<BuyerFilter>("Everyone");
  const [dept, setDept] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [adding, setAdding] = useState(false);
  const [reimbursing, setReimbursing] = useState<ShoppingItem | null>(null);
  const [listFor, setListFor] = useState(false);
  useEffect(() => { if (newItemSignal) setAdding(true); }, [newItemSignal]);

  const all = useMemo(() => Object.values(data.shopping).flat().filter((i) => !project || i.project === project), [data.shopping, project]);
  const list = all
    .filter((i) => !FILTER_ROLE[filter] || i.buyer_role === FILTER_ROLE[filter])
    .filter((i) => !dept || i.department === dept)
    .filter((i) => showDone || i.status === "Needed")
    .sort((a, b) => Number(a.status !== "Needed") - Number(b.status !== "Needed") || (a.need_by || "9").localeCompare(b.need_by || "9"));
  const sum = summarize(list, allPayments);
  const people = data.people.filter((p) => !project || p.projects.includes(project));
  const moneyOpts = moneyOptions(data.settings.money_sources);
  const depts = [...new Set([...SHOP_DEPARTMENTS, ...all.map((i) => i.department).filter(Boolean)])];

  const setBuyer = (i: ShoppingItem, buyer: string) => {
    const wasDefault = i.money === defaultMoney(i.buyer) || !i.money;
    void saveShoppingItem({ ...i, buyer, buyer_role: buyerRole(buyer, data.people), money: wasDefault ? defaultMoney(buyer) : i.money });
  };

  return (
    <>
      <Header
        title="Shopping list"
        actions={
          <>
            <button className="btn" onClick={() => setListFor(true)}>Share a buyer&apos;s list</button>
            <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Item</button>
          </>
        }
      />
      <div className="content">
        <div className="tiles">
          <Tile label="Items" value={sum.count} sub={`${sum.open} still to get`} />
          <Tile label="Estimated total" value={money(sum.estimated)} />
          <Tile label="To reimburse" value={money(sum.toReimburse)} alert={sum.toReimburse > 0} sub="Bought by others, not yet paid back" />
        </div>
        <div className="toolbar">
          <Chips label="Buyer" options={["Everyone", "Producer", "Designers", "Someone else", "Unassigned"] as const} value={filter} onChange={setFilter} />
          <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>
          <label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show bought</label>
        </div>
        {list.length ? (
          <div className="table-scroll"><table className="t shopping">
            <thead>
              <tr>
                <th style={{ width: 34 }}><span className="sr-only">Got it</span></th>
                <th>Item · where</th>
                <th>Department</th>
                {!project && <th>Project</th>}
                <th>Buyer</th>
                <th>Need by</th>
                <th className="r">Est. cost</th>
                <th>Money</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const pay = allPayments.find((p) => p.id === i.payment_id);
                return (
                  <tr key={i.id} className={i.status !== "Needed" ? "done" : ""}>
                    <td><input type="checkbox" aria-label={`Got it: ${i.item}`} checked={i.status !== "Needed"} disabled={!!i.payment_id} title={i.payment_id ? "Reimbursement already created" : undefined} onChange={(e) => void setGotIt(i, e.target.checked)} /></td>
                    <td style={{ minWidth: 180 }}>
                      <EditCell label="Item" value={i.item} onSave={(v) => void saveShoppingItem({ ...i, item: v })} />
                      <div className="where">
                        <EditCell label="Where to get it" placeholder="Where to get it" value={i.where} onSave={(v) => void saveShoppingItem({ ...i, where: v })} />
                        {i.link && <a className="small" href={i.link} target="_blank" rel="noreferrer">link</a>}
                      </div>
                    </td>
                    <td>
                      <select className="cell-edit" aria-label="Department" value={i.department} onChange={(e) => void saveShoppingItem({ ...i, department: e.target.value })}>
                        <option value="">—</option>{depts.map((d) => <option key={d}>{d}</option>)}
                      </select>
                    </td>
                    {!project && <td><ProjectTag slug={i.project} /></td>}
                    <td>
                      <label className="buyer-select">
                        <BuyerPill item={i} />
                        <select aria-label={`Buyer for ${i.item}`} value={i.buyer} onChange={(e) => setBuyer(i, e.target.value)}>
                          <option value="">Unassigned</option>
                          <option value="producer">Producer (you)</option>
                          {[...people, ...data.people.filter((p) => p.slug === i.buyer && !people.includes(p))].map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                        </select>
                      </label>
                    </td>
                    <td style={{ width: 130 }}><EditCell label="Need by" type="date" value={i.need_by} onSave={(v) => void saveShoppingItem({ ...i, need_by: v })} /></td>
                    <td className="r" style={{ width: 80 }}>
                      <EditCell label="Estimated cost" type="number" align="r" value={i.status === "Needed" ? i.est_cost ?? "" : i.actual_cost ?? i.est_cost ?? ""} onSave={(v) => void saveShoppingItem(i.status === "Needed" ? { ...i, est_cost: v === "" ? null : Number(v) } : { ...i, actual_cost: v === "" ? null : Number(v) })} />
                    </td>
                    <td>
                      <select className="cell-edit" aria-label="Money" value={i.money} disabled={!!i.ledger_id || !!i.payment_id} onChange={(e) => void saveShoppingItem({ ...i, money: e.target.value })}>
                        {[...new Set([...moneyOpts, i.money].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="r actions">
                      {i.money === "Reimburse" && i.status === "Got it" && !i.payment_id && <button className="btn small primary" onClick={() => setReimbursing(i)}>Reimburse…</button>}
                      {pay && <span className={`pill ${pay.status === "paid" ? "green" : "blue"}`}>{pay.status === "paid" ? "Reimbursed" : "Reimbursing"}</span>}
                      {i.status !== "Needed" && !i.inventory_id && ["Props", "Costumes", "Set", "Lighting", "Sound"].includes(i.department) && (
                        <button className="btn small ghost" title="Track it in the Equipment log" onClick={() => void moveToEquipment(i)}>→ Log</button>
                      )}
                      <button className="icon-btn" aria-label={`Delete ${i.item}`} onClick={() => void deleteShoppingItem(i)}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={project ? 5 : 6}>{sum.count} items</td><td className="r num">{money(sum.estimated)}</td><td colSpan={2} className="small">{sum.toReimburse ? `${money(sum.toReimburse)} to reimburse` : ""}</td></tr>
            </tfoot>
          </table></div>
        ) : (
          <Empty title={all.length ? "Nothing matches" : "Nothing on the list yet"}>
            <p>Add everything the show needs to buy, rent or borrow, and who&apos;s getting it. Items bought by anyone but you default to Reimburse.</p>
          </Empty>
        )}
      </div>
      {adding && <ItemModal onClose={() => setAdding(false)} />}
      {reimbursing && <ReimburseModal item={reimbursing} onClose={() => setReimbursing(null)} />}
      {listFor && <BuyerListModal items={all} onClose={() => setListFor(false)} />}
    </>
  );
}

function ItemModal({ onClose }: { onClose: () => void }) {
  const { data, project, saveShoppingItem } = useApp();
  const def = project || data.projects.find((p) => !p.builtin)?.slug || "overhead";
  const [i, setI] = useState<ShoppingItem>({
    id: uid("sh"), project: def, item: "", where: "", link: "", department: "Props", buyer: "", buyer_role: "unassigned", need_by: "",
    est_cost: null, actual_cost: null, money: "Producer card", status: "Needed", receipt: "", notes: "", payment_id: "", ledger_id: "", inventory_id: "",
  });
  const people = data.people.filter((p) => p.projects.includes(i.project));
  const save = async (another: boolean) => {
    if (!i.item.trim()) return;
    await saveShoppingItem({ ...i, item: i.item.trim(), buyer_role: buyerRole(i.buyer, data.people) });
    if (another) setI({ ...i, id: uid("sh"), item: "", where: "", link: "", est_cost: null, notes: "" });
    else onClose();
  };
  return (
    <Modal title="Add to the shopping list" onClose={onClose}>
      <div className="form-grid">
        <Field label="Item" wide><input autoFocus value={i.item} onChange={(e) => setI({ ...i, item: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void save(true)} placeholder="Red fedora" /></Field>
        <Field label="Where to get it"><input value={i.where} onChange={(e) => setI({ ...i, where: e.target.value })} placeholder="Thrift store, B&H, borrow from…" /></Field>
        <Field label="Link"><input value={i.link} onChange={(e) => setI({ ...i, link: e.target.value })} /></Field>
        <Field label="Department">
          <input list="mp-shop-depts" value={i.department} onChange={(e) => setI({ ...i, department: e.target.value })} />
          <datalist id="mp-shop-depts">{SHOP_DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Project">
          <select value={i.project} onChange={(e) => setI({ ...i, project: e.target.value })}>{data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
        </Field>
        <Field label="Buyer">
          <select value={i.buyer} onChange={(e) => setI({ ...i, buyer: e.target.value, money: defaultMoney(e.target.value) })}>
            <option value="">Unassigned</option>
            <option value="producer">Producer (you)</option>
            {people.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Need by"><input type="date" value={i.need_by} onChange={(e) => setI({ ...i, need_by: e.target.value })} /></Field>
        <Field label="Estimated cost"><input type="number" value={i.est_cost ?? ""} onChange={(e) => setI({ ...i, est_cost: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Money">
          <select value={i.money} onChange={(e) => setI({ ...i, money: e.target.value })}>{moneyOptions(data.settings.money_sources).map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Notes" wide><input value={i.notes} onChange={(e) => setI({ ...i, notes: e.target.value })} /></Field>
      </div>
      <div className="toolbar">
        <span className="small muted">Enter in the item name saves and starts another.</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Done</button>
        <button className="btn" disabled={!i.item.trim()} onClick={() => void save(true)}>Save and add another</button>
        <button className="btn primary" disabled={!i.item.trim()} onClick={() => void save(false)}>Save</button>
      </div>
    </Modal>
  );
}

function ReimburseModal({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const { data, today, money, reimburse } = useApp();
  const person = data.people.find((p) => p.slug === item.buyer);
  const [method, setMethod] = useState(person?.payment_method && data.settings.money_sources.some((s) => s.name === person.payment_method) ? person.payment_method : "Checking");
  const [due, setDue] = useState(today);
  const [paidNow, setPaidNow] = useState(false);
  return (
    <Modal title={`Reimburse ${person?.name ?? "buyer"}`} onClose={onClose}>
      <p>{item.item}: <strong>{money(cost(item), { cents: true })}</strong>{item.receipt ? "" : <span className="muted small"> (no receipt attached)</span>}</p>
      <div className="form-grid">
        <Field label="Pay from"><select value={method} onChange={(e) => setMethod(e.target.value)}>{data.settings.money_sources.map((s) => <option key={s.name}>{s.name}</option>)}<option>Venmo/Zelle</option></select></Field>
        <Field label="Due"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      <label className="small"><input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> I&apos;ve already paid them back (adds it to Bookkeeping now)</label>
      <p className="small muted">This adds a payment to {person?.name ?? "them"} in Payments. When it&apos;s marked paid, the expense lands in Bookkeeping under {item.department || "the item's"} costs.</p>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { void reimburse(item, { method, due, paidNow }); onClose(); }}>{paidNow ? "Mark reimbursed" : "Add to Payments"}</button></div>
    </Modal>
  );
}

function BuyerListModal({ items, onClose }: { items: ShoppingItem[]; onClose: () => void }) {
  const { data, project, money, toast } = useApp();
  const buyers = [...new Set(items.map((i) => i.buyer))];
  const [buyer, setBuyer] = useState(buyers.find((b) => b && b !== "producer") ?? buyers[0] ?? "");
  const [open, setOpen] = useState(true);
  const name = buyer === "producer" ? "Producer" : buyer ? data.people.find((p) => p.slug === buyer)?.name ?? buyer : "Unassigned";
  const mine = items.filter((i) => i.buyer === buyer && (!open || i.status === "Needed"));
  const proj = data.projects.find((p) => p.slug === project)?.name;
  const text = buyerListText(`${proj ? `${proj}: ` : ""}shopping list for ${name}`, mine, (n) => money(n));
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    <Modal title="Share a buyer's list" onClose={onClose}>
      <div className="toolbar" style={{ margin: 0 }}>
        <select className="input" aria-label="Buyer" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
          {buyers.map((b) => <option key={b} value={b}>{b === "producer" ? "Producer (you)" : b ? data.people.find((p) => p.slug === b)?.name ?? b : "Unassigned"}</option>)}
        </select>
        <label className="small"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Only what&apos;s still needed</label>
      </div>
      <pre className="draft-preview">{text}</pre>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={() => void navigator.clipboard.writeText(text).then(() => toast("List copied. Paste it into a text or email."))}>Copy text</button>
        <button className="btn" onClick={() => saveTextFile(`shopping-${name.toLowerCase().replace(/\W+/g, "-")}.txt`, text)}>Save .txt</button>
        <button className="btn primary" onClick={() => printHtml(`Shopping list: ${name}`, `<pre style="font: 11pt/1.6 Menlo, monospace; white-space: pre-wrap">${esc(text)}</pre>`)}>Print / Save as PDF</button>
      </div>
    </Modal>
  );
}

