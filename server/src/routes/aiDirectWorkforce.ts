import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireCompanyRole } from "../middleware/aiDirectRbac.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import {
  POSITION_STATUSES,
  transitionDepartment,
  transitionPosition,
  type DepartmentStatus,
  type PositionStatus,
} from "../services/workforceStateMachine.js";
import { publishOutboxEvent } from "../utils/outbox.js";

const PAGE_SIZE = 50;
const EMPLOYEE_PAGE_SIZE = 20;
const MAX_EMPLOYEE_PAGE_SIZE = 50;

type SqlConnection = {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  query(sql: string, values?: unknown[]): Promise<any>;
};

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1 到 ${maxLength}`,
    );
  }
  return result;
};

const readNonNegativeInteger = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 必须是 0 到 1000000 的整数`,
    );
  }
  return value;
};

const rejectExtra = (
  body: Record<string, unknown>,
  allowed: readonly string[],
  endpoint: string,
): void => {
  const extraFields = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extraFields.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${endpoint} 不接受以下字段: ${extraFields.join(", ")}`,
      400,
      { extraFields },
    );
  }
};

const requestIdFrom = (request: { headers: Record<string, unknown> }): string => {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : randomUUID();
};

const encodeCursor = (row: { sortOrder: number; id: string }): string =>
  Buffer.from(JSON.stringify(row)).toString("base64url");

const decodeCursor = (value: unknown): { sortOrder: number; id: string } | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof result?.sortOrder === "number" && typeof result?.id === "string" ? result : null;
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
};

const encodeEmployeeCursor = (row: { updatedAt: Date | string; employmentId: string }): string =>
  Buffer.from(
    JSON.stringify({
      updatedAt: new Date(row.updatedAt).toISOString(),
      employmentId: row.employmentId,
    }),
  ).toString("base64url");

const decodeEmployeeCursor = (
  value: unknown,
): { updatedAt: string; employmentId: string } | null => {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const updatedAt = new Date(result?.updatedAt);
    if (
      typeof result?.employmentId !== "string" ||
      result.employmentId.length === 0 ||
      Number.isNaN(updatedAt.valueOf())
    ) {
      throw new Error("invalid cursor");
    }
    return { updatedAt: updatedAt.toISOString(), employmentId: result.employmentId };
  } catch {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "cursor 无效");
  }
};

const readEmployeeLimit = (value: unknown): number => {
  if (value === undefined) return EMPLOYEE_PAGE_SIZE;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "limit 必须是 1 到 50 的整数");
  }
  const limit = Number(value);
  if (limit > MAX_EMPLOYEE_PAGE_SIZE) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "limit 必须是 1 到 50 的整数");
  }
  return limit;
};

async function writeAudit(
  conn: SqlConnection,
  input: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO ai_direct_audit_events
     (id, organizationId, actorUserId, action, targetType, targetId, requestId, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

async function transaction<T>(
  pool: any,
  callback: (conn: SqlConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function companyForDepartment(pool: any, departmentId: string): Promise<any> {
  const [rows] = await pool.query(
    `SELECT d.id, d.companyId, d.status, c.organizationId
     FROM ai_direct_departments d
     JOIN ai_direct_companies c ON c.id = d.companyId
     WHERE d.id = ? LIMIT 1`,
    [departmentId],
  );
  const row = rows[0];
  if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Department 不存在", 404);
  return row;
}

async function positionForAccess(pool: any, positionId: string): Promise<any> {
  const [rows] = await pool.query(
    `SELECT p.id, p.departmentId, p.status, d.companyId, c.organizationId
     FROM ai_direct_positions p
     JOIN ai_direct_departments d ON d.id = p.departmentId
     JOIN ai_direct_companies c ON c.id = d.companyId
     WHERE p.id = ? LIMIT 1`,
    [positionId],
  );
  const row = rows[0];
  if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Position 不存在", 404);
  return row;
}

export async function aiDirectWorkforceRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql as any;
  const auth = [(fastify as any).authenticate];

  fastify.get("/workforce/employees", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const companyId = readString(request.query?.companyId, "companyId", 36);
    await requireCompanyRole(pool, companyId, user.id, "recruiter");

    const departmentId =
      request.query?.departmentId === undefined
        ? null
        : readString(request.query.departmentId, "departmentId", 36);
    const positionId =
      request.query?.positionId === undefined
        ? null
        : readString(request.query.positionId, "positionId", 36);
    const status =
      request.query?.status === undefined ? null : readString(request.query.status, "status", 32);
    const cursor = decodeEmployeeCursor(request.query?.cursor);
    const limit = readEmployeeLimit(request.query?.limit);

    const filters: string[] = ["d.companyId = ?"];
    const params: unknown[] = [companyId];
    if (departmentId) {
      filters.push("d.departmentId = ?");
      params.push(departmentId);
    }
    if (positionId) {
      filters.push("d.positionId = ?");
      params.push(positionId);
    }
    if (status) {
      filters.push("d.employmentStatus = ?");
      params.push(status);
    }
    if (cursor) {
      filters.push("(d.updatedAt < ? OR (d.updatedAt = ? AND d.employmentId < ?))");
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.employmentId);
    }
    params.push(limit + 1);

    const [rows] = await pool.query(
      `SELECT d.employmentId, d.agentId, d.agentVersionId, d.agentDisplayName, d.avatarAssetId,
              d.departmentId, d.departmentName, d.positionId, d.positionName,
              d.roleId, d.roleName, d.employmentStatus, d.startedAt, d.updatedAt
       FROM ai_direct_workforce_employee_digests d
       WHERE ${filters.join(" AND ")}
       ORDER BY d.updatedAt DESC, d.employmentId DESC
       LIMIT ?`,
      params,
    );
    const items = (rows as any[]).slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: (rows as any[]).length > limit && last ? encodeEmployeeCursor(last) : null,
    };
  });

  fastify.get("/workforce/departments", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const companyId = readString(request.query?.companyId, "companyId", 36);
    await requireCompanyRole(pool, companyId, user.id, "recruiter");
    const cursor = decodeCursor(request.query?.cursor);
    const params: unknown[] = [companyId];
    let after = "";
    if (cursor) {
      after = " AND (d.sortOrder > ? OR (d.sortOrder = ? AND d.id > ?))";
      params.push(cursor.sortOrder, cursor.sortOrder, cursor.id);
    }
    params.push(PAGE_SIZE + 1);
    const [rows] = await pool.query(
      `SELECT d.id, d.companyId, d.name, d.status, d.sortOrder, d.createdAt, d.updatedAt
       FROM ai_direct_departments d
       WHERE d.companyId = ?${after}
       ORDER BY d.sortOrder ASC, d.id ASC LIMIT ?`,
      params,
    );
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null };
  });

  fastify.post("/workforce/departments", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(body, ["companyId", "name", "sortOrder"], "POST /workforce/departments");
    const companyId = readString(body.companyId, "companyId", 36);
    const name = readString(body.name, "name", 160);
    const sortOrder = readNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    const member = await requireCompanyRole(pool, companyId, user.id, "admin");
    const id = randomUUID();
    await transaction(pool, async (conn) => {
      await conn.query(
        `INSERT INTO ai_direct_departments (id, companyId, name, status, sortOrder, createdByUserId)
         VALUES (?, ?, ?, 'active', ?, ?)`,
        [id, companyId, name, sortOrder, user.id],
      );
      await writeAudit(conn, {
        organizationId: (member as any).organizationId ?? "",
        actorUserId: user.id,
        action: "workforce.department.created",
        targetType: "department",
        targetId: id,
        requestId: requestIdFrom(request),
        metadata: { companyId, name },
      });
      await publishOutboxEvent(conn as any, {
        organizationId: null,
        aggregateType: "department",
        aggregateId: id,
        eventType: "workforce.department.created.v1",
        payload: { departmentId: id, companyId, actorUserId: user.id },
      });
    });
    return reply.status(201).send({ id, companyId, name, status: "active", sortOrder });
  });

  fastify.patch("/workforce/departments/:id", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(body, ["name", "sortOrder", "toStatus"], "PATCH /workforce/departments/:id");
    const department = await companyForDepartment(pool, request.params.id);
    await requireCompanyRole(pool, department.companyId, user.id, "admin");
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(readString(body.name, "name", 160));
    }
    if (body.sortOrder !== undefined) {
      updates.push("sortOrder = ?");
      values.push(readNonNegativeInteger(body.sortOrder, "sortOrder", 0));
    }
    if (body.toStatus !== undefined) {
      const toStatus = readString(body.toStatus, "toStatus", 32) as DepartmentStatus;
      transitionDepartment(department.status as DepartmentStatus, toStatus);
      updates.push("status = ?");
      values.push(toStatus);
    }
    if (updates.length === 0)
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "没有需要更新的字段");
    values.push(department.id);
    await pool.query(
      `UPDATE ai_direct_departments SET ${updates.join(", ")}, updatedAt = NOW(3) WHERE id = ?`,
      values,
    );
    const [rows] = await pool.query(
      "SELECT id, companyId, name, status, sortOrder, createdAt, updatedAt FROM ai_direct_departments WHERE id = ?",
      [department.id],
    );
    return rows[0];
  });

  fastify.get("/workforce/positions", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const department = await companyForDepartment(
      pool,
      readString(request.query?.departmentId, "departmentId", 36),
    );
    await requireCompanyRole(pool, department.companyId, user.id, "recruiter");
    const cursor = decodeCursor(request.query?.cursor);
    const params: unknown[] = [department.id];
    let after = "";
    if (cursor) {
      after = " AND (p.sortOrder > ? OR (p.sortOrder = ? AND p.id > ?))";
      params.push(cursor.sortOrder, cursor.sortOrder, cursor.id);
    }
    params.push(PAGE_SIZE + 1);
    const [rows] = await pool.query(
      `SELECT p.id, p.departmentId, p.name, p.status, p.headcountTarget, p.headcountFilled, p.requirementsSummary, p.sortOrder, p.createdAt, p.updatedAt
       FROM ai_direct_positions p WHERE p.departmentId = ?${after}
       ORDER BY p.sortOrder ASC, p.id ASC LIMIT ?`,
      params,
    );
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null };
  });

  fastify.post("/workforce/positions", { onRequest: auth }, async (request: any, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(
      body,
      ["departmentId", "name", "headcountTarget", "requirementsSummary", "sortOrder"],
      "POST /workforce/positions",
    );
    const department = await companyForDepartment(
      pool,
      readString(body.departmentId, "departmentId", 36),
    );
    await requireCompanyRole(pool, department.companyId, user.id, "admin");
    if (department.status !== "active")
      throw new AiDirectHiringError(
        ErrorCodes.INVALID_TRANSITION,
        "非 active Department 不能创建 Position",
        409,
      );
    const id = randomUUID();
    const name = readString(body.name, "name", 160);
    const headcountTarget = readNonNegativeInteger(body.headcountTarget, "headcountTarget", 1);
    if (headcountTarget === 0)
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "headcountTarget 必须至少为 1");
    const requirementsSummary =
      body.requirementsSummary === undefined ? null : body.requirementsSummary;
    const sortOrder = readNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    await transaction(pool, async (conn) => {
      await conn.query(
        `INSERT INTO ai_direct_positions
         (id, departmentId, name, status, headcountTarget, headcountFilled, requirementsSummary, sortOrder, createdByUserId)
         VALUES (?, ?, ?, 'draft', ?, 0, ?, ?, ?)`,
        [
          id,
          department.id,
          name,
          headcountTarget,
          requirementsSummary ? JSON.stringify(requirementsSummary) : null,
          sortOrder,
          user.id,
        ],
      );
      await writeAudit(conn, {
        organizationId: department.organizationId,
        actorUserId: user.id,
        action: "workforce.position.created",
        targetType: "position",
        targetId: id,
        requestId: requestIdFrom(request),
        metadata: { departmentId: department.id, companyId: department.companyId },
      });
      await publishOutboxEvent(conn as any, {
        organizationId: department.organizationId,
        aggregateType: "position",
        aggregateId: id,
        eventType: "workforce.position.created.v1",
        payload: {
          positionId: id,
          departmentId: department.id,
          companyId: department.companyId,
          actorUserId: user.id,
        },
      });
    });
    return reply.status(201).send({
      id,
      departmentId: department.id,
      name,
      status: "draft",
      headcountTarget,
      headcountFilled: 0,
      sortOrder,
    });
  });

  fastify.patch("/workforce/positions/:id", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(
      body,
      ["name", "headcountTarget", "requirementsSummary", "sortOrder", "toStatus"],
      "PATCH /workforce/positions/:id",
    );
    const position = await positionForAccess(pool, request.params.id);
    await requireCompanyRole(pool, position.companyId, user.id, "admin");
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(readString(body.name, "name", 160));
    }
    if (body.headcountTarget !== undefined) {
      const target = readNonNegativeInteger(body.headcountTarget, "headcountTarget", 1);
      if (target < (position.headcountFilled ?? 0))
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "headcountTarget 不能小于已聘人数",
        );
      updates.push("headcountTarget = ?");
      values.push(target);
    }
    if (body.requirementsSummary !== undefined) {
      updates.push("requirementsSummary = ?");
      values.push(JSON.stringify(body.requirementsSummary));
    }
    if (body.sortOrder !== undefined) {
      updates.push("sortOrder = ?");
      values.push(readNonNegativeInteger(body.sortOrder, "sortOrder", 0));
    }
    if (body.toStatus !== undefined) {
      const toStatus = readString(body.toStatus, "toStatus", 32) as PositionStatus;
      if (!POSITION_STATUSES.includes(toStatus))
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "无效的 Position 状态");
      transitionPosition(position.status as PositionStatus, toStatus);
      updates.push("status = ?");
      values.push(toStatus);
    }
    if (updates.length === 0)
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "没有需要更新的字段");
    values.push(position.id);
    await pool.query(
      `UPDATE ai_direct_positions SET ${updates.join(", ")}, updatedAt = NOW(3) WHERE id = ?`,
      values,
    );
    const [rows] = await pool.query(
      "SELECT id, departmentId, name, status, headcountTarget, headcountFilled, requirementsSummary, sortOrder, createdAt, updatedAt FROM ai_direct_positions WHERE id = ?",
      [position.id],
    );
    return rows[0];
  });

  fastify.get("/workforce/positions/:id/roles", { onRequest: auth }, async (request: any) => {
    const user = await requireAuth(fastify, request);
    const position = await positionForAccess(pool, request.params.id);
    await requireCompanyRole(pool, position.companyId, user.id, "recruiter");
    const [rows] = await pool.query(
      `SELECT r.id, r.companyId, r.projectId, r.name, r.status, r.requiredCapabilities, r.responsibilities
       FROM ai_direct_position_agent_roles pr
       JOIN ai_direct_agent_roles r ON r.id = pr.roleId
       WHERE pr.positionId = ? ORDER BY r.name ASC, r.id ASC`,
      [position.id],
    );
    return { items: rows };
  });

  fastify.post(
    "/workforce/positions/:id/roles",
    { onRequest: auth },
    async (request: any, reply) => {
      const user = await requireAuth(fastify, request);
      const body = readBody(request.body);
      rejectExtra(body, ["roleId"], "POST /workforce/positions/:id/roles");
      const position = await positionForAccess(pool, request.params.id);
      await requireCompanyRole(pool, position.companyId, user.id, "admin");
      if (position.status === "archived")
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          "已归档 Position 不能关联 Role",
          409,
        );
      const roleId = readString(body.roleId, "roleId", 36);
      const [roles] = await pool.query(
        "SELECT id, companyId, status FROM ai_direct_agent_roles WHERE id = ? LIMIT 1",
        [roleId],
      );
      const role = roles[0];
      if (!role || role.companyId !== position.companyId || role.status !== "open") {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "Role 必须是同公司 open 状态的角色",
          409,
        );
      }
      await transaction(pool, async (conn) => {
        await conn.query(
          "INSERT INTO ai_direct_position_agent_roles (positionId, roleId) VALUES (?, ?)",
          [position.id, roleId],
        );
        await writeAudit(conn, {
          organizationId: position.organizationId,
          actorUserId: user.id,
          action: "workforce.position.role.bound",
          targetType: "position_agent_role",
          targetId: roleId,
          requestId: requestIdFrom(request),
          metadata: { positionId: position.id, roleId },
        });
        await publishOutboxEvent(conn as any, {
          organizationId: position.organizationId,
          aggregateType: "position",
          aggregateId: position.id,
          eventType: "workforce.position.role.bound.v1",
          payload: { positionId: position.id, roleId, actorUserId: user.id },
        });
      });
      return reply.status(201).send({ positionId: position.id, roleId });
    },
  );

  fastify.delete(
    "/workforce/positions/:id/roles/:roleId",
    { onRequest: auth },
    async (request: any, reply) => {
      const user = await requireAuth(fastify, request);
      const position = await positionForAccess(pool, request.params.id);
      await requireCompanyRole(pool, position.companyId, user.id, "admin");
      if (position.status === "archived")
        throw new AiDirectHiringError(
          ErrorCodes.INVALID_TRANSITION,
          "已归档 Position 不能解除 Role",
          409,
        );
      const [result] = await pool.query(
        "DELETE FROM ai_direct_position_agent_roles WHERE positionId = ? AND roleId = ?",
        [position.id, request.params.roleId],
      );
      if (result.affectedRows === 0)
        throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, "Position Role 关联不存在", 404);
      return reply.status(204).send();
    },
  );
}
