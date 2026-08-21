#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const expectedSha = process.argv[3] ?? process.env.RELEASE_SHA ?? '';
const manifestPath = join(root, 'release-manifest.json');
if (!existsSync(manifestPath)) throw new Error('release-manifest.json is missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.format !== 1 || !/^[0-9a-f]{40}$/.test(manifest.commitSha)) throw new Error('invalid release manifest');
if (expectedSha && manifest.commitSha !== expectedSha.toLowerCase()) throw new Error('release commit SHA mismatch');
const listed = new Map(manifest.files.map(file => [file.path, file]));
const actual = [];
const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split('\\').join('/');
    if (path === 'release-manifest.json') continue;
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
    if (info.isDirectory()) walk(absolute);
    else if (info.isFile()) actual.push(path);
    else throw new Error(`unsupported release entry: ${path}`);
  }
};
walk(root);
for (const path of actual) {
  const entry = listed.get(path);
  if (!entry) throw new Error(`unlisted release file: ${path}`);
  const bytes = readFileSync(join(root, path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== entry.bytes || digest !== entry.sha256) throw new Error(`manifest mismatch: ${path}`);
}
for (const path of listed.keys()) if (!actual.includes(path)) throw new Error(`missing release file: ${path}`);
for (const required of ['ssr/server/index.mjs', 'server/dist/index.js', 'ecosystem.config.cjs', 'prisma/schema.prisma', 'artifact-migrate.mjs']) {
  if (!listed.has(required)) throw new Error(`required release entry is missing: ${required}`);
}
console.log(`verified release ${manifest.commitSha}`);