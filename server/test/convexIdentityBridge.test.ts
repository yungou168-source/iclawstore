import { describe, expect, it } from "bun:test";
import { AuthRequiredError } from "../src/middleware/aiDirectAuth.js";
import {
  assertConvexAuthUserIdMatches,
  assertDesktopAccessTokenClaims,
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

describe("desktop OAuth access token claims", () => {
  const validPayload = {
    sub: "convex-user-1",
    client_id: "desktop-client",
    jti: "token-id",
  };

  it("accepts an audience-bound access token from the configured client", () => {
    expect(() =>
      assertDesktopAccessTokenClaims(
        validPayload,
        { alg: "RS256", typ: "at+jwt" },
        "desktop-client",
      ),
    ).not.toThrow();
  });

  it("accepts the OAuth cid compatibility claim", () => {
    expect(() =>
      assertDesktopAccessTokenClaims(
        { sub: "convex-user-1", cid: "desktop-client", jti: "token-id" },
        { alg: "RS256", typ: "application/at+jwt" },
        "desktop-client",
      ),
    ).not.toThrow();
  });

  it("rejects an ID token in place of an access token", () => {
    expect(() =>
      assertDesktopAccessTokenClaims(
        validPayload,
        { alg: "RS256", typ: "JWT" },
        "desktop-client",
      ),
    ).toThrow(AuthRequiredError);
  });

  it("rejects a token issued to another desktop client", () => {
    expect(() =>
      assertDesktopAccessTokenClaims(
        validPayload,
        { alg: "RS256", typ: "at+jwt" },
        "other-client",
      ),
    ).toThrow(AuthRequiredError);
  });

  it("rejects a token without a jti replay identifier", () => {
    expect(() =>
      assertDesktopAccessTokenClaims(
        { sub: "convex-user-1", client_id: "desktop-client" },
        { alg: "RS256", typ: "at+jwt" },
        "desktop-client",
      ),
    ).toThrow(AuthRequiredError);
  });
});