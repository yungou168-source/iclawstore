export type PublicProfile = Readonly<{
  user: Readonly<{
    _id: string;
    _creationTime: number;
    handle?: string;
    name?: string;
    displayName?: string;
    image?: string;
    bio?: string;
  }>;
  profileSlug: string;
  publisher: Readonly<{ handle: string; displayName: string }> | null;
}>;

export type PublicProfilePort = Readonly<{
  getBySlug: (slug: string) => Promise<PublicProfile | null>;
}>;