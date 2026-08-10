import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createRemoteJWKSet, jwtVerify, type JWTHeaderParameters, type JWTPayload } from "jose";
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

export type DesktopOAuthIdentityConfig = {
  issuer: string;
  audience: string;
  clientId: string;
  jwksUri?: string;
};

export type ConvexIdentityBridgeConfig = {
  issuer: string;
  audience: string;
  convexUrl: string;
  jwksUri?: string;
  desktopOAuth?: DesktopOAuthIdentityConfig;
};

const meReference = makeFunctionReference<"query", Record<string, never>, ConvexUser | null>(
  "users:me",
);
const desktopMeReference = makeFunctionReference<"query", Record<string, never>, ConvexUser | null>(
  "desktopOAuth:getDesktopAccessIdentity",
);

type TrustedTokenIdentity = {
  issuer: string;
  subject: string;
  convexUser: ConvexUser;
};

type TokenVerifier = {
  config: {
    issuer: string;
    audience: string;
    jwksUri?: string;
  };
  jwks: ReturnType<typeof createRemoteJWKSet>;
};

const requiredUrl = (value: string | undefined, name: string): string => {
  const normalized = value?.trim().replace(/\/$/, "");
  if (!normalized) throw new Error(`${name} is required for AI Direct Hiring authentication`);
  return normalized;
};

export const identityBridgeConfigFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): ConvexIdentityBridgeConfig => {
  const issuer = requiredUrl(env.CONVEX_AUTH_ISSUER ?? env.CONVEX_SITE_URL, "CONVEX_AUTH_ISSUER");
  const desktopIssuer = env.CONVEX_DESKTOP_AUTH_ISSUER?.trim();
  const desktopClientId = env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim();
  if ((desktopIssuer && !desktopClientId) || (!desktopIssuer && desktopClientId)) {
    throw new Error(
      "CONVEX_DESKTOP_AUTH_ISSUER and AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID must be configured together",
    );
  }

  return {
    issuer,
    audience: env.CONVEX_AUTH_AUDIENCE?.trim() || "convex",
    convexUrl: requiredUrl(env.CONVEX_URL ?? env.VITE_CONVEX_URL, "CONVEX_URL"),
    jwksUri: env.CONVEX_AUTH_JWKS_URI?.trim() || undefined,
    desktopOAuth:
      desktopIssuer && desktopClientId
        ? {
            issuer: requiredUrl(desktopIssuer, "CONVEX_DESKTOP_AUTH_ISSUER"),
            audience:
              env.CONVEX_DESKTOP_AUTH_AUDIENCE?.trim() ||
              "https://www.iclawstore.com/api/v1/ai-direct-hiring",
            clientId: desktopClientId,
            jwksUri: env.CONVEX_DESKTOP_AUTH_JWKS_URI?.trim() || undefined,
          }
        : undefined,
  };
};

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

const loadJwksUri = async (config: { issuer: string; jwksUri?: string }): Promise<string> => {
  if (config.jwksUri) return requiredUrl(config.jwksUri, "OIDC_JWKS_URI");
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}`);
  const discovery = (await response.json()) as { issuer?: string; jwks_uri?: string };
  if (discovery.issuer !== config.issuer) throw new Error("OIDC discovery issuer mismatch");
  return requiredUrl(discovery.jwks_uri, "OIDC jwks_uri");
};

const createTokenVerifier = async (config: TokenVerifier["config"]): Promise<TokenVerifier> => {
  const jwksUri = await loadJwksUri(config);
  return {
    config,
    jwks: createRemoteJWKSet(new URL(jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    }),
  };
};

const verifyToken = async (
  token: string,
  verifier: TokenVerifier,
  maxTokenAge: string,
): Promise<{ payload: JWTPayload; protectedHeader: JWTHeaderParameters }> =>
  jwtVerify(token, verifier.jwks, {
    issuer: verifier.config.issuer,
    audience: verifier.config.audience,
    algorithms: ["RS256"],
    clockTolerance: 5,
    maxTokenAge,
  });

const queryActiveConvexUser = async (
  convexUrl: string,
  token: string,
  reference: typeof meReference | typeof desktopMeReference,
): Promise<ConvexUser> => {
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(token);
  let convexUser: ConvexUser | null;
  try {
    convexUser = await convex.query(reference, {});
  } catch {
    throw new AuthRequiredError("Unable to confirm current account status");
  }
  if (!convexUser || convexUser.deletedAt || convexUser.deactivatedAt) {
    throw new AuthRequiredError("Account is no longer active");
  }
  return convexUser;
};

const authenticateWebToken = async (
  token: string,
  verifier: TokenVerifier,
  convexUrl: string,
): Promise<TrustedTokenIdentity> => {
  const { payload } = await verifyToken(token, verifier, "15m");
  const subject = convexAuthUserIdFromSubject(assertSubject(payload));
  const convexUser = await queryActiveConvexUser(convexUrl, token, meReference);
  assertConvexAuthUserIdMatches(subject, convexUser._id);
  return { issuer: verifier.config.issuer, subject, convexUser };
};

const desktopTokenClientId = (payload: JWTPayload): string | null => {
  if (typeof payload.client_id === "string") return payload.client_id;
  return typeof payload.cid === "string" ? payload.cid : null;
};

export const assertDesktopAccessTokenClaims = (
  payload: JWTPayload,
  protectedHeader: JWTHeaderParameters,
  expectedClientId: string,
): void => {
  if (protectedHeader.typ !== "at+jwt" && protectedHeader.typ !== "application/at+jwt") {
    throw new AuthRequiredError("Desktop authentication token has invalid type");
  }
  if (desktopTokenClientId(payload) !== expectedClientId) {
    throw new AuthRequiredError("Desktop authentication token has invalid client");
  }
  if (typeof payload.jti !== "string" || !payload.jti.trim()) {
    throw new AuthRequiredError("Desktop authentication token has no token identifier");
  }
};

const authenticateDesktopToken = async (
  token: string,
  verifier: TokenVerifier,
  desktopConfig: DesktopOAuthIdentityConfig,
  convexUrl: string,
): Promise<TrustedTokenIdentity> => {
  const { payload, protectedHeader } = await verifyToken(token, verifier, "15m");
  assertDesktopAccessTokenClaims(payload, protectedHeader, desktopConfig.clientId);

  const subject = assertSubject(payload);
  const convexUser = await queryActiveConvexUser(convexUrl, token, desktopMeReference);
  assertConvexAuthUserIdMatches(subject, convexUser._id);
  return { issuer: desktopConfig.issuer, subject, convexUser };
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
  const webVerifier = await createTokenVerifier(config);
  const desktopVerifier = config.desktopOAuth
    ? await createTokenVerifier(config.desktopOAuth)
    : undefined;

  return {
    async authenticate(authorization) {
      const token = bearerToken(authorization);
      let identity: TrustedTokenIdentity | null = null;

      try {
        identity = await authenticateWebToken(token, webVerifier, config.convexUrl);
      } catch (webError) {
        if (!desktopVerifier || !config.desktopOAuth) {
          if (webError instanceof AuthRequiredError) throw webError;
          throw new AuthRequiredError("Invalid or expired authentication token");
        }
        try {
          identity = await authenticateDesktopToken(
            token,
            desktopVerifier,
            config.desktopOAuth,
            config.convexUrl,
          );
        } catch {
          throw new AuthRequiredError("Invalid or expired authentication token");
        }
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const user = await syncBusinessUser(
          connection,
          { issuer: identity.issuer, subject: identity.subject },
          identity.convexUser,
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
