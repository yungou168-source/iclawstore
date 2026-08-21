import { describe, expect, it } from 'vitest';
import {
  assertAssetIntegrity,
  canReadAsset,
  consumeUploadTicket,
  issueUploadTicket,
  type AssetAccessRepository,
  type ManagedAssetMetadata,
  type UploadTicket,
} from './managedAssetAccess.js';

const repository = () => {
  const tickets = new Map<string, UploadTicket>();
  const assets = new Map<string, ManagedAssetMetadata>();
  const implementation: AssetAccessRepository = {
    createTicket: async (ticket) => void tickets.set(ticket.id, ticket),
    getTicket: async (id) => tickets.get(id) ?? null,
    consumeTicket: async (id, consumedAt) => {
      const ticket = tickets.get(id);
      if (!ticket || ticket.consumedAt !== null) return false;
      tickets.set(id, { ...ticket, consumedAt });
      return true;
    },
    getAsset: async (id) => assets.get(id) ?? null,
  };
  return { implementation, tickets };
};

describe('managed asset access', () => {
  it('issues a hashed, single-use upload ticket', async () => {
    const { implementation, tickets } = repository();
    const issued = await issueUploadTicket(implementation, {
      userId: 'user-1', assetKind: 'avatar', targetId: 'profile-1', maxBytes: 100, allowedMimeTypes: ['image/png'],
    }, 1_000);
    expect(tickets.get(issued.ticketId)?.tokenHash).not.toBe(issued.token);
    await consumeUploadTicket(implementation, { ticketId: issued.ticketId, token: issued.token, userId: 'user-1', mimeType: 'image/png', sizeBytes: 10 }, 2_000);
    await expect(consumeUploadTicket(implementation, { ticketId: issued.ticketId, token: issued.token, userId: 'user-1', mimeType: 'image/png', sizeBytes: 10 }, 2_000)).rejects.toThrow('UPLOAD_TICKET_INVALID_OR_EXPIRED');
  });

  it('blocks unsafe asset states and detects corrupted bytes', () => {
    const asset: ManagedAssetMetadata = { id: 'a', ownerUserId: 'u', storageKey: 'avatar/aa/id.png', mimeType: 'image/png', sizeBytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', originalFileName: 'a.png', accessScope: 'owner', status: 'active', scannerStatus: 'clean' };
    expect(canReadAsset(asset, 'u')).toBe(true);
    expect(canReadAsset({ ...asset, scannerStatus: 'pending' }, 'u')).toBe(false);
    expect(canReadAsset(asset, 'other')).toBe(false);
    expect(() => assertAssetIntegrity(asset, Buffer.from('abc'))).not.toThrow();
    expect(() => assertAssetIntegrity(asset, Buffer.from('bad'))).toThrow('ASSET_INTEGRITY_MISMATCH');
  });
});