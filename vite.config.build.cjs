"use strict";
// Pre-built Vite config (converted from vite.config.mjs)
// import.meta.url is replaced with __filename trick
const { createRequire: __createRequire } = require("module");
const __require = __createRequire(__filename);

const { dirname: __path_dirname, join: __path_join } = require("path");

const __convexEntry = __require.resolve("convex");
const __convexRoot = __path_dirname(__path_dirname(__path_dirname(__convexEntry)));
const __convexReactPath = __path_join(__convexRoot, "dist/esm/react/index.js");
const __convexBrowserPath = __path_join(__convexRoot, "dist/esm/browser/index.js");
const __convexValuesPath = __path_join(__convexRoot, "dist/esm/values/index.js");
const __convexAuthReactPath = __require.resolve("@convex-dev/auth/react");

// Load ESM plugins via dynamic import
async function loadPlugins() {
  const [nitroMod, tailwindcssMod, devtoolsMod, tanstackMod, reactMod] = await Promise.all([
    import("nitro/vite"),
    import("@tailwindcss/vite"),
    import("@tanstack/devtools-vite"),
    import("@tanstack/react-start/plugin/vite"),
    import("@vitejs/plugin-react"),
  ]);

  const nitro = nitroMod.nitro;
  const tailwindcss = tailwindcssMod.default;
  const devtools = devtoolsMod.devtools;
  const tanstackStart = tanstackMod.tanstackStart;
  const viteReact = reactMod.default;

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

  function patchArkSafariInOperator() {
    return {
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
  }

  return {
    plugins: [
      patchArkSafariInOperator(),
      devtools(),
      nitro({
        serverDir: "server",
        rollupConfig: { onwarn: handleRollupWarning },
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  };
}

module.exports = {
  loadPlugins,
  __convexReactPath,
  __convexBrowserPath,
  __convexValuesPath,
  __convexAuthReactPath,
};
