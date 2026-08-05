export const DESKTOP_REFRESH_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DESKTOP_REFRESH_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DesktopTokenFamilyPolicy = {
  createdAt: number;
  lastUsedAt: number;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
  revokedAt?: number;
};

export type DesktopTokenFamilyDecision =
  | { active: true }
  | { active: false; reason: "revoked" | "absolute_expired" | "idle_expired" };

type DesktopOAuthUserState = {
  deletedAt?: number;
  deactivatedAt?: number;
};

type DesktopOAuthUserChange =
  | { operation: "insert"; newDoc: DesktopOAuthUserState }
  | { operation: "update"; oldDoc: DesktopOAuthUserState; newDoc: DesktopOAuthUserState }
  | { operation: "delete"; oldDoc: DesktopOAuthUserState };

function isDisabledUser(user: DesktopOAuthUserState): boolean {
  return Boolean(user.deletedAt || user.deactivatedAt);
}

export function shouldRevokeDesktopOAuthForUserChange(change: DesktopOAuthUserChange): boolean {
  if (change.operation === "delete") return !isDisabledUser(change.oldDoc);
  if (!isDisabledUser(change.newDoc)) return false;
  return change.operation === "insert" || !isDisabledUser(change.oldDoc);
}

export function createDesktopTokenFamilyPolicy(now: number): DesktopTokenFamilyPolicy {
  const absoluteExpiresAt = now + DESKTOP_REFRESH_ABSOLUTE_TTL_MS;
  return {
    createdAt: now,
    lastUsedAt: now,
    absoluteExpiresAt,
    idleExpiresAt: Math.min(now + DESKTOP_REFRESH_IDLE_TTL_MS, absoluteExpiresAt),
  };
}

export function evaluateDesktopTokenFamily(
  policy: DesktopTokenFamilyPolicy,
  now: number,
): DesktopTokenFamilyDecision {
  if (policy.revokedAt !== undefined) return { active: false, reason: "revoked" };
  if (policy.absoluteExpiresAt <= now) return { active: false, reason: "absolute_expired" };
  if (policy.idleExpiresAt <= now) return { active: false, reason: "idle_expired" };
  return { active: true };
}

export function touchDesktopTokenFamily(
  policy: DesktopTokenFamilyPolicy,
  now: number,
): Pick<DesktopTokenFamilyPolicy, "lastUsedAt" | "idleExpiresAt"> {
  return {
    lastUsedAt: now,
    idleExpiresAt: Math.min(now + DESKTOP_REFRESH_IDLE_TTL_MS, policy.absoluteExpiresAt),
  };
}
