import { describe, expect, it } from "vitest";
import { idempotencyFingerprint } from "../src/utils/idempotency.js";

describe("idempotency", () => {
  // -------------------------------------------------------------------------
  // Fingerprint stability
  // -------------------------------------------------------------------------
  describe("idempotencyFingerprint", () => {
    it("produces the same hash for identical bodies", () => {
      const body = { name: "Test Corp", slug: "test-corp" };
      const a = idempotencyFingerprint(body);
      const b = idempotencyFingerprint(body);
      expect(a).toBe(b);
    });

    it("produces the same hash regardless of key order", () => {
      const bodyA = { name: "Test Corp", slug: "test-corp" };
      const bodyB = { slug: "test-corp", name: "Test Corp" };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("produces different hashes for different bodies", () => {
      const bodyA = { name: "Test Corp A" };
      const bodyB = { name: "Test Corp B" };
      expect(idempotencyFingerprint(bodyA)).not.toBe(idempotencyFingerprint(bodyB));
    });

    it("strips idempotency-key variations from fingerprint", () => {
      const bodyA = { name: "Test", "Idempotency-Key": "key-123" };
      const bodyB = { name: "Test", "Idempotency-Key": "key-456" };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("strips x-request-id from fingerprint", () => {
      const bodyA = { name: "Test", "x-request-id": "uuid-1" };
      const bodyB = { name: "Test", "x-request-id": "uuid-2" };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("strips requestId from fingerprint (camelCase variant)", () => {
      const bodyA = { name: "Test", requestId: "req-1" };
      const bodyB = { name: "Test", requestId: "req-2" };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("strips nested non-deterministic keys", () => {
      const bodyA = { outer: { name: "Test", idempotencyKey: "key-1" } };
      const bodyB = { outer: { name: "Test", idempotencyKey: "key-2" } };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("strips non-deterministic keys from arrays", () => {
      const bodyA = [
        { name: "A", timestamp: 1000 },
        { name: "B", timestamp: 2000 },
      ];
      const bodyB = [
        { name: "A", timestamp: 9999 },
        { name: "B", timestamp: 1 },
      ];
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("produces a 64-char hex string (SHA-256)", () => {
      const fp = idempotencyFingerprint({ test: "value" });
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles null and undefined fields gracefully", () => {
      const bodyA: any = { name: "Test", extra: null };
      const bodyB: any = { name: "Test", extra: undefined };
      expect(idempotencyFingerprint(bodyA)).toBe(idempotencyFingerprint(bodyB));
    });

    it("handles deeply nested objects", () => {
      const body = {
        level1: {
          level2: {
            level3: {
              name: "Deep Name",
              timestamp: 999, // stripped
            },
          },
        },
      };
      const fp = idempotencyFingerprint(body);
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
