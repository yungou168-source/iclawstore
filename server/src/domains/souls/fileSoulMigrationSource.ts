import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { SoulSnapshot } from './soulMigrationDto.js';
import { normalizeSoulSnapshot } from './soulNormalizer.js';
import type { SoulMigrationSource } from './soulMigrationRuntime.js';

type FileCursor = Readonly<{ watermark: string; offset: number }>;

const decodeCursor = (value: string | null): FileCursor | null => {
  if (!value) return null;
  let parsed: Partial<FileCursor>;
  try { parsed = JSON.parse(value) as Partial<FileCursor>; } catch { throw new Error('Soul file source cursor is invalid'); }
  if (typeof parsed.watermark !== 'string' || typeof parsed.offset !== 'number' || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) {
    throw new Error('Soul file source cursor is invalid');
  }
  return { watermark: parsed.watermark, offset: parsed.offset };
};

export const createFileSoulMigrationSource = (input: Readonly<{
  path: string;
  updatedAfter?: number;
}>): SoulMigrationSource => {
  if (!isAbsolute(input.path)) throw new Error('Soul source path must be absolute');
  if (input.updatedAfter !== undefined && !Number.isFinite(input.updatedAfter)) throw new Error('Soul source updatedAfter is invalid');
  return Object.freeze({
    page: async ({ cursor, limit }) => {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Soul source page limit is invalid');
      const metadata = await stat(input.path);
      const watermark = `${metadata.mtimeMs}:${metadata.size}`;
      const state = decodeCursor(cursor);
      if (state && state.watermark !== watermark) throw new Error('Soul source file changed during migration');
      const content = await readFile(input.path, 'utf8');
      const records = content.split(/\r?\n/).filter(Boolean);
      const offset = state?.offset ?? 0;
      const page: SoulSnapshot[] = [];
      let nextOffset = offset;
      while (nextOffset < records.length && page.length < limit) {
        const recordOffset = nextOffset;
        nextOffset += 1;
        let raw: SoulSnapshot;
        try { raw = JSON.parse(records[recordOffset]) as SoulSnapshot; } catch { throw new Error(`Soul source JSONL record ${recordOffset} is invalid`); }
        const snapshot = normalizeSoulSnapshot(raw);
        if (input.updatedAfter === undefined || snapshot.legacyUpdatedAt > input.updatedAfter) page.push(snapshot);
      }
      const exhausted = nextOffset >= records.length;
      return {
        snapshots: page,
        watermark,
        exhausted,
        cursor: exhausted ? null : JSON.stringify({ watermark, offset: nextOffset }),
      };
    },
  });
};