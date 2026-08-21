import type { Pool } from 'mysql2/promise';
import { ManagedAssetStore } from '../../services/managedAssetStore.js';
import { createConfiguredSoulSource } from './configuredSoulMigrationSource.js';
import { createFileSoulAssetSource } from './fileSoulAssetSource.js';
import { createSoulAssetCopyConsumer } from './soulAssetCopyConsumer.js';
import { createSoulJobComposition } from './soulJobComposition.js';
import { createMysqlSoulFactsRepository } from './mysqlSoulFactsRepository.js';
import { createMysqlSoulMigrationControlPlane } from './mysqlSoulMigrationControlPlane.js';
import { createMysqlSoulReconciliationRunner } from './mysqlSoulReconciliationRunner.js';
import { createSoulRuntimeJobRegistry } from './soulRuntimeJobs.js';

export const createSoulRuntimeComposition = (input: Readonly<{ pool: Pool; environment?: NodeJS.ProcessEnv }>) => {
  const environment = input.environment ?? process.env;
  const batchId = environment.SOUL_BATCH_ID;
  const assetRoot = environment.SOUL_ASSET_ROOT;
  if (!batchId) throw new Error('SOUL_BATCH_ID is required');
  if (!assetRoot) throw new Error('SOUL_ASSET_ROOT is required');
  const source = createConfiguredSoulSource(environment);
  const repository = createMysqlSoulFactsRepository(input.pool);
  const controlPlane = createMysqlSoulMigrationControlPlane(input.pool);
  const assetConsumer = createSoulAssetCopyConsumer({ pool: input.pool, source: createFileSoulAssetSource(assetRoot), store: ManagedAssetStore.fromEnvironment(environment) });
  const reconciliation = createMysqlSoulReconciliationRunner({ pool: input.pool, source, target: repository, batchId, persistReport: async (report) => controlPlane.persistReport(report) });
  const jobs = createSoulJobComposition({ batchId, source, repository, controlPlane, assetJob: assetConsumer, reconcileJob: { run: reconciliation } });
  return Object.freeze({ registry: createSoulRuntimeJobRegistry(jobs), source, repository, controlPlane, assetConsumer, reconciliation });
};