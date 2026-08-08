import { getFastifyAccessToken } from "./fastifyAuthToken";

const BASE = "/api/v1/ai-direct-hiring";

type CnyFen = string;
type SettlementStatus = "pending" | "processing" | "failed" | "completed";
type SettlementAction = "processing" | "failed" | "retry" | "completed";

interface PaidHiringApiErrorData {
  error?: string;
  message?: string;
  code?: string;
}

export class PaidHiringApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, payload: PaidHiringApiErrorData) {
    super(payload.error ?? payload.message ?? `HTTP ${status}`);
    this.name = "PaidHiringApiError";
    this.status = status;
    this.code = payload.code ?? null;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isReconcileCooldown(): boolean {
    return this.status === 429;
  }
}

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CandidateCatalogItemDto {
  agentId: string;
  agentVersionId: string;
  displayName: string;
  summary: string | null;
  category: string | null;
  availability: string;
  priceStatus: string;
}

interface CandidateCategoryDto {
  categoryKey: string;
  candidateCount: number;
}

export interface OwnedAgentDto {
  id: string;
  name: string;
  description: string | null;
  status: string;
  activeVersionId: string | null;
  activeVersion?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnedAgentVersionDto {
  id: string;
  version: number;
  status: string;
  reviewStatus?: string;
  securityStatus?: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface AgentPriceDto {
  id: string;
  agentId: string;
  agentVersionId: string;
  version: number;
  currency: "CNY";
  amountFen: CnyFen;
  status: "active" | "superseded";
  effectiveAt: string;
  supersededAt: string | null;
}

export interface PaidHiringOrderDto {
  id: string;
  hiringIntentId?: string;
  outTradeNo: string;
  provider?: "alipay";
  status: string;
  currency: "CNY";
  grossAmountFen: CnyFen;
  platformFeeFen?: CnyFen;
  developerPayableFen?: CnyFen;
  payUrl?: string;
  replayed?: boolean;
  offerId: string | null;
  employmentId: string | null;
  nextReconcileAt: string | null;
  lastProviderStatus: string | null;
}

interface DeveloperPayableBalanceDto {
  developerUserId: string;
  currency: "CNY";
  payableFen: CnyFen;
}

export interface SettleableLedgerEntryDto {
  id: string;
  paymentOrderId: string;
  amountFen: CnyFen;
  createdAt: string;
}

export interface DeveloperSettlementDto {
  id: string;
  developerUserId: string;
  currency: "CNY";
  amountFen: CnyFen;
  status: SettlementStatus;
  createdAt?: string;
}

export interface DeveloperSettlementDetailDto extends DeveloperSettlementDto {
  externalReference: string | null;
  failureReason: string | null;
  items: Array<{ ledgerEntryId: string; amountFen: CnyFen }>;
}

export interface OperationalAlertDto {
  id: string;
  paymentOrderId: string;
  code: string;
  severity: "warning" | "error";
  occurrenceCount: number;
  lastObservedAt: string;
}

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const send = async (refresh: boolean): Promise<Response> => {
    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const token = await getFastifyAccessToken(refresh);
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${BASE}${path}`, { ...options, headers, credentials: "omit" });
  };

  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as PaidHiringApiErrorData;
    throw new PaidHiringApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

const queryPath = (path: string, query: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== "") params.set(key, String(value));
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
};

const encodeId = (value: string): string => encodeURIComponent(value);

export const formatCnyFen = (amountFen: CnyFen, locale = "zh-CN"): string => {
  const amount = Number(amountFen);
  if (!Number.isSafeInteger(amount)) return `${amountFen} ${locale === "zh-CN" ? "分" : "fen"}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" }).format(amount / 100);
};

export const aiDirectPaidHiringApi = {
  listCandidateCatalog: (
    organizationId: string,
    input: { search?: string; category?: string; limit?: number } = {},
  ) =>
    request<CursorPage<CandidateCatalogItemDto>>(queryPath("/catalog/agents", input), {
      headers: { "X-Organization-Id": organizationId },
    }),
  listCandidateCategories: (organizationId: string) =>
    request<{ items: CandidateCategoryDto[] }>("/catalog/categories", {
      headers: { "X-Organization-Id": organizationId },
    }),
  listOwnedAgents: () => request<{ items: OwnedAgentDto[] }>("/agents"),
  listOwnedAgentVersions: (agentId: string) =>
    request<{ items: OwnedAgentVersionDto[] }>(`/agents/${encodeId(agentId)}/versions`),
  listAgentPrices: (agentId: string) =>
    request<{ prices: AgentPriceDto[] }>(`/agents/${encodeId(agentId)}/prices`),
  setAgentPrice: (
    agentId: string,
    input: { agentVersionId: string; amountFen: number; currency?: "CNY" },
  ) =>
    request<AgentPriceDto>(`/agents/${encodeId(agentId)}/prices`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  createOrder: (
    input: {
      companyId: string;
      projectId: string | null;
      roleId: string;
      positionId: string;
      agentId: string;
    },
    idempotencyKey: string,
  ) =>
    request<PaidHiringOrderDto>("/paid-hiring/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    }),
  getOrder: (orderId: string) =>
    request<PaidHiringOrderDto>(`/paid-hiring/orders/${encodeId(orderId)}`),
  reconcileOrder: (orderId: string) =>
    request<PaidHiringOrderDto>(`/paid-hiring/orders/${encodeId(orderId)}/reconcile`, {
      method: "POST",
    }),

  listPayableBalances: (input: { limit?: number; cursor?: string } = {}) =>
    request<CursorPage<DeveloperPayableBalanceDto>>(
      queryPath("/paid-hiring/settlements/balances", input),
    ),
  listSettleableEntries: (
    developerUserId: string,
    input: { limit?: number; cursor?: string } = {},
  ) =>
    request<CursorPage<SettleableLedgerEntryDto>>(
      queryPath("/paid-hiring/settlements/entries", { developerUserId, ...input }),
    ),
  listSettlements: (
    input: {
      developerUserId?: string;
      status?: SettlementStatus;
      limit?: number;
      cursor?: string;
    } = {},
  ) => request<CursorPage<DeveloperSettlementDto>>(queryPath("/paid-hiring/settlements", input)),
  getSettlement: (settlementId: string) =>
    request<DeveloperSettlementDetailDto>(`/paid-hiring/settlements/${encodeId(settlementId)}`),
  createSettlement: (input: { developerUserId: string; ledgerEntryIds: string[] }) =>
    request<Pick<DeveloperSettlementDto, "id" | "amountFen" | "currency" | "status">>(
      "/paid-hiring/settlements",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  transitionSettlement: (
    settlementId: string,
    action: SettlementAction,
    input: { externalReference?: string; failureReason?: string } = {},
  ) =>
    request<void>(`/paid-hiring/settlements/${encodeId(settlementId)}/${action}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listOperationalAlerts: (
    input: { status?: "open" | "resolved"; limit?: number; cursor?: string } = {},
  ) => request<CursorPage<OperationalAlertDto>>(queryPath("/paid-hiring/operations/alerts", input)),
};
