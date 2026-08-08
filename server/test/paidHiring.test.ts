import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import type { AlipayConfig } from "../src/services/alipayProvider.js";
import { queryAlipayTrade, verifyAlipayNotification } from "../src/services/alipayProvider.js";
import {
  cnyAmountToFen,
  fenToCnyAmount,
  parseCnyFen,
  splitPaidHiringAmount,
} from "../src/services/paidHiringMoney.js";

const canonicalizeNotify = (params: Record<string, string>): string =>
  Object.entries(params)
    .filter(([key, value]) => value !== "" && key !== "sign" && key !== "sign_type")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: AlipayConfig = {
  appId: "app-1",
  sellerId: "seller-1",
  privateKey: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  alipayPublicKey: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  notifyUrl: "https://merchant.example/alipay/notify",
  gateway: "https://openapi.alipay.example/gateway.do",
};

const signedNotification = (overrides: Record<string, string> = {}): Record<string, string> => {
  const params = {
    app_id: config.appId,
    seller_id: config.sellerId,
    out_trade_no: "AIH-ORDER-1",
    trade_no: "ALIPAY-TRADE-1",
    trade_status: "TRADE_SUCCESS",
    total_amount: "100.01",
    sign_type: "RSA2",
    ...overrides,
  };
  return {
    ...params,
    sign: sign("RSA-SHA256", Buffer.from(canonicalizeNotify(params)), keyPair.privateKey).toString(
      "base64",
    ),
  };
};

describe("paid hiring money", () => {
  it("splits exact 20/80 amounts in integer fen", () => {
    expect(splitPaidHiringAmount(10_000n)).toEqual({
      grossAmountFen: 10_000n,
      platformFeeFen: 2_000n,
      developerPayableFen: 8_000n,
    });
  });

  it("rounds the platform 20% half up and assigns the remainder to the developer", () => {
    expect(splitPaidHiringAmount(10_001n)).toEqual({
      grossAmountFen: 10_001n,
      platformFeeFen: 2_000n,
      developerPayableFen: 8_001n,
    });
    expect(splitPaidHiringAmount(10_003n)).toEqual({
      grossAmountFen: 10_003n,
      platformFeeFen: 2_001n,
      developerPayableFen: 8_002n,
    });
  });

  it("parses integer fen and Alipay decimal amounts without floating point", () => {
    expect(parseCnyFen("10001")).toBe(10_001n);
    expect(cnyAmountToFen("100.01")).toBe(10_001n);
    expect(fenToCnyAmount(10_001n)).toBe("100.01");
    expect(() => cnyAmountToFen("100.001")).toThrow();
  });
});

describe("Alipay paid hiring notification", () => {
  it("verifies RSA2, merchant identity, successful status and amount", () => {
    const body = signedNotification();
    expect(verifyAlipayNotification(config, body, "raw-notify")).toMatchObject({
      outTradeNo: "AIH-ORDER-1",
      tradeNo: "ALIPAY-TRADE-1",
      totalAmountFen: 10_001n,
    });
  });

  it("rejects a notification with an invalid signature", () => {
    const body = signedNotification();
    body.total_amount = "1.00";
    expect(() => verifyAlipayNotification(config, body)).toThrow("支付宝回调签名无效");
  });

  it("rejects mismatched app and seller identities", () => {
    expect(() =>
      verifyAlipayNotification(config, signedNotification({ app_id: "other-app" })),
    ).toThrow("支付宝回调 app_id 不匹配");
    expect(() =>
      verifyAlipayNotification(config, signedNotification({ seller_id: "other-seller" })),
    ).toThrow("支付宝回调 seller_id 不匹配");
  });

  it("rejects non-successful trade status", () => {
    expect(() =>
      verifyAlipayNotification(config, signedNotification({ trade_status: "WAIT_BUYER_PAY" })),
    ).toThrow("支付宝交易尚未成功");
  });
});

describe("Alipay paid hiring query", () => {
  const signedQueryResponse = (overrides: Record<string, string> = {}): Response => {
    const result = JSON.stringify({
      code: "10000",
      msg: "Success",
      out_trade_no: "AIH-ORDER-1",
      trade_no: "ALIPAY-TRADE-1",
      total_amount: "100.01",
      trade_status: "TRADE_SUCCESS",
      app_id: config.appId,
      seller_id: config.sellerId,
      ...overrides,
    });
    const signature = sign("RSA-SHA256", Buffer.from(result), keyPair.privateKey).toString(
      "base64",
    );
    return new Response(
      `{"alipay_trade_query_response":${result},"sign":"${signature}","sign_type":"RSA2"}`,
    );
  };

  it("verifies the signed raw query response before reading payment fields", async () => {
    await expect(
      queryAlipayTrade(config, "AIH-ORDER-1", async () => signedQueryResponse()),
    ).resolves.toMatchObject({
      outTradeNo: "AIH-ORDER-1",
      tradeNo: "ALIPAY-TRADE-1",
      totalAmountFen: 10_001n,
      tradeStatus: "TRADE_SUCCESS",
    });
  });

  it("rejects a query response whose signed business node was modified", async () => {
    const response = signedQueryResponse({ total_amount: "1.00" });
    const body = await response.text();
    const tampered = body.replace('"total_amount":"1.00"', '"total_amount":"2.00"');
    await expect(
      queryAlipayTrade(config, "AIH-ORDER-1", async () => new Response(tampered)),
    ).rejects.toThrow("支付宝查询响应签名无效");
  });
});
