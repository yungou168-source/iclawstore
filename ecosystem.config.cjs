const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const releaseRoot = __dirname;
const serverRoot = join(releaseRoot, 'server');
const serverDist = join(serverRoot, 'dist');
const releaseSha = process.env.RELEASE_SHA || 'unknown';
const serverProcess = (entrypoint) => ({
  script: join(serverDist, entrypoint),
  cwd: serverRoot,
  interpreter: '/usr/bin/node',
});

const aiDirectFeatureFlags = JSON.stringify({
  organizations: {
    "15aff8b5-4a60-4eea-aaf6-3d8c40c0c754": { candidateCatalog: true },
  },
});

const loadEnvironment = (path) => {
  const environment = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid environment entry in ${path}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid environment key in ${path}`);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    environment[key] = value;
  }
  return environment;
};

const apiEnvironment = loadEnvironment("/home/ubuntu/.config/iclawstore/api.env");
const dispatcherEnvironment = loadEnvironment("/home/ubuntu/.config/iclawstore/dispatcher.env");
if (
  !apiEnvironment.DATABASE_URL ||
  !apiEnvironment.JWT_SECRET ||
  !dispatcherEnvironment.DATABASE_URL
) {
  throw new Error("API and runtime dispatcher production secrets are required");
}

const executorEnvironmentPath = "/home/ubuntu/.config/iclawstore/executor.env";
const executorEnvironment = existsSync(executorEnvironmentPath)
  ? loadEnvironment(executorEnvironmentPath)
  : null;
const executorApps =
  executorEnvironment?.PROVIDER_EXECUTION_ENABLED === "true"
    ? [
        {
          name: "iclawstore-provider-executor",
          ...serverProcess('workerExecutorProcess.js'),
          env: {
            NODE_ENV: 'production',
            APP_BUILD_SHA: releaseSha,
            ...executorEnvironment,
          },
          instances: 1,
          exec_mode: "fork",
          autorestart: true,
          watch: false,
          min_uptime: "10s",
          restart_delay: 5000,
          max_restarts: 5,
          max_memory_restart: "192M",
        },
      ]
    : [];

const auditExportEnvironmentPath = "/home/ubuntu/.config/iclawstore/audit-export.env";
const auditExportEnvironment = existsSync(auditExportEnvironmentPath)
  ? loadEnvironment(auditExportEnvironmentPath)
  : null;
const auditExportApps =
  auditExportEnvironment?.AUDIT_EXPORT_ENABLED === "true"
    ? [
        {
          name: "iclawstore-audit-export",
          ...serverProcess('auditExportWorkerProcess.js'),
          env: {
            NODE_ENV: 'production',
            APP_BUILD_SHA: releaseSha,
            AUDIT_EXPORT_POLL_INTERVAL_MS: "5000",
            RUNTIME_METRICS_INTERVAL_MS: "60000",
            ...apiEnvironment,
            ...auditExportEnvironment,
          },
          instances: 1,
          exec_mode: "fork",
          autorestart: true,
          watch: false,
          min_uptime: "10s",
          restart_delay: 5000,
          max_restarts: 5,
          max_memory_restart: "128M",
        },
      ]
    : [];

const approvalTimeoutEnvironmentPath = "/home/ubuntu/.config/iclawstore/approval-timeout.env";
const approvalTimeoutEnvironment = existsSync(approvalTimeoutEnvironmentPath)
  ? loadEnvironment(approvalTimeoutEnvironmentPath)
  : null;
const approvalTimeoutApps =
  approvalTimeoutEnvironment?.APPROVAL_TIMEOUT_ENABLED === "true"
    ? [
        {
          name: "iclawstore-approval-timeout",
          ...serverProcess('approvalTimeoutWorkerProcess.js'),
          env: {
            NODE_ENV: 'production',
            APP_BUILD_SHA: releaseSha,
            APPROVAL_TIMEOUT_POLL_INTERVAL_MS: "30000",
            ...apiEnvironment,
            ...approvalTimeoutEnvironment,
          },
          instances: 1,
          exec_mode: "fork",
          autorestart: true,
          watch: false,
          min_uptime: "10s",
          restart_delay: 5000,
          max_restarts: 5,
          max_memory_restart: "96M",
        },
      ]
    : [];

const config = {
  apps: [
    {
      name: "iclawstore-api",
      ...serverProcess('index.js'),
      env: {
        NODE_ENV: 'production',
        APP_BUILD_SHA: releaseSha,
        PORT: 3002,
        HOST: "0.0.0.0",
        MYSQL_CONNECTION_LIMIT: "6",
        MANAGED_ASSET_ROOT: "/home/ubuntu/.local/share/iclawstore/managed-assets",
        AI_DIRECT_FEATURE_FLAGS: aiDirectFeatureFlags,
        ...apiEnvironment,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      restart_delay: 5000,
      max_restarts: 5,
      max_memory_restart: "256M",
    },
    {
      name: "iclawstore-runtime-dispatcher",
      ...serverProcess('outboxDispatcherProcess.js'),
      env: {
        NODE_ENV: 'production',
        APP_BUILD_SHA: releaseSha,
        OUTBOX_BATCH_SIZE: "20",
        OUTBOX_POLL_INTERVAL_MS: "1000",
        ...dispatcherEnvironment,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      restart_delay: 5000,
      max_restarts: 5,
      max_memory_restart: "128M",
    },
    ...executorApps,
    ...auditExportApps,
    ...approvalTimeoutApps,
  ],
};

module.exports = config;
