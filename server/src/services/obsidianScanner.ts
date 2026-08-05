/**
 * Obsidian vault scanner (M1).
 * Spec: specs/ai-direct-hiring-obsidian-sync.md
 *
 * Designed to be invoked from the desktop client's Electron main process.
 * The scanner:
 *   1. Walks the configured vault (bounded depth)
 *   2. Reuses the same extractor as the server
 *   3. Computes a SHA-256 vault fingerprint from the canonical path + a config hash
 *   4. Emits a submission payload that the client POSTs to /api/v1/memory/obsidian/sync
 *
 * The scanner's MEMORY model is intentionally bounded: it streams files in chunks
 * and never inlines the entire vault into memory.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  EXTRACTOR_VERSION,
  NotePointer,
  NoteSummary,
  RawNote,
  extractBatch,
} from "./obsidianExtract.js";

export const VAULT_SCAN_VERSION = "2026-08-01";

/** Compute the vault fingerprint exposed to the server. The vault path is NEVER uploaded. */
export function computeVaultFingerprint(vaultRootPath: string, configHash: string | null): string {
  const canonical = path.resolve(vaultRootPath).replace(/\\/g, "/").toLowerCase();
  return createHash("sha256")
    .update(canonical)
    .update("\u0000")
    .update(configHash ?? "_")
    .digest("hex");
}

/**
 * Yields markdown files under the vault root. Generator: never holds the full tree in memory.
 */
export async function* iterMarkdownFiles(
  root: string,
  options: { maxDepth?: number; ignoreDirs?: string[] } = {},
): AsyncGenerator<string> {
  const maxDepth = options.maxDepth ?? 8;
  const ignoreDirs = new Set([
    ".git",
    ".obsidian",
    ".trash",
    "node_modules",
    ...(options.ignoreDirs ?? []),
  ]);
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(next.dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        if (next.depth + 1 > maxDepth) continue;
        stack.push({ dir: full, depth: next.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        yield full;
      }
    }
  }
}

/** Read a single file as a bounded RawNote. */
export async function readNote(
  filePath: string,
  vaultRoot: string,
  maxBytes = 256 * 1024,
): Promise<RawNote | null> {
  const rel = path.relative(vaultRoot, filePath).replace(/\\/g, "/");
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > maxBytes) {
    return { path: rel, body: "", size: stat.size, mtime: stat.mtime.toISOString() };
  }
  const body = await fs.readFile(filePath, "utf8");
  return { path: rel, body, size: stat.size, mtime: stat.mtime.toISOString() };
}

export type Submission = {
  vaultFingerprint: string;
  evidenceVersion: string;
  pointers: NotePointer[];
  summaries: NoteSummary[];
  errors: Array<{ path: string; code: string }>;
  totalBytes: number;
  extractorVersion: string;
  scanVersion: string;
  scannedAt: string;
};

export interface ScanOptions {
  evidenceVersion: string;
  configHash?: string | null;
  maxBytes?: number;
  maxNotes?: number;
}

/**
 * Scan a vault and produce a Submission. Bounded by maxNotes so a runaway vault
 * cannot exhaust device memory.
 */
export async function scanVault(vaultRootPath: string, options: ScanOptions): Promise<Submission> {
  const vaultFingerprint = computeVaultFingerprint(vaultRootPath, options.configHash ?? null);
  const notes: RawNote[] = [];
  let count = 0;
  for await (const file of iterMarkdownFiles(vaultRootPath)) {
    if (options.maxNotes && count >= options.maxNotes) break;
    const note = await readNote(file, vaultRootPath, options.maxBytes);
    if (note) {
      notes.push(note);
      count++;
    }
  }
  const result = extractBatch(notes);
  return {
    vaultFingerprint,
    evidenceVersion: options.evidenceVersion,
    pointers: result.pointers,
    summaries: result.summaries,
    errors: result.errors.map((error) => ({ path: error.path, code: error.code })),
    totalBytes: result.totalBytes,
    extractorVersion: EXTRACTOR_VERSION,
    scanVersion: VAULT_SCAN_VERSION,
    scannedAt: new Date().toISOString(),
  };
}
