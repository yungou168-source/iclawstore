import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Readable } from "node:stream";

const STORAGE_PATH_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type StoredArtifact = Readonly<{
  storagePath: string;
  sizeBytes: number;
  sha256: string;
}>;

export class ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    if (!root || !isAbsolute(root)) {
      throw new Error("AI_DIRECT_ARTIFACT_ROOT 必须是绝对路径");
    }
    this.root = resolve(root);
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ArtifactStore | undefined {
    const root = environment.AI_DIRECT_ARTIFACT_ROOT?.trim();
    return root ? new ArtifactStore(root) : undefined;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o750 });
  }

  async openVerified(artifact: StoredArtifact): Promise<Readable> {
    const path = this.resolveStoragePath(artifact.storagePath);
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size !== artifact.sizeBytes) {
      throw new Error("Artifact bytes do not match registered metadata");
    }
    const handle = await open(path, "r");
    try {
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < metadata.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, metadata.size - position),
          position,
        );
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      if (position !== metadata.size || hash.digest("hex") !== artifact.sha256) {
        throw new Error("Artifact bytes do not match registered hash");
      }
    } finally {
      await handle.close();
    }
    return createReadStream(path);
  }

  private resolveStoragePath(storagePath: string): string {
    if (!STORAGE_PATH_PATTERN.test(storagePath)) {
      throw new Error("Artifact storage path is invalid");
    }
    const path = resolve(this.root, storagePath);
    const relativePath = relative(this.root, path);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Artifact storage path escapes the artifact root");
    }
    return path;
  }
}
