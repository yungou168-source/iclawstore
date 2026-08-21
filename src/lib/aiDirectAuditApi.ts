import { getFastifyAccessToken } from "./fastifyAuthToken";

const AUDIT_BASE = "/api/v1/ai-direct-hiring/audit";

type AuditEventSource = "domain" | "model_run" | "template";

export type AuditEvent = {
  source: AuditEventSource;
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditFilters = {
  organizationId: string;
  from: string;
  to: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  requestId?: string;
};

type AuditEventPage = { items: AuditEvent[]; nextCursor: string | null };

export type AuditExportJob = {
  id: string;
  organizationId: string;
  status: "queued" | "processing" | "completed" | "failed";
  watermark: string;
  artifactMimeType: string | null;
  artifactFileName: string | null;
  artifactSizeBytes: number | string | null;
  artifactSha256: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const send = async (refresh: boolean) => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    const token = await getFastifyAccessToken(refresh);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return {
      response: await fetch(url, { ...options, headers, credentials: "omit" }),
      hadToken: Boolean(token),
    };
  };
  let attempt = await send(false);
  if (attempt.response.status === 401 && attempt.hadToken) attempt = await send(true);
  if (!attempt.response.ok) {
    const error = await attempt.response
      .json()
      .catch(() => ({ error: `HTTP ${attempt.response.status}` }));
    throw new Error(error.error ?? `HTTP ${attempt.response.status}`);
  }
  return attempt.response.json() as Promise<T>;
}

function appendFilters(params: URLSearchParams, filters: AuditFilters): void {
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
}

export const aiDirectAuditApi = {
  list: async (
    filters: AuditFilters,
    cursor?: string | null,
    limit = 50,
  ): Promise<AuditEventPage> => {
    const params = new URLSearchParams();
    appendFilters(params, filters);
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    return request<AuditEventPage>(`${AUDIT_BASE}/events?${params}`);
  },

  createExport: (filters: AuditFilters): Promise<{ id: string; status: "queued" }> =>
    request(`${AUDIT_BASE}/exports`, { method: "POST", body: JSON.stringify(filters) }),

  getExport: (organizationId: string, id: string): Promise<AuditExportJob> => {
    const params = new URLSearchParams({ organizationId });
    return request(`${AUDIT_BASE}/exports/${encodeURIComponent(id)}?${params}`);
  },

  createDownloadToken: (
    organizationId: string,
    id: string,
  ): Promise<{ token: string; expiresInSeconds: number }> =>
    request(`${AUDIT_BASE}/exports/${encodeURIComponent(id)}/download-token`, {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    }),

  downloadUrl: (id: string, token: string): string =>
    `${AUDIT_BASE}/exports/${encodeURIComponent(id)}/download?token=${encodeURIComponent(token)}`,
};
