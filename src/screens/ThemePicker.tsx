import { useEffect, useState } from "react";
import { saveTextFile } from "../components/bits";
import { deleteTheme, listThemes, saveTheme, themesFolder, type StoredTheme } from "../lib/themeStore";
import { BUILTIN_THEMES, slug, themeFromJSON, themeToJSON, type Theme } from "../lib/themes";
import { useApp } from "../store";
import { ThemeBuilder } from "./ThemeBuilder";

/** Built-in themes, your own themes from the shared folder, and the builder. */
export function ThemePicker() {
  const { data, saveSettings, toast } = useApp();
  const s = data.settings;
  const [custom, setCustom] = useState<StoredTheme[]>([]);
  const [folder, setFolder] = useState("");
  const [building, setBuilding] = useState<Theme | null>(null);

  const refresh = () => void listThemes().then(setCustom);
  useEffect(() => {
    refresh();
    void themesFolder().then(setFolder);
  }, []);

  const activeId = s.theme.startsWith("custom:") ? s.theme.slice(7) : "";
  const use = (t: Theme) => void saveSettings({ ...s, theme: `custom:${t.id}`, custom_theme: t });
  const useBuiltin = (id: string) => void saveSettings({ ...s, theme: id as typeof s.theme });

  // The active theme may only exist as the copy in this vault (e.g. made on another computer).
  const all: StoredTheme[] = [...custom];
  if (s.custom_theme && activeId && !all.some((t) => t.id === activeId)) all.push({ ...s.custom_theme, source: "shared" });
  const fromMw = activeId.startsWith("mw-");

  const onSave = async (t: Theme, andUse: boolean) => {
    // Editing one of your themes overwrites it; a new theme never overwrites another.
    const editing = !!building?.id && custom.some((x) => x.id === building.id && x.source === "shared");
    let id = editing ? building!.id : slug(t.name);
    if (!editing) {
      const taken = new Set([...custom.map((x) => x.id), ...BUILTIN_THEMES.map((x) => x.id), "system"]);
      const base = id;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    }
    const theme = { ...t, id };
    await saveTheme(theme);
    refresh();
    if (andUse || activeId === id) use(theme);
    setBuilding(null);
    toast(`Saved "${theme.name}"`);
  };

  const importFile = async (f: File) => {
    try {
      const t = themeFromJSON(await f.text(), slug(f.name.replace(/\.json$/i, "")));
      setBuilding({ ...t, id: "" }); // open it in the builder to check, then save
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
    }
  };

  const startFrom = (t: Theme): Theme => ({ ...t, id: "", name: `${t.name} (my version)` });
  const current = s.theme.startsWith("custom:") ? s.custom_theme : BUILTIN_THEMES.find((t) => t.id === s.theme);

  return (
    <div>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {BUILTIN_THEMES.map((t) => <ThemeCard key={t.id} t={t} active={s.theme === t.id} onPick={() => useBuiltin(t.id)} />)}
        <button className={`theme-card${s.theme === "system" ? " active" : ""}`} role="radio" aria-checked={s.theme === "system"} onClick={() => useBuiltin("system")}>
          <span className="theme-sw" style={{ background: "linear-gradient(135deg, #ffffff 50%, #17161c 50%)" }} />
          <span className="theme-name">Follow system</span>
          <span className="small muted">Light or Dark</span>
        </button>
        {all.map((t) => <ThemeCard key={t.id} t={t} active={activeId === t.id} onPick={() => use(t)} label={t.source === "many-write" ? "From Many Write" : "Yours"} />)}
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="btn primary small" onClick={() => setBuilding(startFrom(current ?? BUILTIN_THEMES[0]))}>Build your own…</button>
        {activeId && s.custom_theme && (
          <>
            <button className="btn small" onClick={() => setBuilding(fromMw ? { ...s.custom_theme!, id: "", name: `${s.custom_theme!.name} (my version)` } : s.custom_theme!)}>{fromMw ? "Make my own version" : <>Edit &quot;{s.custom_theme.name}&quot;</>}</button>
            <button className="btn small" onClick={() => saveTextFile(`${s.custom_theme!.id}.json`, themeToJSON(s.custom_theme!), "application/json")}>Export</button>
            {!fromMw && <button className="btn small danger" onClick={async () => { if (!confirm(`Delete "${s.custom_theme!.name}" from the shared themes folder? Many Write and Many Apply won't see it either.`)) return; await deleteTheme(activeId); useBuiltin("light"); refresh(); }}>Delete</button>}
          </>
        )}
        <label className="btn small">
          Import a theme file…
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
        </label>
      </div>
      <p className="small muted">
        Your themes are small JSON files in a shared folder{folder ? <> (<code>{folder}</code>)</> : ""}. Themes you made in Many Write show up here, and themes saved here are copied to Many Write&apos;s themes folder so it can use them too. Export one to share it.
      </p>
      {building && <ThemeBuilder start={building} onClose={() => setBuilding(null)} onSave={(t, u) => void onSave(t, u)} />}
    </div>
  );
}

function ThemeCard({ t, active, onPick, label = "Built in" }: { t: Theme; active: boolean; onPick: () => void; label?: string }) {
  return (
    <button className={`theme-card${active ? " active" : ""}`} role="radio" aria-checked={active} onClick={onPick}>
      <span className="theme-sw" style={{ background: t.colors.bg, borderColor: t.colors.surface }}>
        <span style={{ background: t.colors.surface }} />
        <span style={{ background: t.colors.primary }} />
        <span style={{ background: t.colors.secondary }} />
        <span style={{ background: t.colors.text }} />
      </span>
      <span className="theme-name" style={{ fontFamily: `"${t.fonts.heading}", system-ui` }}>{t.name}</span>
      <span className="small muted">{label}</span>
    </button>
  );
}
