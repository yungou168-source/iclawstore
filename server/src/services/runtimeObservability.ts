import { monitorEventLoopDelay } from "node:perf_hooks";

export type RuntimeMetrics = Readonly<{
  role: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  eventLoopDelayP99Ms: number | null;
  mysqlConnectionLimit: number | null;
}>;

export type RuntimeObserver = Readonly<{
  snapshot: () => RuntimeMetrics;
  close: () => void;
}>;

export function parseBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function createRuntimeObserver(
  input: Readonly<{
    role: string;
    mysqlConnectionLimit?: number;
    resolutionMs?: number;
    memoryUsage?: () => NodeJS.MemoryUsage;
    uptime?: () => number;
  }>,
): RuntimeObserver {
  const delay = monitorEventLoopDelay({ resolution: input.resolutionMs ?? 20 });
  delay.enable();
  const memoryUsage = input.memoryUsage ?? process.memoryUsage;
  const uptime = input.uptime ?? process.uptime;

  return Object.freeze({
    snapshot: () => {
      const memory = memoryUsage();
      const delayP99Ns = delay.percentile(99);
      delay.reset();
      return {
        role: input.role,
        uptimeSeconds: Math.floor(uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        eventLoopDelayP99Ms:
          Number.isFinite(delayP99Ns) && delayP99Ns > 0
            ? Number((delayP99Ns / 1_000_000).toFixed(3))
            : null,
        mysqlConnectionLimit: input.mysqlConnectionLimit ?? null,
      };
    },
    close: () => delay.disable(),
  });
}

export function startRuntimeMetricsLogging(
  observer: RuntimeObserver,
  write: (entry: RuntimeMetrics) => void,
  intervalMs = 60_000,
): () => void {
  const timer = setInterval(() => write(observer.snapshot()), Math.max(1_000, intervalMs));
  timer.unref();
  return () => clearInterval(timer);
}
