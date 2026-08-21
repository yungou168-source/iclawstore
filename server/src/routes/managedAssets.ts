import type { FastifyInstance } from 'fastify';
import type { ManagedAssetPort } from '../services/managedAssetPort.js';
import { canReadAsset, completeManagedAssetUpload, issueUploadTicket, type AssetAccessRepository, type AssetCompletionRepository } from '../services/managedAssetAccess.js';
import { managedAssetDownloadHeaders } from '../services/managedAssetStore.js';
import type { ManagedAssetKind } from '../services/managedAssetValidation.js';

export const managedAssetRoutes = async (
  fastify: FastifyInstance,
  options: Readonly<{ access: AssetAccessRepository; completion: AssetCompletionRepository; store: ManagedAssetPort }>,
) => {
  fastify.post('/tickets', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return reply.status(401).send({ error: 'Authentication required' });
    const body = request.body as { assetKind?: string; targetId?: string; maxBytes?: number; allowedMimeTypes?: string[]; ttlMs?: number };
    try {
      const ticket = await issueUploadTicket(options.access, { userId, assetKind: body.assetKind ?? '', targetId: body.targetId ?? '', maxBytes: body.maxBytes ?? 0, allowedMimeTypes: body.allowedMimeTypes ?? [], ttlMs: body.ttlMs });
      return reply.status(201).send(ticket);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid upload ticket' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/tickets/:id/complete', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return reply.status(401).send({ error: 'Authentication required' });
    const part = await request.file();
    if (!part) return reply.status(400).send({ error: 'File is required' });
    try {
      const fields = part.fields as Record<string, { value?: unknown }>;
      const completed = await completeManagedAssetUpload(options.access, options.completion, options.store, { ticketId: request.params.id, token: String(fields.token?.value ?? ''), userId, kind: String(fields.assetKind?.value ?? 'avatar') as ManagedAssetKind, originalFileName: part.filename, declaredMimeType: part.mimetype, stream: part.file });
      return reply.status(201).send({ asset: completed.asset });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Upload failed' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/:id/download', async (request, reply) => {
    const asset = await options.access.getAsset(request.params.id);
    const viewer = request.user?.id ?? null;
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });
    if (!canReadAsset(asset, viewer)) return reply.status(viewer ? 404 : 401).send({ error: viewer ? 'Asset not found' : 'Authentication required' });
    const opened = await options.store.open(asset.storageKey);
    return reply.headers({ ...managedAssetDownloadHeaders({ mimeType: asset.mimeType, sha256: asset.sha256, originalFileName: asset.originalFileName ?? undefined, attachment: true }), 'Content-Length': String(asset.sizeBytes) }).send(opened.stream);
  });
};