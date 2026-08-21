import { describe, expect, it } from 'bun:test';
import { inspectProfileProjectionMigrationReadiness } from '../src/domains/profile-projections/profileProjectionMigrationPreflight.js';

describe('profile projection migration preflight', () => {
  it('fails closed when expand-only tables are absent', async () => {
    const report = await inspectProfileProjectionMigrationReadiness({
      query: async () => [[], []],
    } as never);
    expect(report.ready).toBe(false);
    expect(report.candidateReady).toBe(false);
    expect(report.missingTables).toContain('profile_catalog_items');
  });
});