/**
 * Fastify API Client for MySQL Backend
 *
 * Provides a typed interface for API calls to the Fastify backend.
 */

import { getFastifyAccessToken } from "./fastifyAuthToken";

const API_BASE_URL = "/api";

// Types matching the Fastify API responses
export interface Skill {
  id: string;
  slug: string;
  displayName: string;
  summary: string | null;
  icon: string | null;
  resourceId: string | null;
  ownerUserId: string;
  ownerPublisherId: string | null;
  latestVersionId: string | null;
  latestVersionSummary: string | null;
  tags: string | null;
  capabilityTags: string | null;
  softDeletedAt: string | null;
  moderationStatus: string | null;
  reportCount: number;
  statsDownloads: number;
  statsStars: number;
  statsInstallsCurrent: number;
  statsInstallsAllTime: number;
  statsVersions: number;
  statsComments: number;
  createdAt: string;
  updatedAt: string;
  owner?: {
    id: string;
    handle: string;
    displayName: string;
    image: string;
  };
  publisher?: {
    id: string;
    handle: string;
    displayName: string;
    image: string;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface SkillsListResponse {
  skills: Skill[];
  pagination: Pagination;
}

export interface SkillDetailResponse extends Skill {
  versions?: any[];
  comments?: any[];
  starsCount?: number;
}

export interface SearchResponse {
  hits: any[];
  query: string;
  pagination: Pagination;
  processingTimeMs: number;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  role: string;
  trustedPublisher: boolean;
  publishedSkills: number;
  totalStars: number;
  totalDownloads: number;
  createdAt: string;
}

export interface AiDirectOrganizationSession {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "manager" | "member";
  permissions: string[];
}

export interface AiDirectSession {
  user: {
    id: string;
    convexUserId: string | null;
    email: string | null;
    name: string | null;
    handle: string | null;
    displayName: string | null;
    image: string | null;
    role: string;
  };
  organizations: AiDirectOrganizationSession[];
  currentOrganization: AiDirectOrganizationSession | null;
  featureFlags: Record<string, boolean>;
}

export interface MemoryBinding {
  configured: boolean;
  vaultFingerprint: string | null;
  extractorVersion: string | null;
  evidenceVersion: string | null;
  noteCount: number;
  tagCount: number;
  lastSyncAt: string | null;
  updatedAt: string | null;
}

export interface MemoryNoteSummary {
  notePath: string;
  title: string | null;
  tagsJson: string[] | null;
  linksJson: string[] | null;
  summaryBytes: number;
  sourceBytes: number;
  mtime: string | null;
  size: number;
  updatedAt: string;
}

export interface MemoryNoteDetail extends MemoryNoteSummary {
  summaryMd: string | null;
  frontmatterJson: Record<string, unknown> | null;
}

export interface MemoryVaultBindingInput {
  vaultFingerprint: string;
  extractorVersion: string;
  evidenceVersion: string;
}

class FastifyApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const send = async (
      forceRefreshToken: boolean,
    ): Promise<{ response: Response; hadToken: boolean }> => {
      const headers = new Headers(options.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      const token = await getFastifyAccessToken(forceRefreshToken);
      if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(url, { ...options, headers, credentials: "omit" });
      return { response, hadToken: Boolean(token) };
    };

    let attempt = await send(false);
    if (attempt.response.status === 401 && attempt.hadToken) attempt = await send(true);
    const response = attempt.response;

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Request failed" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Skills API
  async getSkills(args?: {
    page?: number;
    limit?: number;
    sort?: "downloads" | "stars" | "installs" | "created" | "name";
  }): Promise<SkillsListResponse> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));
    if (args?.sort) params.set("sort", args.sort);

    return this.request<SkillsListResponse>(`/skills?${params.toString()}`);
  }

  async getSkill(id: string): Promise<SkillDetailResponse> {
    return this.request<SkillDetailResponse>(`/skills/${id}`);
  }

  async getSkillBySlug(slug: string): Promise<SkillDetailResponse> {
    return this.request<SkillDetailResponse>(`/skills/slug/${slug}`);
  }

  async starSkill(id: string): Promise<{ starred: boolean }> {
    return this.request<{ starred: boolean }>(`/skills/${id}/star`, {
      method: "POST",
    });
  }

  async getSkillVersions(id: string, args?: { page?: number; limit?: number }): Promise<any> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));

    return this.request<any>(`/skills/${id}/versions?${params.toString()}`);
  }

  // Search API
  async search(
    query: string,
    args?: {
      page?: number;
      limit?: number;
      sort?: string;
    },
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));
    if (args?.sort) params.set("sort", args.sort);

    return this.request<SearchResponse>(`/search?${params.toString()}`);
  }

  async getSearchSuggestions(query: string): Promise<{ suggestions: any[] }> {
    return this.request<{ suggestions: any[] }>(
      `/search/suggestions?q=${encodeURIComponent(query)}`,
    );
  }

  // Users API
  async getUser(idOrHandle: string): Promise<User> {
    return this.request<User>(`/users/${encodeURIComponent(idOrHandle)}`);
  }

  async getUserSkills(
    idOrHandle: string,
    args?: { page?: number; limit?: number },
  ): Promise<SkillsListResponse> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));

    return this.request<SkillsListResponse>(
      `/users/${encodeURIComponent(idOrHandle)}/skills?${params.toString()}`,
    );
  }

  async getUserStars(
    idOrHandle: string,
    args?: { page?: number; limit?: number },
  ): Promise<SkillsListResponse> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));

    return this.request<SkillsListResponse>(
      `/users/${encodeURIComponent(idOrHandle)}/stars?${params.toString()}`,
    );
  }

  // Packages API
  async getPackages(args?: { page?: number; limit?: number }): Promise<any> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));

    return this.request<any>(`/packages?${params.toString()}`);
  }

  async getPackage(id: string): Promise<any> {
    return this.request<any>(`/packages/${id}`);
  }

  // Publishers API
  async getPublisher(handle: string): Promise<any> {
    return this.request<any>(`/publishers/${encodeURIComponent(handle)}`);
  }

  async getMyPublishers(): Promise<any[]> {
    return this.request<any[]>("/publishers/mine");
  }

  async getAiDirectSession(organizationId?: string): Promise<AiDirectSession> {
    return this.request<AiDirectSession>("/v1/ai-direct-hiring/session", {
      headers: organizationId ? { "X-Organization-Id": organizationId } : undefined,
    });
  }

  async getMemoryBinding(): Promise<MemoryBinding> {
    return this.request<MemoryBinding>("/v1/memory/obsidian/binding");
  }

  async bindMemoryVault(input: MemoryVaultBindingInput): Promise<void> {
    await this.request<void>("/v1/memory/obsidian/bind", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async revokeMemoryVault(): Promise<void> {
    await this.request<void>("/v1/memory/obsidian/bind", { method: "DELETE" });
  }

  async getMemoryNotes(limit: number): Promise<{ items: MemoryNoteSummary[] }> {
    return this.request<{ items: MemoryNoteSummary[] }>(
      `/v1/memory/obsidian/notes?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async getMemoryNote(notePath: string): Promise<MemoryNoteDetail> {
    return this.request<MemoryNoteDetail>(
      `/v1/memory/obsidian/notes/${encodeURIComponent(notePath)}`,
    );
  }
}

// Export singleton instance
export const fastifyApi = new FastifyApiClient();

// Also export the class for testing
export { FastifyApiClient };
