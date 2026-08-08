import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool, type Pool } from "mysql2/promise";
import { createAiDirectCoreRoutes } from "../src/routes/aiDirectCore.js";
import { setAgentPrice } from "../src/services/agentPricing.js";
import { AiDirectHiringError, errorResponse } from "../src/services/aiDirectErrors.js";
import { ManagedAssetStore } from "../src/services/managedAssetStore.js";
import { fulfillPaidHiring } from "../src/services/paidHiring.js";
import {
  createDeveloperSettlement,
  reconcileDuePaymentOrders,
  transitionDeveloperSettlement,
} from "../src/services/paidHiringOperations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("AI Direct recruitment core MySQL closure", () => {
  let app: FastifyInstance;
  let pool: Pool;
  let authorization: string;
  let developerAuthorization: string;
  let assetRoot: string;

  beforeAll(async () => {
    const alipayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.ALIPAY_PAID_HIRING_ENABLED = "true";
    process.env.ALIPAY_APP_ID = "integration-alipay-app";
    process.env.ALIPAY_SELLER_ID = "integration-alipay-seller";
    process.env.ALIPAY_PRIVATE_KEY = alipayKeys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.ALIPAY_PUBLIC_KEY = alipayKeys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    process.env.ALIPAY_NOTIFY_URL = "https://integration.invalid/alipay/notify";
    process.env.AI_DIRECT_SETTLEMENT_STAFF_IDS = "integration-owner";
    pool = createPool({ uri: databaseUrl!, connectionLimit: 2 });
    app = Fastify({ logger: false });
    await app.register(jwt, { secret: "ai-direct-core-integration-secret" });
    app.decorate("mysql", pool);
    app.decorate("authenticate", async (request) => {
      await request.jwtVerify();
    });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      const statusCode =
        typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : 500;
      return reply.status(statusCode).send({
        code: (error as any)?.code,
        error: error instanceof Error ? error.message : "Internal Server Error",
      });
    });
    assetRoot = await mkdtemp(join(tmpdir(), "clawhub-appearance-mysql-"));
    const assetStore = new ManagedAssetStore(assetRoot);
    await assetStore.initialize();
    await app.register(createAiDirectCoreRoutes(assetStore), {
      prefix: "/api/v1/ai-direct-hiring",
    });
    await app.ready();

    const userId = "integration-owner";
    const developerId = "integration-developer";
    const agentId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000002";
    await pool.query(
      `INSERT INTO ai_direct_agents
       (id, ownerUserId, name, status, activeVersionId, catalogVisibility, availability, createdAt, updatedAt)
       VALUES (?, ?, 'Integration Agent', 'active', ?, 'org_authenticated', 'available', NOW(), NOW())`,
      [agentId, developerId, versionId],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_versions
       (id, agentId, version, status, promptSpec, modelPolicy, executionPolicy, createdByUserId, createdAt)
       VALUES (?, ?, 1, 'published', '{}', '{}', '{}', ?, NOW())`,
      [versionId, agentId, userId],
    );
    authorization = `Bearer ${app.jwt.sign({ id: userId, role: "user" })}`;
    developerAuthorization = `Bearer ${app.jwt.sign({ id: developerId, role: "user" })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  const request = async (
    method: string,
    path: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const response = await app.inject({
      method,
      url: `/api/v1/ai-direct-hiring${path}`,
      headers: { authorization, ...headers },
      payload: body,
    });
    return {
      status: response.statusCode,
      body: response.body ? JSON.parse(response.body) : null,
    };
  };

  it("closes organization through terminated employment with stable replay errors", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/ai-direct-hiring/organizations",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const organization = await request(
      "POST",
      "/organizations",
      { name: "Integration Organization" },
      { "idempotency-key": "integration-organization-1" },
    );
    expect(organization.status).toBe(201);

    const replay = await request(
      "POST",
      "/organizations",
      { name: "Integration Organization" },
      { "idempotency-key": "integration-organization-1" },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(organization.body.id);
    expect(replay.body.replayed).toBe(true);

    const conflict = await request(
      "POST",
      "/organizations",
      { name: "Different Organization" },
      { "idempotency-key": "integration-organization-1" },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const company = await request("POST", "/companies", {
      organizationId: organization.body.id,
      name: "Integration Company",
    });
    expect(company.status).toBe(201);

    const project = await request("POST", "/projects", {
      companyId: company.body.id,
      name: "Integration Project",
      budgetMicros: 1000000,
    });
    expect(project.status).toBe(201);

    const role = await request("POST", `/projects/${project.body.id}/roles`, {
      name: "Integration Role",
      responsibilities: { objective: "Verify recruitment closure" },
      requiredCapabilities: { tools: ["http"] },
      budgetMicros: 500000,
    });
    expect(role.status).toBe(201);

    const department = await request("POST", "/workforce/departments", {
      companyId: company.body.id,
      name: "Integration Engineering",
      sortOrder: 1,
    });
    expect(department.status).toBe(201);

    const position = await request("POST", "/workforce/positions", {
      departmentId: department.body.id,
      name: "Integration Analyst",
      headcountTarget: 1,
      requirementsSummary: { capabilities: ["http"] },
      sortOrder: 1,
    });
    expect(position.status).toBe(201);
    const openedPosition = await request("PATCH", `/workforce/positions/${position.body.id}`, {
      toStatus: "open",
    });
    expect(openedPosition.status).toBe(200);
    const roleBinding = await request("POST", `/workforce/positions/${position.body.id}/roles`, {
      roleId: role.body.id,
    });
    expect(roleBinding.status).toBe(201);

    const price = await request(
      "POST",
      "/agents/00000000-0000-4000-8000-000000000001/prices",
      {
        agentVersionId: "00000000-0000-4000-8000-000000000002",
        amountFen: "10003",
        currency: "CNY",
      },
      { authorization: developerAuthorization },
    );
    expect(price.status).toBe(201);
    expect(price.body).toMatchObject({
      currency: "CNY",
      amountFen: "10003",
      version: 1,
    });

    const order = await request(
      "POST",
      "/paid-hiring/orders",
      {
        companyId: company.body.id,
        projectId: project.body.id,
        roleId: role.body.id,
        positionId: position.body.id,
        agentId: "00000000-0000-4000-8000-000000000001",
      },
      { "idempotency-key": "integration-paid-hiring-1" },
    );
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({
      provider: "alipay",
      status: "pending",
      currency: "CNY",
      grossAmountFen: "10003",
      platformFeeFen: "2001",
      developerPayableFen: "8002",
      replayed: false,
    });
    expect(order.body.payUrl).toContain("openapi.alipay.com");

    const orderReplay = await request(
      "POST",
      "/paid-hiring/orders",
      {
        companyId: company.body.id,
        projectId: project.body.id,
        roleId: role.body.id,
        positionId: position.body.id,
        agentId: "00000000-0000-4000-8000-000000000001",
      },
      { "idempotency-key": "integration-paid-hiring-1" },
    );
    expect(orderReplay.status).toBe(200);
    expect(orderReplay.body.id).toBe(order.body.id);
    expect(orderReplay.body.replayed).toBe(true);

    const failureInjectingPool = {
      getConnection: async () => {
        const connection = await pool.getConnection();
        return {
          beginTransaction: () => connection.beginTransaction(),
          commit: () => connection.commit(),
          rollback: () => connection.rollback(),
          release: () => connection.release(),
          query: (sql: string, values?: unknown[]) => {
            if (
              sql.includes("INSERT INTO ai_direct_outbox_events") &&
              values?.[4] === "paid_hiring.fulfilled.v1"
            ) {
              throw new Error("forced fulfillment outbox failure");
            }
            return connection.query(sql, values);
          },
        };
      },
    };
    await expect(
      fulfillPaidHiring(failureInjectingPool as any, {
        outTradeNo: order.body.outTradeNo,
        tradeNo: "integration-alipay-trade-1",
        totalAmountFen: 10_003n,
        rawNotifySha256: "a".repeat(64),
      }),
    ).rejects.toThrow("forced fulfillment outbox failure");
    const [rolledBackRows] = await pool.query<any[]>(
      `SELECT po.status,
              (SELECT COUNT(*) FROM ai_direct_offers WHERE paymentOrderId = po.id) AS offerCount,
              (SELECT COUNT(*) FROM ai_direct_employments WHERE paymentOrderId = po.id) AS employmentCount,
              (SELECT COUNT(*) FROM ai_direct_revenue_ledger_entries WHERE paymentOrderId = po.id) AS ledgerCount
       FROM ai_direct_payment_orders po WHERE po.id = ?`,
      [order.body.id],
    );
    expect({
      status: rolledBackRows[0].status,
      offerCount: Number(rolledBackRows[0].offerCount),
      employmentCount: Number(rolledBackRows[0].employmentCount),
      ledgerCount: Number(rolledBackRows[0].ledgerCount),
    }).toEqual({ status: "pending", offerCount: 0, employmentCount: 0, ledgerCount: 0 });
    const notifications = await Promise.all([
      fulfillPaidHiring(pool, {
        outTradeNo: order.body.outTradeNo,
        tradeNo: "integration-alipay-trade-1",
        totalAmountFen: 10_003n,
        rawNotifySha256: "a".repeat(64),
      }),
      fulfillPaidHiring(pool, {
        outTradeNo: order.body.outTradeNo,
        tradeNo: "integration-alipay-trade-1",
        totalAmountFen: 10_003n,
        rawNotifySha256: "a".repeat(64),
      }),
    ]);
    expect(notifications.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(new Set(notifications.map(({ offerId }) => offerId)).size).toBe(1);
    expect(new Set(notifications.map(({ employmentId }) => employmentId)).size).toBe(1);
    const fulfillment = notifications.find(({ replayed }) => !replayed)!;
    expect(fulfillment.employmentStatus).toBe("onboarding");
    const fulfillmentReplay = notifications.find(({ replayed }) => replayed)!;
    expect(fulfillmentReplay).toMatchObject({
      offerId: fulfillment.offerId,
      employmentId: fulfillment.employmentId,
      replayed: true,
    });

    const issuedOffer = await request("GET", `/offers/${fulfillment.offerId}`);
    expect(issuedOffer.status).toBe(200);
    expect(issuedOffer.body).toMatchObject({
      id: fulfillment.offerId,
      status: "issued",
      paymentOrderId: order.body.id,
      employmentId: fulfillment.employmentId,
      grossAmountFen: "10003",
    });
    const retiredAcceptance = await request("POST", `/offers/${fulfillment.offerId}/accept`);
    expect(retiredAcceptance.status).toBe(409);
    expect(retiredAcceptance.body.code).toBe("INVALID_TRANSITION");

    const [ledgerRows] = await pool.query<any[]>(
      `SELECT accountType, accountOwnerUserId, amountFen
       FROM ai_direct_revenue_ledger_entries
       WHERE paymentOrderId = ? ORDER BY accountType`,
      [order.body.id],
    );
    expect(
      ledgerRows.map((row) => ({
        accountType: row.accountType,
        accountOwnerUserId: row.accountOwnerUserId,
        amountFen: String(row.amountFen),
      })),
    ).toEqual([
      {
        accountType: "developer_payable",
        accountOwnerUserId: "integration-developer",
        amountFen: "8002",
      },
      { accountType: "platform_revenue", accountOwnerUserId: null, amountFen: "2001" },
    ]);

    const employment = { body: { id: fulfillment.employmentId } };

    const secondCompanyId = "00000000-0000-4000-8000-000000000010";
    const secondRoleId = "00000000-0000-4000-8000-000000000011";
    const secondEmploymentId = "00000000-0000-4000-8000-000000000012";
    await pool.query(
      `INSERT INTO ai_direct_companies
         (id, organizationId, name, slug, status, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, 'Second Integration Company', 'second-integration-company', 'active',
               'integration-owner', NOW(3), NOW(3))`,
      [secondCompanyId, organization.body.id],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_roles
         (id, companyId, projectId, name, responsibilities, requiredCapabilities,
          budgetMicros, status, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, NULL, 'Second Integration Role', '{}', '{}', 0, 'open',
               'integration-owner', NOW(3), NOW(3))`,
      [secondRoleId, secondCompanyId],
    );
    await pool.query(
      `INSERT INTO ai_direct_employments
         (id, companyId, agentId, agentVersionId, roleId, projectId, offerId,
          requestedByUserId, status, createdAt, updatedAt)
       VALUES (?, ?, '00000000-0000-4000-8000-000000000001',
               '00000000-0000-4000-8000-000000000002', ?, NULL,
               '00000000-0000-4000-8000-000000000013', 'integration-owner',
               'offered', NOW(3), NOW(3))`,
      [secondEmploymentId, secondCompanyId, secondRoleId],
    );
    await pool.query(
      `INSERT INTO ai_direct_employment_events
         (id, employmentId, sequence, fromStatus, toStatus, actorUserId, reason, occurredAt)
       VALUES ('00000000-0000-4000-8000-000000000014', ?, 1, NULL, 'offered',
               'integration-owner', 'integration conflict fixture', NOW(3))`,
      [secondEmploymentId],
    );

    const competingAttempt = await request(
      "POST",
      `/employments/${secondEmploymentId}/transition`,
      { toStatus: "accepted", reason: "integration:competing-accept" },
    );
    expect(competingAttempt.status).toBe(409);
    expect(competingAttempt.body.code).toBe("APPEARANCE_CONTROL_CONFLICT");

    let appearanceControlVerified = false;
    for (const toStatus of ["active", "paused", "active", "offboarding", "terminated"]) {
      const transition = await request("POST", `/employments/${employment.body.id}/transition`, {
        toStatus,
        reason: `integration:${toStatus}`,
      });
      if (transition.status !== 200) {
        throw new Error(
          `Employment transition to ${toStatus} failed (${transition.status}): ${JSON.stringify(transition.body)}`,
        );
      }
      expect(transition.body.status).toBe(toStatus);

      if (toStatus === "active" && !appearanceControlVerified) {
        appearanceControlVerified = true;
        const developerView = await request(
          "GET",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          undefined,
          { authorization: developerAuthorization },
        );
        expect(developerView.status).toBe(200);
        expect(developerView.body.control).toMatchObject({
          controllerEmploymentId: employment.body.id,
          controllerCompanyId: company.body.id,
          canWrite: false,
          readOnlyReason: "controlled_by_employer",
        });
        const developerWrite = await request(
          "PATCH",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          { defaultMode: "model_3d" },
          {
            authorization: developerAuthorization,
            "if-match": `"appearance-${developerView.body.revision}"`,
          },
        );
        expect(developerWrite.status).toBe(403);
        expect(developerWrite.body.code).toBe("FORBIDDEN_SCOPE");

        const companyView = await request(
          "GET",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
        );
        expect(companyView.body.control.canWrite).toBe(true);
        expect(companyView.body.control.authority).toBe("company");
        const companyWrite = await request(
          "PATCH",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          { defaultMode: "model_3d" },
          { "if-match": `"appearance-${companyView.body.revision}"` },
        );
        expect(companyWrite.status).toBe(200);
      }

      if (toStatus === "terminated") {
        const developerView = await request(
          "GET",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          undefined,
          { authorization: developerAuthorization },
        );
        expect(developerView.body.control).toMatchObject({
          controllerEmploymentId: null,
          controllerCompanyId: null,
          canWrite: true,
          authority: "developer",
        });
        const formerCompanyWrite = await request(
          "PATCH",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          { defaultMode: "image_2d" },
          { "if-match": `"appearance-${developerView.body.revision}"` },
        );
        expect(formerCompanyWrite.status).toBe(403);
        const developerWrite = await request(
          "PATCH",
          "/agents/00000000-0000-4000-8000-000000000001/appearance",
          { defaultMode: "image_2d" },
          {
            authorization: developerAuthorization,
            "if-match": `"appearance-${developerView.body.revision}"`,
          },
        );
        expect(developerWrite.status).toBe(200);
      }
    }

    const invalidTransition = await request(
      "POST",
      `/employments/${employment.body.id}/transition`,
      { toStatus: "active" },
    );
    expect(invalidTransition.status).toBe(409);
    expect(invalidTransition.body.code).toBe("INVALID_TRANSITION");

    const events = await request("GET", `/employments/${employment.body.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(6);
    expect(events.body.items.at(-1).toStatus).toBe("terminated");

    const [appearanceAuditRows] = await pool.query<any[]>(
      `SELECT action FROM ai_direct_audit_events
       WHERE targetType = 'agent_appearance'
         AND targetId = '00000000-0000-4000-8000-000000000001'
       ORDER BY createdAt, id`,
    );
    const appearanceAuditActions = appearanceAuditRows.map((row) => row.action);
    for (const expectedAction of [
      "agent_appearance.default_mode.updated.v1",
      "agent_appearance.control.released.v1",
    ]) {
      expect(appearanceAuditActions).toContain(expectedAction);
    }
  }, 30000);

  it("keeps pricing and settlement operations serializable with atomic audit outbox evidence", async () => {
    const pricingAgentId = "00000000-0000-4000-8000-000000000021";
    const pricingVersionId = "00000000-0000-4000-8000-000000000022";
    await pool.query(
      `INSERT INTO ai_direct_agents
       (id, ownerUserId, name, status, activeVersionId, catalogVisibility, availability, createdAt, updatedAt)
       VALUES (?, 'integration-developer', 'Settlement Agent', 'active', ?, 'org_authenticated', 'available', NOW(3), NOW(3))`,
      [pricingAgentId, pricingVersionId],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_versions
       (id, agentId, version, status, promptSpec, modelPolicy, executionPolicy, createdByUserId, createdAt)
       VALUES (?, ?, 1, 'published', '{}', '{}', '{}', 'integration-developer', NOW(3))`,
      [pricingVersionId, pricingAgentId],
    );
    const prices = await Promise.all([
      setAgentPrice(pool, {
        agentId: pricingAgentId,
        agentVersionId: pricingVersionId,
        developerUserId: "integration-developer",
        amountFen: 100n,
        requestId: "price-a",
      }),
      setAgentPrice(pool, {
        agentId: pricingAgentId,
        agentVersionId: pricingVersionId,
        developerUserId: "integration-developer",
        amountFen: 101n,
        requestId: "price-b",
      }),
    ]);
    expect(prices).toHaveLength(2);
    const [activePrices] = await pool.query<any[]>(
      `SELECT COUNT(*) AS count FROM ai_direct_agent_prices WHERE agentId = ? AND status = 'active'`,
      [pricingAgentId],
    );
    expect(Number(activePrices[0].count)).toBe(1);

    const paymentOrderId = "00000000-0000-4000-8000-000000000023";
    const ledgerEntryIds = [
      "00000000-0000-4000-8000-000000000024",
      "00000000-0000-4000-8000-000000000025",
    ];
    for (const [index, ledgerEntryId] of ledgerEntryIds.entries()) {
      await pool.query(
        `INSERT INTO ai_direct_revenue_ledger_entries
         (id, entryKey, paymentOrderId, accountType, accountOwnerUserId, direction, currency, amountFen, status, createdAt)
         VALUES (?, ?, ?, 'developer_payable', 'integration-developer', 'credit', 'CNY', ?, 'posted', NOW(3))`,
        [ledgerEntryId, `integration-settlement-${index}`, paymentOrderId, 1_000 + index],
      );
    }

    const competingSettlements = await Promise.allSettled([
      createDeveloperSettlement(pool, {
        developerUserId: "integration-developer",
        ledgerEntryIds,
        createdByUserId: "integration-owner",
      }),
      createDeveloperSettlement(pool, {
        developerUserId: "integration-developer",
        ledgerEntryIds,
        createdByUserId: "integration-owner",
      }),
    ]);
    const created = competingSettlements.find(
      (result): result is PromiseFulfilledResult<{ id: string }> => result.status === "fulfilled",
    );
    expect(created).toBeDefined();
    expect(competingSettlements.filter((result) => result.status === "rejected")).toHaveLength(1);
    const settlementId = created!.value.id;
    const [settlementItems] = await pool.query<any[]>(
      "SELECT COUNT(*) AS count FROM ai_direct_developer_settlement_items WHERE settlementId = ?",
      [settlementId],
    );
    expect(Number(settlementItems[0].count)).toBe(2);

    const rollbackPool = {
      getConnection: async () => {
        const connection = await pool.getConnection();
        return {
          beginTransaction: () => connection.beginTransaction(),
          commit: () => connection.commit(),
          rollback: () => connection.rollback(),
          release: () => connection.release(),
          query: (sql: string, values?: unknown[]) => {
            if (sql.includes("INSERT INTO ai_direct_outbox_events"))
              throw new Error("forced settlement outbox failure");
            return connection.query(sql, values);
          },
        };
      },
    };
    await expect(
      transitionDeveloperSettlement(rollbackPool as any, {
        settlementId,
        actorUserId: "integration-owner",
        action: "processing",
      }),
    ).rejects.toThrow("forced settlement outbox failure");
    const [afterFailedProcessing] = await pool.query<any[]>(
      `SELECT s.status, (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetId = s.id AND action = 'paid_hiring.settlement.processing') AS auditCount
       FROM ai_direct_developer_settlements s WHERE s.id = ?`,
      [settlementId],
    );
    expect({
      status: afterFailedProcessing[0].status,
      auditCount: Number(afterFailedProcessing[0].auditCount),
    }).toEqual({ status: "pending", auditCount: 0 });

    await transitionDeveloperSettlement(pool, {
      settlementId,
      actorUserId: "integration-owner",
      action: "processing",
    });
    await transitionDeveloperSettlement(pool, {
      settlementId,
      actorUserId: "integration-owner",
      action: "failed",
      failureReason: "bank review rejected",
    });
    await transitionDeveloperSettlement(pool, {
      settlementId,
      actorUserId: "integration-owner",
      action: "retry",
    });
    await transitionDeveloperSettlement(pool, {
      settlementId,
      actorUserId: "integration-owner",
      action: "completed",
      externalReference: "payout-ref-1",
    });
    const [completed] = await pool.query<any[]>(
      `SELECT s.status, s.externalReference, s.failureReason,
              (SELECT COUNT(*) FROM ai_direct_revenue_ledger_entries WHERE id IN (?, ?) AND status = 'settled') AS settledCount,
              (SELECT COUNT(*) FROM ai_direct_audit_events WHERE targetId = s.id) AS auditCount,
              (SELECT COUNT(*) FROM ai_direct_outbox_events WHERE aggregateId = s.id) AS outboxCount
       FROM ai_direct_developer_settlements s WHERE s.id = ?`,
      [...ledgerEntryIds, settlementId],
    );
    expect({
      status: completed[0].status,
      externalReference: completed[0].externalReference,
      failureReason: completed[0].failureReason,
      settledCount: Number(completed[0].settledCount),
      auditCount: Number(completed[0].auditCount),
      outboxCount: Number(completed[0].outboxCount),
    }).toEqual({
      status: "completed",
      externalReference: "payout-ref-1",
      failureReason: null,
      settledCount: 2,
      auditCount: 5,
      outboxCount: 5,
    });

    const anomalyOrderId = "00000000-0000-4000-8000-000000000026";
    await pool.query(
      `INSERT INTO ai_direct_payment_orders
       (id, outTradeNo, hiringIntentId, provider, currency, grossAmountFen, platformFeeFen, developerPayableFen,
        developerUserId, priceId, priceVersion, status, createdAt, updatedAt)
       VALUES (?, 'integration-anomaly-order', '00000000-0000-4000-8000-000000000027', 'alipay', 'CNY', 100, 20, 80,
               'integration-developer', '00000000-0000-4000-8000-000000000028', 1, 'pending', NOW(3), NOW(3))`,
      [anomalyOrderId],
    );
    await reconcileDuePaymentOrders(pool, {} as any, "integration-worker", 1, async () => ({
      outTradeNo: "integration-anomaly-order",
      tradeNo: null,
      totalAmountFen: null,
      tradeStatus: "TRADE_CLOSED",
    }));
    const [anomalyRows] = await pool.query<any[]>(
      `SELECT po.status, po.offerId, po.employmentId,
              (SELECT COUNT(*) FROM ai_direct_paid_hiring_operational_alerts WHERE paymentOrderId = po.id AND code = 'provider_trade_closed') AS alertCount
       FROM ai_direct_payment_orders po WHERE po.id = ?`,
      [anomalyOrderId],
    );
    expect({
      status: anomalyRows[0].status,
      offerId: anomalyRows[0].offerId,
      employmentId: anomalyRows[0].employmentId,
      alertCount: Number(anomalyRows[0].alertCount),
    }).toEqual({ status: "closed", offerId: null, employmentId: null, alertCount: 1 });

    const balances = await request("GET", "/paid-hiring/settlements/balances");
    expect(balances.status).toBe(200);
    expect(balances.body.items).toContainEqual({
      developerUserId: "integration-developer",
      currency: "CNY",
      payableFen: "8002",
    });
    const settleableEntries = await request(
      "GET",
      "/paid-hiring/settlements/entries?developerUserId=integration-developer",
    );
    expect(settleableEntries.status).toBe(200);
    expect(settleableEntries.body.items).toHaveLength(1);
    expect(settleableEntries.body.items[0]).toMatchObject({ amountFen: "8002" });
    const settlementDetail = await request("GET", `/paid-hiring/settlements/${settlementId}`);
    expect(settlementDetail.status).toBe(200);
    expect(settlementDetail.body).toMatchObject({
      id: settlementId,
      amountFen: "2001",
      status: "completed",
      externalReference: "payout-ref-1",
    });
    expect(
      await request("GET", "/paid-hiring/settlements/balances", undefined, {
        authorization: developerAuthorization,
      }),
    ).toMatchObject({ status: 403 });
    expect(
      await request("GET", "/paid-hiring/operations/alerts", undefined, {
        authorization: developerAuthorization,
      }),
    ).toMatchObject({ status: 403 });
  }, 30000);
});
