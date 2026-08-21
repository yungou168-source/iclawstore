import type { PrismaClient } from '@prisma/client';
import type { ManagedAssetScanRepository } from './managedAssetScannerWorker.js';
import type { AssetAccessRepository, AssetCompletionRepository, ManagedAssetMetadata, UploadTicket } from './managedAssetAccess.js';

const ticketsTable = (prisma: PrismaClient) => (prisma as unknown as { managedAssetUploadTickets: any }).managedAssetUploadTickets;
const assetsTable = (prisma: PrismaClient) => (prisma as unknown as { convexExitManagedAssets: any }).convexExitManagedAssets;

export const createPrismaManagedAssetRepository = (prisma: PrismaClient): AssetAccessRepository & AssetCompletionRepository & ManagedAssetScanRepository => ({
  async createTicket(ticket: UploadTicket) {
    await ticketsTable(prisma).create({ data: { ...ticket, maxBytes: BigInt(ticket.maxBytes), allowedMimeTypes: ticket.allowedMimeTypes, expiresAt: new Date(ticket.expiresAt), consumedAt: null } });
  },
  async getTicket(id: string) {
    const row = await ticketsTable(prisma).findUnique({ where: { id } });
    return row ? { ...row, maxBytes: Number(row.maxBytes), allowedMimeTypes: row.allowedMimeTypes as string[], expiresAt: row.expiresAt.getTime(), consumedAt: row.consumedAt?.getTime() ?? null } : null;
  },
  async consumeTicket(id: string, consumedAt: number) {
    const result = await ticketsTable(prisma).updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date(consumedAt) } }, data: { consumedAt: new Date(consumedAt) } });
    return result.count === 1;
  },
  async getAsset(id: string) {
    const row = await assetsTable(prisma).findUnique({ where: { id } });
    return row ? { ...row, ownerUserId: row.createdByUserId ?? null, sizeBytes: Number(row.sizeBytes), accessScope: row.accessScope as ManagedAssetMetadata['accessScope'], status: row.status as ManagedAssetMetadata['status'], scannerStatus: row.scannerStatus as ManagedAssetMetadata['scannerStatus'], originalFileName: row.originalFileName ?? null } : null;
  },
  async listPendingAssets(limit: number) {
    const rows = await assetsTable(prisma).findMany({ where: { status: 'active', scannerStatus: 'pending' }, take: limit, orderBy: { createdAt: 'asc' } });
    return rows.map((row: any) => ({ ...row, ownerUserId: row.createdByUserId ?? null, sizeBytes: Number(row.sizeBytes), accessScope: row.accessScope as ManagedAssetMetadata['accessScope'], status: row.status as ManagedAssetMetadata['status'], scannerStatus: row.scannerStatus as ManagedAssetMetadata['scannerStatus'], originalFileName: row.originalFileName ?? null }));
  },
  async setScannerStatus(id: string, scannerStatus: 'clean' | 'blocked') {
    await assetsTable(prisma).updateMany({ where: { id, status: 'active', scannerStatus: 'pending' }, data: { scannerStatus } });
  },
  async persistCompletion(asset: ManagedAssetMetadata, ticketId: string, consumedAt: number) {
    return prisma.$transaction(async (transaction) => {
      const updated = await ticketsTable(transaction as PrismaClient).updateMany({ where: { id: ticketId, consumedAt: null }, data: { consumedAt: new Date(consumedAt) } });
      if (updated.count !== 1) return false;
      await assetsTable(transaction as PrismaClient).create({ data: { id: asset.id, ownerDomain: 'user', ownerLegacyConvexId: asset.ownerUserId ?? 'system', accessScope: asset.accessScope, storageKey: asset.storageKey, originalFileName: asset.originalFileName, mimeType: asset.mimeType, sizeBytes: BigInt(asset.sizeBytes), sha256: asset.sha256, status: asset.status, scannerStatus: asset.scannerStatus, createdByUserId: asset.ownerUserId, targetId: null } });
      return true;
    });
  },
});