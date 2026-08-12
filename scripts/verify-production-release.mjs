import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const releaseDir = resolve(process.argv[2] || '.');
const expectedSha = process.argv[3]?.trim();
const manifestPath = join(releaseDir, 'release-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.schemaVersion !== 1) throw new Error('unsupported release manifest schema');
if (!/^[a-f0-9]{40}$/.test(manifest.releaseSha)) throw new Error('invalid release SHA');
if (expectedSha && manifest.releaseSha !== expectedSha) throw new Error('release SHA does not match request');
if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('release file list is empty');

const actualFiles = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) actualFiles.push(relative(releaseDir, path).replaceAll('\\', '/'));
    else if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) actualFiles.push(relative(releaseDir, path).replaceAll('\\', '/'));
  }
};
walk(releaseDir);

const expectedPaths = new Set(['release-manifest.json']);
for (const file of manifest.files) {
  if (
    !file ||
    typeof file.path !== 'string' ||
    file.path.startsWith('/') ||
    file.path.split('/').includes('..') ||
    !['file', 'symlink'].includes(file.kind) ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  ) {
    throw new Error('invalid release file record');
  }
  if (expectedPaths.has(file.path)) throw new Error(`duplicate release path: ${file.path}`);
  expectedPaths.add(file.path);
  const path = join(releaseDir, file.path);
  if (file.kind === 'symlink') {
    if (typeof file.target !== 'string' || !file.target || resolve(dirname(path), file.target).startsWith(`${releaseDir}${sep}`) === false) {
      throw new Error(`unsafe release symlink: ${file.path}`);
    }
    const target = readlinkSync(path);
    const digest = createHash('sha256').update(target).digest('hex');
    if (target !== file.target || digest !== file.sha256) {
      throw new Error(`release symlink mismatch: ${file.path}`);
    }
    continue;
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`invalid release size: ${file.path}`);
  if (lstatSync(path).size !== file.size) throw new Error(`release size mismatch: ${file.path}`);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== file.sha256) throw new Error(`release checksum mismatch: ${file.path}`);
}

actualFiles.sort();
const expectedFiles = [...expectedPaths].sort();
if (actualFiles.length !== expectedFiles.length || actualFiles.some((file, index) => file !== expectedFiles[index])) {
  throw new Error('release contains unlisted or missing files');
}

for (const component of [
  manifest.components?.ssr,
  manifest.components?.api,
  manifest.components?.prismaSchema,
  manifest.components?.processConfig,
  ...(manifest.components?.workers || []),
]) {
  if (typeof component !== 'string' || !expectedPaths.has(component)) {
    throw new Error(`invalid release component: ${component}`);
  }
}

console.log(`Verified release ${manifest.releaseSha} (${manifest.files.length} files).`);