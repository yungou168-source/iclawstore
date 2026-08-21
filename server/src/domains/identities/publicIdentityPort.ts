import type { PublicProfile, PublicProfilePort } from '../profiles/publicProfilePort.js';

/**
 * A stable public lookup result. It keeps the existing profile response intact
 * while making handle and personal-publisher aliases explicit to HTTP callers.
 */
export type PublicIdentity = Readonly<{
  subjectKind: 'profile';
  requestedHandle: string;
  canonicalHandle: string;
  profile: PublicProfile;
}>;

export type PublicIdentityPort = Readonly<{
  resolveByHandle: (handle: string) => Promise<PublicIdentity | null>;
}>;

export const createPublicIdentityPort = (profiles: PublicProfilePort): PublicIdentityPort =>
  Object.freeze({
    resolveByHandle: async (handle) => {
      const requestedHandle = handle.trim().toLowerCase();
      if (!requestedHandle) return null;
      const profile = await profiles.getBySlug(requestedHandle);
      if (!profile) return null;
      return {
        subjectKind: 'profile',
        requestedHandle,
        canonicalHandle: profile.profileSlug,
        profile,
      };
    },
  });