#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? process.cwd());
const envFile = process.argv[3];
if (!envFile || !existsSync(envFile)) throw new Error('DATABASE_URL environment file is required');
const prisma = join(root, 'server', 'node_modules', '.bin', 'prisma');
if (!existsSync(prisma)) throw new Error(`packaged Prisma CLI is missing: ${prisma}`);
const schema = join(root, 'prisma', 'schema.prisma');
const loadEnv = path => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
  const separator = line.indexOf('=');
  if (separator < 1) throw new Error(`invalid environment entry in ${path}`);
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const environment = { ...process.env, ...loadEnv(envFile) };
for (const args of [['migrate', 'status'], ['migrate', 'deploy'], ['migrate', 'status']]) {
  const result = spawnSync(prisma, [...args, '--schema', schema], { cwd: root, env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}