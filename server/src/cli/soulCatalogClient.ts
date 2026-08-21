import type { SoulSnapshot } from '../domains/souls/soulMigrationDto.js';

export type SoulCatalogClient = Readonly<{ getBySlug: (slug: string) => Promise<SoulSnapshot> }>;

export const createSoulCatalogClient = (baseUrl: string, fetcher: typeof fetch = fetch): SoulCatalogClient => ({
  async getBySlug(slug) {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/souls/${encodeURIComponent(slug)}`);
    if (!response.ok) throw new Error(response.status === 404 ? 'Soul not found' : `Soul request failed: ${response.status}`);
    return await response.json() as SoulSnapshot;
  },
});