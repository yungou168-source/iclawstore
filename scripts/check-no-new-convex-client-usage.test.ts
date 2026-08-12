import { describe, expect, it } from "vitest";
import { findNewDirectClientUsage } from "./check-no-new-convex-client-usage";
import {
  type ConvexDependency,
  directClientUsage,
  summarizeDependencies,
} from "./scan-convex-dependencies";

const dependency = (category: ConvexDependency["category"], file: string): ConvexDependency => ({
  category,
  domain: "platform",
  file,
  line: 1,
});

describe("check-no-new-convex-client-usage", () => {
  it("allows removing existing usage and rejects new files or extra calls", () => {
    const baseline = [
      dependency("browser-react-client", "src/existing.tsx"),
      dependency("browser-react-client", "src/existing.tsx"),
      dependency("generated-api", "src/existing.tsx"),
    ];

    expect(findNewDirectClientUsage(baseline, baseline.slice(0, 2))).toEqual([]);
    expect(
      findNewDirectClientUsage(baseline, [
        ...baseline,
        dependency("http-client", "src/new.ts"),
        dependency("browser-react-client", "src/existing.tsx"),
      ]),
    ).toEqual([
      "browser-react-client:src/existing.tsx (2 -> 3)",
      "http-client:src/new.ts (0 -> 1)",
    ]);
  });

  it("keeps the baseline summary deterministic", () => {
    expect(
      summarizeDependencies([
        dependency("http-client", "server/bridge.ts"),
        dependency("http-client", "server/bridge.ts"),
      ]),
    ).toEqual({ "http-client": { "server/bridge.ts": 2 } });
    expect(directClientUsage([dependency("storage", "convex/uploads.ts")])).toEqual([]);
  });
});
