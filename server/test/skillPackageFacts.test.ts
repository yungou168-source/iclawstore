import { describe, expect, it } from 'vitest';
import { reconcileSkillPackageFacts } from '../src/domains/skill-packages/skillPackageReconciliation.js';
import type { SkillPackageFacts } from '../src/domains/skill-packages/skillPackageMigrationPort.js';

const facts = (): SkillPackageFacts => ({
  aliases: [
    { aliasKind: 'slug', aliasValue: 'demo', isCanonical: true, retiredAt: null },
    { aliasKind: 'slug', aliasValue: 'legacy-demo', isCanonical: false, retiredAt: 10 },
  ],
  github: {
    sourceLegacyConvexId: 'github-1',
    repository: 'owner/repo',
    path: 'skills/demo',
    commit: 'abc123',
    contentHash: 'hash-1',
    status: 'active',
  },
  fingerprint: 'fingerprint-1',
  ownership: [],
  publishTokens: [],
  uploadTickets: [],
  trustedPublishers: [],
  inspector: [],
  versionFiles: {
    '1.0.0': [
      {
        path: 'SKILL.md',
        sizeBytes: 10,
        mimeType: 'text/markdown',
        sha256: 'file-hash',
        storageLegacyConvexId: 'storage-1',
      },
    ],
  },
  installEligibility: { allowed: true },
});

describe('reconcileSkillPackageFacts', () => {
  it('does not report an ordering-only difference for fact lists', () => {
    const source = facts();
    const target = {
      ...facts(),
      aliases: [...source.aliases].reverse(),
    };

    expect(reconcileSkillPackageFacts(source, target)).toEqual([]);
  });

  it('compares version files and install eligibility', () => {
    const source = facts();
    const target = {
      ...facts(),
      versionFiles: {},
      installEligibility: { allowed: false },
    };

    expect(reconcileSkillPackageFacts(source, target)).toEqual([
      { field: 'versionFiles', kind: 'mismatch' },
      { field: 'installEligibility', kind: 'mismatch' },
    ]);
  });

  it('detects changes across identity, ownership, trust and install facts', () => {
    const source = {
      ...facts(),
      ownership: [{
        ownerUserLegacyConvexId: 'user-1',
        ownerPublisherLegacyConvexId: 'publisher-1',
        eventKind: 'claim',
        effectiveAt: 1,
        actorUserLegacyConvexId: 'user-1',
      }],
      publishTokens: [{
        legacyConvexId: 'token-1',
        tokenHash: 'hash-1',
        provider: 'github',
        repository: 'owner/repo',
        workflowFilename: 'publish.yml',
        expiresAt: 10,
        lastUsedAt: null,
        revokedAt: null,
      }],
      uploadTickets: [{
        legacyConvexId: 'ticket-1',
        kind: 'release',
        publishTokenLegacyConvexId: 'token-1',
        userLegacyConvexId: 'user-1',
        createdAt: 1,
        expiresAt: 10,
        usedAt: null,
        storageLegacyConvexId: 'storage-1',
      }],
      trustedPublishers: [{
        legacyConvexId: 'trusted-1',
        provider: 'github',
        repository: 'owner/repo',
        repositoryId: 'repo-1',
        workflowFilename: 'publish.yml',
        environment: null,
      }],
      inspector: [{
        legacyConvexId: 'inspection-1',
        releaseLegacyConvexId: 'release-1',
        status: 'clean',
        inspectorVersion: '1',
        targetRuntimeVersion: '2',
        findingCount: 0,
        findingsHash: null,
        createdAt: 1,
      }],
    };
    const target = {
      ...source,
      github: { ...source.github, commit: 'different' },
      ownership: [],
      publishTokens: [],
      uploadTickets: [],
      trustedPublishers: [],
      inspector: [],
    };

    expect(reconcileSkillPackageFacts(source, target)).toEqual([
      { field: 'github', kind: 'mismatch' },
      { field: 'ownership', kind: 'mismatch' },
      { field: 'publishTokens', kind: 'mismatch' },
      { field: 'uploadTickets', kind: 'mismatch' },
      { field: 'trustedPublishers', kind: 'mismatch' },
      { field: 'inspector', kind: 'mismatch' },
    ]);
  });
});