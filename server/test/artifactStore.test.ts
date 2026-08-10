import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/services/artifactStore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("ArtifactStore", () => {
  it("verifies metadata before returning a streaming artifact reader", async () => {
    const root = await mkdtemp(join(tmpdir(), "iclawstore-artifacts-"));
    directories.push(root);
    const content = Buffer.from("artifact payload");
    await Bun.write(join(root, "report.json"), content);
    const store = new ArtifactStore(root);

    const stream = await store.openVerified({
      storagePath: "report.json",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    expect(await new Response(stream).text()).toBe("artifact payload");
  });

  it("rejects path traversal and bytes that no longer match registered metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "iclawstore-artifacts-"));
    directories.push(root);
    await writeFile(join(root, "report.json"), "changed");
    const store = new ArtifactStore(root);

    await expect(
      store.openVerified({
        storagePath: "../report.json",
        sizeBytes: 7,
        sha256: "a".repeat(64),
      }),
    ).rejects.toThrow("invalid");
    await expect(
      store.openVerified({
        storagePath: "report.json",
        sizeBytes: 7,
        sha256: "a".repeat(64),
      }),
    ).rejects.toThrow("hash");
  });
});
