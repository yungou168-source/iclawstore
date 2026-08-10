import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/aiDirectAuth.js";
import { requireCompanyRole } from "../middleware/aiDirectRbac.js";
import { listAgentPrices, setAgentPrice } from "../services/agentPricing.js";
import { listDeveloperAgentSales } from "../services/agentSales.js";
import { AiDirectHiringError, ErrorCodes } from "../services/aiDirectErrors.js";
import { loadAlipayConfig, verifyAlipayNotification } from "../services/alipayProvider.js";
import { createFreeHiringSale, isFreeHiringRequest } from "../services/freeHiring.js";
import { fulfillPaidHiring } from "../services/paidHiring.js";
import { parseNonNegativeCnyFen } from "../services/paidHiringMoney.js";
import {
  createDeveloperSettlement,
  getDeveloperSettlement,
  getPaymentOrder,
  listDeveloperPayableBalances,
  listDeveloperSettlements,
  listOperationalAlerts,
  listSettleableLedgerEntries,
  reconcilePaymentOrder,
  transitionDeveloperSettlement,
} from "../services/paidHiringOperations.js";
import { createPaidHiringOrder } from "../services/paidHiringOrder.js";
import {
  extractRequestId,
  idempotencyFingerprint,
  parseIdempotencyKey,
} from "../utils/idempotency.js";

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "请求体必须是对象");
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength = 36): string => {
  if (typeof value !== "string") {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${field} 长度必须为 1 到 ${maxLength}`,
    );
  }
  return normalized;
};

const rejectExtra = (body: Record<string, unknown>, allowed: string[], endpoint: string): void => {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${endpoint} 不接受以下字段: ${extra.join(", ")}`,
      400,
      { extraFields: extra },
    );
  }
};

type ParsedAlipayBody = {
  params: Record<string, string>;
  rawBody: string;
};

const isParsedAlipayBody = (value: unknown): value is ParsedAlipayBody =>
  Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "params" in value &&
    "rawBody" in value,
  );

export async function aiDirectPaidHiringRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = fastify.mysql;
  const auth = [fastify.authenticate];

  if (!fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
    fastify.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => {
        try {
          const rawBody = String(body);
          const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
          done(null, { params, rawBody } satisfies ParsedAlipayBody);
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }

  fastify.post("/agents/:agentId/prices", { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const { agentId } = request.params as { agentId: string };
    const body = readBody(request.body);
    rejectExtra(body, ["agentVersionId", "amountFen", "currency"], "POST /agents/:agentId/prices");
    if (body.currency !== undefined && body.currency !== "CNY") {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "首期雇佣定价仅支持 CNY");
    }
    const result = await setAgentPrice(pool, {
      agentId: readString(agentId, "agentId"),
      agentVersionId: readString(body.agentVersionId, "agentVersionId"),
      developerUserId: user.id,
      amountFen: parseNonNegativeCnyFen(body.amountFen),
      requestId: extractRequestId(request),
    });
    return reply.status(201).send({ ...result, amountFen: String(result.amountFen) });
  });

  fastify.get("/agents/:agentId/prices", { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const { agentId } = request.params as { agentId: string };
    const prices = await listAgentPrices(pool, readString(agentId, "agentId"), user.id);
    return reply.send({
      prices: prices.map((price) => ({ ...price, amountFen: String(price.amountFen) })),
    });
  });

  fastify.get("/agent-sales", { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const query = request.query as { limit?: string };
    const sales = await listDeveloperAgentSales(pool, {
      developerUserId: user.id,
      limit: Number(query.limit) || undefined,
    });
    return reply.send({
      items: sales.map((sale) => ({
        ...sale,
        grossAmountFen: String(sale.grossAmountFen),
        platformRevenueFen: String(sale.platformRevenueFen),
        developerRevenueFen: String(sale.developerRevenueFen),
        refundedFen: String(sale.refundedFen),
      })),
    });
  });

  fastify.post("/paid-hiring/orders", { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(
      body,
      ["companyId", "projectId", "roleId", "positionId", "agentId"],
      "POST /paid-hiring/orders",
    );
    const companyId = readString(body.companyId, "companyId");
    const projectId = body.projectId == null ? null : readString(body.projectId, "projectId");
    const roleId = readString(body.roleId, "roleId");
    const positionId = readString(body.positionId, "positionId");
    const agentId = readString(body.agentId, "agentId");
    await requireCompanyRole(pool, companyId, user.id, "recruiter");

    const idempotencyKey = parseIdempotencyKey(request);
    if (!idempotencyKey) {
      throw new AiDirectHiringError(
        ErrorCodes.IDEMPOTENCY_KEY_INVALID,
        "创建雇佣支付订单必须提供 Idempotency-Key",
      );
    }
    const fingerprint = idempotencyFingerprint({
      companyId,
      projectId,
      roleId,
      positionId,
      agentId,
    });
    const hiringInput = {
      companyId,
      projectId,
      roleId,
      positionId,
      agentId,
      requestedByUserId: user.id,
      idempotencyKey,
      idempotencyFingerprint: fingerprint,
      requestId: extractRequestId(request),
    };
    if (await isFreeHiringRequest(pool, hiringInput)) {
      const sale = await createFreeHiringSale(pool, hiringInput);
      return reply.status(sale.replayed ? 200 : 201).send({
        ...sale,
        outTradeNo: sale.saleNo,
        grossAmountFen: "0",
        platformFeeFen: "0",
        developerPayableFen: "0",
        nextReconcileAt: null,
        lastProviderStatus: null,
      });
    }

    const order = await createPaidHiringOrder(pool, hiringInput);
    if (order.status === "pending") {
      await fulfillPaidHiring(
        pool,
        {
          outTradeNo: order.outTradeNo,
          tradeNo: `wallet:${order.outTradeNo}`,
          totalAmountFen: order.grossAmountFen,
          rawNotifySha256: `wallet:${order.id}`,
        },
        user.id,
      );
    }
    const fulfilled = await getPaymentOrder(pool, order.id, user.id);
    return reply.status(order.replayed ? 200 : 201).send({
      ...fulfilled,
      provider: "wallet",
      grossAmountFen: String(fulfilled.grossAmountFen),
      platformFeeFen: String(order.platformFeeFen),
      developerPayableFen: String(order.developerPayableFen),
      replayed: order.replayed,
    });
  });

  fastify.get("/paid-hiring/orders/:orderId", { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const { orderId } = request.params as { orderId: string };
    const order = await getPaymentOrder(pool, readString(orderId, "orderId"), user.id);
    return reply.send({ ...order, grossAmountFen: String(order.grossAmountFen) });
  });

  fastify.post(
    "/paid-hiring/orders/:orderId/reconcile",
    { onRequest: auth },
    async (request, reply) => {
      const config = loadAlipayConfig();
      if (!config)
        throw new AiDirectHiringError(
          ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
          "支付宝雇佣支付未启用或商户配置不可用",
          503,
        );
      const user = await requireAuth(fastify, request);
      const { orderId } = request.params as { orderId: string };
      const order = await reconcilePaymentOrder(pool, config, {
        orderId: readString(orderId, "orderId"),
        requesterUserId: user.id,
      });
      return reply.send({ ...order, grossAmountFen: String(order.grossAmountFen) });
    },
  );

  const requireSettlementStaff = async (request: Parameters<typeof requireAuth>[1]) => {
    const user = await requireAuth(fastify, request);
    const staffIds = new Set(
      (process.env.AI_DIRECT_SETTLEMENT_STAFF_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
    if (!staffIds.has(user.id))
      throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "需要平台结算 staff 权限", 403);
    return user;
  };

  fastify.get("/paid-hiring/settlements/balances", { onRequest: auth }, async (request, reply) => {
    await requireSettlementStaff(request);
    const query = request.query as { limit?: string; cursor?: string };
    const page = await listDeveloperPayableBalances(pool, {
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({
      items: page.items.map((item) => ({ ...item, payableFen: String(item.payableFen) })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.get("/paid-hiring/settlements/entries", { onRequest: auth }, async (request, reply) => {
    await requireSettlementStaff(request);
    const query = request.query as { developerUserId?: string; limit?: string; cursor?: string };
    const page = await listSettleableLedgerEntries(pool, {
      developerUserId: readString(query.developerUserId, "developerUserId", 191),
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({
      items: page.items.map((item) => ({ ...item, amountFen: String(item.amountFen) })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.get("/paid-hiring/settlements", { onRequest: auth }, async (request, reply) => {
    await requireSettlementStaff(request);
    const query = request.query as {
      developerUserId?: string;
      status?: string;
      limit?: string;
      cursor?: string;
    };
    const page = await listDeveloperSettlements(pool, {
      developerUserId: query.developerUserId?.trim() || undefined,
      status: query.status?.trim() || undefined,
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({
      items: page.items.map((item) => ({ ...item, amountFen: String(item.amountFen) })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.get(
    "/paid-hiring/settlements/:settlementId",
    { onRequest: auth },
    async (request, reply) => {
      await requireSettlementStaff(request);
      const { settlementId } = request.params as { settlementId: string };
      const settlement = await getDeveloperSettlement(
        pool,
        readString(settlementId, "settlementId"),
      );
      return reply.send({
        ...settlement,
        amountFen: String(settlement.amountFen),
        items: settlement.items.map((item) => ({ ...item, amountFen: String(item.amountFen) })),
      });
    },
  );

  fastify.get("/paid-hiring/operations/alerts", { onRequest: auth }, async (request, reply) => {
    await requireSettlementStaff(request);
    const query = request.query as { status?: string; limit?: string; cursor?: string };
    const status = query.status?.trim();
    if (status !== undefined && status !== "open" && status !== "resolved") {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "status 必须是 open 或 resolved");
    }
    const page = await listOperationalAlerts(pool, {
      status,
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  fastify.post("/paid-hiring/settlements", { onRequest: auth }, async (request, reply) => {
    const user = await requireSettlementStaff(request);
    const body = readBody(request.body);
    rejectExtra(body, ["developerUserId", "ledgerEntryIds"], "POST /paid-hiring/settlements");
    if (
      !Array.isArray(body.ledgerEntryIds) ||
      !body.ledgerEntryIds.every((id) => typeof id === "string")
    ) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "ledgerEntryIds 必须是字符串数组");
    }
    const settlement = await createDeveloperSettlement(pool, {
      developerUserId: readString(body.developerUserId, "developerUserId", 191),
      ledgerEntryIds: body.ledgerEntryIds.map((id) => readString(id, "ledgerEntryId")),
      createdByUserId: user.id,
    });
    return reply.status(201).send({ ...settlement, amountFen: String(settlement.amountFen) });
  });

  fastify.post(
    "/paid-hiring/settlements/:settlementId/:action",
    { onRequest: auth },
    async (request, reply) => {
      const user = await requireSettlementStaff(request);
      const { settlementId, action } = request.params as { settlementId: string; action: string };
      if (!["processing", "completed", "failed", "retry"].includes(action))
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "未知结算操作");
      const body = request.body === undefined ? {} : readBody(request.body);
      rejectExtra(
        body,
        ["externalReference", "failureReason"],
        "POST /paid-hiring/settlements/:settlementId/:action",
      );
      await transitionDeveloperSettlement(pool, {
        settlementId: readString(settlementId, "settlementId"),
        actorUserId: user.id,
        action: action as "processing" | "completed" | "failed" | "retry",
        externalReference:
          typeof body.externalReference === "string" ? body.externalReference : undefined,
        failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined,
      });
      return reply.status(204).send();
    },
  );

  fastify.post("/paid-hiring/alipay/notify", async (request, reply) => {
    try {
      const config = loadAlipayConfig();
      if (!config) {
        throw new AiDirectHiringError(
          ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
          "支付宝雇佣支付未启用或商户配置不可用",
          503,
        );
      }
      if (!isParsedAlipayBody(request.body)) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          "支付宝回调必须使用 application/x-www-form-urlencoded",
        );
      }
      const notification = verifyAlipayNotification(
        config,
        request.body.params,
        request.body.rawBody,
      );
      await fulfillPaidHiring(pool, notification);
      return reply.type("text/plain").status(200).send("success");
    } catch (error) {
      request.log.error({ err: error }, "支付宝雇佣支付回调验证或履约失败");
      return reply.type("text/plain").status(200).send("failure");
    }
  });
}
