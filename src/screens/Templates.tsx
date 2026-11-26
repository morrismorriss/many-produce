import { useEffect, useState } from "react";
import { Empty, Field, Modal, Plus } from "../components/bits";
import { Header } from "../components/Shell";
import { draftValues, fillTemplate, templateFields } from "../lib/paperwork";
import type { Template } from "../lib/types";
import { slugify, uniqueSlug } from "../lib/util";
import { useApp } from "../store";
import { CampaignModal, blankCampaign } from "./Campaigns";
import type { Campaign } from "../lib/types";

const GROUP_ORDER = ["Ask letters", "Donation calls to action", "Thank-yous & requests", "Agreements"];

export function Templates() {
  const { data, newItemSignal } = useApp();
  const [sel, setSel] = useState(data.templates.find((t) => !t.doc_type)?.slug ?? data.templates[0]?.slug ?? "");
  const [editing, setEditing] = useState<Template | null>(null);
  useEffect(() => { if (newItemSignal) setEditing(blank()); }, [newItemSignal]);
  const groups = [...new Set([...GROUP_ORDER, ...data.templates.map((t) => t.group)])].filter((g) => data.templates.some((t) => t.group === g));
  const t = data.templates.find((x) => x.slug === sel);

  return (
    <>
      <Header title="Templates" actions={<button className="btn primary" onClick={() => setEditing(blank())}><Plus /> Template</button>} />
      <div className="content">
        <div className="tpl-layout">
          <nav className="tpl-list" aria-label="Templates">
            {groups.map((g) => (
              <div key={g}>
                <div className="switcher-label">{g}</div>
                {data.templates.filter((x) => x.group === g).sort((a, b) => a.title.localeCompare(b.title)).map((x) => (
                  <button key={x.slug} className="proj-btn" aria-pressed={x.slug === sel} onClick={() => setSel(x.slug)}>
                    <span>
                      <span className="t">{x.title}</span>
                      {x.solicitation && <span className="s">Needs sponsor review</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {t ? <Preview t={t} onEdit={() => setEditing(t)} /> : <Empty title="No templates yet" />}
        </div>
      </div>
      {editing && <TemplateModal t={editing} onClose={(slug) => { setEditing(null); if (slug) setSel(slug); }} />}
    </>
  );
}

function blank(): Template {
  return { slug: "", title: "", group: "Ask letters", doc_type: "", subject: "", solicitation: false, body: "Hi [First name],\n\n\n\n[Producer]" };
}

/** Field chips: square-bracket fields rendered as chips, everything else as text. */
function WithChips({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]{1,40}\])/g);
  return <>{parts.map((p, i) => (/^\[.*\]$/.test(p) ? <span key={i} className="field-chip">{p.slice(1, -1)}</span> : <span key={i}>{p}</span>))}</>;
}

function Preview({ t, onEdit }: { t: Template; onEdit: () => void }) {
  const { data, project, fs, toast, setScreen, saveTemplate, deleteTemplate } = useApp();
  const [filling, setFilling] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const fields = templateFields(`${t.subject}\n${t.body}`);
  const p = data.projects.find((x) => x.slug === project);
  const sponsor = data.sponsors.find((s) => s.slug === p?.fiscal_sponsor);
  return (
    <section className="card tpl-preview" aria-label={t.title}>
      <div className="card-head">
        <h2>{t.title}</h2>
        {t.solicitation && <span className="pill amber" title="Some fiscal sponsors (Fractured Atlas, for example) require approval of written solicitations.">Needs fiscal sponsor review</span>}
        {t.doc_type && <span className="pill">Makes a {t.doc_type}</span>}
      </div>
      {fields.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }} aria-label="Fill-in fields">
          {fields.map((f) => <span key={f} className="field-chip">{f}</span>)}
        </div>
      )}
      {t.subject && <p><span className="muted small">Subject: </span><WithChips text={t.subject} /></p>}
      <div className="tpl-body"><WithChips text={t.body} /></div>
      {t.solicitation && sponsor?.review_required_for.includes("solicitations") && (
        <p className="note small" style={{ marginTop: 10 }}>{p?.name} is sponsored by {sponsor.name}, which reviews written solicitations. Send it to them before it goes out.</p>
      )}
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={() => setFilling(true)}>Fill for a contact</button>
        <button className="btn" onClick={() => void navigator.clipboard.writeText(`${t.subject ? `${t.subject}\n\n` : ""}${t.body}`).then(() => toast("Template copied"))}>Copy</button>
        <button className="btn" onClick={onEdit}>Edit</button>
        {fs.openFile && <button className="btn" title="Opens the .md file in your default markdown app (Many Write, if it's set as the default)" onClick={() => void fs.openFile!(`templates/${t.slug}.md`).catch((e) => toast(`Couldn't open: ${String(e)}`))}>Edit in Many Write</button>}
        {!t.doc_type && <button className="btn" onClick={() => setCampaign(blankCampaign(project || data.projects.find((x) => !x.builtin)?.slug || "overhead", { title: t.title, template: t.slug, type: /cta|ask|speech/i.test(t.slug + t.group) ? "Fundraising" : "Marketing", body: `${t.subject ? `Subject: ${t.subject}\n\n` : ""}${t.body}` }))}>Add to Campaigns</button>}
        {t.doc_type && <button className="btn" onClick={() => setScreen("paperwork")}>Draft in Paperwork</button>}
        <div className="spacer" />
        <button className="btn ghost small" onClick={() => { const slug = uniqueSlug(`${t.slug}-copy`, data.templates.map((x) => x.slug)); void saveTemplate({ ...t, slug, title: `${t.title} (copy)` }); }}>Duplicate</button>
        <button className="btn ghost small danger" onClick={() => void deleteTemplate(t.slug)}>Delete</button>
      </div>
      <p className="small muted">Saved as <code>templates/{t.slug}.md</code>. Fields use square brackets in plain markdown, so the template stays readable in any editor.</p>
      {filling && <FillModal t={t} onClose={() => setFilling(false)} />}
      {campaign && <CampaignModal campaign={campaign} onClose={() => setCampaign(null)} />}
    </section>
  );
}

function FillModal({ t, onClose }: { t: Template; onClose: () => void }) {
  const { data, project, today, toast } = useApp();
  const [person, setPerson] = useState("");
  const [proj, setProj] = useState(project || data.projects.find((p) => !p.builtin)?.slug || "");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const pObj = data.people.find((p) => p.slug === person);
  const base = draftValues({ producer: data.settings.producer_name, company: data.settings.company_name, today, project: data.projects.find((p) => p.slug === proj), person: pObj });
  const fields = templateFields(`${t.subject}\n${t.body}`);
  const values = { ...base, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };
  const missing = fields.filter((f) => !Object.entries(values).some(([k, v]) => k.toLowerCase() === f.toLowerCase() && v));
  const subject = fillTemplate(t.subject, values);
  const body = fillTemplate(t.body, values);
  const mailto = pObj?.email ? `mailto:${encodeURIComponent(pObj.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "";
  return (
    <Modal title={`Fill: ${t.title}`} onClose={onClose}>
      <div className="form-grid">
        <Field label="Contact">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Someone not in Collaborators</option>
            {data.people.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select value={proj} onChange={(e) => setProj(e.target.value)}>{data.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
        </Field>
        {[...new Set([...missing, ...Object.keys(extra)])].map((f) => (
          <Field key={f} label={f}><input value={extra[f] ?? ""} onChange={(e) => setExtra({ ...extra, [f]: e.target.value })} /></Field>
        ))}
      </div>
      {subject && <p><span className="muted small">Subject: </span>{subject}</p>}
      <pre className="draft-preview" style={{ maxHeight: 320 }}>{body}</pre>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={() => void navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body).then(() => toast("Copied. Paste it into an email or post."))}>Copy</button>
        {mailto && <a className="btn primary" href={mailto}>Open in email</a>}
      </div>
    </Modal>
  );
}

function TemplateModal({ t, onClose }: { t: Template; onClose: (slug?: string) => void }) {
  const { data, saveTemplate } = useApp();
  const [x, setX] = useState(t);
  const groups = [...new Set([...GROUP_ORDER, ...data.templates.map((y) => y.group)])];
  const save = async () => {
    if (!x.title.trim()) return;
    const slug = x.slug || uniqueSlug(slugify(x.title), data.templates.map((y) => y.slug));
    await saveTemplate({ ...x, slug, title: x.title.trim() });
    onClose(slug);
  };
  return (
    <Modal title={t.slug ? `Edit ${t.title}` : "New template"} onClose={() => onClose()}>
      <div className="form-grid">
        <Field label="Title"><input autoFocus value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} /></Field>
        <Field label="Group">
          <input list="mp-tpl-groups" value={x.group} onChange={(e) => setX({ ...x, group: e.target.value })} />
          <datalist id="mp-tpl-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Subject line (optional)" wide><input value={x.subject} onChange={(e) => setX({ ...x, subject: e.target.value })} /></Field>
        <label className="small wide"><input type="checkbox" checked={x.solicitation} onChange={(e) => setX({ ...x, solicitation: e.target.checked })} /> This asks for money (needs fiscal sponsor review)</label>
        <Field label="Body: use [First name], [Project], [Amount], [Link], [Producer]…" wide>
          <textarea style={{ minHeight: 260, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={x.body} onChange={(e) => setX({ ...x, body: e.target.value })} />
        </Field>
      </div>
      <div className="toolbar"><div className="spacer" /><button className="btn" onClick={() => onClose()}>Cancel</button><button className="btn primary" disabled={!x.title.trim()} onClick={save}>Save</button></div>
    </Modal>
  );
}
