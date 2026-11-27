// File access. In the desktop app this goes through the Rust commands in
// src-tauri/src/lib.rs (scoped to the vault). In a plain browser (dev, demo,
// tests) it uses an in-memory folder saved to localStorage.

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface VaultFS {
  readonly kind: "desktop" | "browser";
  readonly root: string;
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  list(dir: string): Promise<DirEntry[]>;
  trash(path: string): Promise<string>;
  /**
   * Let the user pick a file in a native dialog and copy it into the vault as
   * `<dir>/<base>.<ext>` (never overwriting). Returns the vault path, or null if cancelled.
   */
  importPick?(dir: string, base: string, title: string, extensions?: string[]): Promise<string | null>;
  /** Read any file (binary too) as base64. */
  readBase64?(path: string): Promise<string | null>;
  /** Open a vault file in the user's default app. */
  openFile?(path: string): Promise<void>;
  /** Call back (debounced) when files change outside the app. Returns an unsubscribe. */
  watch?(onChange: (paths: string[]) => void): Promise<() => void>;
  close?(): void;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Show the native folder picker (from the Rust side, which remembers the choice as an allowed vault). */
export async function pickVaultFolder(title: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("vault_pick", { title });
}

export async function openDesktopVault(root: string): Promise<VaultFS> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  await invoke("vault_open", { path: root });

  // Our own writes also fire watcher events; remember them so only outside
  // edits (Obsidian, a text editor, a sync client) trigger a reload.
  const ours = new Map<string, number>();
  const mark = (path: string) => ours.set(path, Date.now());
  const isOurs = (path: string) => {
    if (path.endsWith(".mp-tmp") || path.startsWith(".manyproduce/trash")) return true;
    const t = ours.get(path);
    return t !== undefined && Date.now() - t < 3000;
  };

  return {
    kind: "desktop",
    root,
    read: (path) => invoke<string | null>("vault_read", { path }),
    write: (path, contents) => { mark(path); return invoke<void>("vault_write", { path, contents }); },
    list: (path) => invoke<DirEntry[]>("vault_list", { path }),
    trash: (path) => { mark(path); return invoke<string>("vault_trash", { path }); },
    importPick: async (dir, base, title, extensions) => {
      const rel = await invoke<string | null>("vault_import_pick", { dir, base, title, extensions: extensions ?? null });
      if (rel) mark(rel);
      return rel;
    },
    readBase64: (path) => invoke<string | null>("vault_read_base64", { path }),
    openFile: (path) => invoke<void>("vault_open_file", { path }),
    watch: async (onChange) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending = new Set<string>();
      const un = await listen<string[]>("vault-changed", (e) => {
        for (const p of e.payload) if (!isOurs(p)) pending.add(p);
        if (!pending.size) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const list = [...pending];
          pending.clear();
          onChange(list);
        }, 300);
      });
      return () => { clearTimeout(timer); un(); };
    },
    close: () => void invoke("vault_close"),
  };
}

const LS_KEY = "many-produce:browser-vault";

export class MemoryFS implements VaultFS {
  readonly kind = "browser" as const;
  readonly root = "Browser demo vault";
  files: Map<string, string>;
  private persist: boolean;

  constructor(initial?: Record<string, string>, persist = false) {
    this.persist = persist;
    this.files = new Map(Object.entries(initial ?? {}));
  }

  static fromLocalStorage(): MemoryFS | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return new MemoryFS(JSON.parse(raw), true);
    } catch {
      return null;
    }
  }

  static clearLocalStorage() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }

  private save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(this.files)));
    } catch {
      /* storage full or blocked: stays in memory */
    }
  }

  enablePersist() {
    this.persist = true;
    this.save();
  }

  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, contents: string) {
    this.files.set(path, contents);
    this.save();
  }
  async list(dir: string) {
    const prefix = dir ? dir.replace(/\/$/, "") + "/" : "";
    const seen = new Map<string, boolean>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const [head, ...tail] = rest.split("/");
      if (!head) continue;
      seen.set(head, (seen.get(head) ?? false) || tail.length > 0);
    }
    return [...seen].map(([name, is_dir]) => ({ name, is_dir })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async trash(path: string) {
    const dest = `.manyproduce/trash/${Date.now()}-${path.replace(/\//g, "__")}`;
    let moved = false;
    for (const k of [...this.files.keys()]) {
      if (k === path || k.startsWith(path + "/")) {
        this.files.set(dest + k.slice(path.length), this.files.get(k)!);
        this.files.delete(k);
        moved = true;
      }
    }
    if (!moved) throw new Error(`Not found: ${path}`);
    this.save();
    return dest;
  }
}
