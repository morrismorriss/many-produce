// Plain-file formats: markdown with YAML frontmatter, and CSV.
import Papa from "papaparse";
import YAML from "yaml";

export interface Doc<T> {
  data: T;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter<T = Record<string, unknown>>(text: string): Doc<T> {
  const m = FM.exec(text);
  if (!m) return { data: {} as T, body: text };
  // Broken YAML throws (loadVault names the file) rather than reading as empty,
  // which could let a later save overwrite what's in it.
  let data: unknown = YAML.parse(m[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
  return { data: data as T, body: text.slice(m[0].length) };
}

export function stringifyFrontmatter(data: object, body = ""): string {
  // Drop undefined so YAML stays tidy.
  const clean = JSON.parse(JSON.stringify(data));
  const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
  const b = body.trim() ? `\n${body.trim()}\n` : "";
  return `---\n${yaml}\n---\n${b}`;
}

export function parseCSV(text: string): Record<string, string>[] {
  if (!text.trim()) return [];
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return res.data;
}

export function toCSV(columns: readonly string[], rows: Record<string, unknown>[]): string {
  return (
    Papa.unparse(
      { fields: [...columns], data: rows.map((r) => columns.map((c) => (r[c] ?? "") as string)) },
      { newline: "\n" },
    ) + "\n"
  );
}
