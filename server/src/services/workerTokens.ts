import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export type WorkerIdentity = {
  tokenId: string;
  organizationId: string;
  workerId: string;
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export async function createWorkerToken(
  pool: Pool,
  input: {
    organizationId: string;
    workerId: string;
    name: string;
    createdByUserId: string;
    expiresAt?: Date | null;
  },
): Promise<{ id: string; token: string; tokenPrefix: string }> {
  const id = randomUUID();
  const token = `adw_${randomBytes(32).toString("base64url")}`;
  const tokenPrefix = token.slice(0, 12);
  await pool.query(
    `INSERT INTO ai_direct_worker_tokens
     (id, organizationId, workerId, name, tokenPrefix, tokenHash, expiresAt, createdByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.organizationId,
      input.workerId,
      input.name,
      tokenPrefix,
      hashToken(token),
      input.expiresAt ?? null,
      input.createdByUserId,
    ],
  );
  return { id, token, tokenPrefix };
}

function readBearerToken(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) {
    throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, "Worker token 无效", 401);
  }
  const token = value.slice("Bearer ".length).trim();
  if (!/^adw_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, "Worker token 无效", 401);
  }
  return token;
}

export async function authenticateWorker(
  pool: Pool,
  headers: Record<string, unknown>,
): Promise<WorkerIdentity> {
  const token = readBearerToken(headers.authorization);
  const workerId = headers["x-worker-id"];
  if (typeof workerId !== "string" || !workerId || workerId.length > 128) {
    throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, "Worker identity 无效", 401);
  }
  const [rows] = await pool.query(
    `SELECT id, organizationId, workerId
     FROM ai_direct_worker_tokens
     WHERE tokenHash = ? AND status = 'active'
       AND (expiresAt IS NULL OR expiresAt > NOW(3))
     LIMIT 1`,
    [hashToken(token)],
  );
  const identity = (rows as Array<{ id: string; organizationId: string; workerId: string }>)[0];
  if (!identity || identity.workerId !== workerId) {
    throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, "Worker token 无效", 401);
  }
  await pool.query(`UPDATE ai_direct_worker_tokens SET lastUsedAt = NOW(3) WHERE id = ?`, [
    identity.id,
  ]);
  return {
    tokenId: identity.id,
    organizationId: identity.organizationId,
    workerId: identity.workerId,
  };
}

export async function revokeWorkerToken(
  pool: Pool,
  tokenId: string,
  organizationId: string,
): Promise<boolean> {
  const [result] = (await pool.query(
    `UPDATE ai_direct_worker_tokens
     SET status = 'revoked', revokedAt = NOW(3)
     WHERE id = ? AND organizationId = ? AND status = 'active'`,
    [tokenId, organizationId],
  )) as any;
  return Number(result.affectedRows ?? 0) > 0;
}
