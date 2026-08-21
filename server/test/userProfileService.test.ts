import { describe, expect, it } from 'vitest';
import { updateUserProfile } from '../src/services/userProfileService.js';

describe('user profile write policy', () => {
  it('persists only the editable profile fields', async () => {
    const update = async (args: unknown) => args;
    const result = await updateUserProfile({ users: { update } } as never, 'user-1', {
      displayName: 'New name',
      bio: null,
    });
    expect(result).toMatchObject({ data: { displayName: 'New name', bio: null, image: undefined } });
  });

  it('rejects privilege and identity fields', async () => {
    await expect(updateUserProfile({} as never, 'user-1', { role: 'admin' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid image URLs and oversized text', async () => {
    await expect(updateUserProfile({} as never, 'user-1', { image: 'javascript:alert(1)' })).rejects.toThrow(
      'image must be an HTTP(S) URL',
    );
    await expect(updateUserProfile({} as never, 'user-1', { bio: 'x'.repeat(2001) })).rejects.toThrow(
      'bio is invalid',
    );
  });
});