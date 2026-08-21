import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  detectMimeType,
  MANAGED_ASSET_POLICIES,
  ManagedAssetValidationError,
  validateDeclaredMimeType,
  validateDetectedMimeType,
  validateOriginalFileName,
} from './managedAssetValidation.js';
import type { ManagedAssetPort } from './managedAssetPort.js';
import type {
  OpenedManagedAsset,
  StoreManagedAssetInput,
  StoredManagedAsset,
} from './managedAssetStore.js';

export type FakeManagedAssetRecord = StoredManagedAsset & { bytes: Buffer };

/** Deterministic candidate-only port for service and worker tests; it never touches storage. */
export const createFakeManagedAssetPort = (): ManagedAssetPort & {
  readonly records: Map<string, FakeManagedAssetRecord>;
  readonly trash: Map<string, FakeManagedAssetRecord>;
} => {
  const records = new Map<string, FakeManagedAssetRecord>();
  const trash = new Map<string, FakeManagedAssetRecord>();

  const readBytes = async (stream: StoreManagedAssetInput['stream']): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  };

  return {
    records,
    trash,
    async store(input) {
      const policy = MANAGED_ASSET_POLICIES[input.kind];
      const extension = validateOriginalFileName(input.originalFileName, policy);
      validateDeclaredMimeType(input.declaredMimeType, policy);
      const bytes = await readBytes(input.stream);
      if (bytes.length === 0) throw new ManagedAssetValidationError('EMPTY_ASSET', '上传文件不能为空');
      if (bytes.length > policy.maxBytes) {
        throw new ManagedAssetValidationError('ASSET_TOO_LARGE', `文件超过 ${policy.maxBytes} 字节限制`, 413);
      }
      if ((input.stream as Readable & { truncated?: boolean }).truncated) {
        throw new ManagedAssetValidationError('ASSET_TOO_LARGE', '上传流已被大小限制截断', 413);
      }
      const detectedMimeType = detectMimeType(bytes.subarray(0, 64));
      validateDetectedMimeType(detectedMimeType, policy);
      const id = randomUUID();
      const storageKey = `${input.kind}/${id.slice(0, 2)}/${id}${extension}`;
      const record: FakeManagedAssetRecord = {
        storageKey,
        originalFileName: input.originalFileName,
        mimeType: detectedMimeType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      };
      records.set(storageKey, record);
      return record;
    },
    async open(storageKey): Promise<OpenedManagedAsset> {
      const record = records.get(storageKey);
      if (!record) throw new Error('ASSET_NOT_FOUND');
      return { stream: Readable.from(record.bytes), sizeBytes: record.sizeBytes };
    },
    async moveToTrash(storageKey) {
      const record = records.get(storageKey);
      if (!record) throw new Error('ASSET_NOT_FOUND');
      const trashName = `trash-${randomUUID()}`;
      records.delete(storageKey);
      trash.set(trashName, record);
      return trashName;
    },
    async deleteFromTrash(trashName) {
      trash.delete(trashName);
    },
  };
};