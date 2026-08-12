import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ConvexDependency,
  directClientUsage,
  scanConvexDependencies,
} from "./scan-convex-dependencies";

type Baseline = { dependencies: ConvexDependency[] };

type UsageCounts = Map<string, number>;

const usageKey = (dependency: ConvexDependency): string =>
  `${dependency.category}:${dependency.file}`;

const toCounts = (dependencies: ConvexDependency[]): UsageCounts =>
  dependencies.reduce<UsageCounts>((counts, dependency) => {
    const key = usageKey(dependency);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map());

export const findNewDirectClientUsage = (
  baseline: ConvexDependency[],
  current: ConvexDependency[],
): string[] => {
  const baselineCounts = toCounts(directClientUsage(baseline));
  const currentCounts = toCounts(directClientUsage(current));
  return [...currentCounts]
    .flatMap(([key, count]) => {
      const allowed = baselineCounts.get(key) ?? 0;
      return count > allowed ? [`${key} (${allowed} -> ${count})`] : [];
    })
    .sort();
};

const main = (): void => {
  const root = process.cwd();
  const baselinePath = resolve(root, "specs/convex-dependency-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  const additions = findNewDirectClientUsage(
    baseline.dependencies,
    scanConvexDependencies({ root }),
  );

  if (additions.length > 0) {
    process.stderr.write("New direct Convex client usage is not allowed:\n");
    for (const addition of additions) process.stderr.write(`- ${addition}\n`);
    process.stderr.write(
      "Remove the dependency or regenerate the reviewed baseline after reducing existing usage.\n",
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write("No new direct Convex client usage.\n");
};

if (import.meta.main) main();
