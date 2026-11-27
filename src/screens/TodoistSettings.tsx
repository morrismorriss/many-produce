import { useEffect, useState } from "react";
import { Field } from "../components/bits";
import { desktopApi, listAll } from "../lib/todoist";
import type { TodoistSettings as TS } from "../lib/types";
import { useApp } from "../store";

const TOGGLES: { key: keyof TS["sync"]; label: string }[] = [
  { key: "hub", label: "Dashboard to-do list (general to-dos go to Company overhead)" },
  { key: "timeline", label: "Timeline tasks you own" },
  { key: "payments", label: "Payment due dates" },
  { key: "paperwork", label: "Paperwork follow-ups (send contract, chase signature, request W-9)" },
  { key: "shopping", label: "Shopping items you're buying" },
  { key: "campaigns", label: "Campaign dates" },
  { key: "house_reports", label: "Missing house reports" },
];

export function TodoistSettings() {
  const { data, fs, saveSettings, syncTodoist, todoistTurnOff, toast } = useApp();
  const t = data.settings.todoist;
  const desktop = fs.kind === "desktop";
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (patch: Partial<TS>) => void saveSettings({ ...data.settings, todoist: { ...t, ...patch } });

  useEffect(() => {
    if (!desktop) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<boolean>("todoist_has_token").then(setHasToken));
  }, [desktop]);

  const saveToken = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("todoist_set_token", { token });
      setToken("");
      setHasToken(true);
      toast("Token saved in your keychain");
    } catch (e) {
      toast(`Couldn't save the token: ${String(e)}`);
    }
  };
  const removeToken = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("todoist_clear_token");
    setHasToken(false);
    save({ enabled: false });
  };
  const loadProjects = async () => {
    setBusy(true);
    try {
      setProjects(await listAll<{ id: string; name: string }>(await desktopApi(), "/api/v1/projects"));
    } catch (e) {
      toast(`Couldn't reach Todoist: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const newProject = async () => {
    const name = prompt("Name of the new Todoist project", "Many Produce")?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const p = (await (await desktopApi()).request("POST", "/api/v1/projects", { name })) as { id: string; name: string };
      setProjects([...(projects ?? []), p]);
      save({ target_project_id: p.id, target_name: p.name });
    } catch (e) {
      toast(`Couldn't create the project: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const one = t.mode === "one";
  const ready = !one || !!t.target_project_id;
  const moveNote = t.enabled ? " Tasks already in Todoist move there on the next sync." : "";
  const projectPicker = (value: string, onPick: (id: string, name: string) => void, emptyLabel: string, current: string) =>
    projects ? (
      <select value={value} onChange={(e) => onPick(e.target.value, projects.find((p) => p.id === e.target.value)?.name ?? "")}>
        <option value="">{emptyLabel}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    ) : (
      <button className="btn small" disabled={busy} onClick={() => void loadProjects()}>{current ? `${current} (change…)` : "Choose a Todoist project…"}</button>
    );

  return (
    <section className="card">
      <div className="card-head"><h2>Todoist</h2>{t.enabled && <span className="pill green">Syncing</span>}</div>
      <p className="small muted">
        Optional. Many Produce keeps the full plan; Todoist holds your own to-dos. Tasks go into a Todoist project you pick, with a section for each show, or each show can get its own Todoist project. It syncs when the app opens and every 15 minutes. Edits you make in the app win; finishing a task in Todoist marks it done here (a payment is only marked paid after you confirm the amount). Tasks owned by other collaborators stay in the app.
      </p>
      {!desktop ? (
        <p className="note small">Todoist sync works in the desktop app, where your token is kept in the operating system&apos;s keychain.</p>
      ) : (
        <>
          <div className="form-grid">
            {hasToken ? (
              <div className="field wide">
                <span>API token</span>
                <div className="toolbar" style={{ margin: 0 }}><span className="pill green">Saved in your keychain</span><button className="btn small" onClick={() => void removeToken()}>Remove token</button></div>
              </div>
            ) : (
              <Field label="Personal API token (Todoist → Settings → Integrations → Developer)" wide>
                <div className="toolbar" style={{ margin: 0 }}>
                  <input className="input" style={{ flex: 1 }} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
                  <button className="btn primary small" disabled={!token.trim()} onClick={() => void saveToken()}>Save to keychain</button>
                </div>
              </Field>
            )}
          </div>
          {hasToken && (
            <>
              <fieldset className="todoist-where">
                <legend className="muted small">Where tasks go</legend>
                <label className="small">
                  <input type="radio" name="todoist-mode" checked={one} onChange={() => { save({ mode: "one" }); if (t.enabled) toast(`Tasks will go into one project.${moveNote}`); }} />
                  One Todoist project I pick, with a section for each show
                </label>
                {one && (
                  <div className="toolbar" style={{ margin: "4px 0 8px 22px" }}>
                    {projectPicker(t.target_project_id, (id, name) => { save({ target_project_id: id, target_name: name }); if (t.enabled && id) toast(`Tasks will go into ${name}.${moveNote}`); }, "Choose…", t.target_name)}
                    <button className="btn ghost small" disabled={busy} onClick={() => void newProject()}>+ New project</button>
                  </div>
                )}
                <label className="small">
                  <input type="radio" name="todoist-mode" checked={!one} onChange={() => { save({ mode: "per-project" }); if (t.enabled) toast(`Each show will get its own project.${moveNote}`); }} />
                  A new Todoist project for each show, with sections for To do, Payments, Paperwork, Timeline, Shopping, Campaigns and Reports
                </label>
                {!one && (
                  <div className="toolbar" style={{ margin: "4px 0 0 22px" }}>
                    <span className="small muted">Inside</span>
                    {projectPicker(t.parent_project_id, (id, name) => save({ parent_project_id: id, parent_name: name }), "Top level", t.parent_name || "Top level")}
                  </div>
                )}
              </fieldset>
              <div style={{ marginTop: 10 }}>
                <div className="muted small" style={{ marginBottom: 4 }}>What syncs</div>
                {TOGGLES.map((x) => (
                  <label key={x.key} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={t.sync[x.key]} onChange={(e) => save({ sync: { ...t.sync, [x.key]: e.target.checked } })} />
                    {x.label}
                  </label>
                ))}
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                {!t.enabled ? (
                  <>
                    <button className="btn primary" disabled={!ready} onClick={() => { save({ enabled: true }); setTimeout(() => void syncTodoist(true), 50); }}>Turn on sync</button>
                    {!ready && <span className="small muted">Choose a Todoist project first.</span>}
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => void syncTodoist(true)}>Sync now</button>
                    <button className="btn" onClick={() => { if (confirm("Turn off Todoist sync? Tasks already in Todoist stay there.")) void todoistTurnOff(false); }}>Turn off</button>
                    <button className="btn danger" onClick={() => { if (confirm("Turn off sync and delete the tasks Many Produce created in Todoist?")) void todoistTurnOff(true); }}>Turn off and delete its tasks</button>
                  </>
                )}
                <span className="small muted">{t.last_sync ? `Last synced ${new Date(t.last_sync).toLocaleString()}` : "Not synced yet"}</span>
              </div>
              {t.last_error && <p className="note small">{t.last_error}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
