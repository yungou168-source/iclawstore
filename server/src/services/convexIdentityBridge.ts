import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { AuthRequiredError, type AuthenticatedUser } from "../middleware/aiDirectAuth.js";

type ConvexUser = {
  _id: string;
  name?: string;
  email?: string;
  image?: string;
  handle?: string;
  displayName?: string;
  role?: string;
  deactivatedAt?: number;
  deletedAt?: number;
};

type IdentityRow = RowDataPacket & {
  userId: string;
  deactivatedAt: Date | null;
  deletedAt: Date | null;
};

export type ConvexIdentityBridgeConfig = {
  issuer: string;
  audience: string;
  convexUrl: string;
  jwksUri?: string;
};

const meReference = makeFunctionReference<"query", Record<string, never>, ConvexUser | null>(
  "users:me",
);

const requiredUrl = (value: string | undefined, name: string): string => {
  const normalized = value?.trim().replace(/\/$/, "");
  if (!normalized) throw new Error(`${name} is required for AI Direct Hiring authentication`);
  return normalized;
};

export const identityBridgeConfigFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): ConvexIdentityBridgeConfig => ({
  issuer: requiredUrl(env.CONVEX_AUTH_ISSUER ?? env.CONVEX_SITE_URL, "CONVEX_AUTH_ISSUER"),
  audience: env.CONVEX_AUTH_AUDIENCE?.trim() || "convex",
  convexUrl: requiredUrl(env.CONVEX_URL ?? env.VITE_CONVEX_URL, "CONVEX_URL"),
  jwksUri: env.CONVEX_AUTH_JWKS_URI?.trim() || undefined,
});

const bearerToken = (authorization: string | undefined): string => {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new AuthRequiredError("Bearer authentication token required");
  return match[1];
};

const assertSubject = (payload: JWTPayload): string => {
  if (!payload.sub?.trim())
    throw new AuthRequiredError("Authentication token has no stable subject");
  return payload.sub;
};

export const convexAuthUserIdFromSubject = (subject: string): string => {
  const parts = subject.split("|");
  if (
    parts.length !== 2 ||
    parts.some((part) => !part || part !== part.trim() || /\s/.test(part))
  ) {
    throw new AuthRequiredError("Authentication token has invalid Convex Auth subject");
  }
  return parts[0];
};

export const assertConvexAuthUserIdMatches = (
  subjectUserId: string,
  activeUserId: string,
): void => {
  if (subjectUserId !== activeUserId) {
    throw new AuthRequiredError("Authentication subject does not match the active Convex user");
  }
};

const loadJwksUri = async (config: ConvexIdentityBridgeConfig): Promise<string> => {
  if (config.jwksUri) return requiredUrl(config.jwksUri, "CONVEX_AUTH_JWKS_URI");
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Convex OIDC discovery failed with HTTP ${response.status}`);
  const discovery = (await response.json()) as { issuer?: string; jwks_uri?: string };
  if (discovery.issuer !== config.issuer) throw new Error("Convex OIDC discovery issuer mismatch");
  return requiredUrl(discovery.jwks_uri, "OIDC jwks_uri");
};

const syncBusinessUser = async (
  connection: PoolConnection,
  identity: { issuer: string; subject: string },
  convexUser: ConvexUser,
): Promise<AuthenticatedUser> => {
  const [identityRows] = await connection.query<IdentityRow[]>(
    `SELECT i.userId, u.deactivatedAt, u.deletedAt
     FROM ai_direct_auth_identities i
     JOIN users u ON u.id = i.userId
     WHERE i.issuer = ? AND i.subject = ?
     LIMIT 1 FOR UPDATE`,
    [identity.issuer, identity.subject],
  );
  const existing = identityRows[0];
  if (existing && (existing.deactivatedAt || existing.deletedAt)) {
    throw new AuthRequiredError("Business user is disabled");
  }
  if (existing && existing.userId !== convexUser._id) {
    throw new AuthRequiredError("Authentication identity mapping conflict");
  }

  await connection.query(
    `INSERT INTO users
     (id, name, image, email, handle, displayName, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), image = VALUES(image), email = VALUES(email),
       handle = VALUES(handle), displayName = VALUES(displayName),
       role = VALUES(role), updatedAt = NOW()`,
    [
      convexUser._id,
      convexUser.name ?? null,
      convexUser.image ?? null,
      convexUser.email ?? null,
      convexUser.handle ?? null,
      convexUser.displayName ?? null,
      convexUser.role ?? "user",
    ],
  );
  await connection.query(
    `INSERT INTO ai_direct_auth_identities
     (id, issuer, subject, userId, lastAuthenticatedAt, createdAt, updatedAt)
     VALUES (UUID(), ?, ?, ?, NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE lastAuthenticatedAt = NOW(), updatedAt = NOW()`,
    [identity.issuer, identity.subject, convexUser._id],
  );

  return {
    id: convexUser._id,
    convexUserId: convexUser._id,
    issuer: identity.issuer,
    subject: identity.subject,
    role: convexUser.role,
    email: convexUser.email,
    name: convexUser.name,
    handle: convexUser.handle,
    displayName: convexUser.displayName,
    image: convexUser.image,
    authSource: "convex",
  };
};

export const createConvexIdentityBridge = async (
  pool: Pool,
  config: ConvexIdentityBridgeConfig,
): Promise<{ authenticate(authorization: string | undefined): Promise<AuthenticatedUser> }> => {
  const jwksUri = await loadJwksUri(config);
  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });

  return {
    async authenticate(authorization) {
      const token = bearerToken(authorization);
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
          clockTolerance: 5,
          maxTokenAge: "15m",
        }));
      } catch {
        throw new AuthRequiredError("Invalid or expired authentication token");
      }
      const tokenSubject = assertSubject(payload);
      const subject = convexAuthUserIdFromSubject(tokenSubject);

      const convex = new ConvexHttpClient(config.convexUrl);
      convex.setAuth(token);
      let convexUser: ConvexUser | null;
      try {
        convexUser = await convex.query(meReference, {});
      } catch {
        throw new AuthRequiredError("Unable to confirm current account status");
      }
      if (!convexUser || convexUser.deletedAt || convexUser.deactivatedAt) {
        throw new AuthRequiredError("Account is no longer active");
      }
      assertConvexAuthUserIdMatches(subject, convexUser._id);

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const user = await syncBusinessUser(
          connection,
          { issuer: config.issuer, subject },
          convexUser,
        );
        await connection.commit();
        return user;
      } catch (error) {
        await connection.rollback();
        if (error instanceof AuthRequiredError) throw error;
        throw new AuthRequiredError("Unable to establish business identity");
      } finally {
        connection.release();
      }
    },
  };
};
