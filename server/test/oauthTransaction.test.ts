import { describe, expect, it } from 'vitest';
import { createOAuthTransaction, consumeOAuthCallback, type OAuthTransaction, type OAuthTransactionStore } from '../src/services/oauthTransaction.js';
import { createSessionEstablishmentService } from '../src/services/sessionEstablishment.js';

const fakeStore = (): OAuthTransactionStore & { rows: Map<string, OAuthTransaction> } => {
  const rows = new Map<string, OAuthTransaction>();
  return {
    rows,
    async insert(row) { rows.set(row.id, row); },
    async find(id) { return rows.get(id) ?? null; },
    async consume(id, consumedAt) {
      const row = rows.get(id);
      if (!row || row.consumedAt) return null;
      row.consumedAt = consumedAt;
      return row;
    },
    async saveCallbackResult(id, result) {
      const row = rows.get(id);
      if (!row) throw new Error('missing');
      row.callbackResult = result;
    },
  };
};

describe('candidate OAuth transaction boundary', () => {
  it('stores only digests and rejects a second callback before result is saved', async () => {
    const store = fakeStore();
    const expiresAt = new Date('2099-01-01T00:00:00Z');
    const tx = await createOAuthTransaction(store, {
      redirectUri: 'https://client.test/callback', clientId: 'candidate', expiresAt,
      random: (() => { const values = ['tx', 'state', 'nonce', 'verifier']; return () => values.shift()!; })(),
    });
    const row = store.rows.get('tx')!;
    expect(row.stateHash).not.toBe(tx.state);
    expect(row.nonceHash).not.toBe(tx.nonce);
    expect(row.verifierHash).not.toBe(tx.codeVerifier);
    await consumeOAuthCallback(store, { transactionId: 'tx', code: 'code', state: tx.state, nonce: tx.nonce, codeVerifier: tx.codeVerifier }, new Date('2026-01-01'));
    await expect(consumeOAuthCallback(store, { transactionId: 'tx', code: 'code', state: tx.state, nonce: tx.nonce, codeVerifier: tx.codeVerifier }, new Date('2026-01-01'))).rejects.toThrow('already consumed');
  });

  it('rejects expired and mismatched state', async () => {
    const store = fakeStore();
    const tx = await createOAuthTransaction(store, { redirectUri: 'x', clientId: 'c', expiresAt: new Date('2099-01-01') , random: (() => { const values = ['tx', 's', 'n', 'v']; return () => values.shift()!; })() });
    await expect(consumeOAuthCallback(store, { transactionId: tx.transactionId, code: 'code', state: tx.state, nonce: tx.nonce, codeVerifier: tx.codeVerifier }, new Date('2100-01-02'))).rejects.toThrow('expired');
  });

  it('makes completed callback establishment idempotent', async () => {
    const store = fakeStore();
    const tx = await createOAuthTransaction(store, { redirectUri: 'x', clientId: 'c', expiresAt: new Date('2099-01-01'), random: (() => { const values = ['tx', 's', 'n', 'v']; return () => values.shift()!; })() });
    let exchanges = 0;
    const service = createSessionEstablishmentService(store, { async exchange() { exchanges += 1; return { userId: 'u', issuer: 'i', subject: 's', expiresAt: new Date('2099-01-01') }; } }, { async create() { return { sessionId: 'session-1' }; } });
    const input = { transactionId: tx.transactionId, code: 'code', state: tx.state, nonce: tx.nonce, codeVerifier: tx.codeVerifier };
    expect(await service.establish(input, new Date('2026-01-01'))).toEqual({ sessionId: 'session-1', userId: 'u' });
    expect(await service.establish(input, new Date('2026-01-01'))).toEqual({ sessionId: 'session-1', userId: 'u' });
    expect(exchanges).toBe(1);
  });
});