import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.env.RELEASE_OUTPUT_DIR || join(root, '.release'));
const releaseSha = process.env.RELEASE_SHA?.trim();

if (!releaseSha || !/^[a-f0-9]{40}$/.test(releaseSha)) {
  throw new Error('RELEASE_SHA must be a 40-character lowercase Git SHA');
}

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

const copy = (source, destination) => {
  const target = join(output, destination);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, source), target, { recursive: true });
};

mkdirSync(output, { recursive: true });
copy('.output', 'ssr');
copy('server/dist', 'server/dist');
copy('server/package.json', 'server/package.json');
copy('server/package-lock.json', 'server/package-lock.json');
copy('prisma', 'prisma');
copy('ecosystem.config.cjs', 'ecosystem.config.cjs');
copy('scripts/verify-production-release.mjs', 'verify-production-release.mjs');
copy('scripts/run-production-migrations.mjs', 'run-production-migrations.mjs');

run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], join(output, 'server'));

for (const entrypoint of [
  'index.js',
  'outboxDispatcherProcess.js',
  'auditExportWorkerProcess.js',
  'approvalTimeoutWorkerProcess.js',
  'workerExecutorProcess.js',
]) {
  run('node', ['--check', join(output, 'server/dist', entrypoint)]);
}

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const name = relative(output, path).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(path);
      return [
        {
          path: name,
          kind: 'symlink',
          target,
          sha256: createHash('sha256').update(target).digest('hex'),
        },
      ];
    }
    if (entry.isDirectory()) return listFiles(path);
    if (!entry.isFile()) return [];
    if (name === 'release-manifest.json') return [];
    const contents = readFileSync(path);
    return [
      {
        path: name,
        kind: 'file',
        size: lstatSync(path).size,
        sha256: createHash('sha256').update(contents).digest('hex'),
      },
    ];
  });

const files = listFiles(output).sort((left, right) => left.path.localeCompare(right.path));
const manifest = {
  schemaVersion: 1,
  releaseSha,
  createdAt: new Date().toISOString(),
  components: {
    ssr: 'ssr/server/index.mjs',
    api: 'server/dist/index.js',
    workers: [
      'server/dist/outboxDispatcherProcess.js',
      'server/dist/auditExportWorkerProcess.js',
      'server/dist/approvalTimeoutWorkerProcess.js',
      'server/dist/workerExecutorProcess.js',
    ],
    prismaSchema: 'prisma/schema.prisma',
    processConfig: 'ecosystem.config.cjs',
  },
  files,
};
writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
run('node', [join(output, 'verify-production-release.mjs'), output, releaseSha]);
console.log(`Built production release ${basename(output)} with ${files.length} verified files.`);