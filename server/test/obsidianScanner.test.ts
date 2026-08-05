/**
 * Smoke proving the scanner module can be invoked from a non-Electron Node runtime.
 * Uses a temp directory; never opens a real vault.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeVaultFingerprint,
  iterMarkdownFiles,
  readNote,
  scanVault,
} from '../src/services/obsidianScanner.js';

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-scanner-'));
  await fs.writeFile(
    path.join(tempRoot, 'note-a.md'),
    ['---', 'title: Note A', 'tags: [mood]', '---', '# Heading', 'body body body'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'note-b.md'), '# B\nmore body', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'ignore.txt'), 'should be skipped', 'utf8');
  await fs.mkdir(path.join(tempRoot, '.obsidian'));
  await fs.writeFile(path.join(tempRoot, '.obsidian', 'config'), '{}', 'utf8');
  await fs.mkdir(path.join(tempRoot, 'sub'));
  await fs.writeFile(path.join(tempRoot, 'sub', 'note-c.md'), '# C\nnested body', 'utf8');
});

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Obsidian scanner (M1 smoke)', () => {
  it('yields markdown files but ignores .obsidian and non-md files', async () => {
    const seen: string[] = [];
    for await (const file of iterMarkdownFiles(tempRoot)) {
      seen.push(file);
    }
    const rel = seen.map((file) => path.relative(tempRoot, file).replace(/\\/g, '/')).sort();
    expect(rel).toEqual(['note-a.md', 'note-b.md', 'sub/note-c.md']);
  });

  it('reads a note as a bounded RawNote', async () => {
    const note = await readNote(path.join(tempRoot, 'note-a.md'), tempRoot);
    expect(note?.path).toBe('note-a.md');
    expect(note?.body).toContain('body body body');
  });

  it('produces a deterministic vault fingerprint', () => {
    const a = computeVaultFingerprint(tempRoot, 'config-hash');
    const b = computeVaultFingerprint(tempRoot, 'config-hash');
    expect(a).toEqual(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(computeVaultFingerprint(tempRoot, 'different')).not.toEqual(a);
  });

  it('scans a vault to a Submission without exploding memory', async () => {
    const submission = await scanVault(tempRoot, {
      evidenceVersion: '2026-08-01',
      configHash: 'config-hash',
      maxNotes: 50,
      maxBytes: 64 * 1024,
    });
    expect(submission.vaultFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(submission.pointers.length).toBe(3);
    expect(submission.summaries.length).toBe(3);
    expect(submission.errors).toEqual([]);
    expect(submission.totalBytes).toBeGreaterThan(0);
    expect(submission.totalBytes).toBeLessThan(8 * 1024);
  });
});
