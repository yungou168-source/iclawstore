import { describe, expect, it, vi } from 'bun:test';
import { createProfileMigrationMetricsProvider } from '../src/domains/profiles/profileReadObservability.js';

describe('Profile migration observability', () => {
  it('combines synchronization, asset, and reconciliation gates', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce([[{
          watermark: 9_000,
          cursorAgeMs: 250,
          retryCount: 2,
          lastFailureCode: 'source_timeout',
        }], []])
        .mockResolvedValueOnce([[{ pendingAssets: 3, failedAssets: 1 }], []])
        .mockResolvedValueOnce([[{ unclassifiedDifferences: 4 }], []]),
    };
    const provider = createProfileMigrationMetricsProvider(pool as never, () => 10_000);

    await expect(provider.snapshot()).resolves.toEqual({
      watermark: 9_000,
      watermarkLagMs: 1_000,
      cursorAgeMs: 250,
      retryCount: 2,
      lastFailureCode: 'source_timeout',
      pendingAssets: 3,
      failedAssets: 1,
      unclassifiedDifferences: 4,
      candidateReady: false,
    });
  });
});