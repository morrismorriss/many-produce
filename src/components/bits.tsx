import { useEffect, useState, type ReactNode } from "react";
import type { Alloc } from "../lib/types";
import { useApp } from "../store";

export function ProjectTag({ slug, share }: { slug: string; share?: number }) {
  const { projectBySlug } = useApp();
  const p = projectBySlug(slug);
  return (
    <span className="tag">
      <span className="dot" style={{ background: p?.color ?? "#999" }} aria-hidden />
      {p?.name ?? slug}
      {share !== undefined && share < 1 ? ` ${Math.round(share * 100)}%` : ""}
    </span>
  );
}

export function AllocTags({ alloc }: { alloc: Alloc }) {
  return (
    <span className="chips" style={{ gap: 4 }}>
      {Object.entries(alloc).map(([s, v]) => (
        <ProjectTag key={s} slug={s} share={v} />
      ))}
    </span>
  );
}

export function Tile({ label, value, sub, alert }: { label: string; value: ReactNode; sub?: ReactNode; alert?: boolean }) {
  return (
    <div className={`tile${alert ? " alert" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} className="chip" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, blue }: { value: number; max: number; blue?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max + 0.005;
  return (
    <div className={`bar${blue ? " blue" : ""}${over ? " over" : ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={over ? "Over budget" : `${Math.round(pct)}%`}>
      <span style={{ width: `${over ? 100 : pct}%` }} />
    </div>
  );
}

export function Initials({ name, lg }: { name: string; lg?: boolean }) {
  const i = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span className={`avatar${lg ? " lg" : ""}`} aria-hidden>
      {i}
    </span>
  );
}

/**
 * Notion-like inline edit: click to edit, Enter (or blur) saves, Escape cancels.
 */
export function EditCell({
  value,
  onSave,
  type = "text",
  align,
  label,
  placeholder,
}: {
  value: string | number;
  onSave: (v: string) => void;
  type?: "text" | "number" | "date";
  align?: "r";
  label: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => setV(String(value ?? "")), [value]);
  const commit = () => {
    if (v !== String(value ?? "")) onSave(v);
  };
  return (
    <input
      className={`cell-edit${align ? " r" : ""}`}
      aria-label={label}
      type={type}
      value={v}
      placeholder={placeholder}
      step={type === "number" ? "any" : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(String(value ?? ""));
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const X = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Save a text file: desktop uses a save dialog; browser downloads. */
export async function saveTextFile(name: string, text: string, mime = "text/plain") {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({ defaultPath: name });
    if (path) await invoke("export_file", { path, contents: text });
    return;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save binary data (zip, PDF): desktop uses a save dialog; browser downloads. */
export async function saveBinaryFile(name: string, bytes: Uint8Array) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({ defaultPath: name });
    if (!path) return;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await invoke("export_file_base64", { path, data: btoa(bin) });
    return;
  }
  const blob = new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print an HTML fragment on its own page (the system dialog offers "Save as PDF"). */
export function printHtml(title: string, html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>
<style>
  @page { margin: 22mm 20mm; }
  body { font: 11.5pt/1.55 Georgia, "Times New Roman", serif; color: #111; }
  h1 { font: 700 18pt/1.2 "Helvetica Neue", Arial, sans-serif; margin: 0 0 14pt; }
  h2 { font: 700 12.5pt/1.3 "Helvetica Neue", Arial, sans-serif; margin: 16pt 0 6pt; }
  p { margin: 0 0 8pt; }
  .blank { letter-spacing: 0; }
</style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 200);
}
