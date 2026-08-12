import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import type { PublicProfile, PublicProfilePort } from './publicProfilePort.js';
import { compareNormalizedProfiles, type ProfileDifference } from './responseNormalizer.js';

export type ProfileDifferenceSink = Readonly<{
  record: (differences: ProfileDifference[]) => Promise<void>;
}>;

export const createMysqlProfileDifferenceSink = (pool: Pool): ProfileDifferenceSink =>
  Object.freeze({
    record: async (differences) => {
      for (const difference of differences) {
        const recordKey = createHash('sha256')
          .update(`${difference.stableId}:${difference.fieldName}:${difference.differenceKind}`)
          .digest('hex');
        await pool.query(
          `INSERT INTO profile_reconciliation_records
             (id, recordKey, legacyConvexId, fieldName, differenceKind, summary)
           VALUES (UUID(), ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE summary = VALUES(summary), observedAt = CURRENT_TIMESTAMP(3)`,
          [
            recordKey,
            difference.stableId,
            difference.fieldName,
            difference.differenceKind,
            difference.summary,
          ],
        );
      }
    },
  });

export const createComparePublicProfileAdapter = (
  convex: PublicProfilePort,
  mysql: PublicProfilePort,
  sink: ProfileDifferenceSink,
  log: Pick<Console, 'warn'> = console,
): PublicProfilePort =>
  Object.freeze({
    getBySlug: async (slug): Promise<PublicProfile | null> => {
      const convexProfile = await convex.getBySlug(slug);
      if (!convexProfile) return null;
      try {
        const mysqlProfile = await mysql.getBySlug(slug);
        await sink.record(
          compareNormalizedProfiles(
            { stableId: convexProfile.user._id, profile: convexProfile },
            { stableId: convexProfile.user._id, profile: mysqlProfile },
          ),
        );
      } catch (error) {
        log.warn({ err: error, profileId: convexProfile.user._id }, 'profile compare failed closed');
      }
      return convexProfile;
    },
  });