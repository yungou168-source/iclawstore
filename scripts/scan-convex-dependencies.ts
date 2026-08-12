import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx"]);
const TEXT_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".sh",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
]);
const DEFAULT_ROOTS = ["src", "server", "packages", "scripts", "convex", ".github/workflows"];
const DEFAULT_EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".output",
  "assets",
  "dist",
  "fixtures",
  "node_modules",
  "test-artifact",
]);

export type ConvexDependencyCategory =
  | "browser-react-client"
  | "http-client"
  | "generated-api"
  | "identity-bridge"
  | "storage"
  | "http-routes"
  | "cron"
  | "deployment-config";

export type ConvexDependency = {
  category: ConvexDependencyCategory;
  domain: string;
  file: string;
  line: number;
};

type ScanOptions = {
  root?: string;
  roots?: string[];
  includeTests?: boolean;
};

const directClientCategories = new Set<ConvexDependencyCategory>([
  "browser-react-client",
  "http-client",
  "generated-api",
]);

const isTestFile = (file: string) =>
  /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(file);

const domainFor = (file: string): string => {
  if (file.includes("desktop")) return "desktop-oauth";
  if (file.includes("publisher") || file.includes("/org")) return "publishers-organizations";
  if (file.includes("profile") || file.includes("users")) return "profiles";
  if (file.includes("plugin") || file.includes("package")) return "plugins-cli";
  if (file.includes("soul")) return "souls";
  if (file.includes("skill")) return "skills-catalog";
  if (file.includes("security") || file.includes("moderation") || file.includes("report")) {
    return "security-moderation";
  }
  if (file.includes("search") || file.includes("stats") || file.includes("telemetry")) {
    return "search-statistics";
  }
  if (file.includes("auth") || file.includes("identity")) return "authentication";
  if (file.includes("deploy") || file.includes("workflow")) return "operations";
  return "platform";
};

const walk = (root: string, directory: string, files: string[]): void => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (DEFAULT_EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(root, path, files);
    } else if (entry.isFile()) {
      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (TEXT_EXTENSIONS.has(extension)) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
};

const add = (
  dependencies: ConvexDependency[],
  category: ConvexDependencyCategory,
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): void => {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  dependencies.push({ category, domain: domainFor(file), file, line });
};

const importCategory = (moduleName: string): ConvexDependencyCategory | null => {
  if (moduleName === "convex/react") return "browser-react-client";
  if (moduleName === "convex/browser") return "http-client";
  if (moduleName.includes("/convex/_generated/api")) return "generated-api";
  return null;
};

const scanSourceFile = (file: string, source: string): ConvexDependency[] => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const dependencies: ConvexDependency[] = [];
  const reactBindings = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const category = importCategory(node.moduleSpecifier.text);
      if (category) {
        add(dependencies, category, file, sourceFile, node);
        if (
          category === "browser-react-client" &&
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)
        ) {
          for (const element of node.importClause.namedBindings.elements) {
            reactBindings.add(element.name.text);
          }
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (reactBindings.has(node.expression.text)) {
        add(dependencies, "browser-react-client", file, sourceFile, node);
      }
      if (node.expression.text === "httpRouter" || node.expression.text === "httpAction") {
        add(dependencies, "http-routes", file, sourceFile, node);
      }
      if (node.expression.text === "cronJobs") add(dependencies, "cron", file, sourceFile, node);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "storage"
    ) {
      add(dependencies, "storage", file, sourceFile, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dependencies;
};

const scanConfigFile = (file: string, source: string): ConvexDependency[] => {
  const dependencies: ConvexDependency[] = [];
  const matcher = /\b(?:VITE_)?CONVEX_[A-Z0-9_]+\b/g;
  for (const match of source.matchAll(matcher)) {
    const before = source.slice(0, match.index);
    dependencies.push({
      category: "deployment-config",
      domain: domainFor(file),
      file,
      line: before.split("\n").length,
    });
  }
  return dependencies;
};

export const scanConvexDependencies = (options: ScanOptions = {}): ConvexDependency[] => {
  const root = resolve(options.root ?? process.cwd());
  const files: string[] = [];
  for (const directory of options.roots ?? DEFAULT_ROOTS)
    walk(root, resolve(root, directory), files);

  return files.flatMap((file) => {
    if (!options.includeTests && isTestFile(file)) return [];
    const source = readFileSync(resolve(root, file), "utf8");
    const extension = file.slice(file.lastIndexOf("."));
    const dependencies = SOURCE_EXTENSIONS.has(extension) ? scanSourceFile(file, source) : [];
    return [...dependencies, ...scanConfigFile(file, source)];
  });
};

export const directClientUsage = (dependencies: ConvexDependency[]): ConvexDependency[] =>
  dependencies.filter((dependency) => directClientCategories.has(dependency.category));

export const summarizeDependencies = (dependencies: ConvexDependency[]) =>
  Object.fromEntries(
    [...new Set(dependencies.map((dependency) => dependency.category))].sort().map((category) => [
      category,
      dependencies
        .filter((dependency) => dependency.category === category)
        .reduce<Record<string, number>>((byFile, dependency) => {
          byFile[dependency.file] = (byFile[dependency.file] ?? 0) + 1;
          return byFile;
        }, {}),
    ]),
  );

const main = (): void => {
  const dependencies = scanConvexDependencies();
  process.stdout.write(
    `${JSON.stringify({ dependencies, summary: summarizeDependencies(dependencies) }, null, 2)}\n`,
  );
};

if (import.meta.main) main();
