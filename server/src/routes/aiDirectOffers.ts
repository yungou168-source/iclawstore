import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/aiDirectAuth.js';
import { AiDirectHiringError, ErrorCodes } from '../services/aiDirectErrors.js';

const RETIRED_OFFER_WRITE_MESSAGE =
  'Offer 是支付成功后生成的不可变雇佣凭证，不支持创建、提交、审批、发送、接受、拒绝、撤回或过期操作';

const retiredOfferWrite = async (): Promise<never> => {
  throw new AiDirectHiringError(
    ErrorCodes.INVALID_TRANSITION,
    RETIRED_OFFER_WRITE_MESSAGE,
    409,
    { replacement: 'POST /paid-hiring/orders' },
  );
};

export async function aiDirectOffersRoutes(fastify: FastifyInstance): Promise<void> {
  const pool = (fastify as any).mysql;
  const auth = [fastify.authenticate];

  fastify.get('/offers', { onRequest: auth }, async (request) => {
    const user = await requireAuth(fastify, request);
    const query = request.query as { status?: unknown };
    const status = typeof query?.status === 'string' ? query.status : null;
    if (status && status !== 'issued') {
      throw new AiDirectHiringError(
        ErrorCodes.VALIDATION_ERROR,
        "支付即雇佣模式下 Offer 状态仅支持 'issued'",
      );
    }
    const [rows] = await pool.query(
      `SELECT o.id, o.roleId, o.agentVersionId, o.companyId, o.projectId, o.status,
              o.terms, o.proposedByUserId, o.proposedAt, o.paymentOrderId, o.issuedAt,
              o.createdAt, o.updatedAt, r.name AS roleName, c.name AS companyName,
              po.currency, po.grossAmountFen, po.platformFeeFen, po.developerPayableFen,
              po.employmentId
       FROM ai_direct_offers o
       JOIN ai_direct_agent_roles r ON r.id = o.roleId
       JOIN ai_direct_companies c ON c.id = o.companyId
       JOIN ai_direct_payment_orders po ON po.id = o.paymentOrderId AND po.status = 'fulfilled'
       WHERE o.status = 'issued' AND (
         o.proposedByUserId = ? OR EXISTS (
           SELECT 1 FROM ai_direct_organization_members member
           WHERE member.organizationId = c.organizationId
             AND member.userId = ? AND member.status = 'active'
         )
       )
       ORDER BY o.issuedAt DESC, o.id DESC
       LIMIT 100`,
      [user.id, user.id],
    );
    return {
      items: (rows as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        grossAmountFen: String(row.grossAmountFen),
        platformFeeFen: String(row.platformFeeFen),
        developerPayableFen: String(row.developerPayableFen),
      })),
    };
  });

  fastify.get('/offers/:id', { onRequest: auth }, async (request) => {
    const user = await requireAuth(fastify, request);
    const { id } = request.params as { id: string };
    const [rows] = await pool.query(
      `SELECT o.id, o.roleId, o.agentVersionId, o.companyId, o.projectId, o.status,
              o.terms, o.proposedByUserId, o.proposedAt, o.paymentOrderId, o.issuedAt,
              o.createdAt, o.updatedAt, r.name AS roleName, c.name AS companyName,
              po.currency, po.grossAmountFen, po.platformFeeFen, po.developerPayableFen,
              po.employmentId
       FROM ai_direct_offers o
       JOIN ai_direct_agent_roles r ON r.id = o.roleId
       JOIN ai_direct_companies c ON c.id = o.companyId
       JOIN ai_direct_payment_orders po ON po.id = o.paymentOrderId AND po.status = 'fulfilled'
       WHERE o.id = ? AND o.status = 'issued' AND (
         o.proposedByUserId = ? OR EXISTS (
           SELECT 1 FROM ai_direct_organization_members member
           WHERE member.organizationId = c.organizationId
             AND member.userId = ? AND member.status = 'active'
         )
       )
       LIMIT 1`,
      [id, user.id, user.id],
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) throw new AiDirectHiringError(ErrorCodes.NOT_FOUND, 'Offer 凭证不存在', 404);
    return {
      ...row,
      grossAmountFen: String(row.grossAmountFen),
      platformFeeFen: String(row.platformFeeFen),
      developerPayableFen: String(row.developerPayableFen),
    };
  });

  fastify.post('/offers', { onRequest: auth }, retiredOfferWrite);
  for (const action of ['submit', 'approve', 'reject', 'send', 'accept', 'decline', 'revoke', 'expire']) {
    fastify.post(`/offers/:id/${action}`, { onRequest: auth }, retiredOfferWrite);
  }
}