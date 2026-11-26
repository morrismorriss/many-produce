// Themes and the theme builder: color math, contrast checks and the JSON
// format shared with Many Write and Many Apply.

export const FONTS = [
  { id: "Inter", css: '"Inter", system-ui, sans-serif', kind: "Sans" },
  { id: "Space Grotesk", css: '"Space Grotesk", "Inter", system-ui, sans-serif', kind: "Sans" },
  { id: "IBM Plex Sans", css: '"IBM Plex Sans", "Inter", system-ui, sans-serif', kind: "Sans" },
  { id: "Atkinson Hyperlegible", css: '"Atkinson Hyperlegible", "Inter", system-ui, sans-serif', kind: "Sans, very legible" },
  { id: "Source Serif 4", css: '"Source Serif 4", Georgia, serif', kind: "Serif" },
  { id: "Fraunces", css: '"Fraunces", Georgia, serif', kind: "Serif display" },
] as const;

export const COLOR_KEYS = ["bg", "surface", "text", "muted", "primary", "secondary", "success", "warning", "danger"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABEL: Record<ColorKey, string> = {
  bg: "Background", surface: "Surface (cards, sidebar)", text: "Text", muted: "Muted text", primary: "Primary accent",
  secondary: "Secondary accent", success: "Success", warning: "Warning", danger: "Danger",
};

/** The theme file format (a small JSON file). */
export interface Theme {
  format: "many-theme";
  version: 1;
  id: string; // file name without .json
  name: string;
  dark: boolean;
  colors: Record<ColorKey, string>;
  tags: string[]; // project tag palette
  fonts: { heading: string; body: string };
  size: number; // base font size in px
  density: "comfortable" | "compact";
  radius: number; // corner roundness in px
}

const base = { format: "many-theme" as const, version: 1 as const, fonts: { heading: "Space Grotesk", body: "Inter" }, size: 14, density: "comfortable" as const, radius: 10 };

export const BUILTIN_THEMES: Theme[] = [
  { ...base, id: "light", name: "Light", dark: false, colors: { bg: "#ffffff", surface: "#fbf7f8", text: "#22202a", muted: "#6b6574", primary: "#d33871", secondary: "#2e7cb4", success: "#2e7d4f", warning: "#9a6200", danger: "#c2392f" }, tags: ["#EE8AAE", "#6FB3E0", "#F4A6A0", "#9B8AE0", "#6CC4A1", "#E8B04A", "#9AA3B2"] },
  { ...base, id: "dark", name: "Dark", dark: true, colors: { bg: "#17161c", surface: "#1f1e26", text: "#f1eef5", muted: "#a9a3b5", primary: "#f28bb3", secondary: "#79bde9", success: "#7fd3a0", warning: "#f2c063", danger: "#ff8a80" }, tags: ["#F28BB3", "#79BDE9", "#F4A6A0", "#B3A6F0", "#7FD3A0", "#F2C063", "#A9A3B5"] },
  { ...base, id: "pink", name: "Pink", dark: false, colors: { bg: "#fff5f8", surface: "#ffe9f0", text: "#3a1d2a", muted: "#7a5465", primary: "#c22f69", secondary: "#2c74a8", success: "#2a7248", warning: "#8a5800", danger: "#b3261e" }, tags: ["#EE8AAE", "#6FB3E0", "#F4A6A0", "#9B8AE0", "#6CC4A1", "#E8B04A", "#9AA3B2"] },
];

// ---- color math ----

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

export function isHex(s: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Mix two colors; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): string {
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}

/**
 * The nearest shade of `fg` (same hue and saturation, lightness nudged away
 * from the background) that reaches `min` contrast against `bg`.
 */
export function nearestPassing(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const [h, s, l] = toHsl(fg);
  const darker = luminance(bg) > 0.18;
  for (let i = 1; i <= 100; i++) {
    const nl = darker ? l - i / 100 : l + i / 100;
    if (nl < 0 || nl > 1) break;
    const c = fromHsl([h, s, nl]);
    if (contrast(c, bg) >= min) return c;
  }
  return darker ? "#000000" : "#ffffff";
}

// ---- checks ----

export interface ContrastCheck {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
  fix?: { key: ColorKey | `tag${number}`; value: string };
}

/** Project tags show as a tinted pill with text on it, like the project pill in the header. */
export const TAG_TINT = 0.2;

/** The nearest shade of a tag color that keeps text readable on its tinted pill. */
function nearestReadableTag(tag: string, text: string, bg: string): string {
  const [h, s, l] = toHsl(tag);
  // Moving the tag toward the background makes the tint lighter (or darker) and the text clearer.
  const towardBg = luminance(bg) > 0.18 ? 1 : -1;
  for (let i = 1; i <= 100; i++) {
    const nl = l + (towardBg * i) / 100;
    if (nl < 0 || nl > 1) break;
    const c = fromHsl([h, s, nl]);
    if (contrast(text, mix(bg, c, TAG_TINT)) >= 4.5) return c;
  }
  return tag;
}

/**
 * Text needs 4.5:1, wherever it sits: on the background, on surfaces, on
 * filled buttons, and on tinted project-tag pills.
 */
export function checkTheme(t: Theme): ContrastCheck[] {
  const c = t.colors;
  const rows: { label: string; key: ColorKey | `tag${number}`; fg: string; bg: string; min: number; fixFg?: boolean }[] = [
    { label: "Text on background", key: "text", fg: c.text, bg: c.bg, min: 4.5 },
    { label: "Text on surface", key: "text", fg: c.text, bg: c.surface, min: 4.5 },
    { label: "Muted text on background", key: "muted", fg: c.muted, bg: c.bg, min: 4.5 },
    { label: "Muted text on surface", key: "muted", fg: c.muted, bg: c.surface, min: 4.5 },
    { label: "Primary accent as text", key: "primary", fg: c.primary, bg: c.bg, min: 4.5 },
    { label: "Secondary accent as text", key: "secondary", fg: c.secondary, bg: c.bg, min: 4.5 },
    { label: "Danger text", key: "danger", fg: c.danger, bg: c.bg, min: 4.5 },
    { label: "Warning text", key: "warning", fg: c.warning, bg: c.bg, min: 4.5 },
    { label: "Success text", key: "success", fg: c.success, bg: c.bg, min: 4.5 },
  ];
  const out: ContrastCheck[] = rows.map((r) => {
    const ratio = contrast(r.fg, r.bg);
    const pass = ratio >= r.min;
    return { label: r.label, fg: r.fg, bg: r.bg, ratio, min: r.min, pass, fix: pass ? undefined : { key: r.key, value: nearestPassing(r.fg, r.bg, r.min) } };
  });
  // Text on each tinted project-tag pill.
  t.tags.forEach((tag, i) => {
    const bg = mix(c.bg, tag, TAG_TINT);
    const ratio = contrast(c.text, bg);
    const pass = ratio >= 4.5;
    out.push({ label: `Text on project tag ${i + 1}`, fg: c.text, bg, ratio, min: 4.5, pass, fix: pass ? undefined : { key: `tag${i}`, value: nearestReadableTag(tag, c.text, c.bg) } });
  });
  // Text on filled primary/secondary buttons: white or dark, whichever reads better.
  for (const key of ["primary", "secondary"] as const) {
    const fg = onColor(c[key]);
    const ratio = contrast(fg, c[key]);
    const pass = ratio >= 4.5;
    out.push({ label: `Text on ${key} buttons`, fg, bg: c[key], ratio, min: 4.5, pass, fix: pass ? undefined : { key, value: nearestPassing(c[key], fg, 4.5) } });
  }
  return out;
}

/** Text color for a filled accent: white, or near-black when that reads better. */
export function onColor(fill: string): string {
  return contrast("#ffffff", fill) >= contrast("#16141b", fill) ? "#ffffff" : "#16141b";
}

/** Apply every suggested fix, repeating until nothing fails (one fix can move another check). */
export function fixAll(t: Theme): Theme {
  let next = t;
  for (let round = 0; round < 6; round++) {
    const failing = checkTheme(next).filter((c) => !c.pass && c.fix);
    if (!failing.length) break;
    for (const f of failing) {
      const { key, value } = f.fix!;
      next = key.startsWith("tag")
        ? { ...next, tags: next.tags.map((c, i) => (i === Number(key.slice(3)) ? value : c)) }
        : { ...next, colors: { ...next.colors, [key]: value } };
    }
  }
  return next;
}

// ---- applying a theme ----

const fontCss = (id: string) => FONTS.find((f) => f.id === id)?.css ?? `"${id}", system-ui, sans-serif`;

/** CSS custom properties for a theme (the same names the stylesheet uses). */
export function themeVars(t: Theme): Record<string, string> {
  const c = t.colors;
  const soft = (x: string) => mix(c.bg, x, t.dark ? 0.22 : 0.13);
  return {
    "--bg": c.bg,
    "--surface": c.surface,
    "--surface-2": mix(c.surface, c.text, t.dark ? 0.08 : 0.05),
    "--border": mix(c.bg, c.text, t.dark ? 0.16 : 0.1),
    "--text": c.text,
    "--muted": c.muted,
    "--primary": c.primary,
    "--primary-soft": soft(c.primary),
    "--on-primary": onColor(c.primary),
    "--on-secondary": onColor(c.secondary),
    "--secondary": c.secondary,
    "--secondary-soft": soft(c.secondary),
    "--danger": c.danger,
    "--danger-soft": soft(c.danger),
    "--warning": c.warning,
    "--warning-soft": soft(c.warning),
    "--success": c.success,
    "--success-soft": soft(c.success),
    "--focus": c.secondary,
    "--shadow": t.dark ? "0 8px 30px rgba(0,0,0,0.4)" : "0 8px 30px rgba(40,20,30,0.1)",
    "--radius": `${t.radius}px`,
    "--font-ui": fontCss(t.fonts.body),
    "--font-head": fontCss(t.fonts.heading),
    "--fs": `${t.size}px`,
    "color-scheme": t.dark ? "dark" : "light",
  };
}

// ---- files ----

/**
 * The file also carries Many Write's colour names (background, sidebar,
 * accent) and its writing font, so Many Write can open the same file.
 */
export function themeToJSON(t: Theme): string {
  const serif = FONTS.find((f) => f.id === t.fonts.body)?.kind.startsWith("Serif");
  const file = {
    ...t,
    colors: { ...t.colors, background: t.colors.bg, sidebar: t.colors.surface, accent: t.colors.primary },
    writingFont: serif ? "serif" : "sans",
    previewMatchesTheme: false,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/** Read a theme file, filling gaps from the Light theme. Throws on files that aren't themes. */
export function themeFromJSON(text: string, fallbackId = ""): Theme {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || !raw.colors) throw new Error("That file isn't a theme.");
  const light = BUILTIN_THEMES[0];
  const rc = { ...raw.colors } as Record<string, unknown>;
  // Many Write's names (background, sidebar, accent) and Many Apply's (bg, sidebar, accent).
  const hex = (v: unknown) => (typeof v === "string" && isHex(v) ? v : undefined);
  rc.bg ??= hex(rc.background);
  rc.surface ??= hex(rc.sidebar);
  rc.primary ??= hex(rc.accent);
  const bgHex = hex(rc.bg) ?? light.colors.bg;
  const darkBg = luminance(bgHex) < 0.2;
  const basis = darkBg ? BUILTIN_THEMES[1] : light;
  const colors = { ...basis.colors };
  for (const k of COLOR_KEYS) if (hex(rc[k])) colors[k] = rc[k] as string;
  // A four-colour theme has no muted text of its own: mix it from text and background, as Many Write does.
  if (!hex(rc.muted) && hex(rc.text)) colors.muted = nearestPassing(mix(colors.text, colors.bg, 0.42), colors.bg, 4.5);
  return {
    format: "many-theme",
    version: 1,
    id: String(raw.id || fallbackId || slug(String(raw.name || "theme"))),
    name: String(raw.name || "Untitled theme"),
    dark: raw.dark === true || darkBg,
    colors,
    tags: Array.isArray(raw.tags) && raw.tags.every((x: unknown) => typeof x === "string" && isHex(x as string)) && raw.tags.length ? raw.tags : basis.tags,
    fonts: { heading: String(raw.fonts?.heading || basis.fonts.heading), body: String(raw.fonts?.body || basis.fonts.body) },
    size: Math.min(20, Math.max(12, Number(raw.size) || 14)),
    density: raw.density === "compact" ? "compact" : "comfortable",
    radius: Math.min(20, Math.max(0, Number(raw.radius ?? 10))),
  };
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme";
}
