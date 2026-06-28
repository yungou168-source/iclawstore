/**
 * Fastify API Client for MySQL Backend
 * 
 * Provides a typed interface for API calls to the Fastify backend.
 */

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

class FastifyApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
    });

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
  async search(query: string, args?: {
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));
    if (args?.sort) params.set("sort", args.sort);
    
    return this.request<SearchResponse>(`/search?${params.toString()}`);
  }

  async getSearchSuggestions(query: string): Promise<{ suggestions: any[] }> {
    return this.request<{ suggestions: any[] }>(`/search/suggestions?q=${encodeURIComponent(query)}`);
  }

  // Users API
  async getUser(idOrHandle: string): Promise<User> {
    return this.request<User>(`/users/${encodeURIComponent(idOrHandle)}`);
  }

  async getUserSkills(idOrHandle: string, args?: { page?: number; limit?: number }): Promise<SkillsListResponse> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));
    
    return this.request<SkillsListResponse>(`/users/${encodeURIComponent(idOrHandle)}/skills?${params.toString()}`);
  }

  async getUserStars(idOrHandle: string, args?: { page?: number; limit?: number }): Promise<SkillsListResponse> {
    const params = new URLSearchParams();
    if (args?.page) params.set("page", String(args.page));
    if (args?.limit) params.set("limit", String(args.limit));
    
    return this.request<SkillsListResponse>(`/users/${encodeURIComponent(idOrHandle)}/stars?${params.toString()}`);
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
}

// Export singleton instance
export const fastifyApi = new FastifyApiClient();

// Also export the class for testing
export { FastifyApiClient };
