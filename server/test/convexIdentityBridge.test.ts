import { describe, expect, it } from "bun:test";
import { AuthRequiredError } from "../src/middleware/aiDirectAuth.js";
import {
  assertConvexAuthUserIdMatches,
  convexAuthUserIdFromSubject,
} from "../src/services/convexIdentityBridge.js";

describe("Convex identity bridge subject", () => {
  it("extracts the stable user ID from a valid userId|sessionId subject", () => {
    expect(convexAuthUserIdFromSubject("convex-user-1|auth-session-1")).toBe(
      "convex-user-1",
    );
  });

  it("keeps the identity mapping stable across session rotation", () => {
    const firstLogin = convexAuthUserIdFromSubject("convex-user-1|auth-session-1");
    const nextLogin = convexAuthUserIdFromSubject("convex-user-1|auth-session-2");

    expect(firstLogin).toBe(nextLogin);
  });

  it.each([
    "",
    "convex-user-1",
    "|auth-session-1",
    "convex-user-1|",
    "convex-user-1|auth-session-1|extra",
    " convex-user-1|auth-session-1",
    "convex-user-1|auth session-1",
  ])("rejects malformed subject %p", (subject) => {
    expect(() => convexAuthUserIdFromSubject(subject)).toThrow(AuthRequiredError);
  });

  it("rejects a subject user ID that differs from users:me", () => {
    expect(() =>
      assertConvexAuthUserIdMatches("convex-user-1", "convex-user-2"),
    ).toThrow(AuthRequiredError);
  });

  it("accepts a subject user ID matching users:me", () => {
    expect(() =>
      assertConvexAuthUserIdMatches("convex-user-1", "convex-user-1"),
    ).not.toThrow();
  });
});