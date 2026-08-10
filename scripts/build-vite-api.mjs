#!/usr/bin/env node
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
// Direct Vite build script - Pure ESM, bypasses CLI config loading
import { build as viteBuild, defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const req = createRequire(join(__dirname, "package.json"));

// Load plugins via dynamic import - handle failures gracefully
let nitro = null;
let nitroLoadError = null;
let tailwindcss, devtools, tanstackStart, viteReact;
try {
  const [nitroMod, tailwindcssMod, devtoolsMod, tanstackMod, reactMod] = await Promise.all([
    import("nitro/vite"),
    import("@tailwindcss/vite"),
    import("@tanstack/devtools-vite"),
    import("@tanstack/react-start/plugin/vite"),
    import("@vitejs/plugin-react"),
  ]);
  nitro = nitroMod.nitro;
  tailwindcss = tailwindcssMod.default;
  devtools = devtoolsMod.devtools;
  tanstackStart = tanstackMod.tanstackStart;
  viteReact = reactMod.default;
} catch (e) {
  console.warn("Some plugins failed to load:", e.message.split("\n")[0]);
  // Fallback: load plugins individually
  try {
    ({ default: tailwindcss } = await import("@tailwindcss/vite"));
  } catch (e) {}
  try {
    ({ devtools } = await import("@tanstack/devtools-vite"));
  } catch (e) {}
  try {
    ({ tanstackStart } = await import("@tanstack/react-start/plugin/vite"));
  } catch (e) {}
  try {
    ({ default: viteReact } = await import("@vitejs/plugin-react"));
  } catch (e) {}
  try {
    ({ nitro } = await import("nitro/vite"));
  } catch (e) {
    nitroLoadError = e.message;
  }
}

const convexEntry = req.resolve("convex");
const convexRoot = dirname(dirname(dirname(convexEntry)));
const convexReactPath = join(convexRoot, "dist/esm/react/index.js");
const convexBrowserPath = join(convexRoot, "dist/esm/browser/index.js");
const convexValuesPath = join(convexRoot, "dist/esm/values/index.js");
const convexAuthReactPath = req.resolve("@convex-dev/auth/react");

function handleRollupWarning(warning, warn) {
  if (
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    warning.id &&
    warning.id.includes("node_modules") &&
    /use client/i.test(warning.message)
  ) {
    return;
  }
  if (
    warning.code === "UNUSED_EXTERNAL_IMPORT" &&
    /@tanstack\/start-|@tanstack\/router-core\/ssr\/(client|server)/.test(warning.message)
  ) {
    return;
  }
  if (warning.code === "EMPTY_BUNDLE" || /Generated an empty chunk/i.test(warning.message)) {
    return;
  }
  warn(warning);
}

const reflectHas = (target, key) => `Reflect.has(${target}, ${JSON.stringify(key)})`;

const arkSafariInOperatorFixes = [
  {
    suffix: "/node_modules/.vite/deps/arktype.js",
    replacements: [
      ['"expression" in value', reflectHas("value", "expression")],
      ['"toJSON" in o', reflectHas("o", "toJSON")],
      ['"morphs" in schema', reflectHas("schema", "morphs")],
      ['"branches" in schema', reflectHas("schema", "branches")],
      ['"unit" in schema', reflectHas("schema", "unit")],
      ['"reference" in schema', reflectHas("schema", "reference")],
      ['"proto" in schema', reflectHas("schema", "proto")],
      ['"domain" in schema', reflectHas("schema", "domain")],
      ['"value" in transformedInner', reflectHas("transformedInner", "value")],
      ['"default" in this.inner', reflectHas("this.inner", "default")],
      ['"variadic" in schema', reflectHas("schema", "variadic")],
      ['"prefix" in schema', reflectHas("schema", "prefix")],
      ['"defaultables" in schema', reflectHas("schema", "defaultables")],
      ['"optionals" in schema', reflectHas("schema", "optionals")],
      ['"postfix" in schema', reflectHas("schema", "postfix")],
      ['"minVariadicLength" in schema', reflectHas("schema", "minVariadicLength")],
      ['"description" in ctx', reflectHas("ctx", "description")],
      ['"data" in input', reflectHas("input", "data")],
      ['"get" in desc', reflectHas("desc", "get")],
      ['"set" in desc', reflectHas("desc", "set")],
    ],
  },
  {
    suffix: "/node_modules/@ark/util/out/serialize.js",
    replacements: [
      ['"expression" in value', reflectHas("value", "expression")],
      ['"toJSON" in o', reflectHas("o", "toJSON")],
    ],
  },
  {
    suffix: "/node_modules/@ark/schema/out/parse.js",
    replacements: [
      ['"morphs" in schema', reflectHas("schema", "morphs")],
      ['"branches" in schema', reflectHas("schema", "branches")],
      ['"unit" in schema', reflectHas("schema", "unit")],
      ['"reference" in schema', reflectHas("schema", "reference")],
      ['"proto" in schema', reflectHas("schema", "proto")],
      ['"domain" in schema', reflectHas("schema", "domain")],
    ],
  },
  {
    suffix: "/node_modules/@ark/schema/out/node.js",
    replacements: [['"value" in transformedInner', reflectHas("transformedInner", "value")]],
  },
  {
    suffix: "/node_modules/@ark/schema/out/scope.js",
    replacements: [['"branches" in schema', reflectHas("schema", "branches")]],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/optional.js",
    replacements: [['"default" in this.inner', reflectHas("this.inner", "default")]],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/sequence.js",
    replacements: [
      ['"variadic" in schema', reflectHas("schema", "variadic")],
      ['"prefix" in schema', reflectHas("schema", "prefix")],
      ['"defaultables" in schema', reflectHas("schema", "defaultables")],
      ['"optionals" in schema', reflectHas("schema", "optionals")],
      ['"postfix" in schema', reflectHas("schema", "postfix")],
      ['"minVariadicLength" in schema', reflectHas("schema", "minVariadicLength")],
    ],
  },
  {
    suffix: "/node_modules/@ark/schema/out/structure/prop.js",
    replacements: [['"default" in this.inner', reflectHas("this.inner", "default")]],
  },
  {
    suffix: "/node_modules/@ark/schema/out/shared/implement.js",
    replacements: [['"description" in ctx', reflectHas("ctx", "description")]],
  },
  {
    suffix: "/node_modules/@ark/schema/out/shared/errors.js",
    replacements: [['"data" in input', reflectHas("input", "data")]],
  },
  {
    suffix: "/node_modules/@ark/util/out/clone.js",
    replacements: [
      ['"get" in desc', reflectHas("desc", "get")],
      ['"set" in desc', reflectHas("desc", "set")],
    ],
  },
];

const patchArkSafariPlugin = {
  name: "patch-ark-safari-in-operator",
  enforce: "pre",
  transform(code, id) {
    const normalizedId = id.split("?")[0].replace(/\\/g, "/");
    const fix = arkSafariInOperatorFixes.find((entry) => normalizedId.endsWith(entry.suffix));
    if (!fix) return null;

    let nextCode = code;
    for (const [from, to] of fix.replacements) {
      if (!nextCode.includes(from)) {
        this.error(`Expected to patch ${from} in ${normalizedId}`);
      }
      nextCode = nextCode.split(from).join(to);
    }

    return { code: nextCode, map: null };
  },
};

const plugins = [
  patchArkSafariPlugin,
  devtools && devtools(),
  nitro &&
    nitro({
      serverDir: "server",
      rollupConfig: { onwarn: handleRollupWarning },
    }),
  tailwindcss && tailwindcss(),
  tanstackStart && tanstackStart(),
  viteReact && viteReact(),
].filter(Boolean);

const config = defineConfig({
  root: __dirname,
  configFile: false,
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
  optimizeDeps: {
    include: ["convex/react", "convex/browser"],
  },
  plugins,
  build: {
    target: "safari15",
    chunkSizeWarningLimit: 900,
    rollupOptions: { onwarn: handleRollupWarning },
  },
});

console.log("Building with Vite API...");
console.log("Plugins loaded:", plugins.map((p) => p.name).join(", "));
await viteBuild(config);
console.log("Build complete!");
