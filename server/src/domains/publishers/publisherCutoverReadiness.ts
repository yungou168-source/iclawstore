import type { Pool } from "mysql2/promise";
import {
  inspectPublisherMigrationReadiness,
  type PublisherMigrationPreflightReport,
} from "./publisherMigrationPreflight.js";

export type PublisherCutoverReadinessReport = Readonly<{
  ready: boolean;
  candidateUrl: string;
  blocks: readonly string[];
  migration: PublisherMigrationPreflightReport;
}>;

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const normalizeUrl = (raw: string, name: string): string => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return url.origin.toLowerCase();
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
};

export const assertPublisherCandidateUrlIsNonProduction = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const candidate = normalizeUrl(
    required(env.PUBLISHER_PUBLIC_READ_CANDIDATE_URL, "PUBLISHER_PUBLIC_READ_CANDIDATE_URL"),
    "PUBLISHER_PUBLIC_READ_CANDIDATE_URL",
  );
  const productionUrls = [
    env.PUBLISHER_PUBLIC_READ_PRODUCTION_URL,
    env.PRODUCTION_PUBLIC_URL,
    env.PUBLIC_SITE_URL,
    env.SITE_URL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeUrl(value, "production URL"));
  if (productionUrls.includes(candidate)) {
    throw new Error("PUBLISHER_PUBLIC_READ_CANDIDATE_URL must not match a production URL");
  }
  if (env.PUBLISHER_PUBLIC_READ_ALLOW_PRODUCTION_CANDIDATE === "1") {
    throw new Error(
      "Production candidate override is intentionally unsupported for Publisher reads",
    );
  }
  return candidate;
};

const blocksFromMigrationReport = (report: PublisherMigrationPreflightReport): string[] => [
  ...(report.ready ? [] : ["publisher_migration_schema_not_ready"]),
  ...(report.candidateReady ? [] : ["publisher_candidate_backlog_not_ready"]),
  ...(report.runningBatchIds.length > 0 ? ["publisher_sync_batch_running"] : []),
  ...(report.pendingAssets > 0 ? ["publisher_assets_pending"] : []),
  ...(report.failedAssets > 0 ? ["publisher_assets_failed"] : []),
  ...(report.unresolvedDifferences > 0 ? ["publisher_reconciliation_unresolved"] : []),
  ...(report.unclassifiedDifferences > 0 ? ["publisher_reconciliation_unclassified"] : []),
  ...(report.missingProfileLinks > 0 ? ["publisher_profile_links_missing"] : []),
];

export const inspectPublisherCutoverReadiness = async (
  pool: Pick<Pool, "query">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublisherCutoverReadinessReport> => {
  const candidateUrl = assertPublisherCandidateUrlIsNonProduction(env);
  const migration = await inspectPublisherMigrationReadiness(pool);
  const blocks = blocksFromMigrationReport(migration);
  return Object.freeze({
    ready: blocks.length === 0,
    candidateUrl,
    blocks,
    migration,
  });
};

export const requirePublisherCutoverReadiness = async (
  pool: Pick<Pool, "query">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublisherCutoverReadinessReport> => {
  const report = await inspectPublisherCutoverReadiness(pool, env);
  if (!report.ready) {
    throw new Error(`Publisher cutover readiness blocked: ${report.blocks.join(", ")}`);
  }
  return report;
};
