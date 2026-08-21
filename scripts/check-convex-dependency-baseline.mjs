#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoots = ['convex', 'server', 'packages', 'src'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '_generated']);

const rules = [
  ['browser-react-client', /@convex-dev\/react|ConvexProvider|useQuery\(|useMutation\(|useAction\(/],
  ['generated-api', /convex\/_generated\/(api|dataModel)/],
  ['http-client', /ConvexHttpClient|convex\/browser|convex\/client/],
  ['identity-bridge', /convexIdentityBridge|ConvexIdentity/],
  ['deployment-config', /VITE_CONVEX_|CONVEX_(URL|DEPLOYMENT)/],
  ['http-routes', /httpRouter\(|(?:http|httpApi)\.route\(|httpAction\(/],
  ['storage', /(?:ctx|runCtx)\.storage\.|\.storage\.(?:getUrl|generateUploadUrl|delete)/],
  ['cron', /cronJobs\(|crons\.(?:interval|daily|weekly|monthly)/],
];

const compareEntry = (left, right) => entryKey(left).localeCompare(entryKey(right));
const entryKey = ({ category, domain, file, line }) => `${category}\u0000${domain}\u0000${file}\u0000${line}`;

const domainFor = (file) => {
  const normalized = file.toLowerCase();
  if (normalized.includes('publisher') || normalized.includes('org')) return 'publishers-organizations';
  if (normalized.includes('profile')) return 'profiles';
  if (normalized.includes('soul')) return 'souls';
  if (normalized.includes('package') || normalized.includes('clawhub')) return 'plugins-cli';
  if (normalized.includes('moderation') || normalized.includes('security') || normalized.includes('scan')) return 'security-moderation';
  if (normalized.includes('oauth')) return 'desktop-oauth';
  if (normalized.includes('auth') || normalized.includes('identity') || normalized.includes('token')) return 'authentication';
  if (normalized.includes('cron') || normalized.includes('worker') || normalized.includes('outbox')) return 'operations';
  if (normalized.includes('skill')) return 'skills-catalog';
  return 'platform';
};

const walk = async (root, relative = '') => {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(root, entryRelative));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(entryRelative);
  }

  return files;
};

export const collectDependencies = async (root) => {
  const dependencies = [];

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(root, sourceRoot);
    try {
      if (!(await stat(absoluteRoot)).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const relativeFile of await walk(root, sourceRoot)) {
      const file = relativeFile.split(path.sep).join('/');
      const lines = (await readFile(path.join(root, relativeFile), 'utf8')).split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const [category, pattern] of rules) {
          if (pattern.test(line)) {
            dependencies.push({ category, domain: domainFor(file), file, line: index + 1 });
          }
        }
      });
    }
  }

  return dependencies.sort(compareEntry);
};

export const compareBaselines = (expected, actual) => {
  const expectedByKey = new Map(expected.map((entry) => [entryKey(entry), entry]));
  const actualByKey = new Map(actual.map((entry) => [entryKey(entry), entry]));
  const added = actual.filter((entry) => !expectedByKey.has(entryKey(entry)));
  const removed = expected.filter((entry) => !actualByKey.has(entryKey(entry)));

  return { added, removed };
};

const formatEntries = (entries) => entries.map(({ category, domain, file, line }) => `  ${category} ${domain} ${file}:${line}`).join('\n');

export const checkBaseline = async ({ root, baselinePath, writeBaseline = false }) => {
  const actual = await collectDependencies(root);
  if (writeBaseline) {
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify({ dependencies: actual }, null, 2)}\n`);
    return { actual, added: [], removed: [] };
  }

  const expected = JSON.parse(await readFile(baselinePath, 'utf8')).dependencies;
  return { actual, ...compareBaselines(expected, actual) };
};

const findRepositoryRoot = async (start) => {
  let current = start;
  while (true) {
    try {
      await stat(path.join(current, 'specs', 'convex-dependency-baseline.json'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error('找不到 specs/convex-dependency-baseline.json。');
      current = parent;
    }
  }
};

const main = async () => {
  const root = await findRepositoryRoot(process.cwd());
  const baselinePath = path.join(root, 'specs/convex-dependency-baseline.json');
  const result = await checkBaseline({ root, baselinePath, writeBaseline: process.argv.includes('--write-baseline') });
  if (process.argv.includes('--write-baseline')) {
    console.log(`已更新 Convex 依赖基线，共 ${result.actual.length} 条。`);
    return;
  }
  if (result.added.length === 0 && result.removed.length === 0) {
    console.log(`Convex 依赖基线一致，共 ${result.actual.length} 条。`);
    return;
  }

  if (result.added.length > 0) console.error(`新增且未登记的 Convex 依赖：\n${formatEntries(result.added)}`);
  if (result.removed.length > 0) console.error(`已删除但基线未收缩的 Convex 依赖：\n${formatEntries(result.removed)}`);
  process.exitCode = 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}