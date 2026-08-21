import { describe, expect, it, vi } from 'bun:test';
import { createConvexProfileAvatarSourceReader } from '../src/domains/profiles/convexProfileAvatarSourceReader.js';

describe('Convex Profile avatar source reader', () => {
  it('returns a validated stream from controlled source metadata', async () => {
    const source = createConvexProfileAvatarSourceReader(
      {
        query: vi.fn(async () => ({
          storageId: 'storage:avatar',
          url: 'https://storage.example.test/avatar',
          contentType: 'image/png',
          sizeBytes: 4,
          accessScope: 'public' as const,
        })),
      },
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'content-type': 'image/png', 'content-length': '4' },
      })),
    );

    const avatar = await source.read('storage:avatar');
    expect(avatar?.legacyStorageId).toBe('storage:avatar');
    expect(avatar?.declaredMimeType).toBe('image/png');
    expect(avatar?.originalFileName).toBe('profile-avatar.png');
  });

  it('rejects source responses whose metadata no longer matches', async () => {
    const source = createConvexProfileAvatarSourceReader(
      {
        query: vi.fn(async () => ({
          storageId: 'storage:avatar',
          url: 'https://storage.example.test/avatar',
          contentType: 'image/png',
          sizeBytes: 4,
          accessScope: 'public' as const,
        })),
      },
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      })),
    );

    await expect(source.read('storage:avatar')).rejects.toThrow('content type did not match');
  });
});