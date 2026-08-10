/**
 * Obsidian note extractor (M1).
 *
 * Runs on the desktop client. It never sends raw note bodies to the server.
 * Server-side validation re-runs the same checks because the server MUST
 * refuse any payload that violates the privacy contract.
 *
 * Contract: see ../specs/ai-direct-hiring-obsidian-sync.md.
 */
import { createHash } from "node:crypto";

export const EXTRACTOR_VERSION = "2026-08-01";
export const DEFAULT_EVIDENCE_VERSION = "2026-08-01";
export const MAX_SUMMARY_RATIO = 0.2;
export const MAX_BATCH_BYTES = 1024 * 1024;
export const NOTE_PATH_MAX = 1024;
export const NOTE_HASH_ALGO = "sha256";

/** Frontmatter fields that are explicitly allowed to be uploaded. */
export const FRONTMATTER_ALLOWED_FIELDS = [
  "title",
  "tags",
  "created",
  "modified",
  "aliases",
] as const;
export type FrontmatterAllowedField = (typeof FRONTMATTER_ALLOWED_FIELDS)[number];

const SENSITIVE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "mobile_cn", regex: /\b1[3-9]\d{9}\b/g },
  { name: "id_card_cn", regex: /\b\d{17}[\dXx]\b/g },
  { name: "bank_card", regex: /\b\d{16,19}\b/g },
  {
    name: "secret_prefix",
    regex: /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/g,
  },
  { name: "email", regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
];

export type NotePointer = {
  path: string;
  mtime: string | null;
  size: number;
  hash: string;
  tags: string[];
  links: string[];
};

export type NoteSummary = {
  path: string;
  title: string | null;
  summary_md: string;
  top_headings: string[];
  summaryBytes: number;
};

export type ExtractError =
  | { code: "PATH_TOO_LONG"; path: string }
  | { code: "PATH_NOT_MARKDOWN"; path: string }
  | { code: "SUMMARY_TOO_LONG"; path: string; summaryBytes: number; sourceBytes: number }
  | { code: "SENSITIVE_CONTENT"; path: string }
  | { code: "EMPTY_NOTE"; path: string };

export type ExtractResult =
  | { ok: true; pointer: NotePointer; summary: NoteSummary }
  | { ok: false; error: ExtractError };

export interface RawNote {
  /** Vault-relative POSIX path ending with .md */
  path: string;
  /** Last modified ISO timestamp */
  mtime?: string | null;
  /** File size in bytes */
  size?: number;
  /** Raw note body (UTF-8) */
  body: string;
}

export interface ParseFrontmatterResult {
  allowed: Partial<Record<FrontmatterAllowedField, unknown>>;
  extras: string[];
}

/** Parse a YAML-ish frontmatter block. Narrow on purpose. */
export function parseFrontmatter(source: string): ParseFrontmatterResult {
  const allowed: Partial<Record<FrontmatterAllowedField, unknown>> = {};
  const extras: string[] = [];

  if (!source.startsWith("---")) return { allowed, extras };
  const closing = source.indexOf("\n---", 3);
  if (closing < 0) return { allowed, extras };
  const block = source.slice(3, closing).trim();
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    if ((FRONTMATTER_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      allowed[key as FrontmatterAllowedField] = coerceFrontmatterValue(rawValue);
    } else {
      extras.push(key);
    }
  }
  return { allowed, extras };
}

function coerceFrontmatterValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [] as string[];
    return inner.split(",").map((part) => stripYamlQuotes(part.trim()));
  }
  return stripYamlQuotes(raw);
}

function stripYamlQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Extract a sanitized summary capped at MAX_SUMMARY_RATIO of the source body, in UTF-8 bytes. */
export function extractSummary(
  body: string,
  sourceBytes: number,
): { summary_md: string; top_headings: string[]; summaryBytes: number } {
  const { bodyWithoutFrontmatter, headings } = stripFrontmatterAndHeadings(body);
  const limit = Math.max(1, Math.floor(sourceBytes * MAX_SUMMARY_RATIO));
  const text = bodyWithoutFrontmatter.trim();
  const fallback = text.length === 0;
  const trimmed = trimToByteLimit(text, limit);
  const summary = fallback ? EMPTY_SUMMARY_PLACEHOLDER : trimmed;
  return {
    summary_md: summary,
    top_headings: headings.slice(0, 6),
    summaryBytes: Buffer.byteLength(summary, "utf8"),
  };
}

function trimToByteLimit(text: string, limit: number): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    const chunk = Buffer.byteLength(ch, "utf8");
    if (bytes + chunk > limit) break;
    out += ch;
    bytes += chunk;
  }
  return out;
}

const EMPTY_SUMMARY_PLACEHOLDER = "(empty)";

function stripFrontmatterAndHeadings(body: string): {
  bodyWithoutFrontmatter: string;
  headings: string[];
} {
  const lines = body.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    if (i < lines.length) i++;
  }
  const headings: string[] = [];
  const bodyLines: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      headings.push(heading[1].trim());
    } else {
      bodyLines.push(line);
    }
  }
  return { bodyWithoutFrontmatter: bodyLines.join("\n"), headings };
}

/** Pull wiki links and inline tags. Tags are #word (no whitespace). */
export function extractTagsAndLinks(body: string): { tags: string[]; links: string[] } {
  const wikiLinks = Array.from(body.matchAll(/\[\[([^\]\n]+?)\]\]/g)).map((match) =>
    match[1].split("|")[0].trim(),
  );
  const inlineTags = Array.from(body.matchAll(/(?:^|[\s>])(#[\w/.-]+)/g)).map((match) =>
    match[1].slice(1),
  );
  const dedupe = (values: string[]) =>
    Array.from(new Set(values.filter((value) => value.length > 0 && value.length < 256)));
  return { tags: dedupe(inlineTags), links: dedupe(wikiLinks) };
}

/** Returns null if the body is fine, otherwise the first failing pattern name. */
export function detectSensitiveContent(text: string): string | null {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(text)) return pattern.name;
  }
  return null;
}

/** Single note pipeline. Server-side validation mirrors this. */
export function extractNote(note: RawNote): ExtractResult {
  if (note.path.length > NOTE_PATH_MAX) {
    return { ok: false, error: { code: "PATH_TOO_LONG", path: note.path } };
  }
  if (!note.path.endsWith(".md")) {
    return { ok: false, error: { code: "PATH_NOT_MARKDOWN", path: note.path } };
  }
  if (note.body.trim().length === 0) {
    return { ok: false, error: { code: "EMPTY_NOTE", path: note.path } };
  }

  const sourceBytes = Buffer.byteLength(note.body, "utf8");

  const sensitive = detectSensitiveContent(note.body);
  if (sensitive) {
    return { ok: false, error: { code: "SENSITIVE_CONTENT", path: note.path } };
  }

  const { summary_md, top_headings, summaryBytes } = extractSummary(note.body, sourceBytes);
  if (summaryBytes > Math.floor(sourceBytes * MAX_SUMMARY_RATIO) + 1) {
    return {
      ok: false,
      error: {
        code: "SUMMARY_TOO_LONG",
        path: note.path,
        summaryBytes,
        sourceBytes,
      },
    };
  }

  const { allowed: fmAllowed } = parseFrontmatter(note.body);
  const { tags, links } = extractTagsAndLinks(note.body);
  const hash = computeNoteHash(note.path, note.body);

  const pointer: NotePointer = {
    path: note.path,
    mtime: note.mtime ?? null,
    size: note.size ?? sourceBytes,
    hash,
    tags,
    links,
  };
  const summary: NoteSummary = {
    path: note.path,
    title: typeof fmAllowed.title === "string" ? fmAllowed.title.slice(0, 512) : null,
    summary_md,
    top_headings,
    summaryBytes,
  };
  return { ok: true, pointer, summary };
}

export function computeNoteHash(path: string, body: string): string {
  return createHash(NOTE_HASH_ALGO).update(path).update("\u0000").update(body).digest("hex");
}

export type BatchResult = {
  pointers: NotePointer[];
  summaries: NoteSummary[];
  errors: ExtractError[];
  totalBytes: number;
};

export function extractBatch(notes: RawNote[]): BatchResult {
  const pointers: NotePointer[] = [];
  const summaries: NoteSummary[] = [];
  const errors: ExtractError[] = [];
  let totalBytes = 0;

  for (const note of notes) {
    const result = extractNote(note);
    if (result.ok) {
      pointers.push(result.pointer);
      summaries.push(result.summary);
      totalBytes += result.summary.summaryBytes;
    } else {
      errors.push(result.error);
    }
    if (totalBytes > MAX_BATCH_BYTES) break;
  }
  return { pointers, summaries, errors, totalBytes };
}
