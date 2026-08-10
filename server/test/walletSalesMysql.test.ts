import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { setAgentPrice } from "../src/services/agentPricing.js";
import { listDeveloperAgentSales } from "../src/services/agentSales.js";
import { createFreeHiringSale } from "../src/services/freeHiring.js";
import { fulfillPaidHiring } from "../src/services/paidHiring.js";
import {
  createDeveloperSettlement,
  listSettleableLedgerEntries,
  transitionDeveloperSettlement,
} from "../src/services/paidHiringOperations.js";
import { createPaidHiringOrder } from "../src/services/paidHiringOrder.js";
import { applyWalletLedgerChange } from "../src/services/walletLedger.js";
import { createRechargeOrder, fulfillRecharge } from "../src/services/walletRecharge.js";
import { createWalletRefund, reviewWalletRefund } from "../src/services/walletRefund.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const id = () => randomUUID();

integration("wallet and unified Agent sales state machines", () => {
  let pool: Pool;
  const buyerUserId = "wallet-sales-buyer";
  const developerUserId = "wallet-sales-developer";
  const companyId = id();
  const organizationId = id();

  const createHiringFixture = async (name: string, amountFen: bigint) => {
    const agentId = id();
    const versionId = id();
    const departmentId = id();
    const positionId = id();
    const roleId = id();
    await pool.query(
      `INSERT INTO ai_direct_agents
       (id, ownerUserId, name, status, activeVersionId, catalogVisibility, availability, priceStatus,
        createdAt, updatedAt)
       VALUES (?, ?, ?, 'active', ?, 'org_authenticated', 'available', 'active', NOW(3), NOW(3))`,
      [agentId, developerUserId, name, versionId],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_versions
       (id, agentId, version, status, reviewStatus, securityStatus, promptSpec, modelPolicy,
        executionPolicy, createdByUserId, createdAt)
       VALUES (?, ?, 1, 'published', 'approved', 'passed', '{}', '{}', '{}', ?, NOW(3))`,
      [versionId, agentId, developerUserId],
    );
    await pool.query(
      `INSERT INTO ai_direct_departments
       (id, companyId, name, status, createdByUserId)
       VALUES (?, ?, ?, 'active', ?)`,
      [departmentId, companyId, `${name} Department`, buyerUserId],
    );
    await pool.query(
      `INSERT INTO ai_direct_positions
       (id, departmentId, name, status, headcountTarget, headcountFilled, createdByUserId)
       VALUES (?, ?, ?, 'open', 1, 0, ?)`,
      [positionId, departmentId, `${name} Position`, buyerUserId],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_roles
       (id, companyId, projectId, name, responsibilities, requiredCapabilities, status, createdByUserId)
       VALUES (?, ?, NULL, ?, '{}', '{}', 'open', ?)`,
      [roleId, companyId, `${name} Role`, buyerUserId],
    );
    await pool.query(
      "INSERT INTO ai_direct_position_agent_roles (positionId, roleId) VALUES (?, ?)",
      [positionId, roleId],
    );
    const price = await setAgentPrice(pool, {
      agentId,
      agentVersionId: versionId,
      developerUserId,
      amountFen,
      requestId: `price-${name}`,
    });
    return { agentId, versionId, positionId, roleId, priceId: price.id };
  };

  const hiringInput = (fixture: Awaited<ReturnType<typeof createHiringFixture>>, key: string) => ({
    companyId,
    projectId: null,
    roleId: fixture.roleId,
    positionId: fixture.positionId,
    agentId: fixture.agentId,
    requestedByUserId: buyerUserId,
    idempotencyKey: key,
    idempotencyFingerprint: key.padEnd(64, "0").slice(0, 64),
    requestId: `request-${key}`,
  });

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 3 });
    await pool.query(
      `INSERT INTO ai_direct_companies
       (id, organizationId, name, slug, status, createdByUserId)
       VALUES (?, ?, 'Wallet Sales Company', ?, 'active', ?)`,
      [companyId, organizationId, `wallet-sales-${companyId}`, buyerUserId],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("records a free hiring exactly once with two zero revenue entries and no wallet mutation", async () => {
    const fixture = await createHiringFixture("Free Agent", 0n);
    const input = hiringInput(fixture, "free-hiring");
    const first = await createFreeHiringSale(pool, input);
    const replay = await createFreeHiringSale(pool, input);

    expect(first).toMatchObject({ provider: "free", status: "fulfilled", replayed: false });
    expect(replay).toMatchObject({ saleId: first.saleId, replayed: true });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT sale.pricingMode, sale.grossAmountFen, sale.paymentOrderId,
              COUNT(DISTINCT revenue.id) AS revenueCount,
              SUM(revenue.amountFen) AS revenueTotal,
              COUNT(DISTINCT wallet.id) AS walletEntryCount
       FROM ai_direct_agent_sales sale
       JOIN ai_direct_revenue_ledger_entries revenue ON revenue.saleId = sale.id
       LEFT JOIN wallet_ledger_entries wallet
         ON wallet.businessType = 'agent_sale' AND wallet.businessId = sale.id
       WHERE sale.id = ? GROUP BY sale.id`,
      [first.saleId],
    );
    expect({
      pricingMode: rows[0].pricingMode,
      grossAmountFen: String(rows[0].grossAmountFen),
      paymentOrderId: rows[0].paymentOrderId,
      revenueCount: Number(rows[0].revenueCount),
      revenueTotal: String(rows[0].revenueTotal),
      walletEntryCount: Number(rows[0].walletEntryCount),
    }).toEqual({
      pricingMode: "free",
      grossAmountFen: "0",
      paymentOrderId: null,
      revenueCount: 2,
      revenueTotal: "0",
      walletEntryCount: 0,
    });

    const [zeroEntries] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM ai_direct_revenue_ledger_entries
       WHERE saleId = ? AND accountType = 'developer_payable'`,
      [first.saleId],
    );
    await expect(
      createDeveloperSettlement(pool, {
        developerUserId,
        ledgerEntryIds: [zeroEntries[0].id],
        createdByUserId: developerUserId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("keeps paid wallet debit, sale, Offer, Employment and 20/80 revenue atomic", async () => {
    const fixture = await createHiringFixture("Paid Agent", 10_003n);
    const order = await createPaidHiringOrder(pool, hiringInput(fixture, "paid-hiring"));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await applyWalletLedgerChange(connection, {
        entryKey: "test:paid-wallet-credit",
        userId: buyerUserId,
        entryType: "recharge",
        businessType: "test_credit",
        businessId: "paid-hiring-credit",
        availableDeltaFen: 10_003n,
      });
      await connection.commit();
    } finally {
      connection.release();
    }

    const result = await fulfillPaidHiring(
      pool,
      {
        outTradeNo: order.outTradeNo,
        tradeNo: `wallet:${order.outTradeNo}`,
        totalAmountFen: order.grossAmountFen,
        rawNotifySha256: `wallet:${order.id}`,
      },
      buyerUserId,
    );
    const replay = await fulfillPaidHiring(
      pool,
      {
        outTradeNo: order.outTradeNo,
        tradeNo: `wallet:${order.outTradeNo}`,
        totalAmountFen: order.grossAmountFen,
        rawNotifySha256: `wallet:${order.id}`,
      },
      buyerUserId,
    );
    expect(replay).toMatchObject({ employmentId: result.employmentId, replayed: true });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT sale.id AS saleId, sale.grossAmountFen, sale.platformRevenueFen,
              sale.developerRevenueFen, account.availableFen,
              COUNT(DISTINCT revenue.id) AS revenueCount
       FROM ai_direct_agent_sales sale
       JOIN ai_direct_revenue_ledger_entries revenue ON revenue.saleId = sale.id
       JOIN wallet_accounts account ON account.userId = ?
       WHERE sale.paymentOrderId = ?
       GROUP BY sale.id, account.id`,
      [buyerUserId, order.id],
    );
    expect({
      gross: String(rows[0].grossAmountFen),
      platform: String(rows[0].platformRevenueFen),
      developer: String(rows[0].developerRevenueFen),
      wallet: String(rows[0].availableFen),
      revenueCount: Number(rows[0].revenueCount),
    }).toEqual({
      gross: "10003",
      platform: "2001",
      developer: "8002",
      wallet: "0",
      revenueCount: 2,
    });
  });

  it("rolls back every paid hiring fact when the wallet debit fails", async () => {
    const fixture = await createHiringFixture("Insufficient Balance Agent", 500n);
    const order = await createPaidHiringOrder(pool, hiringInput(fixture, "insufficient-balance"));

    await expect(
      fulfillPaidHiring(
        pool,
        {
          outTradeNo: order.outTradeNo,
          tradeNo: `wallet:${order.outTradeNo}`,
          totalAmountFen: order.grossAmountFen,
          rawNotifySha256: `wallet:${order.id}`,
        },
        buyerUserId,
      ),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT po.status AS orderStatus, hi.status AS intentStatus, positionRow.headcountFilled,
              (SELECT COUNT(*) FROM ai_direct_agent_sales sale
               WHERE sale.paymentOrderId = po.id) AS saleCount,
              (SELECT COUNT(*) FROM ai_direct_offers offerRow
               WHERE offerRow.paymentOrderId = po.id) AS offerCount,
              (SELECT COUNT(*) FROM ai_direct_employments employmentRow
               WHERE employmentRow.paymentOrderId = po.id) AS employmentCount,
              (SELECT COUNT(*) FROM ai_direct_revenue_ledger_entries revenue
               WHERE revenue.paymentOrderId = po.id) AS revenueCount,
              (SELECT COUNT(*) FROM wallet_ledger_entries wallet
               WHERE wallet.businessType = 'paid_hiring_order' AND wallet.businessId = po.id) AS walletEntryCount
       FROM ai_direct_payment_orders po
       JOIN ai_direct_hiring_intents hi ON hi.id = po.hiringIntentId
       JOIN ai_direct_positions positionRow ON positionRow.id = hi.positionId
       WHERE po.id = ?`,
      [order.id],
    );
    expect({
      orderStatus: rows[0].orderStatus,
      intentStatus: rows[0].intentStatus,
      headcountFilled: Number(rows[0].headcountFilled),
      saleCount: Number(rows[0].saleCount),
      offerCount: Number(rows[0].offerCount),
      employmentCount: Number(rows[0].employmentCount),
      revenueCount: Number(rows[0].revenueCount),
      walletEntryCount: Number(rows[0].walletEntryCount),
    }).toEqual({
      orderStatus: "pending",
      intentStatus: "awaiting_payment",
      headcountFilled: 0,
      saleCount: 0,
      offerCount: 0,
      employmentCount: 0,
      revenueCount: 0,
      walletEntryCount: 0,
    });
  });

  it("makes recharge fulfillment idempotent and settles only positive net developer earnings", async () => {
    const recharge = await createRechargeOrder(pool, {
      userId: "wallet-recharge-user",
      amountFen: 100n,
      idempotencyKey: "recharge-state-machine",
    });
    const notification = {
      outTradeNo: recharge.outTradeNo,
      tradeNo: "wallet-sales-recharge-trade",
      totalAmountFen: 100n,
      rawNotifySha256: "wallet-sales-recharge-notify",
    };
    await fulfillRecharge(pool, notification);
    const replay = await fulfillRecharge(pool, notification);
    expect(replay.replayed).toBe(true);
    const [rechargeState] = await pool.query<RowDataPacket[]>(
      `SELECT account.availableFen, account.version, COUNT(ledger.id) AS ledgerCount
       FROM wallet_accounts account
       JOIN wallet_ledger_entries ledger ON ledger.walletAccountId = account.id
       WHERE account.userId = 'wallet-recharge-user' GROUP BY account.id`,
    );
    expect({
      available: String(rechargeState[0].availableFen),
      version: String(rechargeState[0].version),
      ledgerCount: Number(rechargeState[0].ledgerCount),
    }).toEqual({ available: "100", version: "1", ledgerCount: 1 });

    const paidSales = await listDeveloperAgentSales(pool, { developerUserId });
    const partiallyRefundedSale = paidSales.find((sale) => sale.grossAmountFen === 10_003n)!;
    const partialRefund = await createWalletRefund(pool, {
      paymentOrderId: partiallyRefundedSale.paymentOrderId!,
      amountFen: 5_003n,
      reason: "state machine partial refund",
      requestedByUserId: buyerUserId,
    });
    await reviewWalletRefund(pool, {
      refundId: partialRefund.id,
      approved: true,
      reviewerUserId: "wallet-sales-reviewer",
    });

    const fullRefundFixture = await createHiringFixture("Fully Refunded Agent", 2_500n);
    const fullRefundOrder = await createPaidHiringOrder(
      pool,
      hiringInput(fullRefundFixture, "full-refund"),
    );
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await applyWalletLedgerChange(connection, {
        entryKey: "test:full-refund-wallet-credit",
        userId: buyerUserId,
        entryType: "recharge",
        businessType: "test_credit",
        businessId: "full-refund-credit",
        availableDeltaFen: fullRefundOrder.grossAmountFen,
      });
      await connection.commit();
    } finally {
      connection.release();
    }
    await fulfillPaidHiring(
      pool,
      {
        outTradeNo: fullRefundOrder.outTradeNo,
        tradeNo: `wallet:${fullRefundOrder.outTradeNo}`,
        totalAmountFen: fullRefundOrder.grossAmountFen,
        rawNotifySha256: `wallet:${fullRefundOrder.id}`,
      },
      buyerUserId,
    );
    const fullRefund = await createWalletRefund(pool, {
      paymentOrderId: fullRefundOrder.id,
      amountFen: fullRefundOrder.grossAmountFen,
      reason: "state machine full refund",
      requestedByUserId: buyerUserId,
    });
    await reviewWalletRefund(pool, {
      refundId: fullRefund.id,
      approved: true,
      reviewerUserId: "wallet-sales-reviewer",
    });

    const settleable = await listSettleableLedgerEntries(pool, { developerUserId });
    expect(settleable.items).toHaveLength(1);
    expect(settleable.items[0]!.amountFen).toBe(4_000n);
    const settlement = await createDeveloperSettlement(pool, {
      developerUserId,
      ledgerEntryIds: [settleable.items[0]!.id],
      createdByUserId: developerUserId,
      requestedByUserId: developerUserId,
    });
    expect(settlement.amountFen).toBe(4_000n);
    await transitionDeveloperSettlement(pool, {
      settlementId: settlement.id,
      actorUserId: "wallet-sales-reviewer",
      action: "processing",
    });
    await transitionDeveloperSettlement(pool, {
      settlementId: settlement.id,
      actorUserId: "wallet-sales-reviewer",
      action: "completed",
      externalReference: "offline-transfer-reference",
    });
    await expect(
      transitionDeveloperSettlement(pool, {
        settlementId: settlement.id,
        actorUserId: "wallet-sales-reviewer",
        action: "completed",
        externalReference: "duplicate-reference",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
