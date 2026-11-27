import { useEffect, useState } from "react";
import type { VaultData } from "./lib/types";
import { Bookkeeping } from "./screens/Bookkeeping";
import { Budget } from "./screens/Budget";
import { Dashboard } from "./screens/Dashboard";
import { Paperwork } from "./screens/Paperwork";
import { Schedule } from "./screens/Schedule";
import { Shopping } from "./screens/Shopping";
import { Equipment } from "./screens/Equipment";
import { Campaigns } from "./screens/Campaigns";
import { Templates } from "./screens/Templates";
import { Reports } from "./screens/Reports";
import { Payments } from "./screens/Payments";
import { Collaborators, Venues } from "./screens/People";
import { Placeholder } from "./screens/Placeholder";
import { Settings } from "./screens/Settings";
import { useApp, useStore } from "./store";
import { Drawer } from "./components/Drawer";
import { CommandPalette, Sidebar, Toasts, sectionOf } from "./components/Shell";
import { SupportPrompt } from "./components/Support";
import { isTauri, MemoryFS, openDesktopVault, type VaultFS } from "./lib/fs";
import { sampleVault } from "./lib/seed";
import { loadVault } from "./lib/vault";
import { BUILTIN_THEMES, themeVars } from "./lib/themes";

const LAST_VAULT = "many-produce:last-vault";

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
}

export default function App() {
  const [vault, setVault] = useState<{ fs: VaultFS; data: VaultData } | null>(null);
  const [ready, setReady] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");

  const open = async (fs: VaultFS) => {
    try {
      const data = await loadVault(fs);
      useStore.getState().init(fs, data);
      setVault({ fs, data });
      setReady(true);
      if (fs.kind === "desktop") lsSet(LAST_VAULT, fs.root);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    (async () => {
      if (isTauri()) {
        const last = lsGet(LAST_VAULT);
        if (last) await open(await openDesktopVault(last)).catch(() => lsSet(LAST_VAULT, null));
      } else {
        const saved = MemoryFS.fromLocalStorage();
        if (saved) await open(saved);
      }
      setBooting(false);
    })();
  }, []);

  if (booting) return null;
  if (!vault || !ready) return <Welcome onOpen={open} error={error} />;
  return <Frame key={vault.fs.root} onSwitchVault={() => { lsSet(LAST_VAULT, null); vault.fs.close?.(); setReady(false); setVault(null); }} />;
}

function Welcome({ onOpen, error }: { onOpen: (fs: VaultFS) => void; error: string }) {
  const desktop = isTauri();
  const pickFolder = async (withSample: boolean) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: withSample ? "Choose an empty folder for the sample vault" : "Choose or create your Many Produce folder" });
    if (typeof dir !== "string") return;
    const fs = await openDesktopVault(dir);
    if (withSample) {
      const existing = await fs.list("");
      if (existing.length && !confirm("That folder isn't empty. Add sample files to it anyway?")) return;
      for (const [path, text] of Object.entries(sampleVault())) await fs.write(path, text);
    }
    onOpen(fs);
  };
  const browser = (withSample: boolean) => {
    const fs = new MemoryFS(withSample ? sampleVault() : {}, true);
    fs.enablePersist();
    onOpen(fs);
  };
  return (
    <div className="welcome">
      <img src="/icon.svg" alt="" />
      <h1 style={{ fontSize: 30 }}>Many Produce</h1>
      <p className="muted">Run a production in one place: the people, the spaces, the money. Everything lives in a folder on your computer as plain markdown and CSV files you own. No accounts, no cloud, no AI.</p>
      {desktop ? (
        <div className="toolbar" style={{ justifyContent: "center" }}>
          <button className="btn primary" onClick={() => pickFolder(false)}>Choose a vault folder…</button>
          <button className="btn" onClick={() => pickFolder(true)}>Try with sample data…</button>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => browser(true)}>Try with sample data</button>
            <button className="btn" onClick={() => browser(false)}>Start empty</button>
          </div>
          <p className="small muted">You&apos;re in the browser demo. Data stays in this browser only. The desktop app saves to a real folder.</p>
        </>
      )}
      {error && <p className="neg">{error}</p>}
    </div>
  );
}

function useTheme() {
  const { data } = useApp();
  const t = data.settings.theme;
  const custom = data.settings.custom_theme;
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { for (const k of Object.keys(themeVars(BUILTIN_THEMES[0]))) root.style.removeProperty(k); delete root.dataset.density; };
    const apply = () => {
      clear();
      if (t.startsWith("custom:") && custom) {
        root.dataset.theme = "custom";
        root.dataset.density = custom.density;
        for (const [k, v] of Object.entries(themeVars(custom))) root.style.setProperty(k, v);
        return;
      }
      const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = t === "system" ? (dark ? "dark" : "light") : t.startsWith("custom:") ? "light" : t;
    };
    apply();
    if (t !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [t, custom]);
}

function Frame({ onSwitchVault }: { onSwitchVault: () => void }) {
  const { screen, drawer, openDrawer, fireNewItem, fs, reload } = useApp();

  // Todoist: sync when the app opens and every 15 minutes while it's open.
  const todoistOn = useApp().data.settings.todoist.enabled;
  useEffect(() => {
    if (!todoistOn || fs.kind !== "desktop") return;
    const run = () => void useStore.getState().syncTodoist(false);
    const first = setTimeout(run, 3000);
    const every = setInterval(run, 15 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [todoistOn, fs]);

  // Pick up edits made in other apps straight away.
  useEffect(() => {
    if (!fs.watch) return;
    let un: (() => void) | undefined;
    void fs.watch(() => void reload(true)).then((u) => (un = u));
    return () => un?.();
  }, [fs, reload]);
  const [sidebar, setSidebar] = useState(true);
  const [palette, setPalette] = useState(false);
  useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k" || k === "f") { e.preventDefault(); setPalette(true); }
      else if (k === "n") { e.preventDefault(); fireNewItem(); }
      else if (k === "\\") { e.preventDefault(); setSidebar((s) => !s); }
      else if (k === ".") { e.preventDefault(); if (drawer) openDrawer(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, openDrawer, fireNewItem]);

  const phase = sectionOf(screen)?.phase;
  let body;
  if (phase) body = <Placeholder screen={screen} />;
  else if (screen === "dashboard") body = <Dashboard />;
  else if (screen === "bookkeeping") body = <Bookkeeping />;
  else if (screen === "budget") body = <Budget />;
  else if (screen === "payments") body = <Payments />;
  else if (screen === "collaborators") body = <Collaborators />;
  else if (screen === "venues") body = <Venues />;
  else if (screen === "paperwork") body = <Paperwork />;
  else if (screen === "schedule") body = <Schedule />;
  else if (screen === "shopping") body = <Shopping />;
  else if (screen === "inventory") body = <Equipment />;
  else if (screen === "campaigns") body = <Campaigns />;
  else if (screen === "templates") body = <Templates />;
  else if (screen === "reports") body = <Reports />;
  else body = <Settings onSwitchVault={onSwitchVault} />;

  return (
    <div className={`app${sidebar ? "" : " sidebar-hidden"}`}>
      <Sidebar />
      <main className="main">{body}</main>
      <Drawer />
      <Toasts />
      <SupportPrompt />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
