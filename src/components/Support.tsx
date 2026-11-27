// "Buy me a coffee": a link in the sidebar, and a pop-up that asks now and then.
// The pop-up first shows after a few launches, never more than once per launch;
// "Maybe later" waits a couple of months, and "Don't ask again" means it.
import { useEffect, useState } from "react";
import { isTauri } from "../lib/fs";
import { addDays, todayISO } from "../lib/util";
import { Modal } from "./bits";

export const SUPPORT_URL = "https://buymeacoffee.com/morriss";

const KEY = "many-produce:support";
const FIRST_AFTER_LAUNCHES = 5;
const SNOOZE_DAYS = 60;

export interface SupportState {
  launches: number;
  next: string; // don't ask before this date ("" = when launches allow)
  never: boolean;
}

function readState(): SupportState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { launches: Number(s.launches) || 0, next: typeof s.next === "string" ? s.next : "", never: !!s.never };
  } catch {
    return { launches: 0, next: "", never: false };
  }
}
function writeState(s: SupportState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: just ask again next time */ }
}

/** Whether to show the pop-up on this launch. Pure, for tests. */
export function shouldAsk(s: SupportState, today: string): boolean {
  if (s.never) return false;
  if (s.launches < FIRST_AFTER_LAUNCHES) return false;
  return !s.next || today >= s.next;
}

/**
 * A link that's safe to hand to the browser or mail app: http(s) or mailto only
 * ("www.example.com" gets https:// added). Anything else (javascript:, file:…) is null.
 */
export function safeExternalUrl(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[^\s/]+\.[^\s/]+/.test(s) ? `https://${s}` : s;
  try {
    const u = new URL(withScheme);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Open a web page in the user's browser (desktop) or a new tab. */
export async function openExternal(url: string) {
  const safe = safeExternalUrl(url);
  if (!safe) throw new Error("Only web and email links can be opened.");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url: safe });
  } else if (safe.startsWith("mailto:")) {
    window.location.href = safe;
  } else {
    window.open(safe, "_blank", "noopener,noreferrer");
  }
}

export function CoffeeLink() {
  return (
    <button className="coffee-link" onClick={() => void openExternal(SUPPORT_URL)} title={SUPPORT_URL}>
      <span aria-hidden>☕</span> Buy me a coffee
    </button>
  );
}

/** Mount once per open vault. */
export function SupportPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const s = readState();
    const next = { ...s, launches: s.launches + 1 };
    writeState(next);
    if (!shouldAsk(next, todayISO())) return;
    // Let the app settle first, so it doesn't greet you with a pop-up.
    const t = setTimeout(() => setOpen(true), 20000);
    return () => clearTimeout(t);
  }, []);
  if (!open) return null;

  const close = (never: boolean) => {
    writeState({ ...readState(), next: addDays(todayISO(), SNOOZE_DAYS), never });
    setOpen(false);
  };
  return (
    <Modal title="Enjoying Many Produce?" onClose={() => close(false)}>
      <p>Many Produce is free, with no accounts, ads or subscriptions, and it&apos;s made by one person. If it&apos;s saving you time on your productions, you can say thanks with a coffee.</p>
      <div className="toolbar">
        <button className="btn" onClick={() => close(true)}>Don&apos;t ask again</button>
        <div className="spacer" />
        <button className="btn" onClick={() => close(false)}>Maybe later</button>
        <button className="btn primary" onClick={() => { void openExternal(SUPPORT_URL); close(true); }}><span aria-hidden>☕</span> Buy me a coffee</button>
      </div>
    </Modal>
  );
}
