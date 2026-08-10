import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import {
  createAlipayPagePayUrl,
  loadAlipayConfig,
  verifyAlipayNotification,
} from '../services/alipayProvider.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import {
  createDeveloperSettlement,
  listDeveloperSettlements,
  listSettleableLedgerEntries,
  transitionDeveloperSettlement,
} from '../services/paidHiringOperations.js';
import {
  listRechargeOrdersForAdmin,
  listWalletAccountsForAdmin,
  listWalletStatement,
  readWalletOverview,
} from '../services/walletOperations.js';
import {
  createWalletRefund,
  listWalletRefunds,
  reviewWalletRefund,
} from '../services/walletRefund.js';
import {
  createRechargeOrder,
  fulfillRecharge,
  getRechargeOrder,
  reconcileRechargeOrder,
} from '../services/walletRecharge.js';
import { extractRequestId, parseIdempotencyKey } from '../utils/idempotency.js';

type ParsedAlipayBody = { params: Record<string, string>; rawBody: string };

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '请求体必须是对象');
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength = 191): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 格式无效`);
  }
  return value.trim();
};

const readAmountFen = (value: unknown): bigint => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'amountFen 必须是整数分');
  }
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'amountFen 必须是正整数分');
  }
  return BigInt(normalized);
};

const isParsedAlipayBody = (value: unknown): value is ParsedAlipayBody =>
  Boolean(value && typeof value === 'object' && 'params' in value && 'rawBody' in value);

const serializeRecharge = (order: Awaited<ReturnType<typeof getRechargeOrder>>) => ({
  ...order,
  amountFen: String(order.amountFen),
});

const requireFinanceStaff = async (request: FastifyRequest, fastify: FastifyInstance) => {
  const user = await requireAuth(fastify, request);
  const configured = new Set(
    (process.env.AI_DIRECT_SETTLEMENT_STAFF_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (user.role !== 'admin' && !configured.has(user.id)) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '需要财务运营权限', 403);
  }
  return user;
};

export async function aiDirectWalletRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql;
  const auth = [fastify.authenticate];

  if (!fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          const rawBody = String(body);
          done(null, {
            params: Object.fromEntries(new URLSearchParams(rawBody).entries()),
            rawBody,
          } satisfies ParsedAlipayBody);
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }

  fastify.get('/wallet', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const overview = await readWalletOverview(pool, user.id);
    return reply.send({
      ...overview,
      availableFen: String(overview.availableFen),
      frozenFen: String(overview.frozenFen),
      withdrawableEarningsFen: String(overview.withdrawableEarningsFen),
      frozenEarningsFen: String(overview.frozenEarningsFen),
    });
  });

  fastify.get('/wallet/statement', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const query = request.query as { limit?: string; cursor?: string; entryType?: string };
    const page = await listWalletStatement(pool, user.id, {
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
      entryType: query.entryType?.trim() || undefined,
    });
    return reply.send({
      items: page.items.map((item) => ({
        ...item,
        availableDeltaFen: String(item.availableDeltaFen),
        frozenDeltaFen: String(item.frozenDeltaFen),
        availableAfterFen: String(item.availableAfterFen),
        frozenAfterFen: String(item.frozenAfterFen),
      })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.post('/wallet/recharges', { onRequest: auth }, async (request, reply) => {
    const config = loadAlipayConfig();
    if (!config) {
      throw new AiDirectHiringError(
        ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
        '支付宝充值未启用或商户配置不可用',
        503,
      );
    }
    const user = await requireAuth(fastify, request);
    const idempotencyKey = parseIdempotencyKey(request);
    if (!idempotencyKey) {
      throw new AiDirectHiringError(ErrorCodes.IDEMPOTENCY_KEY_INVALID, '充值必须提供 Idempotency-Key');
    }
    const body = readBody(request.body);
    const order = await createRechargeOrder(pool, {
      userId: user.id,
      amountFen: readAmountFen(body.amountFen),
      idempotencyKey,
    });
    const payUrl = createAlipayPagePayUrl(config, {
      outTradeNo: order.outTradeNo,
      amountFen: order.amountFen,
      subject: 'iClawStore 钱包充值',
    });
    return reply.status(order.replayed ? 200 : 201).send({ ...serializeRecharge(order), payUrl });
  });

  fastify.get('/wallet/recharges/:orderId', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const { orderId } = request.params as { orderId: string };
    return reply.send(serializeRecharge(await getRechargeOrder(pool, readString(orderId, 'orderId', 36), user.id)));
  });

  fastify.post(
    '/wallet/recharges/:orderId/reconcile',
    { onRequest: auth },
    async (request, reply) => {
      const config = loadAlipayConfig();
      if (!config) {
        throw new AiDirectHiringError(ErrorCodes.RUNTIME_CAPABILITY_DISABLED, '支付宝充值未启用', 503);
      }
      const user = await requireAuth(fastify, request);
      const { orderId } = request.params as { orderId: string };
      const order = await reconcileRechargeOrder(
        pool,
        config,
        readString(orderId, 'orderId', 36),
        user.id,
      );
      return reply.send(serializeRecharge(order));
    },
  );

  fastify.post('/wallet/alipay/notify', async (request, reply) => {
    try {
      const config = loadAlipayConfig();
      if (!config) throw new Error('支付宝充值未启用');
      if (!isParsedAlipayBody(request.body)) throw new Error('支付宝回调格式无效');
      const notification = verifyAlipayNotification(
        config,
        request.body.params,
        request.body.rawBody,
      );
      await fulfillRecharge(pool, notification);
      return reply.type('text/plain').status(200).send('success');
    } catch (error) {
      request.log.error({ err: error, requestId: extractRequestId(request) }, '支付宝充值回调失败');
      return reply.type('text/plain').status(200).send('failure');
    }
  });

  fastify.get('/wallet/earnings/entries', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const query = request.query as { limit?: string; cursor?: string };
    const page = await listSettleableLedgerEntries(pool, {
      developerUserId: user.id,
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({
      items: page.items.map((item) => ({ ...item, amountFen: String(item.amountFen) })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.get('/wallet/withdrawals', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const query = request.query as { limit?: string; cursor?: string };
    const page = await listDeveloperSettlements(pool, {
      developerUserId: user.id,
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
    });
    return reply.send({
      items: page.items.map((item) => ({ ...item, amountFen: String(item.amountFen) })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.post('/wallet/withdrawals', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    if (!Array.isArray(body.ledgerEntryIds) || body.ledgerEntryIds.length === 0) {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, 'ledgerEntryIds 必须是非空数组');
    }
    const ledgerEntryIds = body.ledgerEntryIds.map((id) => readString(id, 'ledgerEntryId', 36));
    const settlement = await createDeveloperSettlement(pool, {
      developerUserId: user.id,
      ledgerEntryIds,
      createdByUserId: user.id,
      requestedByUserId: user.id,
    });
    return reply.status(201).send({ ...settlement, amountFen: String(settlement.amountFen) });
  });

  fastify.get('/wallet/admin/accounts', { onRequest: auth }, async (request, reply) => {
    await requireFinanceStaff(request, fastify);
    const query = request.query as { search?: string; limit?: string };
    const items = await listWalletAccountsForAdmin(pool, {
      search: query.search,
      limit: Number(query.limit) || undefined,
    });
    return reply.send({
      items: items.map((item) => ({
        ...item,
        availableFen: String(item.availableFen),
        frozenFen: String(item.frozenFen),
      })),
    });
  });

  fastify.get('/wallet/admin/accounts/:userId/statement', { onRequest: auth }, async (request, reply) => {
    await requireFinanceStaff(request, fastify);
    const { userId } = request.params as { userId: string };
    const query = request.query as { limit?: string; cursor?: string; entryType?: string };
    const page = await listWalletStatement(pool, readString(userId, 'userId', 191), {
      limit: Number(query.limit) || undefined,
      cursor: query.cursor,
      entryType: query.entryType?.trim() || undefined,
    });
    return reply.send({
      items: page.items.map((item) => ({
        ...item,
        availableDeltaFen: String(item.availableDeltaFen),
        frozenDeltaFen: String(item.frozenDeltaFen),
        availableAfterFen: String(item.availableAfterFen),
        frozenAfterFen: String(item.frozenAfterFen),
      })),
      nextCursor: page.nextCursor,
    });
  });

  fastify.get('/wallet/admin/recharges', { onRequest: auth }, async (request, reply) => {
    await requireFinanceStaff(request, fastify);
    const query = request.query as { status?: string; limit?: string };
    const items = await listRechargeOrdersForAdmin(pool, {
      status: query.status?.trim() || undefined,
      limit: Number(query.limit) || undefined,
    });
    return reply.send({ items: items.map((item) => ({ ...item, amountFen: String(item.amountFen) })) });
  });

  fastify.get('/wallet/admin/refunds', { onRequest: auth }, async (request, reply) => {
    await requireFinanceStaff(request, fastify);
    const query = request.query as { status?: string; limit?: string };
    const items = await listWalletRefunds(pool, {
      status: query.status?.trim() || undefined,
      limit: Number(query.limit) || undefined,
    });
    return reply.send({ items: items.map((item) => ({ ...item, amountFen: String(item.amountFen) })) });
  });

  fastify.post('/wallet/admin/refunds', { onRequest: auth }, async (request, reply) => {
    const staff = await requireFinanceStaff(request, fastify);
    const body = readBody(request.body);
    const refund = await createWalletRefund(pool, {
      paymentOrderId: readString(body.paymentOrderId, 'paymentOrderId', 36),
      amountFen: readAmountFen(body.amountFen),
      reason: readString(body.reason, 'reason', 512),
      requestedByUserId: staff.id,
    });
    return reply.status(201).send({ ...refund, amountFen: String(refund.amountFen) });
  });

  fastify.post(
    '/wallet/admin/refunds/:refundId/:action',
    { onRequest: auth },
    async (request, reply) => {
      const staff = await requireFinanceStaff(request, fastify);
      const { refundId, action } = request.params as { refundId: string; action: string };
      if (action !== 'approve' && action !== 'reject') {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '退款操作必须是 approve 或 reject');
      }
      const body = request.body === undefined ? {} : readBody(request.body);
      const result = await reviewWalletRefund(pool, {
        refundId: readString(refundId, 'refundId', 36),
        approved: action === 'approve',
        reviewerUserId: staff.id,
        reviewNote: typeof body.reviewNote === 'string' ? body.reviewNote.trim() : undefined,
      });
      return reply.send(result);
    },
  );

  fastify.post(
    '/wallet/admin/withdrawals/:settlementId/:action',
    { onRequest: auth },
    async (request, reply) => {
      const staff = await requireFinanceStaff(request, fastify);
      const { settlementId, action } = request.params as { settlementId: string; action: string };
      if (!['processing', 'completed', 'failed', 'retry'].includes(action)) {
        throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '未知提现操作');
      }
      const body = request.body === undefined ? {} : readBody(request.body);
      await transitionDeveloperSettlement(pool, {
        settlementId: readString(settlementId, 'settlementId', 36),
        actorUserId: staff.id,
        action: action as 'processing' | 'completed' | 'failed' | 'retry',
        externalReference:
          typeof body.externalReference === 'string' ? body.externalReference.trim() : undefined,
        failureReason: typeof body.failureReason === 'string' ? body.failureReason.trim() : undefined,
      });
      return reply.status(204).send();
    },
  );
}