export type SoulOpsCommand = 'full-import' | 'incremental-sync' | 'asset-copy' | 'reconcile' | 'status';

export type SoulOpsRequest = Readonly<{
  command: SoulOpsCommand;
  batchId?: string;
  dryRun: boolean;
  actor: string;
}>;

const commands = new Set<SoulOpsCommand>(['full-import', 'incremental-sync', 'asset-copy', 'reconcile', 'status']);

export const parseSoulOpsRequest = (argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): SoulOpsRequest => {
  const command = argv[0] as SoulOpsCommand | undefined;
  if (!command || !commands.has(command)) throw new Error('Usage: soul-migration <full-import|incremental-sync|asset-copy|reconcile|status> [--batch <id>] [--execute]');
  const actor = environment.SOUL_MIGRATION_OPERATOR;
  if (!actor) throw new Error('SOUL_MIGRATION_OPERATOR is required');
  const batchIndex = argv.indexOf('--batch');
  const batchId = batchIndex >= 0 ? argv[batchIndex + 1] : undefined;
  if (batchIndex >= 0 && (!batchId || batchId.startsWith('--'))) throw new Error('--batch requires a value');
  return Object.freeze({ command, batchId, dryRun: !argv.includes('--execute'), actor });
};

export const assertSoulOpsCanExecute = (request: SoulOpsRequest, environment: NodeJS.ProcessEnv = process.env): void => {
  if (!request.dryRun && environment.SOUL_MIGRATION_CONFIRM !== 'yes') throw new Error('Set SOUL_MIGRATION_CONFIRM=yes to execute a write operation');
  if (environment.SOUL_READ_MODE && environment.SOUL_READ_MODE !== 'disabled' && environment.SOUL_READ_MODE !== 'candidate') throw new Error('Soul read mode is not an accepted candidate value');
};

export type SoulOpsExecutors = Readonly<{
  fullImport: () => Promise<unknown>;
  incrementalSync: () => Promise<unknown>;
  assetCopy: () => Promise<unknown>;
  reconcile: () => Promise<unknown>;
  status: () => Promise<unknown>;
}>;

export const executeSoulOpsRequest = async (request: SoulOpsRequest, executors: SoulOpsExecutors): Promise<unknown> => {
  if (request.dryRun) return { command: request.command, status: 'dry-run', actor: request.actor };
  const executor = {
    'full-import': executors.fullImport,
    'incremental-sync': executors.incrementalSync,
    'asset-copy': executors.assetCopy,
    reconcile: executors.reconcile,
    status: executors.status,
  }[request.command];
  return executor();
};
