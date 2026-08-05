import { afterEach, describe, expect, it } from 'vitest';
import {
  desktopOAuthRedirectKind,
  desktopOAuthRedirectUris,
  requiredEnvironment,
} from './oauthEnvironment';

const originalRedirectUris = process.env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS;

afterEach(() => {
  if (originalRedirectUris === undefined) {
    delete process.env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS;
  } else {
    process.env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS = originalRedirectUris;
  }
});

describe('desktop OAuth environment', () => {
  it('requires HTTPS for public provider URLs', () => {
    process.env.TEST_DESKTOP_OAUTH_URL = 'http://example.com/oauth';
    expect(() => requiredEnvironment('TEST_DESKTOP_OAUTH_URL')).toThrow(
      'must use HTTPS outside local development',
    );
    delete process.env.TEST_DESKTOP_OAUTH_URL;
  });

  it.each([
    ['iclawstore://oauth/callback', 'custom'],
    ['http://127.0.0.1/callback', 'loopback'],
    ['http://[::1]/callback', 'loopback'],
  ] as const)('classifies %s as %s', (uri, kind) => {
    expect(desktopOAuthRedirectKind(uri)).toBe(kind);
  });

  it.each([
    'https://example.com/callback',
    'http://localhost/callback',
    'file:///tmp/callback',
    'javascript:alert(1)',
    'iclawstore://user:password@oauth/callback',
    'iclawstore://oauth/callback#fragment',
  ])('rejects unsafe redirect URI %s', (uri) => {
    expect(() => desktopOAuthRedirectKind(uri)).toThrow();
  });

  it('requires both fixed native callback forms and removes duplicates', () => {
    process.env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS = [
      'iclawstore://oauth/callback',
      'http://127.0.0.1/callback',
      'iclawstore://oauth/callback',
    ].join(',');

    expect(desktopOAuthRedirectUris()).toEqual([
      'iclawstore://oauth/callback',
      'http://127.0.0.1/callback',
    ]);
  });

  it('rejects a registration without loopback fallback', () => {
    process.env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS = 'iclawstore://oauth/callback';
    expect(() => desktopOAuthRedirectUris()).toThrow('must include one custom URI');
  });
});