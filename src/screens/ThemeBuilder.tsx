import { useMemo, useState } from "react";
import { Field, Modal } from "../components/bits";
import { COLOR_KEYS, COLOR_LABEL, FONTS, checkTheme, fixAll, isHex, slug, themeVars, type ColorKey, type Theme } from "../lib/themes";

/** The builder: controls on the left, a live preview of a real screen on the right, contrast checks below. */
export function ThemeBuilder({ start, onClose, onSave }: { start: Theme; onClose: () => void; onSave: (t: Theme, use: boolean) => void }) {
  const [t, setT] = useState<Theme>(start);
  const checks = useMemo(() => checkTheme(t), [t]);
  const failing = checks.filter((c) => !c.pass);
  const setColor = (k: ColorKey, v: string) => setT((x) => ({ ...x, colors: { ...x.colors, [k]: v } }));
  const setTag = (i: number, v: string) => setT((x) => ({ ...x, tags: x.tags.map((c, k) => (k === i ? v : c)) }));
  const applyFix = (key: string, value: string) => (key.startsWith("tag") ? setTag(Number(key.slice(3)), value) : setColor(key as ColorKey, value));
  // React wants camelCase for the one non-variable property.
  const { "color-scheme": scheme, ...cssVars } = themeVars(t);
  const vars = { ...cssVars, colorScheme: scheme } as React.CSSProperties;
  const valid = t.name.trim() && COLOR_KEYS.every((k) => isHex(t.colors[k]));

  const save = (use: boolean) => onSave({ ...t, name: t.name.trim(), id: t.id || slug(t.name) }, use);

  return (
    <Modal title="Theme builder" onClose={onClose} wide>
      <div className="tb-layout">
        <div className="tb-controls">
          <Field label="Name"><input autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="My theme" /></Field>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>Colors</div>
            <div className="tb-colors">
              {COLOR_KEYS.map((k) => <ColorInput key={k} label={COLOR_LABEL[k]} value={t.colors[k]} onChange={(v) => setColor(k, v)} />)}
            </div>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input type="checkbox" checked={t.dark} onChange={(e) => setT({ ...t, dark: e.target.checked })} /> This is a dark theme (for form controls and scrollbars)
            </label>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>Project tag colors</div>
            <div className="chips" style={{ gap: 6 }}>
              {t.tags.map((c, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <input type="color" aria-label={`Tag color ${i + 1}`} value={isHex(c) ? (c.length === 4 ? c : c.slice(0, 7)) : "#000000"} onChange={(e) => setTag(i, e.target.value)} style={{ width: 28, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 6 }} />
                  {t.tags.length > 2 && <button className="icon-btn" aria-label={`Remove tag color ${i + 1}`} onClick={() => setT({ ...t, tags: t.tags.filter((_, k) => k !== i) })}>×</button>}
                </span>
              ))}
              {t.tags.length < 12 && <button className="btn small ghost" onClick={() => setT({ ...t, tags: [...t.tags, t.colors.secondary] })}>+ Color</button>}
            </div>
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Field label="Heading font"><select value={t.fonts.heading} onChange={(e) => setT({ ...t, fonts: { ...t.fonts, heading: e.target.value } })}>{FONTS.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}</select></Field>
            <Field label="Body font"><select value={t.fonts.body} onChange={(e) => setT({ ...t, fonts: { ...t.fonts, body: e.target.value } })}>{FONTS.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}</select></Field>
            <Field label={`Text size (${t.size}px)`}><input type="range" min={12} max={18} step={1} value={t.size} onChange={(e) => setT({ ...t, size: Number(e.target.value) })} /></Field>
            <Field label={`Corners (${t.radius}px)`}><input type="range" min={0} max={18} step={1} value={t.radius} onChange={(e) => setT({ ...t, radius: Number(e.target.value) })} /></Field>
            <Field label="Density">
              <div className="seg" role="group" aria-label="Density">
                <button aria-pressed={t.density === "comfortable"} onClick={() => setT({ ...t, density: "comfortable" })}>Comfortable</button>
                <button aria-pressed={t.density === "compact"} onClick={() => setT({ ...t, density: "compact" })}>Compact</button>
              </div>
            </Field>
          </div>
          <p className="small muted">All fonts are bundled, so they work offline.</p>
        </div>

        <div>
          <Preview t={t} vars={vars} />
          <div style={{ marginTop: 12 }}>
            <div className="section-title">
              <h3>Contrast check</h3>
              {failing.length ? <span className="pill red">{failing.length} to fix</span> : <span className="pill green">Everything is readable</span>}
              {failing.length > 0 && <button className="btn small" onClick={() => setT((x) => fixAll(x))}>Fix all</button>}
            </div>
            <p className="small muted" style={{ margin: "0 0 6px" }}>Text needs at least a 4.5:1 contrast ratio to be readable, wherever it sits. &quot;Use&quot; picks the nearest shade that passes.</p>
            <ul className="tb-checks">
              {checks.map((c, i) => (
                <li key={i}>
                  <span className="tb-swatch" style={{ background: c.bg }}><span style={{ display: "block", width: 6, height: 6, margin: 3, borderRadius: 2, background: c.fg }} /></span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span className={`num ${c.pass ? "muted" : "neg"}`}>{c.ratio.toFixed(2)}:1</span>
                  {c.pass ? <span className="pill green">OK</span> : (
                    <>
                      <span className="pill red">Below {c.min}:1</span>
                      {c.fix && <button className="btn small" onClick={() => applyFix(c.fix!.key, c.fix!.value)} title="The nearest shade that passes">Use <span className="tb-swatch" style={{ display: "inline-block", verticalAlign: "middle", background: c.fix.value }} /> {c.fix.value}</button>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <span className="small muted">{failing.length ? "You can save a theme that fails a check, but some text will be hard to read." : ""}</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid} onClick={() => save(false)}>Save</button>
        <button className="btn primary" disabled={!valid} onClick={() => save(true)}>Save and use</button>
      </div>
    </Modal>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const shown = text.toLowerCase() === value.toLowerCase() ? text : value;
  return (
    <label className="tb-color">
      <input type="color" aria-label={label} value={isHex(value) && value.length === 7 ? value : "#000000"} onChange={(e) => { onChange(e.target.value); setText(e.target.value); }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <input type="text" aria-label={`${label} hex`} value={shown} onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) onChange(e.target.value.length === 4 ? "#" + e.target.value.slice(1).split("").map((c) => c + c).join("") : e.target.value); }} />
      </span>
    </label>
  );
}

/** A small, real-looking Dashboard drawn with the theme being built. */
function Preview({ t, vars }: { t: Theme; vars: React.CSSProperties }) {
  return (
    <div className="tb-preview" style={vars} data-density={t.density} aria-label="Theme preview">
      <div className="pv-top">
        <h1 style={{ fontFamily: "var(--font-head)", fontSize: "1.45em", margin: 0 }}>Dashboard</h1>
        <span className="pill" style={{ background: t.tags[0] + "33" }}><span className="dot" style={{ background: t.tags[0] }} />Prodigy</span>
        <span style={{ flex: 1 }} />
        <button className="btn">Export</button>
        <button className="btn primary">+ Expense</button>
        <button className="btn blue">+ Income</button>
      </div>
      <div className="pv-body">
        <div className="pv-side">
          <span className="on">Dashboard</span><span>Contacts</span><span>Bookkeeping</span><span>Paperwork</span><span>Schedule</span>
          <span style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Projects</span>
          {t.tags.slice(0, 4).map((c, i) => <span key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{["Prodigy", "Made Men", "Night Shift", "Overhead"][i]}</span>)}
        </div>
        <div className="pv-main">
          <div className="tiles" style={{ marginBottom: 0 }}>
            <div className="tile"><div className="label">Cash on hand</div><div className="value">$2,292</div></div>
            <div className="tile"><div className="label">Income raised</div><div className="value in">$1,772</div><div className="sub">of $12,902 goal</div></div>
            <div className="tile alert"><div className="label">Payments overdue</div><div className="value">1</div></div>
          </div>
          <div className="card">
            <div className="card-head"><h2 style={{ fontFamily: "var(--font-head)" }}>Needs attention</h2></div>
            <ul className="attn">
              <li><span className="pill red">Overdue</span><span>Director, installment 2 of 3 · $500</span></li>
              <li><span className="pill amber">No W-9</span><span>Jun Park has been paid</span></li>
              <li><span className="pill green">Signed</span><span>Uptown Studio Theatre rental</span></li>
              <li><span className="pill blue">Scheduled</span><span className="muted">Venue deposit · due Jan 5</span></li>
            </ul>
          </div>
          <table className="t">
            <thead><tr><th>Date</th><th>Description</th><th>Project</th><th className="r">Amount</th></tr></thead>
            <tbody>
              <tr><td className="muted">Nov 21</td><td>Venue deposit</td><td><span className="tag"><span className="dot" style={{ background: t.tags[0] }} />Prodigy</span></td><td className="r num">−$300.00</td></tr>
              <tr><td className="muted">Nov 14</td><td>Reading sponsor gift</td><td><span className="tag"><span className="dot" style={{ background: t.tags[1] }} />Made Men</span></td><td className="r num in">+$400.00</td></tr>
            </tbody>
          </table>
          <div className="chips"><button className="chip" aria-pressed="true">All entries</button><button className="chip">Income</button><button className="chip">Expenses</button><a href="#preview" onClick={(e) => e.preventDefault()}>A link</a></div>
        </div>
      </div>
    </div>
  );
}
