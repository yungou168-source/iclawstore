#!/usr/bin/env node
// Direct Vite API build script - uses ESM dynamic imports to bypass CLI issues

// Ensure crypto.getRandomValues exists before loading anything
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
  const crypto = require("crypto");
  globalThis.crypto = {
    getRandomValues: (arr) => {
      const bytes = crypto.randomBytes(arr.length);
      for (let i = 0; i < arr.length; i++) arr[i] = bytes[i];
      return arr;
    },
  };
}

if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(name, opts) {
      super(name);
      this.detail = opts && opts.detail;
    }
  };
}

const path = require("path");
const projectRoot = __dirname;

async function build() {
  const vite = await import("vite");
  const nitroMod = await import("nitro/vite");
  const tailwindcss = (await import("@tailwindcss/vite")).default;
  const devtools = (await import("@tanstack/devtools-vite")).devtools;
  const tanstackStart = (await import("@tanstack/react-start/plugin/vite")).tanstackStart;
  const viteReact = (await import("@vitejs/plugin-react")).default;

  const { defineConfig } = vite;
  const { build: viteBuild } = vite;

  const { createRequire } = await import("module");
  const req = createRequire(path.join(projectRoot, "package.json"));

  const convexEntry = req.resolve("convex");
  const convexRoot = path.dirname(path.dirname(path.dirname(convexEntry)));
  const convexReactPath = path.join(convexRoot, "dist/esm/react/index.js");
  const convexBrowserPath = path.join(convexRoot, "dist/esm/browser/index.js");
  const convexValuesPath = path.join(convexRoot, "dist/esm/values/index.js");
  const convexAuthReactPath = req.resolve("@convex-dev/auth/react");

  function handleRollupWarning(warning, warn) {
    if (warning.code === "MODULE_LEVEL_DIRECTIVE" && /use client/i.test(warning.message)) return;
    if (warning.code === "UNUSED_EXTERNAL_IMPORT" && /@tanstack\/start-/.test(warning.message))
      return;
    if (warning.code === "EMPTY_BUNDLE" || /Generated an empty chunk/i.test(warning.message))
      return;
    warn(warning);
  }

  const config = defineConfig({
    root: projectRoot,
    resolve: {
      dedupe: ["convex", "@convex-dev/auth", "react", "react-dom"],
      alias: {
        "convex/react": convexReactPath,
        "convex/browser": convexBrowserPath,
        "convex/values": convexValuesPath,
        "@convex-dev/auth/react": convexAuthReactPath,
      },
      tsconfigPaths: true,
    },
    optimizeDeps: { include: ["convex/react", "convex/browser"] },
    plugins: [
      devtools(),
      nitroMod.nitro({ serverDir: "server", rollupConfig: { onwarn: handleRollupWarning } }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
    build: {
      target: "safari15",
      chunkSizeWarningLimit: 900,
      rollupOptions: { onwarn: handleRollupWarning },
    },
  });

  console.log("Building with Vite API...");
  await viteBuild(config);
  console.log("Build complete!");
}

build().catch((e) => {
  console.error("Build failed:", e.message, e.stack);
  process.exit(1);
});
