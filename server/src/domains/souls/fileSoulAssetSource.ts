import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { SoulAssetSource } from './soulAssetCopyConsumer.js';

export const createFileSoulAssetSource = (root: string): SoulAssetSource => {
  if (!isAbsolute(root)) throw new Error('SOUL_ASSET_ROOT must be absolute');
  const resolvedRoot = resolve(root);
  return Object.freeze({
    open: async (legacyStorageId: string) => {
      if (!legacyStorageId || legacyStorageId.includes('\\') || legacyStorageId.includes('..')) throw new Error('Soul asset source key is invalid');
      const path = resolve(join(resolvedRoot, legacyStorageId));
      const relativePath = relative(resolvedRoot, path);
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('Soul asset source path escapes root');
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new Error('Soul asset source is missing');
      return createReadStream(path);
    },
  });
};