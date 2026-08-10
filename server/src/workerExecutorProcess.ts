import { createPool } from "mysql2/promise";
import { createProviderRateLimiter } from "./services/providerRateLimiter.js";
import { clearProviderRuntime, loadProviderRuntime } from "./services/providerRuntime.js";
import {
  createRuntimeObserver,
  startRuntimeMetricsLogging,
} from "./services/runtimeObservability.js";
import { createWorkerExecutor } from "./services/workerExecutor.js";
import { createWorkerRuntimeClient } from "./services/workerRuntimeClient.js";

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Executor integer configuration must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function enabled(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("PROVIDER_EXECUTION_ENABLED must be true or false");
}

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => stop.abort(new Error(`Executor received ${signal}`)));
}

if (!enabled(process.env.PROVIDER_EXECUTION_ENABLED)) {
  console.info(JSON.stringify({ event: "provider.executor.disabled" }));
  await new Promise<void>((resolve) => {
    if (stop.signal.aborted) return resolve();
    stop.signal.addEventListener("abort", () => resolve(), { once: true });
  });
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("mysql")) throw new Error("DATABASE_URL must be a MySQL URL");
  const workerId = process.env.WORKER_ID;
  const workerToken = process.env.WORKER_TOKEN;
  const workerApiBaseUrl = process.env.WORKER_API_BASE_URL;
  if (!workerId || !workerToken || !workerApiBaseUrl) {
    throw new Error("WORKER_ID, WORKER_TOKEN, and WORKER_API_BASE_URL are required");
  }

  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 1,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  const observer = createRuntimeObserver({ role: "executor", mysqlConnectionLimit: 1 });
  const stopMetricsLogging = startRuntimeMetricsLogging(
    observer,
    (metrics) => console.info(JSON.stringify({ event: "runtime.metrics", ...metrics })),
    integer(process.env.RUNTIME_METRICS_INTERVAL_MS, 60_000, 1_000, 300_000),
  );
  const runtime = loadProviderRuntime(pool);
  if (!runtime) {
    stopMetricsLogging();
    observer.close();
    await pool.end();
    throw new Error("AI Direct provider runtime must be enabled for the Executor");
  }

  const executor = createWorkerExecutor({
    pool,
    client: createWorkerRuntimeClient({
      baseUrl: workerApiBaseUrl,
      workerId,
      workerToken,
    }),
    credentialStore: runtime.credentialStore,
    providers: runtime.providers,
    rateLimiter: createProviderRateLimiter(),
    config: {
      workerId,
      pollIntervalMs: integer(process.env.EXECUTOR_POLL_INTERVAL_MS, 2_000, 100, 60_000),
      heartbeatIntervalMs: integer(
        process.env.EXECUTOR_HEARTBEAT_INTERVAL_MS,
        20_000,
        1_000,
        30_000,
      ),
    },
  });

  console.info(JSON.stringify({ event: "provider.executor.started", concurrency: 1 }));
  try {
    await executor.run(stop.signal);
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    stopMetricsLogging();
    observer.close();
    clearProviderRuntime(runtime);
    await pool.end();
    console.info(JSON.stringify({ event: "provider.executor.stopped" }));
  }
}
