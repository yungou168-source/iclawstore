/**
 * API Client Abstraction Layer
 * 
 * Provides a unified interface for API calls.
 * Currently uses Convex, can be switched to Fastify API.
 */

import { getRequiredRuntimeEnv } from "./runtimeEnv";

// API Base URL - will point to Fastify server when enabled
const API_BASE_URL = typeof window !== "undefined" 
  ? (import.meta.env.VITE_API_URL || "/api")
  : "";

// Check if using Fastify backend
const USE_FASTIFY_API = import.meta.env.VITE_USE_FASTIFY_API === "true";

// ============================================
// Fastify API Client (when enabled)
// ============================================

async function fastifyRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
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

// ============================================
// API Functions - Skills
// ============================================

export const api = {
  // Skills
  skills: {
    list: (args?: { 
      cursor?: string; 
      numResults?: number;
      sortBy?: "downloads" | "stars" | "created";
    }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ skills: any[]; cursor?: string }>(
          `/api/skills?${new URLSearchParams(args as any)}`
        );
      }
      // Fallback to Convex - handled by React hooks
      return Promise.resolve({ skills: [], cursor: undefined });
    },
    
    getBySlug: (slug: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/skills/slug/${slug}`);
      }
      return Promise.resolve(null);
    },
    
    getById: (id: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/skills/${id}`);
      }
      return Promise.resolve(null);
    },
    
    create: (data: { slug: string; displayName: string; summary?: string }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>("/api/skills", {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
      throw new Error("Convex mutation not available");
    },
    
    update: (id: string, data: { displayName?: string; summary?: string }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/skills/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
      }
      throw new Error("Convex mutation not available");
    },
    
    delete: (id: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ success: boolean }>(`/api/skills/${id}`, {
          method: "DELETE",
        });
      }
      throw new Error("Convex mutation not available");
    },
    
    star: (id: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ starred: boolean }>(`/api/skills/${id}/star`, {
          method: "POST",
        });
      }
      throw new Error("Convex mutation not available");
    },
  },
  
  // Users
  users: {
    getByHandle: (handle: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/users/${handle}`);
      }
      return Promise.resolve(null);
    },
    
    getById: (id: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/users/${id}`);
      }
      return Promise.resolve(null);
    },
    
    getMySkills: (userId: string, args?: { cursor?: string; numResults?: number }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ skills: any[]; cursor?: string }>(
          `/api/users/${userId}/skills?${new URLSearchParams(args as any)}`
        );
      }
      return Promise.resolve({ skills: [] });
    },
    
    getStars: (userId: string, args?: { cursor?: string; numResults?: number }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ skills: any[]; cursor?: string }>(
          `/api/users/${userId}/stars?${new URLSearchParams(args as any)}`
        );
      }
      return Promise.resolve({ skills: [] });
    },
    
    updateProfile: (data: { displayName?: string; bio?: string }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>("/api/users/me", {
          method: "PUT",
          body: JSON.stringify(data),
        });
      }
      throw new Error("Convex mutation not available");
    },
  },
  
  // Search
  search: {
    query: (query: string, args?: { cursor?: string; numResults?: number }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ results: any[]; cursor?: string }>(
          `/api/search?q=${encodeURIComponent(query)}&${new URLSearchParams(args as any)}`
        );
      }
      return Promise.resolve({ results: [] });
    },
  },
  
  // Publishers
  publishers: {
    getByHandle: (handle: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/publishers/${handle}`);
      }
      return Promise.resolve(null);
    },
    
    listMine: () => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any[]>("/api/publishers/mine");
      }
      return Promise.resolve([]);
    },
  },
  
  // Packages
  packages: {
    list: (args?: { cursor?: string; numResults?: number }) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<{ packages: any[]; cursor?: string }>(
          `/api/packages?${new URLSearchParams(args as any)}`
        );
      }
      return Promise.resolve({ packages: [] });
    },
    
    getById: (id: string) => {
      if (USE_FASTIFY_API) {
        return fastifyRequest<any>(`/api/packages/${id}`);
      }
      return Promise.resolve(null);
    },
  },
};

// Export a flag for components to check
export const isUsingFastify = USE_FASTIFY_API;
export const isUsingConvex = !USE_FASTIFY_API;
