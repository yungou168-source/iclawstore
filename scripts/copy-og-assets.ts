import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

async function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Missing required asset. Tried: ${candidates.join(", ")}`);
}

function nodeModuleCandidates(relativePath: string) {
  return [
    path.resolve(`node_modules/${relativePath}`),
    path.resolve(`../../node_modules/${relativePath}`),
  ];
}

const resvgWasmSource = await resolveExistingPath(
  nodeModuleCandidates("@resvg/resvg-wasm/index_bg.wasm"),
);
const bricolage800Source = await resolveExistingPath(
  nodeModuleCandidates(
    "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2",
  ),
);
const bricolage500Source = await resolveExistingPath(
  nodeModuleCandidates(
    "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2",
  ),
);
const ibmPlex500Source = await resolveExistingPath(
  nodeModuleCandidates("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"),
);
const notoSansSc800Source = await resolveExistingPath(
  nodeModuleCandidates(
    "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-800-normal.woff2",
  ),
);
const notoSansSc500Source = await resolveExistingPath(
  nodeModuleCandidates(
    "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2",
  ),
);

const outputDir = path.resolve(process.env.NITRO_OUTPUT_DIR ?? ".output");

const copies = [
  {
    source: path.resolve("public/ai-work-icon.svg"),
    targets: [
      path.resolve(outputDir, "server/ai-work-icon.svg"),
      path.resolve(outputDir, "server/public/ai-work-icon.svg"),
      path.resolve(".vercel/output/functions/__server.func/ai-work-icon.svg"),
      path.resolve(".vercel/output/functions/__server.func/public/ai-work-icon.svg"),
    ],
  },
  {
    source: resvgWasmSource,
    targets: [
      path.resolve(outputDir, "server/node_modules/@resvg/resvg-wasm/index_bg.wasm"),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@resvg/resvg-wasm/index_bg.wasm",
      ),
    ],
  },
  {
    source: bricolage800Source,
    targets: [
      path.resolve(
        outputDir,
        "server/node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2",
      ),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2",
      ),
    ],
  },
  {
    source: bricolage500Source,
    targets: [
      path.resolve(
        outputDir,
        "server/node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2",
      ),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2",
      ),
    ],
  },
  {
    source: ibmPlex500Source,
    targets: [
      path.resolve(
        outputDir,
        "server/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
      ),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
      ),
    ],
  },
  {
    source: notoSansSc800Source,
    targets: [
      path.resolve(
        outputDir,
        "server/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-800-normal.woff2",
      ),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-800-normal.woff2",
      ),
    ],
  },
  {
    source: notoSansSc500Source,
    targets: [
      path.resolve(
        outputDir,
        "server/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2",
      ),
      path.resolve(
        ".vercel/output/functions/__server.func/node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2",
      ),
    ],
  },
];

for (const { source, targets } of copies) {
  for (const target of targets) {
    const parent = path.dirname(target);
    await mkdir(parent, { recursive: true });
    await copyFile(source, target);
  }
}
