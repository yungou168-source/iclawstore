import { describe, expect, it } from "bun:test";
import { AiDirectHiringError } from "../src/services/aiDirectErrors.js";
import {
  assertRemoteModelAllowed,
  interviewRetentionDefaults,
  normalizeInterviewRetentionPolicy,
  retentionExpiresAt,
} from "../src/services/interviewRetentionPolicy.js";

describe("interview retention policy", () => {
  it("only accepts the approved v1 policy values", () => {
    expect(normalizeInterviewRetentionPolicy({ ...interviewRetentionDefaults })).toEqual(
      interviewRetentionDefaults,
    );
    expect(() =>
      normalizeInterviewRetentionPolicy({ ...interviewRetentionDefaults, bodyRetentionDays: 30 }),
    ).toThrow(AiDirectHiringError);
  });

  it("sets a 90-day deadline without retaining model consent in message data", () => {
    const createdAt = new Date("2026-08-09T00:00:00.000Z");
    expect(retentionExpiresAt(createdAt).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("blocks remote-model use for a participant who opted out", () => {
    expect(() =>
      assertRemoteModelAllowed({ policy: interviewRetentionDefaults, optedOutAt: new Date() }),
    ).toThrow(AiDirectHiringError);
    expect(() =>
      assertRemoteModelAllowed({ policy: interviewRetentionDefaults, optedOutAt: null }),
    ).not.toThrow();
  });
});
