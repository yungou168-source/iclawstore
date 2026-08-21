import { describe, expect, it, vi } from 'vitest';
import { runSoulRuntimeJob } from '../src/domains/souls/soulRuntimeWorker.js';

const lease = { workerName: 'soul-worker', token: 'lease-1', acquiredAt: new Date('2026-03-14T00:00:00.000Z'), expiresAt: new Date('2026-03-14T00:01:00.000Z') };

describe('Soul worker recovery boundaries', () => {
  it('does not execute or checkpoint after lease renewal fails', async () => {
    const runPage = vi.fn();
    const checkpoint = vi.fn();
    const result = await runSoulRuntimeJob({
      workerName: 'soul-worker', lease, leaseDurationMs: 30_000,
      store: { renew: async () => null, checkpoint },
      job: { kind: 'soul-full-import', runPage },
    });
    expect(result).toBe(false);
    expect(runPage).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('does not checkpoint a crashed page, allowing the previous cursor to be retried', async () => {
    const checkpoint = vi.fn();
    const crash = new Error('injected worker crash');
    await expect(runSoulRuntimeJob({
      workerName: 'soul-worker', lease, leaseDurationMs: 30_000,
      store: { renew: async (_name, current) => current, checkpoint },
      job: { kind: 'soul-incremental-sync', runPage: async () => { throw crash; } },
    })).rejects.toBe(crash);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('checkpoints only after a successful page and preserves completion state', async () => {
    const checkpoint = vi.fn(async () => undefined);
    const result = await runSoulRuntimeJob({
      workerName: 'soul-worker', lease, leaseDurationMs: 30_000,
      store: { renew: async (_name, current) => current, checkpoint },
      job: { kind: 'soul-reconcile', runPage: async () => ({ cursor: null, watermark: 'fixture-v1', completed: true }) },
    });
    expect(result).toBe(true);
    expect(checkpoint).toHaveBeenCalledWith('soul-worker', null, 'fixture-v1', true);
  });
});