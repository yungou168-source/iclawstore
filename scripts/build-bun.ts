#!/usr/bin/env bun
import { createServer as createViteServer, build as viteBuild } from "vite";
import { loadConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const config = await loadConfig({
  configFile: resolve(__dirname, "vite.config.ts"),
  mode: "production",
});

console.log("Building...");
await viteBuild({
  ...config,
  configFile: undefined,
  root: __dirname,
});
console.log("Build complete!");
