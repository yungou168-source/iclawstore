import { createHash, createSign, createVerify } from 'node:crypto';
import { AiDirectHiringError, ErrorCodes } from './aiDirectErrors.js';
import { cnyAmountToFen, fenToCnyAmount } from './paidHiringMoney.js';

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

const canonicalize = (params: Record<string, string>, excludeSign: boolean): string =>
  Object.entries(params)
    .filter(([key, value]) => value !== '' && (!excludeSign || (key !== 'sign' && key !== 'sign_type')))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

const normalizePem = (value: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string =>
  value.includes('BEGIN')
    ? value.replaceAll('\\n', '\n')
    : `-----BEGIN ${label}-----\n${value.match(/.{1,64}/g)?.join('\n') ?? value}\n-----END ${label}-----`;

export function loadAlipayConfig(env: NodeJS.ProcessEnv = process.env): AlipayConfig | null {
  if (env.ALIPAY_PAID_HIRING_ENABLED !== 'true') return null;
  const appId = env.ALIPAY_APP_ID?.trim();
  const sellerId = env.ALIPAY_SELLER_ID?.trim();
  const privateKey = env.ALIPAY_PRIVATE_KEY?.trim();
  const alipayPublicKey = env.ALIPAY_PUBLIC_KEY?.trim();
  const notifyUrl = env.ALIPAY_NOTIFY_URL?.trim();
  if (!appId || !sellerId || !privateKey || !alipayPublicKey || !notifyUrl) {
    throw new AiDirectHiringError(
      ErrorCodes.RUNTIME_CAPABILITY_DISABLED,
      '支付宝支付已启用，但 ALIPAY_APP_ID/SELLER_ID/PRIVATE_KEY/PUBLIC_KEY/NOTIFY_URL 配置不完整',
      503,
    );
  }
  return {
    appId,
    sellerId,
    privateKey: normalizePem(privateKey, 'PRIVATE KEY'),
    alipayPublicKey: normalizePem(alipayPublicKey, 'PUBLIC KEY'),
    notifyUrl,
    returnUrl: env.ALIPAY_RETURN_URL?.trim() || undefined,
    gateway: env.ALIPAY_GATEWAY?.trim() || 'https://openapi.alipay.com/gateway.do',
  };
}

export function createAlipayPagePayUrl(
  config: AlipayConfig,
  input: { outTradeNo: string; amountFen: bigint; subject: string },
): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const params: Record<string, string> = {
    app_id: config.appId,
    biz_content: JSON.stringify({
      out_trade_no: input.outTradeNo,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      subject: input.subject.slice(0, 256),
      total_amount: fenToCnyAmount(input.amountFen),
    }),
    charset: 'utf-8',
    format: 'JSON',
    method: 'alipay.trade.page.pay',
    notify_url: config.notifyUrl,
    sign_type: 'RSA2',
    timestamp,
    version: '1.0',
  };
  if (config.returnUrl) params.return_url = config.returnUrl;
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalize(params, false), 'utf8');
  params.sign = signer.sign(config.privateKey, 'base64');
  return `${config.gateway}?${new URLSearchParams(params).toString()}`;
}

export function verifyAlipayNotification(
  config: AlipayConfig,
  body: Record<string, string>,
  rawPayload = canonicalize(body, false),
): AlipayNotify {
  if (body.app_id !== config.appId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝回调 app_id 不匹配', 400);
  }
  if (body.seller_id !== config.sellerId) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝回调 seller_id 不匹配', 400);
  }
  if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(body.trade_status)) {
    throw new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, '支付宝交易尚未成功', 409);
  }
  if (!body.sign || !body.out_trade_no || !body.trade_no || !body.total_amount) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, '支付宝回调缺少必要字段', 400);
  }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonicalize(body, true), 'utf8');
  if (!verifier.verify(config.alipayPublicKey, body.sign, 'base64')) {
    throw new AiDirectHiringError(ErrorCodes.FORBIDDEN_SCOPE, '支付宝回调签名无效', 403);
  }
  return {
    outTradeNo: body.out_trade_no,
    tradeNo: body.trade_no,
    totalAmountFen: cnyAmountToFen(body.total_amount),
    rawNotifySha256: createHash('sha256').update(rawPayload).digest('hex'),
  };
}