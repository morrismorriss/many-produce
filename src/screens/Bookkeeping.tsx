import { useEffect, useMemo, useState } from "react";
import { earnedIncomeNote, isAutoFee, signedShare, totals } from "../lib/ledger";
import { DIRECT_SOURCE, FISCAL_TAG, type Alloc, type EntryKind, type LedgerEntry } from "../lib/types";
import { allocTouches, allocValid, fmtDate, round2, single, uid } from "../lib/util";
import { useApp } from "../store";
import { AllocTags, Chips, Empty, Field, Plus, Tile, saveTextFile } from "../components/bits";
import { Header, MoneyTabs } from "../components/Shell";
import { ledgerToCSV } from "../lib/ledger";

type Filter = "All entries" | "Income" | "Expenses";

export function Bookkeeping() {
  const { data, project, money, openDrawer, newItemSignal } = useApp();
  const [form, setForm] = useState<EntryKind | null>(null);
  const [filter, setFilter] = useState<Filter>("All entries");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (newItemSignal) setForm("expense");
  }, [newItemSignal]);

  const t = totals(data.ledger, project);
  const rows = useMemo(
    () =>
      data.ledger
        .filter((e) => allocTouches(e.project_alloc, project))
        .filter((e) => filter === "All entries" || (filter === "Income" ? e.kind === "income" : e.kind === "expense"))
        .filter((e) => !category || e.category === category)
        .filter((e) => !tag || e.tags.includes(tag))
        .filter((e) => !source || e.source === source)
        .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [data.ledger, project, filter, category, tag, source, from, to],
  );
  const cats = [...new Set([...data.settings.expense_categories, ...data.settings.income_categories])];
  const sources = [...new Set([...data.settings.money_sources.map((s) => s.name), ...data.ledger.map((e) => e.source).filter(Boolean)])];

  return (
    <>
      <Header
        title="Bookkeeping"
        actions={
          <>
            <button className="btn blue" onClick={() => setForm("income")}>
              <Plus /> Income
            </button>
            <button className="btn primary" onClick={() => setForm("expense")}>
              <Plus /> Expense
            </button>
          </>
        }
      />
      <div className="content">
        <MoneyTabs />
        <div className="tiles">
          <Tile label="Money in" value={<span className="in">{money(t.moneyIn)}</span>} />
          <Tile label="Money out" value={money(t.moneyOut)} />
          <Tile label="Net" value={<span className={t.net < 0 ? "neg" : ""}>{money(t.net)}</span>} />
          <Tile label="Sponsor fees" value={money(t.sponsorFees)} sub="Added automatically" />
        </div>

        {form && <EntryForm kind={form} onDone={() => setForm(null)} />}

        <div className="toolbar">
          <Chips label="Entry type" options={["All entries", "Income", "Expenses"] as const} value={filter} onChange={setFilter} />
          <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input" aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {data.settings.tags.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input" aria-label="Money source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All money sources</option>
            {sources.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">to</span>
          <input className="input" type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="spacer" />
          <button className="btn small" onClick={() => saveTextFile(`ledger-${project || "all"}.csv`, ledgerToCSV(rows), "text/csv")}>
            Export CSV
          </button>
        </div>

        {rows.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Project</th>
                <th>Category</th>
                <th>Money from / to</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const v = signedShare(e, project);
                return (
                  <tr key={e.id} className="clickable" onClick={() => openDrawer({ kind: "entry", id: e.id })}>
                    <td className="num muted">{fmtDate(e.date)}</td>
                    <td>
                      <div>{e.description || <span className="muted">(no description)</span>}</div>
                      <div className="chips" style={{ gap: 4, marginTop: 3 }}>
                        {e.tags.map((x) => <span key={x} className="tag">{x}</span>)}
                        {isAutoFee(e) && <span className="tag">Added automatically</span>}
                        {e.counterparty && <span className="muted small">{e.kind === "income" ? "from" : "to"} {e.counterparty}</span>}
                      </div>
                    </td>
                    <td><AllocTags alloc={e.project_alloc} /></td>
                    <td>{e.category}</td>
                    <td className="muted">{e.source}</td>
                    <td className={`r num ${e.kind === "income" ? "in" : ""}`}>
                      {money(v, { sign: true, cents: true })}
                      {project && (e.project_alloc[project] ?? 1) < 1 && <div className="muted small">of {money(e.amount, { cents: true })}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty title={data.ledger.length ? "No entries match these filters" : "No entries yet"}>
            <p>Every dollar in and out goes here. Start with <strong>+ Income</strong> or <strong>+ Expense</strong>.</p>
          </Empty>
        )}
      </div>
    </>
  );
}

/** Inline entry form for new entries, and the editor inside the drawer. */
export function EntryForm({ kind: initialKind, existing, onDone }: { kind?: EntryKind; existing?: LedgerEntry; onDone: () => void }) {
  const { data, project, today, saveEntry, people, venues } = useEntryData();
  const defaultProject = project || data.projects.find((p) => !p.builtin)?.slug || "overhead";
  const [e, setE] = useState<LedgerEntry>(
    existing ?? {
      id: uid("e"),
      date: today,
      kind: initialKind ?? "expense",
      amount: 0,
      description: "",
      project_alloc: single(defaultProject),
      category: "",
      source: "",
      counterparty: "",
      tags: [],
      receipt: "",
      restricted_to: "",
      linked_payment: "",
      linked_shopping_item: "",
      notes: "",
    },
  );
  const [amountText, setAmountText] = useState(existing ? String(existing.amount) : "");
  const [split, setSplit] = useState(Object.keys(e.project_alloc).length > 1);
  const set = <K extends keyof LedgerEntry>(k: K, v: LedgerEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const cats = e.kind === "income" ? data.settings.income_categories : data.settings.expense_categories;
  const sources = [...new Set([...data.settings.money_sources.map((s) => s.name), DIRECT_SOURCE, "Venmo/Zelle"])];
  const amount = Number(amountText);
  const allocOk = allocValid(e.project_alloc);
  const valid = amount > 0 && e.date && allocOk;
  const note = earnedIncomeNote(e);
  const firstProj = data.projects.find((p) => p.slug === Object.keys(e.project_alloc)[0]);
  const sponsor = firstProj?.fiscal_sponsor ? data.sponsors.find((s) => s.slug === firstProj.fiscal_sponsor) : undefined;

  // Changing type resets category if it isn't valid for the new type.
  const setKind = (k: EntryKind) => setE((x) => ({ ...x, kind: k, category: (k === "income" ? data.settings.income_categories : data.settings.expense_categories).includes(x.category) ? x.category : "" }));

  // Project default: when the project has a fiscal sponsor, new contributed income goes through it.
  useEffect(() => {
    if (existing || e.kind !== "income" || !sponsor) return;
    if (e.category === "Ticket sales") {
      setE((x) => ({ ...x, source: x.source || DIRECT_SOURCE, tags: x.tags.filter((t) => t !== FISCAL_TAG) }));
    } else if (["Donations", "Grants", "Fundraiser"].includes(e.category) && !e.tags.includes(FISCAL_TAG)) {
      const fund = data.settings.money_sources.find((s) => s.sponsor === sponsor.slug)?.name;
      setE((x) => ({ ...x, tags: [...x.tags, FISCAL_TAG], source: x.source || fund || "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.category, e.kind]);

  const submit = async () => {
    if (!valid) return;
    await saveEntry({ ...e, amount: round2(amount), category: e.category || "Other" });
    onDone();
  };

  const counterpartyOptions = [...people.map((p) => p.name), ...venues.map((v) => v.name)];

  return (
    <div className="card" style={{ marginBottom: 16 }} onKeyDown={(ev) => { if (ev.key === "Escape") onDone(); if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) void submit(); }}>
      <div className="card-head">
        <div className="seg" role="group" aria-label="Entry type">
          <button className="in" aria-pressed={e.kind === "income"} onClick={() => setKind("income")}>Income</button>
          <button className="out" aria-pressed={e.kind === "expense"} onClick={() => setKind("expense")}>Expense</button>
        </div>
        <h2>{existing ? "Edit entry" : e.kind === "income" ? "New income" : "New expense"}</h2>
        {existing && isAutoFee(existing) && <span className="pill amber">Added automatically</span>}
      </div>
      <div className="form-grid">
        <Field label="Date">
          <input type="date" value={e.date} onChange={(x) => set("date", x.target.value)} />
        </Field>
        <Field label="Amount">
          <input autoFocus={!existing} inputMode="decimal" placeholder="0.00" value={amountText} onChange={(x) => setAmountText(x.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field label="Description" wide>
          <input value={e.description} onChange={(x) => set("description", x.target.value)} placeholder={e.kind === "income" ? "Crowdfunding payout" : "Rehearsal room"} />
        </Field>
        <Field label="Project">
          <select
            value={split ? "__split" : Object.keys(e.project_alloc)[0]}
            onChange={(x) => {
              if (x.target.value === "__split") {
                setSplit(true);
              } else {
                setSplit(false);
                set("project_alloc", single(x.target.value));
              }
            }}
          >
            {data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            <option value="__split">Split between projects…</option>
          </select>
        </Field>
        <Field label="Category">
          <select value={e.category} onChange={(x) => set("category", x.target.value)}>
            <option value="">Choose…</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={e.kind === "income" ? "Deposited to" : "Paid from"}>
          <input list="mp-sources" value={e.source} onChange={(x) => set("source", x.target.value)} />
          <datalist id="mp-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label={e.kind === "income" ? "From" : "Paid to"}>
          <input list="mp-counterparties" value={e.counterparty} onChange={(x) => set("counterparty", x.target.value)} />
          <datalist id="mp-counterparties">{counterpartyOptions.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        {split && (
          <div className="wide">
            <SplitEditor alloc={e.project_alloc} onChange={(a) => set("project_alloc", a)} />
          </div>
        )}
        <div className="wide">
          <div className="muted small" style={{ marginBottom: 4 }}>Tags</div>
          <div className="chips">
            {data.settings.tags.map((t) => (
              <button key={t} className="chip" aria-pressed={e.tags.includes(t)} onClick={() => set("tags", e.tags.includes(t) ? e.tags.filter((x) => x !== t) : [...e.tags, t])}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {e.tags.includes("Restricted") && (
          <Field label="Restricted to" wide>
            <input value={e.restricted_to} onChange={(x) => set("restricted_to", x.target.value)} placeholder="What this money can be spent on" />
          </Field>
        )}
        <Field label="Receipt (file in ledger/receipts/)" wide>
          <ReceiptPicker value={e.receipt} date={e.date} description={e.description} onChange={(r) => setE((x) => ({ ...x, receipt: r, tags: r && !x.tags.includes("Has receipt") ? [...x.tags, "Has receipt"] : x.tags }))} />
        </Field>
        {!isAutoFee(e) && (
          <Field label="Notes" wide>
            <input value={e.notes} onChange={(x) => set("notes", x.target.value)} />
          </Field>
        )}
      </div>
      {e.kind === "income" && e.tags.includes(FISCAL_TAG) && amount > 0 && (
        <p className="note info" style={{ marginTop: 10 }}>
          A matching sponsor fee expense will be added automatically{sponsor ? ` (${sponsor.name}, ${+((firstProj?.sponsor_fee_rate ?? sponsor.fee_rate) * 100).toFixed(2)}%)` : ""}.
          {!sponsor && " This project has no fiscal sponsor set, so no fee will be added."}
        </p>
      )}
      {note && <p className="note" style={{ marginTop: 10 }}>{note}</p>}
      <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
        {split && !allocOk && <span className="neg small">Split percentages must add up to 100%.</span>}
        <div className="spacer" />
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className={`btn ${e.kind === "income" ? "blue" : "primary"}`} disabled={!valid} onClick={submit}>Save</button>
      </div>
    </div>
  );
}

function useEntryData() {
  const a = useApp();
  return { ...a, people: a.data.people, venues: a.data.venues };
}

export function SplitEditor({ alloc, onChange }: { alloc: Alloc; onChange: (a: Alloc) => void }) {
  const { data } = useApp();
  const entries = Object.entries(alloc);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const unused = data.projects.filter((p) => !(p.slug in alloc));
  return (
    <div className="card" style={{ background: "var(--surface)" }}>
      <div className="muted small" style={{ marginBottom: 6 }}>Split between projects (total {Math.round(total * 100)}%)</div>
      {entries.map(([slug, share]) => (
        <div key={slug} className="toolbar" style={{ marginBottom: 6 }}>
          <span style={{ minWidth: 160 }}>{data.projects.find((p) => p.slug === slug)?.name ?? slug}</span>
          <input
            className="input"
            style={{ width: 80 }}
            type="number"
            aria-label={`Percent for ${slug}`}
            value={+(share * 100).toFixed(2)}
            onChange={(x) => onChange({ ...alloc, [slug]: Number(x.target.value) / 100 })}
          />
          <span>%</span>
          {entries.length > 1 && (
            <button className="btn ghost small" onClick={() => { const n = { ...alloc }; delete n[slug]; onChange(n); }}>Remove</button>
          )}
        </div>
      ))}
      {unused.length > 0 && (
        <select className="input" value="" aria-label="Add a project to the split" onChange={(x) => x.target.value && onChange({ ...alloc, [x.target.value]: Math.max(0, round2(1 - total)) })}>
          <option value="">+ Add project…</option>
          {unused.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}

function ReceiptPicker({ value, date, description, onChange }: { value: string; date: string; description: string; onChange: (path: string) => void }) {
  const { fs, toast } = useApp();
  const pick = async () => {
    if (fs.kind === "desktop" && fs.importFile) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const src = await open({ multiple: false, filters: [{ name: "Receipts", extensions: ["pdf", "png", "jpg", "jpeg", "heic", "webp"] }] });
      if (typeof src !== "string") return;
      const ext = src.split(".").pop() ?? "pdf";
      const base = `${date}-${(description || "receipt").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
      const dest = `ledger/receipts/${base}.${ext}`;
      await fs.importFile(src, dest);
      onChange(dest);
    } else {
      toast("Attaching receipts needs the desktop app. In the browser demo you can type a file name.");
    }
  };
  return (
    <div className="toolbar" style={{ margin: 0 }}>
      <input className="input" style={{ flex: 1 }} value={value} onChange={(x) => onChange(x.target.value)} placeholder="No receipt attached" />
      <button className="btn small" onClick={pick}>Attach receipt</button>
    </div>
  );
}
