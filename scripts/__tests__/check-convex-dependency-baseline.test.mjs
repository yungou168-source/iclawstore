import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkBaseline, compareBaselines } from '../check-convex-dependency-baseline.mjs';

const dependency = (overrides = {}) => ({
  category: 'http-client',
  domain: 'platform',
  file: 'server/src/example.ts',
  line: 1,
  ...overrides,
});

test('compareBaselines separates unregistered additions from stale removals', () => {
  const shared = dependency();
  const added = dependency({ line: 2 });
  const removed = dependency({ line: 3 });

  assert.deepEqual(compareBaselines([shared, removed], [shared, added]), {
    added: [added],
    removed: [removed],
  });
});

test('checkBaseline writes an explicit snapshot and later compares it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convex-baseline-'));
  const baselinePath = path.join(root, 'specs', 'baseline.json');

  try {
    await mkdir(path.join(root, 'server', 'src'), { recursive: true });
    await writeFile(path.join(root, 'server', 'src', 'client.ts'), "import { ConvexHttpClient } from 'convex/browser';\n");

    const written = await checkBaseline({ root, baselinePath, writeBaseline: true });
    assert.equal(written.actual.length, 1);

    const matched = await checkBaseline({ root, baselinePath });
    assert.deepEqual(matched.added, []);
    assert.deepEqual(matched.removed, []);

    await writeFile(path.join(root, 'server', 'src', 'client.ts'), "import { ConvexHttpClient } from 'convex/browser';\nconst client = new ConvexHttpClient('url');\n");
    const changed = await checkBaseline({ root, baselinePath });
    assert.equal(changed.added.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});