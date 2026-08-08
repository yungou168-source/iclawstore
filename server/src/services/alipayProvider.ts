import { createHash, createSign, createVerify } from "node:crypto";
import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";
import { cnyAmountToFen, fenToCnyAmount } from "./paidHiringMoney.js";

export type AlipayConfig = {
  appId: string;
  sellerId: string;
  privateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  returnUrl?: string;
  gateway: string;
};

export type AlipayNotify = {
  outTradeNo: string;
  tradeNo: string;
  totalAmountFen: bigint;
  rawNotifySha256: string;
};

export type AlipayQueryResult = {
  outTradeNo: string;
  tradeNo: string | null;
  totalAmountFen: bigint | null;
  tradeStatus: string;
};

const canonicalize = (params: Record<string, string>, excludeSign: boolean): string =>
  Object.entries(params)
    .filter(
      ([key, value]) => value !== "" && (!excludeSign || (key !== "sign" && key !== "sign_type")),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

const normalizePem = (value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string =>
  value.includes("BEGIN")
    ? value.replaceAll("\\n", "\n")
    : `-----BEGIN ${label}-----\n${value.match(/.{1,64}/g)?.join("\n") ?? value}\n-----END ${label}-----`;

const extractSignedResponseNode = (body: string, responseKey: string): string => {
  const keyOffset = body.indexOf(`"${responseKey}"`);
  const valueOffset = keyOffset < 0 ? -1 : body.indexOf("{", keyOffset + responseKey.length + 2);
  if (valueOffset < 0)
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝查询响应缺少业务节点", 502);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = valueOffset; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (!escaped && character === '"') quoted = false;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(valueOffset, index + 1);
    }
  }
  throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝查询响应 JSON 不完整", 502);
};

const verifyAlipayQueryResponseSignature = (
  config: AlipayConfig,
  body: string,
  payload: Record<string, unknown>,
): void => {
  const signature = typeof payload.sign === "string" ? payload.sign : "";
  if (!signature)
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "支付宝查询响应缺少签名", 502);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(extractSignedResponseNode(body, "alipay_trade_query_response"), "utf8");
  if (!verifier.verify(config.alipayPublicKey, signature, "base64")) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "支付宝查询响应签名无效", 502);
  }
};

export function loadAlipayConfig(env: NodeJS.ProcessEnv = process.env): AlipayConfig | null {
  if (env.ALIPAY_PAID_HIRING_ENABLED !== "true") return null;
  const appId = env.ALIPAY_APP_ID?.trim();
  const sellerId = env.ALIPAY_SELLER_ID?.trim();
  const privateKey = env.ALIPAY_PRIVATE_KEY?.trim();
  const alipayPublicKey = env.ALIPAY_PUBLIC_KEY?.trim();
  const notifyUrl = env.ALIPAY_NOTIFY_URL?.trim();
  if (!appId || !sellerId || !privateKey || !alipayPublicKey || !notifyUrl) {
    throw new AiDirectHiringError(
      ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
      "支付宝支付已启用，但 ALIPAY_APP_ID/SELLER_ID/PRIVATE_KEY/PUBLIC_KEY/NOTIFY_URL 配置不完整",
      503,
    );
  }
  return {
    appId,
    sellerId,
    privateKey: normalizePem(privateKey, "PRIVATE KEY"),
    alipayPublicKey: normalizePem(alipayPublicKey, "PUBLIC KEY"),
    notifyUrl,
    returnUrl: env.ALIPAY_RETURN_URL?.trim() || undefined,
    gateway: env.ALIPAY_GATEWAY?.trim() || "https://openapi.alipay.com/gateway.do",
  };
}

export function createAlipayPagePayUrl(
  config: AlipayConfig,
  input: { outTradeNo: string; amountFen: bigint; subject: string },
): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const params: Record<string, string> = {
    app_id: config.appId,
    biz_content: JSON.stringify({
      out_trade_no: input.outTradeNo,
      product_code: "FAST_INSTANT_TRADE_PAY",
      subject: input.subject.slice(0, 256),
      total_amount: fenToCnyAmount(input.amountFen),
    }),
    charset: "utf-8",
    format: "JSON",
    method: "alipay.trade.page.pay",
    notify_url: config.notifyUrl,
    sign_type: "RSA2",
    timestamp,
    version: "1.0",
  };
  if (config.returnUrl) params.return_url = config.returnUrl;
  const signer = createSign("RSA-SHA256");
  signer.update(canonicalize(params, false), "utf8");
  params.sign = signer.sign(config.privateKey, "base64");
  return `${config.gateway}?${new URLSearchParams(params).toString()}`;
}

export async function queryAlipayTrade(
  config: AlipayConfig,
  outTradeNo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AlipayQueryResult> {
  const params: Record<string, string> = {
    app_id: config.appId,
    biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
    charset: "utf-8",
    format: "JSON",
    method: "alipay.trade.query",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
  };
  const signer = createSign("RSA-SHA256");
  signer.update(canonicalize(params, false), "utf8");
  params.sign = signer.sign(config.privateKey, "base64");
  const response = await fetchImpl(`${config.gateway}?${new URLSearchParams(params).toString()}`);
  if (!response.ok)
    throw new AiDirectHiringError(ErrorCodes.INTERNAL_ERROR, "支付宝订单查询请求失败", 502);
  const rawBody = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "支付宝订单查询响应不是有效 JSON",
      502,
    );
  }
  verifyAlipayQueryResponseSignature(config, rawBody, payload);
  const result = payload.alipay_trade_query_response as Record<string, string> | undefined;
  if (!result || result.code !== "10000" || result.out_trade_no !== outTradeNo) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝订单查询响应无效", 502);
  }
  if (result.app_id && result.app_id !== config.appId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝订单查询 app_id 不匹配", 502);
  }
  if (result.seller_id && result.seller_id !== config.sellerId) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "支付宝订单查询 seller_id 不匹配",
      502,
    );
  }
  return {
    outTradeNo,
    tradeNo: result.trade_no || null,
    totalAmountFen: result.total_amount ? cnyAmountToFen(result.total_amount) : null,
    tradeStatus: result.trade_status || "UNKNOWN",
  };
}

export function verifyAlipayNotification(
  config: AlipayConfig,
  body: Record<string, string>,
  rawPayload = canonicalize(body, false),
): AlipayNotify {
  if (body.app_id !== config.appId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝回调 app_id 不匹配", 400);
  }
  if (body.seller_id !== config.sellerId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝回调 seller_id 不匹配", 400);
  }
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(body.trade_status)) {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "支付宝交易尚未成功", 409);
  }
  if (!body.sign || !body.out_trade_no || !body.trade_no || !body.total_amount) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝回调缺少必要字段", 400);
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(canonicalize(body, true), "utf8");
  if (!verifier.verify(config.alipayPublicKey, body.sign, "base64")) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, "支付宝回调签名无效", 403);
  }
  return {
    outTradeNo: body.out_trade_no,
    tradeNo: body.trade_no,
    totalAmountFen: cnyAmountToFen(body.total_amount),
    rawNotifySha256: createHash("sha256").update(rawPayload).digest("hex"),
  };
}
