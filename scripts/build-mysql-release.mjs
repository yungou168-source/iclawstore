#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const output = resolve(process.env.RELEASE_OUTPUT_DIR ?? join(root, '.release-artifact'));
const sha = process.env.RELEASE_SHA ?? '';
if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('RELEASE_SHA must be a 40-character commit SHA');
if (existsSync(output)) throw new Error(`release output already exists: ${output}`);
mkdirSync(output, { recursive: true });

const copy = (source, target) => {
  if (!existsSync(source)) throw new Error(`required release input is missing: ${source}`);
  cpSync(source, join(output, target), { recursive: true, dereference: true });
};
copy(join(root, '.output'), 'ssr');
copy(join(root, 'server', 'dist'), 'server/dist');
copy(join(root, 'server', 'package.json'), 'server/package.json');
copy(join(root, 'server', 'node_modules'), 'server/node_modules');
rmSync(join(output, 'server', 'node_modules', 'convex'), { recursive: true, force: true });
copy(join(root, 'prisma', 'schema.prisma'), 'prisma/schema.prisma');
copy(join(root, 'prisma', 'migrations'), 'prisma/migrations');
copy(join(root, 'ecosystem.config.cjs'), 'ecosystem.config.cjs');
copy(join(root, 'ops', 'artifact-verify.mjs'), 'artifact-verify.mjs');
copy(join(root, 'ops', 'artifact-migrate.mjs'), 'artifact-migrate.mjs');

const files = [];
const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) {
      const path = relative(output, absolute).split('\\').join('/');
      const bytes = readFileSync(absolute);
      files.push({ path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error(`unsupported release entry: ${absolute}`);
  }
};
walk(output);
files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(output, 'release-manifest.json'), JSON.stringify({ format: 1, commitSha: sha.toLowerCase(), files }, null, 2) + '\n');
console.log(`built ${files.length} files in ${output}`);