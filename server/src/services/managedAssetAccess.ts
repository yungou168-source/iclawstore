import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export type AssetAccessScope = 'public' | 'authenticated' | 'owner';
export type AssetStatus = 'pending' | 'active' | 'blocked' | 'deleted';

export type ManagedAssetMetadata = Readonly<{
  id: string;
  ownerUserId: string | null;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalFileName: string | null;
  accessScope: AssetAccessScope;
  status: AssetStatus;
  scannerStatus: 'pending' | 'clean' | 'blocked';
}>;

export type UploadTicket = Readonly<{
  id: string;
  tokenHash: string;
  userId: string;
  assetKind: string;
  targetId: string;
  expiresAt: number;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
  consumedAt: number | null;
}>;

export type AssetAccessRepository = Readonly<{
  createTicket: (ticket: UploadTicket) => Promise<void>;
  getTicket: (id: string) => Promise<UploadTicket | null>;
  consumeTicket: (id: string, consumedAt: number) => Promise<boolean>;
  getAsset: (id: string) => Promise<ManagedAssetMetadata | null>;
}>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const equalsHash = (left: string, right: string) => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export const issueUploadTicket = async (
  repository: AssetAccessRepository,
  input: Readonly<{
    userId: string;
    assetKind: string;
    targetId: string;
    maxBytes: number;
    allowedMimeTypes: readonly string[];
    ttlMs?: number;
  }>,
  now = Date.now(),
) => {
  if (!input.userId || !input.assetKind || !input.targetId || input.maxBytes <= 0) {
    throw new Error('INVALID_UPLOAD_TICKET');
  }
  const token = `${randomUUID()}${randomUUID()}`;
  const ticket: UploadTicket = {
    id: randomUUID(),
    tokenHash: hashToken(token),
    userId: input.userId,
    assetKind: input.assetKind,
    targetId: input.targetId,
    expiresAt: now + Math.min(input.ttlMs ?? 10 * 60_000, 60 * 60_000),
    maxBytes: input.maxBytes,
    allowedMimeTypes: [...input.allowedMimeTypes],
    consumedAt: null,
  };
  await repository.createTicket(ticket);
  return { ticketId: ticket.id, token, expiresAt: ticket.expiresAt };
};

export const consumeUploadTicket = async (
  repository: AssetAccessRepository,
  input: Readonly<{ ticketId: string; token: string; userId: string; mimeType: string; sizeBytes: number }>,
  now = Date.now(),
) => {
  const ticket = await repository.getTicket(input.ticketId);
  if (!ticket || ticket.consumedAt !== null || ticket.expiresAt <= now || ticket.userId !== input.userId) {
    throw new Error('UPLOAD_TICKET_INVALID_OR_EXPIRED');
  }
  if (!equalsHash(ticket.tokenHash, hashToken(input.token))) throw new Error('UPLOAD_TICKET_INVALID_OR_EXPIRED');
  if (input.sizeBytes <= 0 || input.sizeBytes > ticket.maxBytes || !ticket.allowedMimeTypes.includes(input.mimeType)) {
    throw new Error('UPLOAD_POLICY_VIOLATION');
  }
  if (!(await repository.consumeTicket(ticket.id, now))) throw new Error('UPLOAD_TICKET_ALREADY_CONSUMED');
  return ticket;
};

export type AssetCompletionRepository = Readonly<{
  persistCompletion: (asset: ManagedAssetMetadata, ticketId: string, consumedAt: number) => Promise<boolean>;
}>;

export type CompletedAsset = Readonly<{
  asset: ManagedAssetMetadata;
  ticket: UploadTicket;
}>;

export const completeManagedAssetUpload = async (
  access: AssetAccessRepository,
  completion: AssetCompletionRepository,
  store: Readonly<{
    store: (input: { kind: any; originalFileName: string; declaredMimeType: string; stream: any }) => Promise<{ storageKey: string; originalFileName: string; mimeType: string; sizeBytes: number; sha256: string }>;
    moveToTrash: (storageKey: string) => Promise<string>;
  }>,
  input: Readonly<{ ticketId: string; token: string; userId: string; kind: any; originalFileName: string; declaredMimeType: string; stream: any; accessScope?: AssetAccessScope }>,
  now = Date.now(),
): Promise<CompletedAsset> => {
  const ticket = await access.getTicket(input.ticketId);
  if (!ticket || ticket.consumedAt !== null || ticket.expiresAt <= now || ticket.userId !== input.userId) throw new Error('UPLOAD_TICKET_INVALID_OR_EXPIRED');
  if (!equalsHash(ticket.tokenHash, hashToken(input.token))) throw new Error('UPLOAD_TICKET_INVALID_OR_EXPIRED');
  const stored = await store.store({ kind: input.kind, originalFileName: input.originalFileName, declaredMimeType: input.declaredMimeType, stream: input.stream });
  const asset: ManagedAssetMetadata = {
    id: randomUUID(), ownerUserId: input.userId, storageKey: stored.storageKey, mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes, sha256: stored.sha256, originalFileName: stored.originalFileName,
    accessScope: input.accessScope ?? 'owner', status: 'active', scannerStatus: 'pending',
  };
  try {
    if (!(await completion.persistCompletion(asset, ticket.id, now))) throw new Error('UPLOAD_TICKET_ALREADY_CONSUMED');
    return { asset, ticket };
  } catch (error) {
    await store.moveToTrash(stored.storageKey).catch(() => undefined);
    throw error;
  }
};
export const canReadAsset = (
  asset: ManagedAssetMetadata,
  viewerUserId: string | null,
): boolean => {
  if (asset.status !== 'active' || asset.scannerStatus !== 'clean') return false;
  if (asset.accessScope === 'public') return true;
  if (!viewerUserId) return false;
  return asset.accessScope === 'authenticated' || asset.ownerUserId === viewerUserId;
};

export const assertAssetIntegrity = (asset: ManagedAssetMetadata, bytes: Uint8Array) => {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256 || bytes.byteLength !== asset.sizeBytes) throw new Error('ASSET_INTEGRITY_MISMATCH');
};