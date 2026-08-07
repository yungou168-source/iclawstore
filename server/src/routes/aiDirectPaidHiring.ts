import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { requireCompanyRole } from '../middleware/aiDirectRbac.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';
import {
  createAlipayPagePayUrl,
  loadAlipayConfig,
  verifyAlipayNotification,
} from '../services/alipayProvider.js';
import { fulfillPaidHiring } from '../services/paidHiring.js';
import { parseCnyFen } from '../services/paidHiringMoney.js';
import { createPaidHiringOrder, setActiveAgentPrice } from '../services/paidHiringOrder.js';
import {
  extractRequestId,
  idempotencyFingerprint,
  parseIdempotencyKey,
} from '../utils/idempotency.js';

const readBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '请求体必须是对象');
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown, field: string, maxLength = 36): string => {
  if (typeof value !== 'string') {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, `${field} 长度必须为 1 到 ${maxLength}`);
  }
  return normalized;
};

const rejectExtra = (body: Record<string, unknown>, allowed: string[], endpoint: string): void => {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      `${endpoint} 不接受以下字段: ${extra.join(', ')}`,
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
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'params' in value &&
      'rawBody' in value,
  );

export async function aiDirectPaidHiringRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql;
  const auth = [fastify.authenticate];

  if (!fastify.hasContentTypeParser('application/x-www-form-urlencoded')) {
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
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

  fastify.post('/agents/:agentId/prices', { onRequest: auth }, async (request, reply) => {
    const user = await requireAuth(fastify, request);
    const { agentId } = request.params as { agentId: string };
    const body = readBody(request.body);
    rejectExtra(body, ['agentVersionId', 'amountFen', 'currency'], 'POST /agents/:agentId/prices');
    if (body.currency !== undefined && body.currency !== 'CNY') {
      throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '首期雇佣定价仅支持 CNY');
    }
    const result = await setActiveAgentPrice(pool, {
      agentId: readString(agentId, 'agentId'),
      agentVersionId: readString(body.agentVersionId, 'agentVersionId'),
      developerUserId: user.id,
      amountFen: parseCnyFen(body.amountFen),
    });
    return reply.status(201).send({ ...result, amountFen: String(result.amountFen) });
  });

  fastify.post('/paid-hiring/orders', { onRequest: auth }, async (request, reply) => {
    const config = loadAlipayConfig();
    if (!config) {
      throw new AiDirectHiringError(
        ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
        '支付宝雇佣支付未启用或商户配置不可用',
        503,
      );
    }
    const user = await requireAuth(fastify, request);
    const body = readBody(request.body);
    rejectExtra(
      body,
      ['companyId', 'projectId', 'roleId', 'positionId', 'agentId'],
      'POST /paid-hiring/orders',
    );
    const companyId = readString(body.companyId, 'companyId');
    const projectId = body.projectId == null ? null : readString(body.projectId, 'projectId');
    const roleId = readString(body.roleId, 'roleId');
    const positionId = readString(body.positionId, 'positionId');
    const agentId = readString(body.agentId, 'agentId');
    await requireCompanyRole(pool, companyId, user.id, 'recruiter');

    const idempotencyKey = parseIdempotencyKey(request);
    if (!idempotencyKey) {
      throw new AiDirectHiringError(
        ErrorCodes.IDEMPOTENCY_KEY_INVALID,
        '创建雇佣支付订单必须提供 Idempotency-Key',
      );
    }
    const fingerprint = idempotencyFingerprint({ companyId, projectId, roleId, positionId, agentId });
    const order = await createPaidHiringOrder(pool, {
      companyId,
      projectId,
      roleId,
      positionId,
      agentId,
      requestedByUserId: user.id,
      idempotencyKey,
      idempotencyFingerprint: fingerprint,
      requestId: extractRequestId(request),
    });
    const payUrl = createAlipayPagePayUrl(config, {
      outTradeNo: order.outTradeNo,
      amountFen: order.grossAmountFen,
      subject: `雇佣 Agent：${order.agentName}`,
    });
    return reply.status(order.replayed ? 200 : 201).send({
      id: order.id,
      hiringIntentId: order.hiringIntentId,
      outTradeNo: order.outTradeNo,
      provider: 'alipay',
      status: order.status,
      currency: order.currency,
      grossAmountFen: String(order.grossAmountFen),
      platformFeeFen: String(order.platformFeeFen),
      developerPayableFen: String(order.developerPayableFen),
      payUrl,
      replayed: order.replayed,
    });
  });

  fastify.post('/paid-hiring/alipay/notify', async (request, reply) => {
    try {
      const config = loadAlipayConfig();
      if (!config) {
        throw new AiDirectHiringError(
          ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
          '支付宝雇佣支付未启用或商户配置不可用',
          503,
        );
      }
      if (!isParsedAlipayBody(request.body)) {
        throw new AiDirectHiringError(
          ErrorCodes.VALIDATION_ERROR,
          '支付宝回调必须使用 application/x-www-form-urlencoded',
        );
      }
      const notification = verifyAlipayNotification(
        config,
        request.body.params,
        request.body.rawBody,
      );
      await fulfillPaidHiring(pool, notification);
      return reply.type('text/plain').status(200).send('success');
    } catch (error) {
      request.log.error({ err: error }, '支付宝雇佣支付回调验证或履约失败');
      return reply.type('text/plain').status(200).send('failure');
    }
  });
}