import { describe, expect, it } from 'vitest';
import { importSoulMigrationPage, type SoulMigrationSource } from '../src/domains/souls/soulMigrationRuntime.js';

const source = (page: Awaited<ReturnType<SoulMigrationSource['page']>>): SoulMigrationSource => ({ page: async () => page });

describe('Soul migration page import', () => {
  it('persists a page and atomically advances its supplied checkpoint', async () => {
    const calls: unknown[] = [];
    await expect(importSoulMigrationPage({
      batchId: 'batch-1', checkpoint: null, limit: 10,
      source: source({ snapshots: [], watermark: '100', cursor: 'cursor-1', exhausted: false }),
      target: { importPage: async (input) => { calls.push(input); } },
    })).resolves.toMatchObject({ completed: false, imported: 0, checkpoint: { cursor: 'cursor-1', watermark: '100' } });
    expect(calls).toHaveLength(1);
  });

  it('fails closed if the source watermark changes', async () => {
    await expect(importSoulMigrationPage({
      batchId: 'batch-1', checkpoint: { cursor: 'cursor-1', watermark: '100', completed: false }, limit: 10,
      source: source({ snapshots: [], watermark: '101', cursor: null, exhausted: true }),
      target: { importPage: async () => undefined },
    })).rejects.toThrow('watermark changed');
  });

  it('rejects a non-advancing incomplete source page', async () => {
    await expect(importSoulMigrationPage({
      batchId: 'batch-1', checkpoint: { cursor: 'cursor-1', watermark: '100', completed: false }, limit: 10,
      source: source({ snapshots: [], watermark: '100', cursor: 'cursor-1', exhausted: false }),
      target: { importPage: async () => undefined },
    })).rejects.toThrow('non-advancing cursor');
  });
});