import { apiRequest, registryUrl } from './http.js';
import { ApiRoutes } from './schema/routes.js';

type CatalogEntry = Readonly<{
  id: string;
  name: string;
  displayName: string;
  summary: string | null;
  owner: { id: string; handle: string | null; displayName: string | null; image: string | null };
  publisher: { id: string; handle: string; displayName: string; image: string | null } | null;
  latestVersion: CatalogVersion | null;
  updatedAt: string;
  tags: readonly string[];
  stats: Readonly<Record<string, number>>;
}>;

type CatalogVersion = Readonly<{
  id: string;
  version: string;
  createdAt: string;
  changelog: string;
  sha256: string | null;
  artifacts: readonly { path: string; mimeType: string; sizeBytes: number; sha256: string; available: false }[];
}>;

type CatalogPage = Readonly<{
  items: readonly CatalogEntry[];
  pagination: { page: number; limit: number; total: number; pages: number };
}>;

const catalogPath = (domain: 'skill' | 'package') =>
  domain === 'skill' ? ApiRoutes.catalogSkills : ApiRoutes.catalogPackages;

export const catalogApi = Object.freeze({
  list: (registry: string, domain: 'skill' | 'package', query: Readonly<{ page?: number; limit?: number; sort?: string; q?: string }>, token?: string) => {
    const url = registryUrl(catalogPath(domain), registry);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    return apiRequest<CatalogPage>(registry, { method: 'GET', url: url.toString(), token });
  },
  resolve: (registry: string, domain: 'skill' | 'package', name: string, token?: string) =>
    apiRequest<CatalogEntry>(registry, { method: 'GET', path: `${catalogPath(domain)}/resolve/${encodeURIComponent(name)}`, token }),
  get: (registry: string, domain: 'skill' | 'package', id: string, token?: string) =>
    apiRequest<CatalogEntry>(registry, { method: 'GET', path: `${catalogPath(domain)}/${encodeURIComponent(id)}`, token }),
  versions: (registry: string, domain: 'skill' | 'package', id: string, query: Readonly<{ page?: number; limit?: number }>, token?: string) => {
    const url = registryUrl(`${catalogPath(domain)}/${encodeURIComponent(id)}/versions`, registry);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    return apiRequest<{ versions: readonly CatalogVersion[]; pagination: CatalogPage['pagination'] }>(registry, { method: 'GET', url: url.toString(), token });
  },
  version: (registry: string, domain: 'skill' | 'package', id: string, version: string, token?: string) =>
    apiRequest<CatalogVersion>(registry, {
      method: 'GET',
      path: `${catalogPath(domain)}/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`,
      token,
    }),
});

export type { CatalogEntry, CatalogPage, CatalogVersion };