import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_EVIDENCE_VERSION,
  EXTRACTOR_VERSION,
  FRONTMATTER_ALLOWED_FIELDS,
  MAX_BATCH_BYTES,
  MAX_SUMMARY_RATIO,
  detectSensitiveContent,
  extractBatch,
  extractNote,
  extractSummary,
  extractTagsAndLinks,
  parseFrontmatter,
} from '../src/services/obsidianExtract.js';

describe('Obsidian extractor (M1)', () => {
  it('parses only allowed frontmatter fields', () => {
    const body = [
      '---',
      'title: AI direct PRD',
      'tags: [prd, ai-hiring]',
      'created: 2026-07-01',
      'aliases: ["document"]',
      'secret: drop-me',
      'cssclass: wide',
      '---',
      '# Top',
      'Body line',
    ].join('\n');

    const fm = parseFrontmatter(body);
    expect(fm.allowed.title).toBe('AI direct PRD');
    expect(Array.isArray(fm.allowed.tags)).toBe(true);
    expect(fm.allowed.created).toBe('2026-07-01');
    expect(fm.allowed.aliases).toEqual(['document']);
    expect(fm.extras).toEqual(['secret', 'cssclass']);
  });

  it('extracts wiki links and inline tags', () => {
    const body = 'See [[note-a]] and [[note-b|alias]]. Also #mood and #journal/2026';
    expect(extractTagsAndLinks(body)).toEqual({
      tags: ['mood', 'journal/2026'],
      links: ['note-a', 'note-b'],
    });
  });

  it('caps the summary at 20% of the source body in UTF-8 bytes', () => {
    const body = '正文'.repeat(2000);
    const sourceBytes = Buffer.byteLength(body, 'utf8');
    const { summary_md, summaryBytes } = extractSummary(body, sourceBytes);
    expect(summaryBytes).toBeLessThanOrEqual(Math.floor(sourceBytes * MAX_SUMMARY_RATIO) + 1);
    expect(summary_md.length).toBeGreaterThan(0);
  });

  it('captures top headings in order', () => {
    const body = '---\ntitle: t\n---\n# A\nbody\n## B\nbody\n### C\n';
    const { top_headings } = extractSummary(body, Buffer.byteLength(body, 'utf8'));
    expect(top_headings).toEqual(['A', 'B', 'C']);
  });

  it('detects sensitive patterns', () => {
    expect(detectSensitiveContent('mobile 13800001111')).toBe('mobile_cn');
    expect(detectSensitiveContent('email a@b.com')).toBe('email');
    expect(detectSensitiveContent('sk-abcdefghijklmnop')).toBe('secret_prefix');
    expect(detectSensitiveContent('plain text')).toBeNull();
  });

  it('rejects empty notes', () => {
    const result = extractNote({ path: 'foo.md', body: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_NOTE');
  });

  it('rejects non-markdown paths', () => {
    const result = extractNote({ path: 'foo.txt', body: '# hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PATH_NOT_MARKDOWN');
  });

  it('rejects sensitive payloads before they ever leave the device', () => {
    const result = extractNote({ path: 'a.md', body: '# contact\nmobile 13800001111' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SENSITIVE_CONTENT');
  });

  it('keeps small summaries under the 20% cap', () => {
    const body = 'x'.repeat(100);
    const result = extractNote({ path: 'foo.md', body });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary_md.length).toBeLessThanOrEqual(20);
    }
  });

  it('batches pointers and summaries while isolating failures', () => {
    const batch = extractBatch([
      { path: 'good.md', body: '# t\nbody body body body' },
      { path: 'bad.txt', body: '# t\nbody' },
      { path: 'empty.md', body: '' },
      { path: 'phone.md', body: '# t\nmobile 13800001111' },
    ]);
    expect(batch.pointers.length).toBe(1);
    expect(batch.summaries.length).toBe(1);
    expect(batch.errors.map((err) => err.code).sort()).toEqual([
      'EMPTY_NOTE',
      'PATH_NOT_MARKDOWN',
      'SENSITIVE_CONTENT',
    ]);
    expect(batch.totalBytes).toBeLessThanOrEqual(MAX_BATCH_BYTES);
  });

  it('exports stable extractor and evidence versions', () => {
    expect(EXTRACTOR_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(DEFAULT_EVIDENCE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(FRONTMATTER_ALLOWED_FIELDS).toContain('title');
  });
});
