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
  importFile?(source: string, dest: string): Promise<void>;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openDesktopVault(root: string): Promise<VaultFS> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("vault_open", { path: root });
  return {
    kind: "desktop",
    root,
    read: (path) => invoke<string | null>("vault_read", { path }),
    write: (path, contents) => invoke<void>("vault_write", { path, contents }),
    list: (path) => invoke<DirEntry[]>("vault_list", { path }),
    trash: (path) => invoke<string>("vault_trash", { path }),
    importFile: (source, dest) => invoke<void>("vault_import_file", { source, dest }),
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
