import { describe, expect, it } from "vitest";
import {
  createDesktopTokenFamilyPolicy,
  DESKTOP_REFRESH_ABSOLUTE_TTL_MS,
  DESKTOP_REFRESH_IDLE_TTL_MS,
  evaluateDesktopTokenFamily,
  shouldRevokeDesktopOAuthForUserChange,
  touchDesktopTokenFamily,
} from "./desktopOAuthTokenPolicy";

describe("desktop OAuth token family policy", () => {
  it("creates fixed absolute and idle deadlines", () => {
    expect(createDesktopTokenFamilyPolicy(1_000)).toEqual({
      createdAt: 1_000,
      lastUsedAt: 1_000,
      absoluteExpiresAt: 1_000 + DESKTOP_REFRESH_ABSOLUTE_TTL_MS,
      idleExpiresAt: 1_000 + DESKTOP_REFRESH_IDLE_TTL_MS,
    });
  });

  it("fails closed for revoked, absolute-expired and idle-expired families", () => {
    const policy = createDesktopTokenFamilyPolicy(1_000);
    expect(evaluateDesktopTokenFamily({ ...policy, revokedAt: 2_000 }, 2_001)).toEqual({
      active: false,
      reason: "revoked",
    });
    expect(evaluateDesktopTokenFamily(policy, policy.absoluteExpiresAt)).toEqual({
      active: false,
      reason: "absolute_expired",
    });
    expect(evaluateDesktopTokenFamily(policy, policy.idleExpiresAt)).toEqual({
      active: false,
      reason: "idle_expired",
    });
  });

  it("revokes only when an account crosses into a disabled state", () => {
    const active = { deletedAt: undefined, deactivatedAt: undefined };
    const deactivated = { ...active, deactivatedAt: 2_000 };

    expect(
      shouldRevokeDesktopOAuthForUserChange({
        operation: "update",
        oldDoc: active,
        newDoc: deactivated,
      }),
    ).toBe(true);
    expect(
      shouldRevokeDesktopOAuthForUserChange({
        operation: "update",
        oldDoc: deactivated,
        newDoc: { ...deactivated, deletedAt: 3_000 },
      }),
    ).toBe(false);
    expect(shouldRevokeDesktopOAuthForUserChange({ operation: "delete", oldDoc: active })).toBe(
      true,
    );
    expect(
      shouldRevokeDesktopOAuthForUserChange({ operation: "delete", oldDoc: deactivated }),
    ).toBe(false);
  });

  it("moves only the idle deadline and never extends the absolute lifetime", () => {
    const policy = createDesktopTokenFamilyPolicy(1_000);
    const nearAbsoluteExpiry = policy.absoluteExpiresAt - 1_000;

    expect(touchDesktopTokenFamily(policy, nearAbsoluteExpiry)).toEqual({
      lastUsedAt: nearAbsoluteExpiry,
      idleExpiresAt: policy.absoluteExpiresAt,
    });
    expect(policy.absoluteExpiresAt).toBe(1_000 + DESKTOP_REFRESH_ABSOLUTE_TTL_MS);
  });
});
