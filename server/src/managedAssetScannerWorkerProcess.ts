import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { ManagedAssetStore } from './services/managedAssetStore.js';
import { createPrismaManagedAssetRepository } from './services/prismaManagedAssetRepository.js';
import { scanPendingManagedAssets } from './services/managedAssetScannerWorker.js';

const command = process.env.ASSET_SCANNER_COMMAND;
if (!command) throw new Error('ASSET_SCANNER_COMMAND is required');

const scan = async ({ bytes }: { bytes: Buffer }) => {
  const child = spawn(command, [], { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.end(bytes);
  const [code] = await once(child, 'close') as [number];
  return code === 0 ? 'clean' as const : 'blocked' as const;
};

const prisma = new PrismaClient();
const repository = createPrismaManagedAssetRepository(prisma);
const store = ManagedAssetStore.fromEnvironment();
const result = await scanPendingManagedAssets(repository, store, { scan }, Number(process.env.ASSET_SCANNER_BATCH_SIZE ?? 20));
console.log(JSON.stringify(result));
await prisma.$disconnect();