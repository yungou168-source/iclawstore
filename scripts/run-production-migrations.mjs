import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseDir = resolve(process.argv[2] || '.');
const environmentPath = resolve(process.argv[3] || '');
const environment = { ...process.env };

for (const rawLine of readFileSync(environmentPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) throw new Error(`invalid environment entry in ${environmentPath}`);
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`invalid environment key in ${environmentPath}`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  environment[key] = value;
}

if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required for migration preflight');
const prisma = join(releaseDir, 'server/node_modules/.bin/prisma');
const schema = join(releaseDir, 'prisma/schema.prisma');
const run = (args, allowedStatuses = [0]) => {
  const result = spawnSync(prisma, [...args, '--schema', schema], {
    cwd: dirname(schema),
    env: environment,
    stdio: 'inherit',
  });
  if (!allowedStatuses.includes(result.status ?? -1)) {
    throw new Error(`prisma ${args.join(' ')} failed`);
  }
};

run(['migrate', 'status'], [0, 1]);
run(['migrate', 'deploy']);
run(['migrate', 'status']);