import { describe, expect, it, vi } from 'vitest';
import { catalogApi } from './catalogApi.js';

const requestMock = vi.hoisted(() => vi.fn());
const registryUrlMock = vi.hoisted(() =>
  vi.fn((path: string, registry: string) => {
    const base = registry.endsWith('/') ? registry : `${registry}/`;
    return new URL(path.replace(/^\//, ''), base);
  }),
);

vi.mock('./http.js', () => ({
  apiRequest: requestMock,
  registryUrl: registryUrlMock,
}));

describe('catalogApi', () => {
  it('encodes names and preserves registry base paths for resolve', async () => {
    requestMock.mockResolvedValueOnce({ id: 'skill-1' });

    await catalogApi.resolve('https://registry.test/custom', 'skill', 'owner/name', 'token-1');

    expect(requestMock).toHaveBeenCalledWith('https://registry.test/custom', {
      method: 'GET',
      path: '/api/skills/resolve/owner%2Fname',
      token: 'token-1',
    });
  });

  it('adds only defined pagination and sort parameters', async () => {
    requestMock.mockResolvedValueOnce({
      items: [],
      pagination: { page: 2, limit: 10, total: 0, pages: 0 },
    });

    await catalogApi.list('https://registry.test/base', 'package', {
      page: 2,
      limit: 10,
      sort: undefined,
    });

    expect(registryUrlMock).toHaveBeenCalledWith('/api/packages', 'https://registry.test/base');
    const request = requestMock.mock.calls.at(-1)?.[1] as { url: string };
    expect(request.url).toBe('https://registry.test/base/api/packages?page=2&limit=10');
  });

  it('uses the encoded id in version requests', async () => {
    requestMock.mockResolvedValueOnce({
      versions: [],
      pagination: { page: 1, limit: 25, total: 0, pages: 0 },
    });

    await catalogApi.versions('https://registry.test', 'skill', 'skill/1', {
      page: 1,
      limit: 25,
    });

    expect(requestMock).toHaveBeenCalledWith('https://registry.test', {
      method: 'GET',
      url: 'https://registry.test/api/skills/skill%2F1/versions?page=1&limit=25',
      token: undefined,
    });
  });
});