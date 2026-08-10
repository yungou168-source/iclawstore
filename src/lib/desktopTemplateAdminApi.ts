import { getFastifyAccessToken } from "./fastifyAuthToken";

const BASE_URL = "/api/v1/desktop";

export interface TemplateReviewQueueItem {
  id: string;
  templateId: string;
  version: string;
  reviewStatus: string;
  publicationStatus: string;
  submittedAt: string;
  templateName: string;
  templateSlug: string;
  publisherId: string;
  publisherName: string;
  sha256: string;
}

interface TemplateReviewDecision {
  id: string;
  decision: "approved" | "rejected";
  reason: string | null;
  actorUserId: string;
  createdAt: string;
}

export interface TemplateReviewDetail extends TemplateReviewQueueItem {
  description: string;
  manifest: Record<string, unknown> | string;
  mimeType: string;
  sizeBytes: string | number;
  decisions: TemplateReviewDecision[];
  screenshots: Array<{
    id: string;
    sortOrder: number;
    mimeType: string;
    sizeBytes: string | number;
    sha256: string;
  }>;
}

export interface PublisherTemplateVersionItem {
  id: string;
  publisherId: string;
  slug: string;
  name: string;
  description: string;
  catalogStatus: string;
  versionId: string | null;
  version: string | null;
  reviewStatus: string | null;
  publicationStatus: string | null;
  latestReviewReason: string | null;
  updatedAt: string;
}

export class DesktopTemplateAdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "DesktopTemplateAdminApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (refresh: boolean) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const token = await getFastifyAccessToken(refresh);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "omit" });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new DesktopTemplateAdminApiError(
      body.error ?? `HTTP ${response.status}`,
      response.status,
      body.code ?? null,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const desktopTemplateAdminApi = {
  listPublisherTemplates() {
    return request<{ items: PublisherTemplateVersionItem[] }>("/publisher/templates");
  },
  resubmit(templateId: string, versionId: string) {
    return request<{ id: string; reviewStatus: string }>(
      `/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/resubmit`,
      { method: "POST" },
    );
  },
  listQueue(cursor?: string, limit = 25) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<{ items: TemplateReviewQueueItem[]; nextCursor: string | null }>(
      `/template-review/queue?${params}`,
    );
  },
  getDetail(versionId: string) {
    return request<TemplateReviewDetail>(
      `/template-review/versions/${encodeURIComponent(versionId)}`,
    );
  },
  approve(versionId: string, reason?: string) {
    return request<{ id: string; reviewStatus: string }>(
      `/template-review/versions/${encodeURIComponent(versionId)}/approve`,
      { method: "POST", body: JSON.stringify({ reason: reason?.trim() || null }) },
    );
  },
  reject(versionId: string, reason: string) {
    return request<{ id: string; reviewStatus: string; reason: string }>(
      `/template-review/versions/${encodeURIComponent(versionId)}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  publish(versionId: string) {
    return request<{ id: string; publicationStatus: string }>(
      `/template-review/versions/${encodeURIComponent(versionId)}/publish`,
      { method: "POST" },
    );
  },
  unpublish(versionId: string) {
    return request<{ id: string; publicationStatus: string }>(
      `/template-review/versions/${encodeURIComponent(versionId)}/unpublish`,
      { method: "POST" },
    );
  },
  grantEntitlement(templateId: string, userId: string, reference?: string) {
    return request<{ templateId: string; userId: string; status: string }>(
      `/template-review/templates/${encodeURIComponent(templateId)}/entitlements/${encodeURIComponent(userId)}`,
      { method: "PUT", body: JSON.stringify({ reference: reference?.trim() || null }) },
    );
  },
  revokeEntitlement(templateId: string, userId: string) {
    return request<void>(
      `/template-review/templates/${encodeURIComponent(templateId)}/entitlements/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  },
};
