import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import {
  detectMimeType,
  MANAGED_ASSET_POLICIES,
  ManagedAssetValidationError,
  type ManagedAssetKind,
  validateDeclaredMimeType,
  validateDetectedMimeType,
  validateOriginalFileName,
} from './managedAssetValidation.js';
import type { ManagedAssetPort } from './managedAssetPort.js';

export interface StoreManagedAssetInput {
  kind: ManagedAssetKind;
  originalFileName: string;
  declaredMimeType: string;
  stream: Readable;
}

export interface StoredManagedAsset {
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  validationMetadata?: unknown;
}

export interface OpenedManagedAsset {
  stream: Readable;
  sizeBytes: number;
}

export interface ManagedAssetDownloadHeadersInput {
  mimeType: string;
  sha256: string;
  originalFileName?: string;
  attachment?: boolean;
}

const STORAGE_KEY_PATTERN =
  /^(avatar|image_2d|model_3d|sidebar_icon|template_screenshot|template_package)\/[a-f0-9]{2}\/[a-f0-9-]{36}\.[a-z0-9]+$/;

export class ManagedAssetStore implements ManagedAssetPort {
  readonly root: string;
  private readonly temporaryRoot: string;
  private readonly trashRoot: string;

  constructor(root: string) {
    if (!root || !isAbsolute(root)) {
      throw new Error("MANAGED_ASSET_ROOT 必须是绝对路径");
    }
    this.root = resolve(root);
    this.temporaryRoot = join(this.root, ".tmp");
    this.trashRoot = join(this.root, ".trash");
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ManagedAssetStore {
    const root = environment.MANAGED_ASSET_ROOT;
    if (!root) {
      throw new Error("MANAGED_ASSET_ROOT is required");
    }
    return new ManagedAssetStore(root);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.root, { recursive: true, mode: 0o750 }),
      mkdir(this.temporaryRoot, { recursive: true, mode: 0o750 }),
      mkdir(this.trashRoot, { recursive: true, mode: 0o750 }),
    ]);
  }

  async store(input: StoreManagedAssetInput): Promise<StoredManagedAsset> {
    const policy = MANAGED_ASSET_POLICIES[input.kind];
    const extension = validateOriginalFileName(input.originalFileName, policy);
    validateDeclaredMimeType(input.declaredMimeType, policy);
    await this.initialize();

    const assetId = randomUUID();
    const temporaryPath = join(this.temporaryRoot, `${assetId}.part`);
    const storageKey = `${input.kind}/${assetId.slice(0, 2)}/${assetId}${extension}`;
    const destinationPath = this.resolveStorageKey(storageKey);
    let handle: FileHandle | undefined;

    try {
      handle = await open(temporaryPath, "wx+", 0o640);
      const hash = createHash("sha256");
      const prefixParts: Buffer[] = [];
      let prefixBytes = 0;
      let sizeBytes = 0;

      for await (const rawChunk of input.stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        sizeBytes += chunk.length;
        if (sizeBytes > policy.maxBytes) {
          throw new ManagedAssetValidationError(
            "ASSET_TOO_LARGE",
            `文件超过 ${policy.maxBytes} 字节限制`,
            413,
          );
        }
        if (prefixBytes < 64) {
          const part = chunk.subarray(0, Math.min(chunk.length, 64 - prefixBytes));
          prefixParts.push(part);
          prefixBytes += part.length;
        }
        hash.update(chunk);
        await handle.write(chunk);
      }

      if ((input.stream as Readable & { truncated?: boolean }).truncated) {
        throw new ManagedAssetValidationError("ASSET_TOO_LARGE", "上传流已被大小限制截断", 413);
      }
      if (sizeBytes === 0) {
        throw new ManagedAssetValidationError("EMPTY_ASSET", "上传文件不能为空");
      }
      const detectedMimeType = detectMimeType(Buffer.concat(prefixParts));
      validateDetectedMimeType(detectedMimeType, policy);
      await handle.sync();
      const validationMetadata = await policy.validate(handle, sizeBytes, detectedMimeType);
      await handle.close();
      handle = undefined;

      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o750 });
      await rename(temporaryPath, destinationPath);
      return {
        storageKey,
        originalFileName: input.originalFileName,
        mimeType: detectedMimeType,
        sizeBytes,
        sha256: hash.digest("hex"),
        ...(validationMetadata === undefined ? {} : { validationMetadata }),
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async open(storageKey: string): Promise<OpenedManagedAsset> {
    const filePath = this.resolveStorageKey(storageKey);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new ManagedAssetValidationError("ASSET_NOT_FOUND", "资源不存在", 404);
    }
    return {
      stream: createReadStream(filePath),
      sizeBytes: fileStat.size,
    };
  }

  async moveToTrash(storageKey: string): Promise<string> {
    await this.initialize();
    const sourcePath = this.resolveStorageKey(storageKey);
    const trashName = `${Date.now()}-${randomUUID()}-${basename(sourcePath)}`;
    const trashPath = join(this.trashRoot, trashName);
    await rename(sourcePath, trashPath);
    return trashName;
  }

  scheduleTrashCleanup(trashName: string, delayMs = 60 * 60 * 1000): NodeJS.Timeout {
    if (!/^[0-9]+-[a-f0-9-]{36}-[^/\\]+$/i.test(trashName)) {
      throw new ManagedAssetValidationError("INVALID_STORAGE_KEY", "回收站资源键不合法");
    }
    const trashPath = join(this.trashRoot, trashName);
    const timer = setTimeout(
      () => {
        void unlink(trashPath).catch(() => undefined);
      },
      Math.max(0, delayMs),
    );
    timer.unref();
    return timer;
  }

  async deleteFromTrash(trashName: string): Promise<void> {
    if (!/^[0-9]+-[a-f0-9-]{36}-[^/\\]+$/i.test(trashName)) {
      throw new ManagedAssetValidationError("INVALID_STORAGE_KEY", "回收站资源键不合法");
    }
    await unlink(join(this.trashRoot, trashName));
  }

  private resolveStorageKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new ManagedAssetValidationError("INVALID_STORAGE_KEY", "受管资源键不合法");
    }
    const filePath = resolve(this.root, storageKey);
    const relativePath = relative(this.root, filePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new ManagedAssetValidationError("INVALID_STORAGE_KEY", "受管资源路径越界");
    }
    return filePath;
  }
}

export function managedAssetDownloadHeaders(
  input: ManagedAssetDownloadHeadersInput,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": input.mimeType,
    "X-Content-Type-Options": "nosniff",
    ETag: `"${input.sha256}"`,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (input.attachment) {
    const originalName = input.originalFileName ?? "download";
    const asciiName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "download";
    headers["Content-Disposition"] =
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
  }
  return headers;
}

export function managedAssetExtension(storageKey: string): string {
  return extname(storageKey).toLowerCase();
}
