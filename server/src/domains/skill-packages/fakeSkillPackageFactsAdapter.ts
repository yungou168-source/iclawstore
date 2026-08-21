import type { SkillPackageFacts } from './skillPackageMigrationPort.js';
import type { SkillPackageFactsRepository } from './mysqlSkillPackageFactsRepository.js';

export const createFakeSkillPackageFactsRepository = (initial: Readonly<Record<string, SkillPackageFacts>> = {}): SkillPackageFactsRepository => {
  const store = new Map(Object.entries(initial));
  return Object.freeze({
    upsert: async ({ snapshotId, facts }) => { store.set(snapshotId, facts); },
    read: async (snapshotId) => store.get(snapshotId) ?? { aliases: [], github: null, fingerprint: null, ownership: [], publishTokens: [], uploadTickets: [], trustedPublishers: [], inspector: [], versionFiles: {}, installEligibility: null },
  });
};