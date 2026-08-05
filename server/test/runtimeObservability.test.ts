import { describe, expect, it } from 'bun:test';
import {
  createRuntimeObserver,
  parseBoundedPositiveInteger,
} from '../src/services/runtimeObservability.js';

describe('runtime observability', () => {
  it('bounds positive integer configuration without accepting zero or invalid values', () => {
    expect(parseBoundedPositiveInteger('7', 3, 10)).toBe(7);
    expect(parseBoundedPositiveInteger('99', 3, 10)).toBe(10);
    expect(parseBoundedPositiveInteger('0', 3, 10)).toBe(3);
    expect(parseBoundedPositiveInteger('nope', 3, 10)).toBe(3);
  });

  it('reports only process resource metrics and configured pool capacity', () => {
    const observer = createRuntimeObserver({
      role: 'dispatcher',
      mysqlConnectionLimit: 2,
      memoryUsage: () => ({
        rss: 100,
        heapTotal: 80,
        heapUsed: 60,
        external: 4,
        arrayBuffers: 2,
      }),
      uptime: () => 12.8,
    });

    const metrics = observer.snapshot();
    observer.close();

    expect(metrics).toMatchObject({
      role: 'dispatcher',
      uptimeSeconds: 12,
      rssBytes: 100,
      heapTotalBytes: 80,
      heapUsedBytes: 60,
      externalBytes: 4,
      mysqlConnectionLimit: 2,
    });
    expect(Object.keys(metrics).sort()).toEqual([
      'eventLoopDelayP99Ms',
      'externalBytes',
      'heapTotalBytes',
      'heapUsedBytes',
      'mysqlConnectionLimit',
      'role',
      'rssBytes',
      'uptimeSeconds',
    ]);
  });
});