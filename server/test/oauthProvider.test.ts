import { describe, expect, it } from 'vitest';
import { createAuthorizationUrl, oauthProviderConfigFromEnvironment } from '../src/services/oauthProvider.js';
import { resolveExternalAccount, type AccountBindingStore } from '../src/services/accountBinding.js';

describe('candidate OAuth provider boundary', () => {
  it('requires explicit provider lifecycle configuration and builds S256 authorization requests', () => {
    const config = oauthProviderConfigFromEnvironment({
      AUTH_ISSUER: 'https://issuer.example/',
      AUTH_CLIENT_ID: 'candidate-client',
      AUTH_AUTHORIZATION_ENDPOINT: 'https://issuer.example/authorize',
      AUTH_TOKEN_ENDPOINT: 'https://issuer.example/token',
      AUTH_JWKS_URI: 'https://issuer.example/jwks',
      AUTH_AUDIENCE: 'candidate-api',
      AUTH_REDIRECT_URI: 'https://candidate.example/auth/callback',
    });
    expect(config?.issuer).toBe('https://issuer.example');
    expect(config?.scopes).toEqual(['openid', 'profile', 'email']);
    const url = new URL(createAuthorizationUrl(config!, {
      transactionId: 'tx', state: 'state', nonce: 'nonce', codeVerifier: 'verifier',
    }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).not.toBe('verifier');
  });
});

describe('candidate external account binding', () => {
  const store = (emailMatch: string | null = null): AccountBindingStore & { bound: string[] } => ({
    bound: [],
    async findByExternalIdentity() { return null; },
    async findByVerifiedEmail() { return emailMatch ? { userId: emailMatch } : null; },
    async createUser() { return { userId: 'created' }; },
    async bindExternalIdentity(input) { this.bound.push(input.userId); return { userId: input.userId, issuer: input.issuer, subject: input.subject }; },
  });

  it('does not silently merge a verified email with an existing account', async () => {
    const result = await resolveExternalAccount(store('existing'), {
      issuer: 'https://issuer.example', subject: 'sub', email: 'USER@example.com', emailVerified: true,
    }, { allowEmailLink: false });
    expect(result).toEqual({ kind: 'email-match-requires-link', userId: 'existing' });
  });

  it('creates and binds a new external identity', async () => {
    const binding = store();
    const result = await resolveExternalAccount(binding, {
      issuer: 'https://issuer.example', subject: 'sub',
    }, { allowEmailLink: false });
    expect(result).toEqual({ kind: 'created', userId: 'created' });
    expect(binding.bound).toEqual(['created']);
  });
});