import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type {
  PublicPublisherListItem,
  PublicPublisherMembers,
  PublicPublisherPage,
  PublicPublisherPort,
  PublicPublisherStats,
  PublisherDirectoryQuery,
} from "./publicPublisherPort.js";
import type { PublisherReadObserver } from "./publisherReadObservability.js";

export type PublisherPublicReadDifference = Readonly<{
  stableId: string;
  fieldName: string;
  differenceKind: "missing" | "value_mismatch";
  summary: string;
}>;

export type PublisherDifferenceSink = Readonly<{
  record: (differences: readonly PublisherPublicReadDifference[]) => Promise<void>;
}>;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const scalarFields = ["kind", "handle", "displayName", "official"] as const;
const statFields = ["skills", "packages", "installs", "downloads", "stars"] as const;

const compareStats = (
  stableId: string,
  source: PublicPublisherStats,
  target: PublicPublisherStats,
): PublisherPublicReadDifference[] =>
  statFields.flatMap((fieldName) =>
    source[fieldName] === target[fieldName]
      ? []
      : [
          {
            stableId,
            fieldName: `stats.${fieldName}`,
            differenceKind: "value_mismatch" as const,
            summary: `stats.${fieldName} differs`,
          },
        ],
  );

export const comparePublicPublishers = (
  source: PublicPublisherListItem | null,
  target: PublicPublisherListItem | null,
): PublisherPublicReadDifference[] => {
  const stableId = source?._id ?? target?._id;
  if (!stableId) return [];
  if (!target) {
    return [
      {
        stableId,
        fieldName: "publisher",
        differenceKind: "missing",
        summary: "target public Publisher is absent",
      },
    ];
  }
  if (!source) {
    return [
      {
        stableId,
        fieldName: "publisher",
        differenceKind: "missing",
        summary: "source public Publisher is absent",
      },
    ];
  }
  const scalarDifferences = scalarFields.flatMap((fieldName) =>
    source[fieldName] === target[fieldName]
      ? []
      : [
          {
            stableId,
            fieldName,
            differenceKind: "value_mismatch" as const,
            summary: `${fieldName} differs`,
          },
        ],
  );
  const nullableDifferences = (["image", "bio", "linkedUserId"] as const).flatMap((fieldName) =>
    normalizeText(source[fieldName]) === normalizeText(target[fieldName])
      ? []
      : [
          {
            stableId,
            fieldName,
            differenceKind: "value_mismatch" as const,
            summary: `${fieldName} differs`,
          },
        ],
  );
  return [
    ...scalarDifferences,
    ...nullableDifferences,
    ...compareStats(stableId, source.stats, target.stats),
  ];
};

const comparePages = (
  source: PublicPublisherPage,
  target: PublicPublisherPage,
): PublisherPublicReadDifference[] => {
  const sourceById = new Map(source.page.map((publisher) => [publisher._id, publisher]));
  const targetById = new Map(target.page.map((publisher) => [publisher._id, publisher]));
  return [...new Set([...sourceById.keys(), ...targetById.keys()])].flatMap((id) =>
    comparePublicPublishers(sourceById.get(id) ?? null, targetById.get(id) ?? null),
  );
};

const memberSignature = (members: PublicPublisherMembers | null): string[] =>
  (members?.members ?? [])
    .map((member) => `${member.user._id}:${member.role}:${member.user.handle ?? ""}`)
    .sort();

const compareMembers = (
  source: PublicPublisherMembers | null,
  target: PublicPublisherMembers | null,
): PublisherPublicReadDifference[] => {
  const stableId = source?.publisher?._id ?? target?.publisher?._id;
  if (!stableId) return [];
  if (!target) {
    return [
      {
        stableId,
        fieldName: "members",
        differenceKind: "missing",
        summary: "target public Publisher members are absent",
      },
    ];
  }
  if (!source) {
    return [
      {
        stableId,
        fieldName: "members",
        differenceKind: "missing",
        summary: "source public Publisher members are absent",
      },
    ];
  }
  return JSON.stringify(memberSignature(source)) === JSON.stringify(memberSignature(target))
    ? []
    : [
        {
          stableId,
          fieldName: "members",
          differenceKind: "value_mismatch",
          summary: "public Publisher members differ",
        },
      ];
};

export const createMysqlPublisherDifferenceSink = (pool: Pool): PublisherDifferenceSink =>
  Object.freeze({
    record: async (differences) => {
      for (const difference of differences) {
        const recordKey = createHash("sha256")
          .update(
            `publishers:public-read:${difference.stableId}:${difference.fieldName}:${difference.differenceKind}`,
          )
          .digest("hex");
        await pool.query(
          `INSERT INTO convex_exit_reconciliation_records
             (id, recordKey, domain, legacyConvexId, fieldName, differenceKind, summary)
           VALUES (UUID(), ?, 'publishers', ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE summary = VALUES(summary), observedAt = CURRENT_TIMESTAMP(3)`,
          [
            recordKey,
            difference.stableId,
            `public_read.${difference.fieldName}`,
            difference.differenceKind,
            difference.summary,
          ],
        );
      }
    },
  });

export const createComparePublicPublisherAdapter = (
  convex: PublicPublisherPort,
  mysql: PublicPublisherPort,
  sink: PublisherDifferenceSink,
  log: Pick<Console, "warn"> = console,
  observer?: PublisherReadObserver,
): PublicPublisherPort =>
  Object.freeze({
    getProfileByHandle: async (handle): Promise<PublicPublisherListItem | null> => {
      const convexPublisher = await convex.getProfileByHandle(handle);
      if (!convexPublisher) return null;
      try {
        const mysqlPublisher = await mysql.getProfileByHandle(handle);
        if (mysqlPublisher) observer?.increment("mysqlHit");
        const differences = comparePublicPublishers(convexPublisher, mysqlPublisher);
        if (differences.length > 0) observer?.increment("diff", differences.length);
        await sink.record(differences);
      } catch (error) {
        observer?.increment("adapterError");
        log.warn(
          { err: error, publisherId: convexPublisher._id },
          "publisher public compare failed closed",
        );
      }
      return convexPublisher;
    },
    listPublicPage: async (query: PublisherDirectoryQuery): Promise<PublicPublisherPage> => {
      const convexPage = await convex.listPublicPage(query);
      try {
        const mysqlPage = await mysql.listPublicPage(query);
        observer?.increment("mysqlHit");
        const differences = comparePages(convexPage, mysqlPage);
        if (differences.length > 0) observer?.increment("diff", differences.length);
        await sink.record(differences);
      } catch (error) {
        observer?.increment("adapterError");
        log.warn({ err: error }, "publisher directory compare failed closed");
      }
      return convexPage;
    },
    listMembers: async (publisherHandle: string): Promise<PublicPublisherMembers | null> => {
      const convexMembers = await convex.listMembers(publisherHandle);
      if (!convexMembers) return null;
      try {
        const mysqlMembers = await mysql.listMembers(publisherHandle);
        if (mysqlMembers) observer?.increment("mysqlHit");
        const differences = compareMembers(convexMembers, mysqlMembers);
        if (differences.length > 0) observer?.increment("diff", differences.length);
        await sink.record(differences);
      } catch (error) {
        observer?.increment("adapterError");
        log.warn({ err: error, publisherHandle }, "publisher member compare failed closed");
      }
      return convexMembers;
    },
  });
