import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

export type ManagedAssetKind =
  | "avatar"
  | "image_2d"
  | "model_3d"
  | "sidebar_icon"
  | "template_screenshot"
  | "template_package";

export interface ManagedAssetPolicy {
  kind: ManagedAssetKind;
  maxBytes: number;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  validate(handle: FileHandle, sizeBytes: number, detectedMimeType: string): Promise<unknown>;
}

export interface TemplateManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;
  author: { name: string; publisherId: string };
  screenshots: string[];
  dataSchemaVersion: number;
  capabilities: string[];
}

export class ManagedAssetValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ManagedAssetValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const TEMPLATE_CAPABILITIES = new Set(["local-storage", "markdown-import", "markdown-export"]);

const imagePolicy = (kind: ManagedAssetKind, maxBytes: number): ManagedAssetPolicy => ({
  kind,
  maxBytes,
  extensions: IMAGE_EXTENSIONS,
  mimeTypes: IMAGE_MIME_TYPES,
  validate: validateRasterImage,
});

export const MANAGED_ASSET_POLICIES: Record<ManagedAssetKind, ManagedAssetPolicy> = {
  avatar: imagePolicy("avatar", 5 * 1024 * 1024),
  image_2d: imagePolicy("image_2d", 10 * 1024 * 1024),
  sidebar_icon: imagePolicy("sidebar_icon", 2 * 1024 * 1024),
  template_screenshot: imagePolicy("template_screenshot", 10 * 1024 * 1024),
  model_3d: {
    kind: "model_3d",
    maxBytes: 50 * 1024 * 1024,
    extensions: [".glb"],
    mimeTypes: ["model/gltf-binary", "application/octet-stream"],
    validate: validateGlb,
  },
  template_package: {
    kind: "template_package",
    maxBytes: 50 * 1024 * 1024,
    extensions: [".clawtemplate"],
    mimeTypes: ["application/zip", "application/octet-stream"],
    validate: validateTemplatePackage,
  },
};

export function validateOriginalFileName(
  originalFileName: string,
  policy: ManagedAssetPolicy,
): string {
  if (
    originalFileName.length < 1 ||
    originalFileName.length > 255 ||
    /[\x00-\x1f\x7f]/.test(originalFileName) ||
    originalFileName.includes("/") ||
    originalFileName.includes("\\")
  ) {
    throw new ManagedAssetValidationError("INVALID_FILE_NAME", "文件名不合法");
  }

  const lower = originalFileName.toLowerCase();
  const extension = policy.extensions.find((candidate) => lower.endsWith(candidate));
  if (!extension) {
    throw new ManagedAssetValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      `文件扩展名不受支持，仅允许 ${policy.extensions.join(", ")}`,
      415,
    );
  }

  const stem = originalFileName.slice(0, -extension.length);
  if (!stem || stem.startsWith(".") || stem.includes(".")) {
    throw new ManagedAssetValidationError("INVALID_FILE_NAME", "禁止隐藏文件名和双扩展名");
  }
  return extension;
}

export function validateDeclaredMimeType(
  declaredMimeType: string,
  policy: ManagedAssetPolicy,
): void {
  const normalized = declaredMimeType.toLowerCase().split(";", 1)[0]?.trim();
  if (!policy.mimeTypes.includes(normalized)) {
    throw new ManagedAssetValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      `声明的媒体类型不受支持：${declaredMimeType}`,
      415,
    );
  }
}

export function detectMimeType(prefix: Uint8Array): string | null {
  if (
    prefix.length >= 8 &&
    prefix[0] === 0x89 &&
    prefix[1] === 0x50 &&
    prefix[2] === 0x4e &&
    prefix[3] === 0x47 &&
    prefix[4] === 0x0d &&
    prefix[5] === 0x0a &&
    prefix[6] === 0x1a &&
    prefix[7] === 0x0a
  ) {
    return "image/png";
  }
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    prefix.length >= 12 &&
    Buffer.from(prefix.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(prefix.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (prefix.length >= 4 && Buffer.from(prefix.subarray(0, 4)).readUInt32LE(0) === 0x46546c67) {
    return "model/gltf-binary";
  }
  if (
    prefix.length >= 4 &&
    prefix[0] === 0x50 &&
    prefix[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(prefix[2] ?? -1) &&
    [0x04, 0x06, 0x08].includes(prefix[3] ?? -1)
  ) {
    return "application/zip";
  }
  return null;
}

export function validateDetectedMimeType(
  detectedMimeType: string | null,
  policy: ManagedAssetPolicy,
): asserts detectedMimeType is string {
  const expected =
    policy.kind === "model_3d"
      ? ["model/gltf-binary"]
      : policy.kind === "template_package"
        ? ["application/zip"]
        : IMAGE_MIME_TYPES;
  if (!detectedMimeType || !expected.includes(detectedMimeType as never)) {
    throw new ManagedAssetValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      "文件内容与允许的媒体格式不匹配",
      415,
    );
  }
}

async function validateRasterImage(
  handle: FileHandle,
  sizeBytes: number,
  detectedMimeType: string,
): Promise<void> {
  if (detectedMimeType === "image/png") {
    if (sizeBytes < 24) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "PNG 文件结构不完整");
    }
    const header = Buffer.alloc(24);
    await handle.read(header, 0, header.length, 0);
    if (
      header.readUInt32BE(8) !== 13 ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      header.readUInt32BE(16) === 0 ||
      header.readUInt32BE(20) === 0
    ) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "PNG IHDR 无效");
    }
    return;
  }

  if (detectedMimeType === "image/jpeg") {
    if (sizeBytes < 4) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "JPEG 文件结构不完整");
    }
    const trailer = Buffer.alloc(2);
    await handle.read(trailer, 0, 2, sizeBytes - 2);
    if (trailer[0] !== 0xff || trailer[1] !== 0xd9) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "JPEG 结束标记无效");
    }
    return;
  }

  if (detectedMimeType === "image/webp") {
    if (sizeBytes < 20) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "WebP 文件结构不完整");
    }
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    if (
      header.readUInt32LE(4) + 8 !== sizeBytes ||
      !["VP8 ", "VP8L", "VP8X"].includes(header.toString("ascii", 12, 16))
    ) {
      throw new ManagedAssetValidationError("INVALID_IMAGE", "WebP RIFF 结构无效");
    }
  }
}

async function validateGlb(handle: FileHandle, sizeBytes: number): Promise<void> {
  if (sizeBytes < 20) {
    throw new ManagedAssetValidationError("INVALID_GLB", "GLB 文件过短");
  }
  const header = Buffer.alloc(12);
  await handle.read(header, 0, header.length, 0);
  if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2) {
    throw new ManagedAssetValidationError("INVALID_GLB", "仅支持 GLB 2.0");
  }
  if (header.readUInt32LE(8) !== sizeBytes) {
    throw new ManagedAssetValidationError("INVALID_GLB", "GLB 声明长度与文件大小不一致");
  }

  let offset = 12;
  let json: unknown;
  while (offset + 8 <= sizeBytes) {
    const chunkHeader = Buffer.alloc(8);
    await handle.read(chunkHeader, 0, chunkHeader.length, offset);
    const chunkLength = chunkHeader.readUInt32LE(0);
    const chunkType = chunkHeader.readUInt32LE(4);
    offset += 8;
    if (chunkLength > sizeBytes - offset) {
      throw new ManagedAssetValidationError("INVALID_GLB", "GLB chunk 越界");
    }
    if (chunkType === 0x4e4f534a && json === undefined) {
      if (chunkLength > 4 * 1024 * 1024) {
        throw new ManagedAssetValidationError("INVALID_GLB", "GLB JSON chunk 过大");
      }
      const jsonBuffer = Buffer.alloc(chunkLength);
      await handle.read(jsonBuffer, 0, chunkLength, offset);
      try {
        json = JSON.parse(
          jsonBuffer
            .toString("utf8")
            .replace(/\u0000+$/g, "")
            .trim(),
        );
      } catch {
        throw new ManagedAssetValidationError("INVALID_GLB", "GLB JSON chunk 无效");
      }
    }
    offset += chunkLength;
  }
  if (offset !== sizeBytes || !json || typeof json !== "object") {
    throw new ManagedAssetValidationError("INVALID_GLB", "GLB 结构不完整");
  }

  const document = json as {
    buffers?: Array<{ uri?: unknown }>;
    images?: Array<{ uri?: unknown }>;
  };
  const externalUris = [...(document.buffers ?? []), ...(document.images ?? [])]
    .map((item) => item.uri)
    .filter((uri): uri is string => typeof uri === "string" && !uri.startsWith("data:"));
  if (externalUris.length > 0) {
    throw new ManagedAssetValidationError("INVALID_GLB", "GLB 不能引用外部资源");
  }
}

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

async function validateTemplatePackage(
  handle: FileHandle,
  sizeBytes: number,
): Promise<TemplateManifest> {
  const entries = await readZipEntries(handle, sizeBytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get("manifest.json");
  if (!manifestEntry || !byName.has("index.html")) {
    throw new ManagedAssetValidationError(
      "INVALID_TEMPLATE_PACKAGE",
      "模板包根目录必须包含 manifest.json 和 index.html",
    );
  }

  const manifest = parseTemplateManifest(await readZipEntry(handle, manifestEntry));
  if (manifest.entry !== "index.html") {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_MANIFEST", "entry 必须为 index.html");
  }
  for (const screenshot of manifest.screenshots) {
    validateArchivePath(screenshot);
    const entry = byName.get(screenshot);
    if (!entry || !/^screenshots\/.+\.(png|jpe?g|webp)$/i.test(screenshot)) {
      throw new ManagedAssetValidationError(
        "INVALID_TEMPLATE_MANIFEST",
        `截图不存在或格式不受支持：${screenshot}`,
      );
    }
  }
  return manifest;
}

async function readZipEntries(handle: FileHandle, sizeBytes: number): Promise<ZipEntry[]> {
  const tailLength = Math.min(sizeBytes, 65_557);
  const tail = Buffer.alloc(tailLength);
  await handle.read(tail, 0, tailLength, sizeBytes - tailLength);
  let eocdOffset = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 中央目录不存在");
  }

  const entryCount = tail.readUInt16LE(eocdOffset + 10);
  const centralSize = tail.readUInt32LE(eocdOffset + 12);
  const centralOffset = tail.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "不支持 ZIP64 模板包");
  }
  if (entryCount < 3 || entryCount > 256 || centralSize > 4 * 1024 * 1024) {
    throw new ManagedAssetValidationError(
      "INVALID_TEMPLATE_PACKAGE",
      "模板包文件数量或目录大小超限",
    );
  }
  if (centralOffset + centralSize > sizeBytes) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 中央目录越界");
  }

  const central = Buffer.alloc(centralSize);
  await handle.read(central, 0, centralSize, centralOffset);
  const entries: ZipEntry[] = [];
  let offset = 0;
  let expandedBytes = 0;
  while (offset < central.length && entries.length < entryCount) {
    if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
      throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 中央目录损坏");
    }
    const flags = central.readUInt16LE(offset + 8);
    const method = central.readUInt16LE(offset + 10);
    const compressedSize = central.readUInt32LE(offset + 20);
    const uncompressedSize = central.readUInt32LE(offset + 24);
    const nameLength = central.readUInt16LE(offset + 28);
    const extraLength = central.readUInt16LE(offset + 30);
    const commentLength = central.readUInt16LE(offset + 32);
    const localHeaderOffset = central.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > central.length) {
      throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 文件名越界");
    }
    const name = central.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    validateArchivePath(name);
    if (entries.some((entry) => entry.name === name)) {
      throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", `ZIP 路径重复：${name}`);
    }
    if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) {
      throw new ManagedAssetValidationError(
        "INVALID_TEMPLATE_PACKAGE",
        "模板包禁止加密或未知压缩算法",
      );
    }
    expandedBytes += uncompressedSize;
    if (uncompressedSize > 20 * 1024 * 1024 || expandedBytes > 100 * 1024 * 1024) {
      throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "模板包展开大小超限");
    }
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (entries.length !== entryCount || offset !== central.length) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 条目数量不一致");
  }
  return entries;
}

function validateArchivePath(name: string): void {
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    !normalized ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", `ZIP 路径不安全：${name}`);
  }
}

async function readZipEntry(handle: FileHandle, entry: ZipEntry): Promise<Buffer> {
  if (entry.uncompressedSize > 256 * 1024 || entry.compressedSize > 256 * 1024) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_MANIFEST", "manifest.json 过大");
  }
  const localHeader = Buffer.alloc(30);
  await handle.read(localHeader, 0, localHeader.length, entry.localHeaderOffset);
  if (localHeader.readUInt32LE(0) !== 0x04034b50) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 本地条目损坏");
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = Buffer.alloc(entry.compressedSize);
  await handle.read(compressed, 0, compressed.length, dataOffset);
  const output =
    entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 256 * 1024 });
  if (output.length !== entry.uncompressedSize) {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_PACKAGE", "ZIP 条目展开长度不一致");
  }
  return output;
}

function parseTemplateManifest(buffer: Buffer): TemplateManifest {
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ManagedAssetValidationError(
      "INVALID_TEMPLATE_MANIFEST",
      "manifest.json 不是有效 JSON",
    );
  }
  if (!value || typeof value !== "object") {
    throw new ManagedAssetValidationError("INVALID_TEMPLATE_MANIFEST", "manifest.json 必须是对象");
  }
  const manifest = value as Partial<TemplateManifest>;
  const author = manifest.author;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.id !== "string" ||
    manifest.id.length < 3 ||
    manifest.id.length > 160 ||
    typeof manifest.name !== "string" ||
    manifest.name.length < 1 ||
    manifest.name.length > 160 ||
    typeof manifest.description !== "string" ||
    manifest.description.length < 1 ||
    manifest.description.length > 2000 ||
    typeof manifest.version !== "string" ||
    manifest.version.length < 1 ||
    manifest.version.length > 64 ||
    manifest.entry !== "index.html" ||
    !author ||
    typeof author.name !== "string" ||
    typeof author.publisherId !== "string" ||
    !Number.isInteger(manifest.dataSchemaVersion) ||
    (manifest.dataSchemaVersion ?? 0) < 1 ||
    !Array.isArray(manifest.screenshots) ||
    manifest.screenshots.length < 1 ||
    manifest.screenshots.length > 4 ||
    !manifest.screenshots.every((item) => typeof item === "string") ||
    !Array.isArray(manifest.capabilities) ||
    !manifest.capabilities.every(
      (item) => typeof item === "string" && TEMPLATE_CAPABILITIES.has(item),
    )
  ) {
    throw new ManagedAssetValidationError(
      "INVALID_TEMPLATE_MANIFEST",
      "manifest.json 字段或能力声明不合法",
    );
  }
  return manifest as TemplateManifest;
}
