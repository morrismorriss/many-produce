// Dashboard quick hub: a to-do list and the links you keep reaching for.
// Saved as hub/todos.csv and hub/links.csv in the vault.
import { useMemo, useRef, useState } from "react";
import { filterLinks, groupLinks, hostOf, sortTodos } from "../lib/hub";
import type { HubLink, HubTodo } from "../lib/types";
import { fmtDate, uid } from "../lib/util";
import { useApp, useStore } from "../store";
import { Field, Modal, ProjectTag } from "./bits";
import { openExternal, safeExternalUrl } from "./Support";

export function QuickHub() {
  return (
    <section className="card hub" aria-label="Quick hub">
      <TodoPanel />
      <LinksPanel />
    </section>
  );
}

function TodoPanel() {
  const { data, project, today, saveTodos, toast } = useApp();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // With a project picked, show its to-dos plus the general ones.
  const mine = useMemo(() => sortTodos(data.todos.filter((t) => !project || !t.project || t.project === project)), [data.todos, project]);
  const open = mine.filter((t) => !t.done);
  const done = mine.filter((t) => t.done);

  const latest = () => useStore.getState().data.todos;
  const update = (t: HubTodo) => void saveTodos(latest().map((x) => (x.id === t.id ? t : x)));

  const add = () => {
    const s = text.trim();
    if (!s) return;
    void saveTodos([...latest(), { id: uid("td"), text: s, done: false, project, due, created: today, done_date: "" }]);
    setText("");
    setDue("");
    inputRef.current?.focus();
  };
  const remove = (t: HubTodo) => {
    void saveTodos(latest().filter((x) => x.id !== t.id));
    toast(`"${t.text}" removed`, () => void saveTodos([...latest(), t]));
  };
  const clearDone = () => {
    const ids = new Set(done.map((t) => t.id));
    const removed = latest().filter((x) => ids.has(x.id));
    void saveTodos(latest().filter((x) => !ids.has(x.id)));
    toast(`Cleared ${removed.length} done`, () => void saveTodos([...latest(), ...removed]));
  };

  const row = (t: HubTodo) => (
    <li key={t.id} className={t.done ? "done" : ""}>
      <input
        type="checkbox"
        aria-label={`Done: ${t.text}`}
        checked={t.done}
        onChange={(e) => update({ ...t, done: e.target.checked, done_date: e.target.checked ? today : "" })}
      />
      {editing === t.id ? (
        <input
          className="input hub-edit"
          autoFocus
          defaultValue={t.text}
          aria-label="Edit to-do"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.text) update({ ...t, text: v }); setEditing(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <span className="hub-text" onDoubleClick={() => setEditing(t.id)} title="Double-click to edit">{t.text}</span>
      )}
      {t.due && !t.done && <span className={`pill ${t.due < today ? "red" : t.due === today ? "amber" : ""}`}>{t.due === today ? "Today" : fmtDate(t.due)}</span>}
      {!project && t.project && <ProjectTag slug={t.project} />}
      <button className="icon-btn" aria-label={`Edit ${t.text}`} title="Edit" onClick={() => setEditing(t.id)}>✎</button>
      <button className="icon-btn" aria-label={`Delete ${t.text}`} title="Delete" onClick={() => remove(t)}>×</button>
    </li>
  );

  return (
    <div className="hub-panel">
      <div className="card-head">
        <h2>To do</h2>
        <span className="muted small">{open.length ? `${open.length} open` : "All done"}</span>
      </div>
      <form className="hub-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do…" aria-label="New to-do" />
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date (optional)" title="Due date (optional)" />
        <button className="btn primary small" type="submit" disabled={!text.trim()}>Add</button>
      </form>
      {open.length ? <ul className="hub-list">{open.map(row)}</ul> : <p className="muted small">Nothing on the list. Add something above.</p>}
      {done.length > 0 && (
        <div className="hub-foot">
          <button className="btn ghost small" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          <div className="spacer" />
          <button className="btn ghost small" onClick={clearDone}>Clear done</button>
        </div>
      )}
      {showDone && done.length > 0 && <ul className="hub-list">{done.map(row)}</ul>}
    </div>
  );
}

function LinksPanel() {
  const { data, saveLinks, toast } = useApp();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<HubLink | null>(null);
  const [err, setErr] = useState("");

  const shown = useMemo(() => filterLinks(data.links, q), [data.links, q]);
  const groups = useMemo(() => groupLinks(shown), [shown]);
  const latest = () => useStore.getState().data.links;

  const go = (l: HubLink) => openExternal(l.url).catch((e) => toast(String(e instanceof Error ? e.message : e)));
  const remove = (l: HubLink) => {
    void saveLinks(latest().filter((x) => x.id !== l.id));
    toast(`"${l.title || hostOf(l.url)}" removed`, () => void saveLinks([...latest(), l]));
  };

  return (
    <div className="hub-panel">
      <div className="card-head">
        <h2>Links</h2>
        <span className="muted small">{data.links.length || "None yet"}</span>
        <div className="spacer" />
        <button className="btn small" onClick={() => { setErr(""); setEdit({ id: "", title: "", url: "", group: "", notes: "" }); }}>+ Add link</button>
      </div>
      {data.links.length > 0 && (
        <div className="search" style={{ flex: "none", marginBottom: 10 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9.5 9.5 13 13" stroke="currentColor" strokeWidth="1.5" /></svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) void go(shown[0]); if (e.key === "Escape") setQ(""); }}
            placeholder="Find a link… (Enter opens the first)"
            aria-label="Find a link"
          />
        </div>
      )}
      {!data.links.length && <p className="muted small">Keep the sites you use all the time here: Canva, your fundraising page, the shared drive, ticketing.</p>}
      {data.links.length > 0 && !shown.length && <p className="muted small">No links match “{q}”.</p>}
      {groups.map((g) => (
        <div key={g.group || "_"} className="hub-group">
          {(g.group || groups.length > 1) && <h3>{g.group || "Other"}</h3>}
          <ul className="hub-list">
            {g.links.map((l) => (
              <li key={l.id}>
                <button className="hub-link" onClick={() => void go(l)} title={l.notes ? `${l.url}\n${l.notes}` : l.url}>
                  <span className="hub-text">{l.title || hostOf(l.url)}</span>
                  <span className="muted small">{hostOf(l.url)}</span>
                  <span aria-hidden className="muted">↗</span>
                </button>
                <button className="icon-btn" aria-label={`Edit ${l.title}`} title="Edit" onClick={() => { setErr(""); setEdit(l); }}>✎</button>
                <button className="icon-btn" aria-label={`Delete ${l.title}`} title="Delete" onClick={() => remove(l)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {edit && (
        <LinkModal
          link={edit}
          err={err}
          groups={[...new Set(data.links.map((l) => l.group.trim()).filter(Boolean))]}
          onClose={() => setEdit(null)}
          onSave={(l) => {
            const url = safeExternalUrl(l.url);
            if (!url) { setErr("Enter a web address (https://…) or an email (mailto:…)."); return; }
            const next = { ...l, url, title: l.title.trim() || hostOf(url), group: l.group.trim(), id: l.id || uid("ln") };
            void saveLinks(l.id ? latest().map((x) => (x.id === l.id ? next : x)) : [...latest(), next]);
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function LinkModal({ link, groups, err, onClose, onSave }: { link: HubLink; groups: string[]; err: string; onClose: () => void; onSave: (l: HubLink) => void }) {
  const [l, setL] = useState(link);
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") onSave(l); };
  return (
    <Modal title={link.id ? "Edit link" : "Add a link"} onClose={onClose}>
      <div className="form-grid">
        <Field label="Address" wide><input autoFocus value={l.url} onChange={(e) => setL({ ...l, url: e.target.value })} onKeyDown={enter} placeholder="canva.com/design/…" /></Field>
        <Field label="Name"><input value={l.title} onChange={(e) => setL({ ...l, title: e.target.value })} onKeyDown={enter} placeholder="Poster in Canva" /></Field>
        <Field label="Group">
          <input value={l.group} list="hub-groups" onChange={(e) => setL({ ...l, group: e.target.value })} onKeyDown={enter} placeholder="Design, Fundraising…" />
          <datalist id="hub-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Notes" wide><input value={l.notes} onChange={(e) => setL({ ...l, notes: e.target.value })} onKeyDown={enter} placeholder="Login is in the shared password manager" /></Field>
      </div>
      {err && <p className="neg small">{err}</p>}
      <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(l)} disabled={!l.url.trim()}>Save</button>
      </div>
    </Modal>
  );
}
