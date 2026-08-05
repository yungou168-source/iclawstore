const { existsSync, readFileSync } = require("node:fs");

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
const executorApps = existsSync(executorEnvironmentPath)
  ? [
      {
        name: "iclawstore-provider-executor",
        script: "/home/ubuntu/.local/bin/bun",
        args: "x tsx src/workerExecutorProcess.ts",
        cwd: "/www/wwwroot/iclawstore.com/server",
        env: {
          NODE_ENV: "production",
          ...loadEnvironment(executorEnvironmentPath),
        },
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        watch: false,
        max_memory_restart: "200M",
      },
    ]
  : [];

const config = {
  apps: [
    {
      name: "iclawstore-api",
      script: "/home/ubuntu/.local/bin/bun",
      args: "x tsx src/index.ts",
      cwd: "/www/wwwroot/iclawstore.com/server",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
        HOST: "0.0.0.0",
        MANAGED_ASSET_ROOT: "/home/ubuntu/.local/share/iclawstore/managed-assets",
        ...apiEnvironment,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
    },
    {
      name: "iclawstore-runtime-dispatcher",
      script: "/home/ubuntu/.local/bin/bun",
      args: "x tsx src/outboxDispatcherProcess.ts",
      cwd: "/www/wwwroot/iclawstore.com/server",
      env: {
        NODE_ENV: "production",
        OUTBOX_BATCH_SIZE: "20",
        OUTBOX_POLL_INTERVAL_MS: "1000",
        ...dispatcherEnvironment,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
    },
    ...executorApps,
  ],
};

module.exports = config;
