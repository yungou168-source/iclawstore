import { getFastifyAccessToken } from "./fastifyAuthToken";

const BASE = "/api/v1/ai-direct-hiring";

export type WalletOverview = {
  currency: "CNY";
  availableFen: string;
  frozenFen: string;
  withdrawableEarningsFen: string;
  frozenEarningsFen: string;
};

export type WalletStatementItem = {
  id: string;
  entryType: "recharge" | "consume" | "refund" | "freeze" | "unfreeze" | "withdraw";
  businessType: string;
  businessId: string;
  availableDeltaFen: string;
  frozenDeltaFen: string;
  availableAfterFen: string;
  frozenAfterFen: string;
  reason: string | null;
  createdAt: string;
};

export type RechargeOrder = {
  id: string;
  outTradeNo: string;
  userId?: string;
  status: string;
  currency: "CNY";
  amountFen: string;
  providerTradeNo: string | null;
  paidAt: string | null;
  createdAt: string;
  payUrl?: string;
};

export type EarningEntry = {
  id: string;
  paymentOrderId: string;
  amountFen: string;
  createdAt: string;
};

export type AdminWalletAccount = {
  userId: string;
  currency: "CNY";
  availableFen: string;
  frozenFen: string;
  handle: string | null;
  email: string | null;
};

export type WalletRefund = {
  id: string;
  paymentOrderId: string;
  userId: string;
  amountFen: string;
  status: string;
  reason: string;
  createdAt: string;
};

export type Withdrawal = {
  id: string;
  developerUserId: string;
  amountFen: string;
  currency: "CNY";
  status: string;
  createdAt: string;
};

type CursorPage<T> = { items: T[]; nextCursor: string | null };

type ApiErrorPayload = { code?: string; error?: string; message?: string };

export class WalletApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "WalletApiError";
  }
}

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const send = async (refresh: boolean) => {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const token = await getFastifyAccessToken(refresh);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${BASE}${path}`, { ...options, headers, credentials: "omit" });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new WalletApiError(
      response.status,
      payload.code ?? null,
      payload.error ?? payload.message ?? `HTTP ${response.status}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

const queryPath = (path: string, query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.size > 0 ? `${path}?${params}` : path;
};

export const formatWalletCny = (amountFen: string, locale = "zh-CN") => {
  const amount = Number(amountFen);
  if (!Number.isSafeInteger(amount)) return `${amountFen} 分`;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(amount / 100);
};

export const walletApi = {
  getOverview: () => request<WalletOverview>("/wallet"),
  listStatement: (input: { cursor?: string; limit?: number; entryType?: string } = {}) =>
    request<CursorPage<WalletStatementItem>>(queryPath("/wallet/statement", input)),
  createRecharge: (amountFen: string, idempotencyKey: string) =>
    request<RechargeOrder>("/wallet/recharges", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ amountFen }),
    }),
  getRecharge: (orderId: string) =>
    request<RechargeOrder>(`/wallet/recharges/${encodeURIComponent(orderId)}`),
  reconcileRecharge: (orderId: string) =>
    request<RechargeOrder>(`/wallet/recharges/${encodeURIComponent(orderId)}/reconcile`, {
      method: "POST",
    }),
  listEarningEntries: () => request<CursorPage<EarningEntry>>("/wallet/earnings/entries?limit=100"),
  listWithdrawals: () => request<CursorPage<Withdrawal>>("/wallet/withdrawals?limit=100"),
  createWithdrawal: (ledgerEntryIds: string[]) =>
    request<{ id: string; amountFen: string; currency: "CNY"; status: string }>(
      "/wallet/withdrawals",
      { method: "POST", body: JSON.stringify({ ledgerEntryIds }) },
    ),

  listAdminAccounts: (search = "") =>
    request<{ items: AdminWalletAccount[] }>(
      queryPath("/wallet/admin/accounts", { search, limit: 100 }),
    ),
  listAdminStatement: (userId: string, entryType = "") =>
    request<CursorPage<WalletStatementItem>>(
      queryPath(`/wallet/admin/accounts/${encodeURIComponent(userId)}/statement`, {
        entryType,
        limit: 100,
      }),
    ),
  listAdminRecharges: (status = "") =>
    request<{ items: RechargeOrder[] }>(
      queryPath("/wallet/admin/recharges", { status, limit: 100 }),
    ),
  listAdminRefunds: (status = "") =>
    request<{ items: WalletRefund[] }>(queryPath("/wallet/admin/refunds", { status, limit: 100 })),
  listAdminWithdrawals: (status = "") =>
    request<CursorPage<Withdrawal>>(queryPath("/paid-hiring/settlements", { status, limit: 100 })),
  createRefund: (input: { paymentOrderId: string; amountFen: string; reason: string }) =>
    request<{ id: string; status: string }>("/wallet/admin/refunds", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  reviewRefund: (refundId: string, action: "approve" | "reject", reviewNote = "") =>
    request<{ id: string; status: string }>(
      `/wallet/admin/refunds/${encodeURIComponent(refundId)}/${action}`,
      { method: "POST", body: JSON.stringify({ reviewNote }) },
    ),
  transitionWithdrawal: (
    settlementId: string,
    action: "processing" | "completed" | "failed" | "retry",
    input: { externalReference?: string; failureReason?: string } = {},
  ) =>
    request<void>(`/wallet/admin/withdrawals/${encodeURIComponent(settlementId)}/${action}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
