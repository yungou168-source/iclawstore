import { api } from '../../convex/_generated/api';
import { convexHttp } from '../convex/client';

export type PublicProfile = {
  user: {
    _id: string;
    _creationTime: number;
    handle?: string;
    name?: string;
    displayName?: string;
    image?: string;
    bio?: string;
  };
  profileSlug: string;
  publisher: { handle: string; displayName: string } | null;
};

export const getPublicProfile = async (slug: string): Promise<PublicProfile | null> => {
  try {
    const response = await fetch(`/api/profiles/${encodeURIComponent(slug)}`, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (response.ok) return (await response.json()) as PublicProfile;
  } catch {
    // The public Convex response remains the availability-safe fallback during migration.
  }
  return (await convexHttp.query(api.users.getPublicProfileBySlug, { slug })) as PublicProfile | null;
};