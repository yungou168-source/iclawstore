import { getFastifyAccessToken } from "./fastifyAuthToken";

const BASE = "/api/v1/ai-direct-hiring/management";

type Page<T> = { items: T[]; nextCursor: string | null };

export type Overview = {
  window: { from: string; to: string };
  employees: { active: number };
  runs: { queued: number; active: number; failed: number };
  costs: { currency: "USD"; micros: string; inputTokens: number; outputTokens: number };
  approvals: { pending: number };
};

export type SystemStatus = {
  generatedAt: string;
  runs: { queued: number; active: number; failed: number; expired: number };
  workers: Array<{ workerId: string; lastHeartbeatAt: string | null; activeRuns: number }>;
  outbox: { pending: number; oldestPendingAt: string | null };
};

export type Employee = {
  id: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  agentId: string;
  agentName: string;
  companyId: string;
  companyName: string;
  roleId: string;
  roleName: string;
};

export type CostEntry = {
  id: string;
  runId: string | null;
  agentId: string;
  agentVersionId: string;
  modelKey: string;
  providerKey: string | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: string;
  latencyMs: number | null;
  createdAt: string;
};

async function request<T>(path: string): Promise<T> {
  const send = async (refresh: boolean) => {
    const token = await getFastifyAccessToken(refresh);
    return fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "omit",
    });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value && params.set(key, value));
  return params.toString();
};

export const aiDirectManagementInsightsApi = {
  overview: (organizationId: string) => request<Overview>(`/overview?${query({ organizationId })}`),
  systemStatus: (organizationId: string) =>
    request<SystemStatus>(`/system-status?${query({ organizationId })}`),
  employees: (organizationId: string, cursor?: string) =>
    request<Page<Employee>>(`/employees?${query({ organizationId, cursor })}`),
  costs: (organizationId: string, cursor?: string) =>
    request<Page<CostEntry>>(`/cost-ledger?${query({ organizationId, cursor })}`),
};
