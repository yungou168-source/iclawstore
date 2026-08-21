export type ExternalIdentity = Readonly<{
  issuer: string;
  subject: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
}>;

export type BoundAccount = Readonly<{ userId: string; issuer: string; subject: string }>;

export type AccountBindingStore = {
  findByExternalIdentity(identity: Pick<ExternalIdentity, 'issuer' | 'subject'>): Promise<BoundAccount | null>;
  findByVerifiedEmail(email: string): Promise<Readonly<{ userId: string }> | null>;
  createUser(identity: ExternalIdentity): Promise<Readonly<{ userId: string }>>;
  bindExternalIdentity(input: ExternalIdentity & { userId: string }): Promise<BoundAccount>;
};

export type AccountBindingResult =
  | { kind: 'existing'; userId: string }
  | { kind: 'created'; userId: string }
  | { kind: 'email-match-requires-link'; userId: string };

/** Never silently merges providers by email; an existing account must explicitly link the identity. */
export const resolveExternalAccount = async (
  store: AccountBindingStore,
  identity: ExternalIdentity,
  options: { allowEmailLink: boolean },
): Promise<AccountBindingResult> => {
  if (!identity.issuer.trim() || !identity.subject.trim()) throw new Error('External identity is incomplete');
  const existing = await store.findByExternalIdentity(identity);
  if (existing) return { kind: 'existing', userId: existing.userId };

  if (identity.email && identity.emailVerified) {
    const emailMatch = await store.findByVerifiedEmail(identity.email.trim().toLowerCase());
    if (emailMatch) {
      if (!options.allowEmailLink) return { kind: 'email-match-requires-link', userId: emailMatch.userId };
      const bound = await store.bindExternalIdentity({ ...identity, userId: emailMatch.userId });
      return { kind: 'existing', userId: bound.userId };
    }
  }

  const created = await store.createUser(identity);
  await store.bindExternalIdentity({ ...identity, userId: created.userId });
  return { kind: 'created', userId: created.userId };
};