import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireAuth, type AuthenticatedUser } from "../middleware/aiDirectAuth.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  managedAssetDownloadHeaders,
  type ManagedAssetStore,
  type StoredManagedAsset,
} from "../services/managedAssetStore.js";
import type { TemplateManifest } from "../services/managedAssetValidation.js";

interface TemplateRow extends RowDataPacket {
  id: string;
  publisherId: string;
  publisherName: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  pricingMode: "free" | "paid";
  priceMicros: string | number | bigint | null;
  currency: string | null;
  activeVersionId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  versionId: string | null;
  version: string | null;
  versionStatus: string | null;
  manifest: string | TemplateManifest | null;
  dataSchemaVersion: number | null;
  packageStorageKey: string | null;
  packageOriginalFileName: string | null;
  packageMimeType: string | null;
  packageSizeBytes: string | number | bigint | null;
  packageSha256: string | null;
  entitlementStatus?: string | null;
  entitlementSource?: string | null;
}

interface ScreenshotRow extends RowDataPacket {
  id: string;
  templateVersionId: string;
  sortOrder: number;
  storageKey: string;
  mimeType: string;
  sizeBytes: string | number | bigint;
  sha256: string;
}

export function createDesktopTemplateRoutes(assetStore: ManagedAssetStore) {
  return async function desktopTemplateRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/templates", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const query = request.query as { limit?: string; offset?: string };
      const limit = boundedInteger(query.limit, 1, 50, 20);
      const offset = boundedInteger(query.offset, 0, 10_000, 0);
      const [rows] = await fastify.mysql.query<TemplateRow[]>(
        `${templateSelectSql()}
         WHERE template.status = 'published' AND version.status = 'published'
         ORDER BY template.updatedAt DESC, template.id
         LIMIT ? OFFSET ?`,
        [user.id, limit, offset],
      );
      const screenshots = await loadScreenshots(
        fastify,
        rows.flatMap((row) => (row.versionId ? [row.versionId] : [])),
      );
      return reply.status(200).send({
        items: rows.map((row) => templateResponse(row, screenshots)),
        limit,
        offset,
        purchaseSupported: false,
      });
    });

    fastify.get("/templates/:id", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      const row = await findTemplate(fastify, id, user);
      const screenshots = await loadScreenshots(fastify, row.versionId ? [row.versionId] : []);
      return reply.status(200).send(templateResponse(row, screenshots));
    });

    fastify.get("/publisher/templates", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const [rows] = await fastify.mysql.query<RowDataPacket[]>(
        `SELECT template.id, template.publisherId, template.slug, template.name, template.description,
                template.status, template.catalogStatus, template.pricingMode, template.updatedAt,
                version.id AS versionId, version.version, version.reviewStatus,
                version.publicationStatus, version.submittedAt, version.reviewedAt, version.createdAt AS versionCreatedAt,
                decision.reason AS latestReviewReason
         FROM desktop_templates template
         LEFT JOIN desktop_template_versions version ON version.templateId = template.id
         LEFT JOIN desktop_template_review_decisions decision ON decision.id = version.reviewDecisionId
         WHERE template.createdByUserId = ?
         ORDER BY template.updatedAt DESC, template.id, version.createdAt DESC`,
        [user.id],
      );
      return reply.status(200).send({ items: rows });
    });

    fastify.post("/templates", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const input = parseCreateTemplate(request.body);
      await requirePublisherMembership(fastify, input.publisherId, user.id);
      const id = randomUUID();
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_templates
             (id, publisherId, slug, name, description, status, pricingMode,
              priceMicros, currency, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, NOW(3), NOW(3))`,
          [
            id,
            input.publisherId,
            input.slug,
            input.name,
            input.description,
            input.pricingMode,
            input.priceMicros,
            input.currency,
            user.id,
          ],
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new AiDirectHiringError(
            ErrorCodes.DUPLICATE_ENTRY,
            "Publisher 下模板 slug 已存在",
            409,
          );
        }
        throw error;
      }
      return reply.status(201).send({ id, status: "draft", ...input, purchaseSupported: false });
    });

    fastify.patch("/templates/:id", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      await requireDraftOwner(fastify, id, user.id);
      const input = parseTemplatePatch(request.body);
      await fastify.mysql.query(
        `UPDATE desktop_templates
         SET name = COALESCE(?, name), description = COALESCE(?, description),
             pricingMode = COALESCE(?, pricingMode),
             priceMicros = CASE WHEN ? IS NULL THEN priceMicros ELSE ? END,
             currency = CASE WHEN ? IS NULL THEN currency ELSE ? END,
             updatedAt = NOW(3)
         WHERE id = ? AND status = 'draft' AND createdByUserId = ?`,
        [
          input.name ?? null,
          input.description ?? null,
          input.pricingMode ?? null,
          input.pricingMode ?? null,
          input.priceMicros,
          input.pricingMode ?? null,
          input.currency,
          id,
          user.id,
        ],
      );
      return reply.status(200).send({ id, updated: true });
    });

    fastify.post("/templates/:id/versions", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId } = request.params as { id: string };
      const template = await requireDraftOwner(fastify, templateId, user.id);
      const part = await request.file();
      if (!part) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "必须上传模板包");
      }
      const stored = await assetStore.store({
        kind: "template_package",
        originalFileName: part.filename,
        declaredMimeType: part.mimetype,
        stream: part.file,
      });
      const manifest = requireTemplateManifest(stored.validationMetadata);
      if (manifest.author.publisherId !== template.publisherId) {
        await discardStoredAsset(assetStore, stored);
        throw new AiDirectHiringError(
          ErrorCodes.FORBIDDEN_SCOPE,
          "manifest author.publisherId 与模板 Publisher 不一致",
          403,
        );
      }
      const versionId = randomUUID();
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_template_versions
             (id, templateId, version, status, manifest, dataSchemaVersion,
              storageKey, originalFileName, mimeType, sizeBytes, sha256,
              createdByUserId, createdAt)
           VALUES (?, ?, ?, 'draft', CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            versionId,
            templateId,
            manifest.version,
            JSON.stringify(manifest),
            manifest.dataSchemaVersion,
            stored.storageKey,
            stored.originalFileName,
            stored.mimeType,
            stored.sizeBytes,
            stored.sha256,
            user.id,
          ],
        );
      } catch (error) {
        await discardStoredAsset(assetStore, stored);
        if (isDuplicateEntry(error)) {
          throw new AiDirectHiringError(ErrorCodes.DUPLICATE_ENTRY, "模板版本已存在", 409);
        }
        throw error;
      }
      return reply.status(201).send({
        id: versionId,
        templateId,
        version: manifest.version,
        status: "draft",
        manifest,
        sha256: stored.sha256,
      });
    });

    fastify.post("/templates/:id/versions/:versionId/screenshots", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId, versionId } = request.params as { id: string; versionId: string };
      await requireDraftOwner(fastify, templateId, user.id);
      await requireDraftVersion(fastify, templateId, versionId);
      const sortOrder = boundedInteger(
        (request.query as { sortOrder?: string }).sortOrder,
        0,
        3,
        -1,
      );
      if (sortOrder < 0) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "sortOrder 必须为 0–3");
      }
      const part = await request.file();
      if (!part) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "必须上传截图");
      }
      const stored = await assetStore.store({
        kind: "template_screenshot",
        originalFileName: part.filename,
        declaredMimeType: part.mimetype,
        stream: part.file,
      });
      const screenshotId = randomUUID();
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_template_screenshots
             (id, templateVersionId, sortOrder, storageKey, mimeType, sizeBytes, sha256, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            screenshotId,
            versionId,
            sortOrder,
            stored.storageKey,
            stored.mimeType,
            stored.sizeBytes,
            stored.sha256,
          ],
        );
      } catch (error) {
        await discardStoredAsset(assetStore, stored);
        if (isDuplicateEntry(error)) {
          throw new AiDirectHiringError(ErrorCodes.DUPLICATE_ENTRY, "该截图顺序已存在", 409);
        }
        throw error;
      }
      return reply.status(201).send({
        id: screenshotId,
        templateVersionId: versionId,
        sortOrder,
        contentUrl: `/api/v1/desktop/template-screenshots/${screenshotId}/content`,
      });
    });

    fastify.post("/templates/:id/versions/:versionId/submit", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId, versionId } = request.params as { id: string; versionId: string };
      await requireDraftOwner(fastify, templateId, user.id);
      const version = await requireDraftVersion(fastify, templateId, versionId);
      const [countRows] = await fastify.mysql.query<Array<RowDataPacket & { count: number }>>(
        "SELECT COUNT(*) AS count FROM desktop_template_screenshots WHERE templateVersionId = ?",
        [versionId],
      );
      const screenshotCount = Number(countRows[0]?.count ?? 0);
      const manifest = parseManifest(version.manifest);
      if (
        screenshotCount < 1 ||
        screenshotCount > 4 ||
        screenshotCount !== manifest.screenshots.length
      ) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "独立截图数量必须与 manifest 的 1–4 张截图一致",
        );
      }
      const [submitResult] = await fastify.mysql.query(
        `UPDATE desktop_template_versions
         SET reviewStatus = 'pending_review', submittedAt = NOW(3), reviewedAt = NULL
         WHERE id = ? AND templateId = ? AND status = 'draft' AND reviewStatus = 'draft'`,
        [versionId, templateId],
      );
      if (affectedRows(submitResult) !== 1) {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          "模板版本不能从当前状态提交审核",
          409,
        );
      }
      return reply
        .status(200)
        .send({ id: versionId, reviewStatus: "pending_review", publicationStatus: "unpublished" });
    });

    fastify.post("/templates/:id/versions/:versionId/resubmit", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId, versionId } = request.params as { id: string; versionId: string };
      await requireDraftOwner(fastify, templateId, user.id);
      const [result] = await fastify.mysql.query(
        `UPDATE desktop_template_versions
         SET reviewStatus = 'pending_review', submittedAt = NOW(3), reviewedAt = NULL
         WHERE id = ? AND templateId = ? AND status = 'draft' AND reviewStatus = 'rejected'`,
        [versionId, templateId],
      );
      if (affectedRows(result) !== 1) {
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          "只有被拒绝的模板版本可以重新提交",
          409,
        );
      }
      return reply
        .status(200)
        .send({ id: versionId, reviewStatus: "pending_review", publicationStatus: "unpublished" });
    });

    fastify.get("/templates/:id/versions", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId } = request.params as { id: string };
      await requireDraftOwner(fastify, templateId, user.id);
      const [rows] = await fastify.mysql.query<RowDataPacket[]>(
        `SELECT id, version, reviewStatus, publicationStatus, submittedAt, reviewedAt,
                publishedAt, sha256, sizeBytes, createdAt
         FROM desktop_template_versions WHERE templateId = ? ORDER BY createdAt DESC, id DESC`,
        [templateId],
      );
      return reply.status(200).send({ items: rows });
    });

    fastify.get("/templates/:id/downloads", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id: templateId } = request.params as { id: string };
      await requireDraftOwner(fastify, templateId, user.id);
      const query = request.query as { limit?: string };
      const limit = boundedInteger(query.limit, 1, 100, 50);
      const [rows] = await fastify.mysql.query<RowDataPacket[]>(
        `SELECT id, templateVersionId, userId, entitlementSource, downloadedAt
         FROM desktop_template_download_events
         WHERE templateId = ? ORDER BY downloadedAt DESC, id DESC LIMIT ?`,
        [templateId, limit],
      );
      return reply.status(200).send({ items: rows });
    });

    fastify.get("/templates/:id/package", async (request, reply) => {
      const user = await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      const template = await findTemplate(fastify, id, user);
      if (
        !template.versionId ||
        !template.packageStorageKey ||
        !template.packageMimeType ||
        !template.packageSha256
      ) {
        throw new AiDirectHiringError(
          ErrorCodes.TEMPLATE_NOT_INSTALLABLE,
          "模板没有可安装版本",
          409,
        );
      }
      const canDownload =
        template.pricingMode === "free" ||
        template.entitlementStatus === "active" ||
        template.createdByUserId === user.id;
      if (!canDownload) {
        throw new AiDirectHiringError(
          ErrorCodes.TEMPLATE_ENTITLEMENT_REQUIRED,
          "付费模板需要有效授权；当前版本不支持在线购买",
          403,
          { purchaseSupported: false },
        );
      }
      const opened = await assetStore.open(template.packageStorageKey);
      try {
        await fastify.mysql.query(
          `INSERT INTO desktop_template_download_events
             (id, templateId, templateVersionId, userId, entitlementSource, requestId, downloadedAt)
           VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            randomUUID(),
            template.id,
            template.versionId,
            user.id,
            template.pricingMode === "free" ? "free" : (template.entitlementSource ?? "owner"),
            request.id,
          ],
        );
      } catch (error) {
        opened.stream.destroy();
        throw error;
      }
      reply.headers(
        managedAssetDownloadHeaders({
          mimeType: template.packageMimeType,
          sha256: template.packageSha256,
          originalFileName: template.packageOriginalFileName ?? `${template.slug}.clawtemplate`,
          attachment: true,
        }),
      );
      reply.header("Content-Length", String(opened.sizeBytes));
      return reply.send(opened.stream);
    });

    fastify.get("/template-screenshots/:id/content", async (request, reply) => {
      await requireAuth(fastify, request);
      const { id } = request.params as { id: string };
      const [rows] = await fastify.mysql.query<ScreenshotRow[]>(
        `SELECT screenshot.*
         FROM desktop_template_screenshots screenshot
         JOIN desktop_template_versions version ON version.id = screenshot.templateVersionId
         JOIN desktop_templates template ON template.activeVersionId = version.id
         WHERE screenshot.id = ? AND template.status = 'published' AND version.status = 'published'
         LIMIT 1`,
        [id],
      );
      const screenshot = rows[0];
      if (!screenshot) {
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板截图不存在", 404);
      }
      const opened = await assetStore.open(screenshot.storageKey);
      reply.headers(
        managedAssetDownloadHeaders({ mimeType: screenshot.mimeType, sha256: screenshot.sha256 }),
      );
      reply.header("Content-Length", String(opened.sizeBytes));
      return reply.send(opened.stream);
    });
  };
}

function templateSelectSql(): string {
  return `SELECT
    template.*, publisher.displayName AS publisherName,
    version.id AS versionId, version.version, version.status AS versionStatus,
    version.manifest, version.dataSchemaVersion,
    version.storageKey AS packageStorageKey,
    version.originalFileName AS packageOriginalFileName,
    version.mimeType AS packageMimeType,
    version.sizeBytes AS packageSizeBytes,
    version.sha256 AS packageSha256,
    entitlement.status AS entitlementStatus,
    entitlement.source AS entitlementSource
  FROM desktop_templates template
  JOIN publishers publisher ON publisher.id = template.publisherId
  LEFT JOIN desktop_template_versions version ON version.id = template.activeVersionId
  LEFT JOIN desktop_template_entitlements entitlement
    ON entitlement.templateId = template.id AND entitlement.userId = ?`;
}

async function findTemplate(
  fastify: FastifyInstance,
  id: string,
  user: AuthenticatedUser,
): Promise<TemplateRow> {
  const [rows] = await fastify.mysql.query<TemplateRow[]>(
    `${templateSelectSql()}
     WHERE template.id = ? AND (
       (template.status = 'published' AND version.status = 'published')
       OR template.createdByUserId = ?
       OR EXISTS (SELECT 1 FROM users admin_user WHERE admin_user.id = ? AND admin_user.role = 'admin')
     )
     LIMIT 1`,
    [user.id, id, user.id, user.id],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "模板不存在", 404);
  }
  return rows[0];
}

async function loadScreenshots(
  fastify: FastifyInstance,
  versionIds: string[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const result = new Map<string, Array<Record<string, unknown>>>();
  if (versionIds.length === 0) return result;
  const placeholders = versionIds.map(() => "?").join(", ");
  const [rows] = await fastify.mysql.query<ScreenshotRow[]>(
    `SELECT * FROM desktop_template_screenshots
     WHERE templateVersionId IN (${placeholders})
     ORDER BY templateVersionId, sortOrder`,
    versionIds,
  );
  for (const row of rows) {
    const values = result.get(row.templateVersionId) ?? [];
    values.push({
      id: row.id,
      sortOrder: row.sortOrder,
      mimeType: row.mimeType,
      sizeBytes: String(row.sizeBytes),
      sha256: row.sha256,
      contentUrl: `/api/v1/desktop/template-screenshots/${row.id}/content`,
    });
    result.set(row.templateVersionId, values);
  }
  return result;
}

function templateResponse(
  row: TemplateRow,
  screenshots: Map<string, Array<Record<string, unknown>>>,
): Record<string, unknown> {
  return {
    id: row.id,
    publisher: { id: row.publisherId, name: row.publisherName },
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    pricing: {
      mode: row.pricingMode,
      priceMicros: row.priceMicros === null ? null : String(row.priceMicros),
      currency: row.currency,
      purchaseSupported: false,
    },
    entitled: row.pricingMode === "free" || row.entitlementStatus === "active",
    activeVersion: row.versionId
      ? {
          id: row.versionId,
          version: row.version,
          status: row.versionStatus,
          manifest: row.manifest ? parseManifest(row.manifest) : null,
          dataSchemaVersion: row.dataSchemaVersion,
          sha256: row.packageSha256,
          sizeBytes: row.packageSizeBytes === null ? null : String(row.packageSizeBytes),
          screenshots: screenshots.get(row.versionId) ?? [],
        }
      : null,
    updatedAt: row.updatedAt,
  };
}

async function requirePublisherMembership(
  fastify: FastifyInstance,
  publisherId: string,
  userId: string,
): Promise<void> {
  const [rows] = await fastify.mysql.query<RowDataPacket[]>(
    `SELECT publisher.id
     FROM publishers publisher
     LEFT JOIN publisherMembers member
       ON member.publisherId = publisher.id AND member.userId = ?
     WHERE publisher.id = ? AND publisher.deletedAt IS NULL
       AND (publisher.linkedUserId = ? OR member.id IS NOT NULL)
     LIMIT 1`,
    [userId, publisherId, userId],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "用户不是该 Publisher 成员", 403);
  }
}

async function requireDraftOwner(
  fastify: FastifyInstance,
  templateId: string,
  userId: string,
): Promise<TemplateRow> {
  const [rows] = await fastify.mysql.query<TemplateRow[]>(
    `SELECT template.*, publisher.displayName AS publisherName,
       NULL AS versionId, NULL AS version, NULL AS versionStatus, NULL AS manifest,
       NULL AS dataSchemaVersion, NULL AS packageStorageKey, NULL AS packageOriginalFileName,
       NULL AS packageMimeType, NULL AS packageSizeBytes, NULL AS packageSha256
     FROM desktop_templates template
     JOIN publishers publisher ON publisher.id = template.publisherId
     WHERE template.id = ? AND template.createdByUserId = ?
     LIMIT 1`,
    [templateId, userId],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "只有模板所有者可管理模板", 403);
  }
  return rows[0];
}

async function requireDraftVersion(
  fastify: FastifyInstance,
  templateId: string,
  versionId: string,
): Promise<RowDataPacket & { manifest: string | TemplateManifest }> {
  const [rows] = await fastify.mysql.query<
    Array<RowDataPacket & { manifest: string | TemplateManifest }>
  >(
    `SELECT manifest FROM desktop_template_versions
     WHERE id = ? AND templateId = ? AND status = 'draft'
     LIMIT 1`,
    [versionId, templateId],
  );
  if (!rows[0]) {
    throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "草稿模板版本不存在", 404);
  }
  return rows[0];
}

function parseCreateTemplate(value: unknown) {
  const body = requireObject(value, [
    "publisherId",
    "slug",
    "name",
    "description",
    "pricingMode",
    "priceMicros",
    "currency",
  ]);
  const publisherId = requiredString(body.publisherId, "publisherId", 191);
  const slug = requiredString(body.slug, "slug", 160);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid("slug 仅允许小写字母、数字和连字符");
  const name = requiredString(body.name, "name", 160);
  const description = requiredString(body.description, "description", 2000);
  const pricing = parsePricing(body);
  return { publisherId, slug, name, description, ...pricing };
}

function parseTemplatePatch(value: unknown) {
  const body = requireObject(value, [
    "name",
    "description",
    "pricingMode",
    "priceMicros",
    "currency",
  ]);
  if (Object.keys(body).length === 0) invalid("至少提供一个修改字段");
  const name = body.name === undefined ? undefined : requiredString(body.name, "name", 160);
  const description =
    body.description === undefined
      ? undefined
      : requiredString(body.description, "description", 2000);
  if (body.pricingMode === undefined) {
    if (body.priceMicros !== undefined || body.currency !== undefined) {
      invalid("修改价格时必须同时提供 pricingMode");
    }
    return {
      name,
      description,
      pricingMode: undefined,
      priceMicros: null,
      currency: null,
    };
  }
  return { name, description, ...parsePricing(body) };
}

function parsePricing(body: Record<string, unknown>) {
  if (body.pricingMode !== "free" && body.pricingMode !== "paid") invalid("pricingMode 不合法");
  if (body.pricingMode === "free") {
    if (body.priceMicros !== undefined && body.priceMicros !== null && body.priceMicros !== 0) {
      invalid("免费模板不能设置价格");
    }
    return { pricingMode: "free" as const, priceMicros: null, currency: null };
  }
  if (!Number.isSafeInteger(body.priceMicros) || (body.priceMicros as number) < 0) {
    invalid("付费模板 priceMicros 必须是非负安全整数");
  }
  if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) {
    invalid("付费模板 currency 必须是三个大写字母");
  }
  return {
    pricingMode: "paid" as const,
    priceMicros: body.priceMicros as number,
    currency: body.currency,
  };
}

function requireObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("请求正文必须是对象");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !keys.includes(key))) invalid("请求正文包含未知字段");
  return body;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxLength) {
    invalid(`${field} 不合法`);
  }
  return value.trim();
}

function requireTemplateManifest(value: unknown): TemplateManifest {
  if (!value || typeof value !== "object" || !("version" in value) || !("author" in value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "模板包未返回有效清单");
  }
  return value as TemplateManifest;
}

function parseManifest(value: string | TemplateManifest): TemplateManifest {
  return (typeof value === "string" ? JSON.parse(value) : value) as TemplateManifest;
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function affectedRows(result: unknown): number {
  return typeof result === "object" && result !== null && "affectedRows" in result
    ? Number(result.affectedRows)
    : 0;
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY"
  );
}

function invalid(message: string): never {
  throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, message, 400);
}

async function discardStoredAsset(
  assetStore: ManagedAssetStore,
  stored: StoredManagedAsset,
): Promise<void> {
  try {
    const trashName = await assetStore.moveToTrash(stored.storageKey);
    await assetStore.deleteFromTrash(trashName);
  } catch {
    // The file has no database reference and can be removed by orphan cleanup.
  }
}
