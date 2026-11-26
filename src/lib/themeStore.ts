// Where custom themes are kept: the shared "Many Apps/themes" folder in the
// desktop app, or this browser's storage in the browser preview.
import { themeFromJSON, themeToJSON, type Theme } from "./themes";

const LS = "many-apps:themes";
const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function lsAll(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; }
}

export type StoredTheme = Theme & { source: "shared" | "many-write" };

/** Your themes from the shared folder, plus any made in Many Write. */
export async function listThemes(): Promise<StoredTheme[]> {
  let files: [string, string, string][];
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    files = await invoke<[string, string, string][]>("themes_list");
  } else files = Object.entries(lsAll()).map(([id, text]) => [id, text, "shared"]);
  const out: StoredTheme[] = [];
  const shared = new Set(files.filter((f) => f[2] === "shared").map((f) => f[0]));
  for (const [rawId, text, source] of files) {
    // Our own copies in Many Write's folder are named custom-<id>; skip those duplicates.
    if (source === "many-write" && shared.has(rawId.replace(/^custom-/, ""))) continue;
    const id = source === "many-write" ? `mw-${rawId.replace(/^custom-/, "")}` : rawId;
    try { out.push({ ...themeFromJSON(text, id), id, source: source as StoredTheme["source"] }); } catch { /* skip files that aren't themes */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTheme(t: Theme): Promise<void> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("theme_save", { name: t.id, contents: themeToJSON(t) });
  } else {
    try { localStorage.setItem(LS, JSON.stringify({ ...lsAll(), [t.id]: themeToJSON(t) })); } catch { /* storage blocked */ }
  }
}

export async function deleteTheme(id: string): Promise<void> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("theme_delete", { name: id });
  } else {
    const all = lsAll();
    delete all[id];
    try { localStorage.setItem(LS, JSON.stringify(all)); } catch { /* storage blocked */ }
  }
}

export async function themesFolder(): Promise<string> {
  if (!isDesktop()) return "this browser's storage (preview only)";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("themes_dir");
}
