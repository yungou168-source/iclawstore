import type { ProfileProjectionReconciliationDifference, ProfileProjectionReconciliationPhase } from './profileProjectionReconciliation.js';

type SqlConnection = Readonly<{
  query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
}>;

type Row = Readonly<{ legacyConvexId: string; fieldName: string; summary: string }>;

const rows = <T>(result: unknown): readonly T[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];

const targetOnlyDifference = (
  legacyConvexId: string,
  fieldName: string,
  summary: string,
): ProfileProjectionReconciliationDifference => ({
  legacyConvexId,
  fieldName,
  differenceKind: 'invariant_violation',
  summary,
});

export const createProfileProjectionOrphanRepository = (connection: SqlConnection) => Object.freeze({
  list: async (): Promise<readonly ProfileProjectionReconciliationDifference[]> => {
    const [catalog, starred, manifests, entries] = await Promise.all([
      connection.query(
        `SELECT item.legacyConvexId,'publisher_map' AS fieldName,'catalog item has no publisher legacy map' AS summary
         FROM profile_catalog_items item
         LEFT JOIN convex_exit_legacy_id_maps map ON map.domain = 'publishers' AND map.targetId = item.publisherId
         WHERE map.targetId IS NULL`,
      ),
      connection.query(
        `SELECT CONCAT(item.viewerUserLegacyConvexId, ':', item.skillLegacyConvexId) AS legacyConvexId,
                'viewer_profile_map' AS fieldName,'starred item has no profile legacy map' AS summary
         FROM profile_starred_items item
         LEFT JOIN convex_exit_legacy_id_maps map ON map.domain = 'profiles' AND map.targetId = item.viewerProfileId
         WHERE map.targetId IS NULL`,
      ),
      connection.query(
        `SELECT manifest.sourceGitHubLegacyConvexId AS legacyConvexId,'publisher_map' AS fieldName,
                'manifest has no publisher legacy map' AS summary
         FROM profile_catalog_manifests manifest
         LEFT JOIN convex_exit_legacy_id_maps map ON map.domain = 'publishers' AND map.targetId = manifest.publisherId
         WHERE map.targetId IS NULL`,
      ),
      connection.query(
        `SELECT entry.id AS legacyConvexId,'publisher_boundary' AS fieldName,
                'manifest entry does not share the section and catalog publisher' AS summary
         FROM profile_catalog_manifest_entries entry
         LEFT JOIN profile_catalog_manifest_sections section ON section.id = entry.sectionId
         LEFT JOIN profile_catalog_items item ON item.id = entry.catalogItemId
         WHERE section.id IS NULL OR item.id IS NULL OR entry.publisherId <> section.publisherId OR entry.publisherId <> item.publisherId`,
      ),
    ]);
    return [catalog, starred, manifests, entries]
      .flatMap((result) => rows<Row>(result))
      .map((row) => targetOnlyDifference(row.legacyConvexId, row.fieldName, row.summary));
  },
});

export const orphanPhase = (): ProfileProjectionReconciliationPhase => 'manifests';