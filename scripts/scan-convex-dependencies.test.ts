import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { directClientUsage, scanConvexDependencies } from "./scan-convex-dependencies";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const fixture = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "clawhub-convex-scan-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
};

describe("scan-convex-dependencies", () => {
  it("classifies direct clients, generated API imports, and runtime capabilities", () => {
    const root = fixture({
      "src/client.ts":
        "import { useQuery } from 'convex/react';\nimport { api } from '../convex/_generated/api';\nuseQuery(api.users.me, {});",
      "server/bridge.ts":
        "import { ConvexHttpClient } from 'convex/browser';\nconst client = new ConvexHttpClient('https://example.invalid');",
      "convex/http.ts":
        "import { httpRouter } from 'convex/server';\nconst http = httpRouter();\nctx.storage.getUrl(id);\n",
      "convex/crons.ts": "import { cronJobs } from 'convex/server';\nconst crons = cronJobs();",
      ".github/workflows/deploy.yml": "env:\n  CONVEX_SELF_HOSTED_ADMIN_KEY: ${{ secrets.KEY }}\n",
      "src/client.test.ts": "import { useQuery } from 'convex/react';",
    });

    const dependencies = scanConvexDependencies({ root });
    expect(dependencies.map((dependency) => dependency.category)).toEqual(
      expect.arrayContaining([
        "browser-react-client",
        "generated-api",
        "http-client",
        "http-routes",
        "storage",
        "cron",
        "deployment-config",
      ]),
    );
    expect(directClientUsage(dependencies)).toHaveLength(4);
    expect(dependencies.some((dependency) => dependency.file.endsWith(".test.ts"))).toBe(false);
  });
});
