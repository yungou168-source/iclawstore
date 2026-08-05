/**
 * Obsidian memory routes (M1).
 * Spec: specs/ai-direct-hiring-obsidian-sync.md
 *
 * Endpoints (all under /api/v1/memory/obsidian):
 *   POST   /bind      register or replace a vault binding for the current user
 *   DELETE /bind      revoke the binding and clear all of its digests
 *   GET    /binding   binding status (configured + meta only, no path/email)
 *   GET    /bindings  workspace summary (noteCount + tagCount + top tags)
 *   POST   /sync      submit a batch of pointers + summaries (idempotent)
 *   GET    /notes     list pointers (paginated, no body)
 *   GET    /notes/:notePath  return a single digest summary
 *
 * Hard rules:
 *   - Raw note bodies are NEVER accepted. /sync only accepts pointers + summaries.
 *   - Summaries are re-validated server-side for ratio and sensitive content.
 *   - The endpoint NEVER returns vaultRootPath, user email, or any location-identifying field.
 *
 * M1 uses Prisma only (no mysql pool dependency); the route is self-contained.
 */
import { createHash, randomUUID } from "node:crypto";
import { FastifyInstance, FastifyRequest } from "fastify";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  DEFAULT_EVIDENCE_VERSION,
  EXTRACTOR_VERSION,
  FRONTMATTER_ALLOWED_FIELDS,
  MAX_BATCH_BYTES,
  MAX_SUMMARY_RATIO,
  detectSensitiveContent,
} from "../services/obsidianExtract.js";

const TAG_NAME = /^[a-zA-Z0-9_/-]{1,64}$/;
const NOTE_PATH = /^[^\u0000-\u001f]{1,1024}\.md$/;

interface AuthenticatedUser {
  id: string;
  role?: string;
}

function getUser(fastify: FastifyInstance, request: FastifyRequest): AuthenticatedUser {
  const user = (request as any).user as AuthenticatedUser | undefined;
  if (!user?.id) throw new AiDirectHiringError(ErrorCodes.AUTH_REQUIRED, '请先登录', 401);
  return user;
}

function requestIdOf(request: FastifyRequest): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : randomUUID();
}

function idempotencyKeyOf(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "Idempotency-Key 长度必须为 1-128");
  }
  return value;
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 长度必须为 1-${max}`);
  }
  return trimmed;
}

function readOptionalString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  if (value.length > max) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 不能超过 ${max} 字符`);
  }
  return value;
}

function readPositiveInt(value: unknown, field: string, max: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是 1-${max} 之间的整数`);
  }
  return numeric;
}

function readStringArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串数组`);
  }
  return value.map((entry) => readString(entry, field, max));
}

function assertHex(value: string, field: string, length = 64): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是 ${length} 位 hex`);
  }
}

function assertValidEvidenceVersion(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "evidenceVersion 格式不正确");
  }
}

interface BindingRow {
  id: string;
  userId: string;
  vaultFingerprint: string;
  status: string;
  extractorVersion: string;
  evidenceVersion: string;
  noteCount: number;
  tagCount: number;
  lastSyncAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function loadActiveBinding(prisma: any, userId: string): Promise<BindingRow | null> {
  const row = await prisma.aiDirectMemoryBindings.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  return row ? (row as BindingRow) : null;
}

async function writeAudit(
  prisma: any,
  input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    outcome: "success" | "rejected";
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.aiDirectAuditEvents.create({
    data: {
      id: randomUUID(),
      organizationId: null,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      outcome: input.outcome,
      metadata: input.metadata,
    },
  });
}

interface SubmissionPointer {
  path: string;
  mtime: string | null;
  size: number;
  hash: string;
  tags: string[];
  links: string[];
}

interface SubmissionSummary {
  path: string;
  title: string | null;
  summary_md: string;
  top_headings: string[];
  summaryBytes: number;
  sourceBytes: number;
  frontmatter: Record<string, unknown>;
}

function validatePointerShape(value: unknown, index: number): SubmissionPointer {
  const obj = readObject(value, `pointers[${index}]`);
  const path = readString(obj.path, `pointers[${index}].path`, 1024);
  if (!NOTE_PATH.test(path)) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `pointers[${index}].path 必须是相对路径且以 .md 结尾`,
    );
  }
  const mtime = readOptionalString(obj.mtime, `pointers[${index}].mtime`, 64);
  const size = readPositiveInt(obj.size ?? 0, `pointers[${index}].size`, 1024 * 1024 * 10);
  const hash = readString(obj.hash, `pointers[${index}].hash`, 64);
  assertHex(hash, `pointers[${index}].hash`);
  const tags = readStringArray(obj.tags ?? [], `pointers[${index}].tags`, 64).filter((tag) =>
    TAG_NAME.test(tag),
  );
  const links = readStringArray(obj.links ?? [], `pointers[${index}].links`, 256).filter(
    (link) => link.length > 0,
  );
  return { path, mtime, size, hash, tags, links };
}

function validateSummaryShape(value: unknown, index: number): SubmissionSummary {
  const obj = readObject(value, `summaries[${index}]`);
  const path = readString(obj.path, `summaries[${index}].path`, 1024);
  if (!NOTE_PATH.test(path)) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `summaries[${index}].path 必须是相对路径且以 .md 结尾`,
    );
  }
  const title = readOptionalString(obj.title, `summaries[${index}].title`, 512);
  const summary_md = readString(obj.summary_md, `summaries[${index}].summary_md`, MAX_BATCH_BYTES);
  const topHeadings = readStringArray(
    obj.top_headings ?? [],
    `summaries[${index}].top_headings`,
    256,
  );
  const summaryBytes = readPositiveInt(
    obj.summaryBytes ?? 0,
    `summaries[${index}].summaryBytes`,
    MAX_BATCH_BYTES,
  );
  const sourceBytes = readPositiveInt(
    obj.sourceBytes ?? 0,
    `summaries[${index}].sourceBytes`,
    1024 * 1024 * 10,
  );
  const frontmatter = readObject(obj.frontmatter ?? {}, `summaries[${index}].frontmatter`);
  const allowedKeys = new Set<string>(FRONTMATTER_ALLOWED_FIELDS as readonly string[]);
  for (const key of Object.keys(frontmatter)) {
    if (!allowedKeys.has(key)) delete frontmatter[key];
  }
  return {
    path,
    title,
    summary_md,
    top_headings: topHeadings,
    summaryBytes,
    sourceBytes,
    frontmatter,
  };
}

function revalidateSummary(
  pointer: SubmissionPointer,
  summary: SubmissionSummary,
): { ok: true } | { ok: false; code: string } {
  if (pointer.path !== summary.path) {
    return { ok: false, code: "PATH_MISMATCH" };
  }
  if (summary.summaryBytes > Math.floor(summary.sourceBytes * MAX_SUMMARY_RATIO) + 1) {
    return { ok: false, code: "SUMMARY_TOO_LONG" };
  }
  if (summary.sourceBytes > 0 && detectSensitiveContent(summary.summary_md)) {
    return { ok: false, code: "SENSITIVE_CONTENT" };
  }
  return { ok: true };
}

export async function aiDirectMemoryRoutes(fastify: FastifyInstance) {
  const prisma = (fastify as any).prisma;
  const auth = [(fastify as any).authenticate];

  // ── Bind / unbind / status ─────────────────────────────────────────────────

  fastify.post("/memory/obsidian/bind", { onRequest: auth }, async (request: any, reply) => {
    try {
      const body = readObject(request.body, "body");
      const vaultFingerprint = readString(body.vaultFingerprint, "vaultFingerprint", 64);
      assertHex(vaultFingerprint, "vaultFingerprint");
      const extractorVersion = readString(
        body.extractorVersion ?? EXTRACTOR_VERSION,
        "extractorVersion",
        64,
      );
      const evidenceVersion = readString(
        body.evidenceVersion ?? DEFAULT_EVIDENCE_VERSION,
        "evidenceVersion",
        64,
      );
      assertValidEvidenceVersion(evidenceVersion);
      const currentRequestId = requestIdOf(request);
      const user = getUser(fastify, request);

      const existing = await loadActiveBinding(prisma, user.id);
      if (existing && existing.vaultFingerprint === vaultFingerprint) {
        await prisma.aiDirectMemoryBindings.update({
          where: { id: existing.id },
          data: {
            extractorVersion,
            evidenceVersion,
            status: "active",
            revokedAt: null,
          },
        });
        await writeAudit(prisma, {
          actorUserId: user.id,
          action: "memory.obsidian.bind.replayed",
          targetType: "ai_direct_memory_binding",
          targetId: existing.id,
          requestId: currentRequestId,
          outcome: "success",
          metadata: {
            vaultFingerprint,
            extractorVersion,
            evidenceVersion,
          },
        });
        return reply.status(200).send({
          id: existing.id,
          vaultFingerprint,
          extractorVersion,
          evidenceVersion,
          status: "active",
          replayed: true,
        });
      }

      if (existing) {
        await prisma.aiDirectMemoryBindings.update({
          where: { id: existing.id },
          data: { status: "revoked", revokedAt: new Date() },
        });
      }
      const bindingId = randomUUID();
      await prisma.aiDirectMemoryBindings.create({
        data: {
          id: bindingId,
          userId: user.id,
          vaultFingerprint,
          status: "active",
          extractorVersion,
          evidenceVersion,
        },
      });
      await writeAudit(prisma, {
        actorUserId: user.id,
        action: "memory.obsidian.bind",
        targetType: "ai_direct_memory_binding",
        targetId: bindingId,
        requestId: currentRequestId,
        outcome: "success",
        metadata: { vaultFingerprint, extractorVersion, evidenceVersion },
      });
      return reply.status(201).send({
        id: bindingId,
        vaultFingerprint,
        extractorVersion,
        evidenceVersion,
        status: "active",
      });
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        const body: Record<string, unknown> = { code: error.code, error: error.message };
        if (error.details !== undefined) body.details = error.details;
        return reply.status(error.httpStatus).send(body);
      }
      throw error;
    }
  });

  fastify.delete("/memory/obsidian/bind", { onRequest: auth }, async (request: any, reply) => {
    const user = getUser(fastify, request);
    const currentRequestId = requestIdOf(request);
    const existing = await loadActiveBinding(prisma, user.id);
    if (!existing) return reply.status(204).send();

    await prisma.$transaction(async (tx: any) => {
      await tx.aiDirectMemoryBindings.update({
        where: { id: existing.id },
        data: { status: "revoked", revokedAt: new Date() },
      });
      await tx.aiDirectMemoryDigests.deleteMany({ where: { bindingId: existing.id } });
    });
    await writeAudit(prisma, {
      actorUserId: user.id,
      action: "memory.obsidian.revoked",
      targetType: "ai_direct_memory_binding",
      targetId: existing.id,
      requestId: currentRequestId,
      outcome: "success",
      metadata: { vaultFingerprint: existing.vaultFingerprint },
    });
    return reply.status(204).send();
  });

  fastify.get("/memory/obsidian/binding", { onRequest: auth }, async (request: any) => {
    const user = getUser(fastify, request);
    const binding = await loadActiveBinding(prisma, user.id);
    return {
      configured: Boolean(binding),
      vaultFingerprint: binding?.vaultFingerprint ?? null,
      extractorVersion: binding?.extractorVersion ?? null,
      evidenceVersion: binding?.evidenceVersion ?? null,
      noteCount: binding?.noteCount ?? 0,
      tagCount: binding?.tagCount ?? 0,
      lastSyncAt: binding?.lastSyncAt ?? null,
      updatedAt: binding?.updatedAt ?? null,
    };
  });

  // ── Sync (batch) ───────────────────────────────────────────────────────────

  fastify.post("/memory/obsidian/sync", { onRequest: auth }, async (request: any, reply) => {
    const currentRequestId = requestIdOf(request);
    const idempotencyKey = idempotencyKeyOf(request);
    let user: AuthenticatedUser | null = null;
    try {
      const body = readObject(request.body, "body");
      user = getUser(fastify, request);
      const userId = user.id;
      const submissionFingerprint = readString(
        body.vaultFingerprint ?? "",
        "vaultFingerprint",
        64,
      );
      assertHex(submissionFingerprint, "vaultFingerprint");
      const evidenceVersion = readString(
        body.evidenceVersion ?? DEFAULT_EVIDENCE_VERSION,
        "evidenceVersion",
        64,
      );
      assertValidEvidenceVersion(evidenceVersion);

      const binding = await loadActiveBinding(prisma, user.id);
      if (!binding) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "未找到生效中的 vault 绑定",
          404,
        );
      }
      if (binding.vaultFingerprint !== submissionFingerprint) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "提交的 vaultFingerprint 与当前绑定不一致",
          409,
        );
      }
      if (binding.evidenceVersion !== evidenceVersion) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "evidenceVersion 已过期，请重新绑定",
          409,
        );
      }

      const rawPointers = Array.isArray(body.pointers) ? body.pointers : [];
      const rawSummaries = Array.isArray(body.summaries) ? body.summaries : [];
      if (rawPointers.length === 0) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "pointers 不能为空", 422);
      }
      if (rawPointers.length !== rawSummaries.length) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "pointers 与 summaries 数量必须一致",
          422,
        );
      }
      if (rawPointers.length > 5000) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "单次最多 5000 条笔记",
          422,
        );
      }

      const pointers = rawPointers.map((value: unknown, index: number) =>
        validatePointerShape(value, index),
      );
      const summaries = rawSummaries.map((value: unknown, index: number) =>
        validateSummaryShape(value, index),
      );

      let totalSummaryBytes = 0;
      const pointerByPath = new Map<string, SubmissionPointer>();
      for (const pointer of pointers) {
        if (pointerByPath.has(pointer.path)) {
          throw new AiDirectHiringError(
            ErrorCodes.VALIDATION_ERROR,
            `path 重复: ${pointer.path}`,
            422,
          );
        }
        pointerByPath.set(pointer.path, pointer);
        const summary = summaries.find((entry) => entry.path === pointer.path);
        if (!summary) {
          throw new AiDirectHiringError(
            ErrorCodes.VALIDATION_ERROR,
            `缺少对应 summary: ${pointer.path}`,
            422,
          );
        }
        const check = revalidateSummary(pointer, summary);
        if (!check.ok) {
          await writeAudit(prisma, {
            actorUserId: user.id,
            action: "memory.obsidian.sync.rejected",
            targetType: "ai_direct_memory_digest",
            targetId: binding.id,
            requestId: currentRequestId,
            outcome: "rejected",
            metadata: { path: pointer.path, reason: check.code },
          });
          throw new AiDirectHiringError(
            ErrorCodes.VALIDATION_ERROR,
            `校验未通过 (${pointer.path}): ${check.code}`,
            422,
            { reason: check.code, path: pointer.path },
          );
        }
        totalSummaryBytes += summary.summaryBytes;
        if (totalSummaryBytes > MAX_BATCH_BYTES) {
          throw new AiDirectHiringError(
            ErrorCodes.VALIDATION_ERROR,
            `摘要总字节超过 ${MAX_BATCH_BYTES}`,
            422,
          );
        }
      }

      const fingerprint = createHash("sha256")
        .update(binding.vaultFingerprint)
        .update("\u0000")
        .update(binding.extractorVersion)
        .update("\u0000")
        .update(idempotencyKey)
        .digest("hex");

      await prisma.$transaction(async (tx: any) => {
        for (const pointer of pointers) {
          const summary = summaries.find((entry) => entry.path === pointer.path)!;
          const existing = await tx.aiDirectMemoryDigests.findUnique({
            where: { bindingId_notePath: { bindingId: binding.id, notePath: pointer.path } },
          });
          const data = {
            noteHash: pointer.hash,
            title: summary.title,
            tagsJson: pointer.tags,
            linksJson: pointer.links,
            summaryMd: summary.summary_md,
            summaryBytes: summary.summaryBytes,
            sourceBytes: summary.sourceBytes,
            frontmatterJson: summary.frontmatter,
            mtime: pointer.mtime ? new Date(pointer.mtime) : null,
            size: pointer.size,
            redactedAt: null,
            redactionReason: null,
          };
          if (existing) {
            await tx.aiDirectMemoryDigests.update({
              where: { id: existing.id },
              data,
            });
          } else {
            await tx.aiDirectMemoryDigests.create({
              data: {
                id: randomUUID(),
                bindingId: binding.id,
                userId,
                vaultFingerprint: binding.vaultFingerprint,
                notePath: pointer.path,
                ...data,
              },
            });
          }
        }
        const tagSet = new Set<string>();
        for (const pointer of pointers) {
          for (const tag of pointer.tags) tagSet.add(tag);
        }
        const noteCount = await tx.aiDirectMemoryDigests.count({
          where: { bindingId: binding.id },
        });
        await tx.aiDirectMemoryBindings.update({
          where: { id: binding.id },
          data: {
            noteCount,
            tagCount: tagSet.size,
            lastSyncAt: new Date(),
          },
        });
      });

      await writeAudit(prisma, {
        actorUserId: user.id,
        action: "memory.obsidian.sync",
        targetType: "ai_direct_memory_binding",
        targetId: binding.id,
        requestId: currentRequestId,
        outcome: "success",
        metadata: {
          vaultFingerprint: binding.vaultFingerprint,
          noteCount: pointers.length,
          totalBytes: totalSummaryBytes,
          idempotencyKey,
          fingerprint,
        },
      });

      return reply.status(200).send({
        bindingId: binding.id,
        vaultFingerprint: binding.vaultFingerprint,
        accepted: pointers.length,
        totalBytes: totalSummaryBytes,
        evidenceVersion: binding.evidenceVersion,
        replayed: false,
      });
    } catch (error) {
      if (error instanceof AiDirectHiringError) {
        const body: Record<string, unknown> = { code: error.code, error: error.message };
        if (error.details !== undefined) body.details = error.details;
        if (user) {
          await writeAudit(prisma, {
            actorUserId: user.id,
            action: "memory.obsidian.sync.rejected",
            targetType: "ai_direct_memory_digest",
            targetId: "memory-sync",
            requestId: currentRequestId,
            outcome: "rejected",
            metadata: { code: error.code, message: error.message, idempotencyKey },
          }).catch(() => {});
        }
        return reply.status(error.httpStatus).send(body);
      }
      throw error;
    }
  });

  // ── Read (web workspace + MCP) ─────────────────────────────────────────────

  fastify.get("/memory/obsidian/bindings", { onRequest: auth }, async (request: any) => {
    const user = getUser(fastify, request);
    const binding = await loadActiveBinding(prisma, user.id);
    if (!binding) {
      return { configured: false, topTags: [], noteCount: 0, tagCount: 0, lastSyncAt: null };
    }
    const digests = await prisma.aiDirectMemoryDigests.findMany({
      where: { bindingId: binding.id },
      select: { tagsJson: true },
    });
    const counts = new Map<string, number>();
    for (const row of digests) {
      if (!row.tagsJson) continue;
      const tags = Array.isArray(row.tagsJson) ? (row.tagsJson as string[]) : [];
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const topTags = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([tag]) => tag);
    return {
      configured: true,
      vaultFingerprint: binding.vaultFingerprint,
      noteCount: binding.noteCount,
      tagCount: binding.tagCount,
      lastSyncAt: binding.lastSyncAt,
      topTags,
    };
  });

  fastify.get("/memory/obsidian/notes", { onRequest: auth }, async (request: any) => {
    const user = getUser(fastify, request);
    const binding = await loadActiveBinding(prisma, user.id);
    if (!binding) return { items: [] };
    const limit = Math.max(1, Math.min(Number(request.query?.limit ?? 50) || 50, 200));
    const items = await prisma.aiDirectMemoryDigests.findMany({
      where: { bindingId: binding.id },
      orderBy: { notePath: "asc" },
      take: limit,
      select: {
        notePath: true,
        title: true,
        tagsJson: true,
        linksJson: true,
        summaryBytes: true,
        sourceBytes: true,
        mtime: true,
        size: true,
        updatedAt: true,
      },
    });
    return { items };
  });

  fastify.get("/memory/obsidian/notes/:notePath", { onRequest: auth }, async (request: any, reply) => {
    const user = getUser(fastify, request);
    const binding = await loadActiveBinding(prisma, user.id);
    if (!binding) {
      return reply.status(404).send({ code: "BINDING_NOT_FOUND", error: "未找到生效中的 vault 绑定" });
    }
    const notePath = decodeURIComponent(request.params.notePath);
    if (!NOTE_PATH.test(notePath)) {
      return reply.status(400).send({ code: "VALIDATION_ERROR", error: "notePath 格式不正确" });
    }
    const row = await prisma.aiDirectMemoryDigests.findFirst({
      where: { bindingId: binding.id, notePath },
      select: {
        notePath: true,
        title: true,
        tagsJson: true,
        linksJson: true,
        summaryMd: true,
        summaryBytes: true,
        sourceBytes: true,
        frontmatterJson: true,
        mtime: true,
        size: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      return reply.status(404).send({ code: "NOT_FOUND", error: "笔记不在 digest 集合中" });
    }
    return row;
  });
}
