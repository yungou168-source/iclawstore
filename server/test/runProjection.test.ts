import { describe, expect, it } from "bun:test";
import { decodeRunCursor, encodeRunCursor } from "../src/services/runProjection.js";

describe("Run cursor", () => {
  it("round-trips the stable createdAt and runId seek tuple", () => {
    const cursor = { createdAt: "2026-08-08T10:00:00.000Z", runId: "run-1" };
    expect(decodeRunCursor(encodeRunCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed cursors instead of widening the query", () => {
    expect(decodeRunCursor("not-a-cursor")).toBeNull();
    expect(
      decodeRunCursor(
        Buffer.from(JSON.stringify({ createdAt: "invalid", runId: "run-1" })).toString("base64url"),
      ),
    ).toBeNull();
  });
});
