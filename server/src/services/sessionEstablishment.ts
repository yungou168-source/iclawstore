import {
  consumeOAuthCallback,
  type OAuthCallbackInput,
  type OAuthCallbackResult,
  type OAuthTransactionStore,
} from './oauthTransaction.js';

export type AuthorizationCodeExchange = {
  exchange(input: OAuthCallbackInput): Promise<{ userId: string; issuer: string; subject: string; expiresAt: Date }>;
};

export type SessionEstablishmentPort = {
  create(input: {
    userId: string;
    issuer: string;
    subject: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }>;
};

export type SessionEstablishmentService = {
  establish(input: OAuthCallbackInput, now?: Date): Promise<OAuthCallbackResult>;
};

export const createSessionEstablishmentService = (
  transactions: OAuthTransactionStore,
  exchange: AuthorizationCodeExchange,
  sessions: SessionEstablishmentPort,
): SessionEstablishmentService => {
  const inFlight = new Map<string, Promise<OAuthCallbackResult>>();
  const establish = async (input: OAuthCallbackInput, now = new Date()): Promise<OAuthCallbackResult> => {
    const pending = inFlight.get(input.transactionId);
    if (pending) return pending;
    const operation = (async () => {
      const consumed = await consumeOAuthCallback(transactions, input, now);
      if ('sessionId' in consumed) return consumed;
      const identity = await exchange.exchange(input);
      const created = await sessions.create(identity);
      const result = { sessionId: created.sessionId, userId: identity.userId };
      await transactions.saveCallbackResult(consumed.id, result);
      return result;
    })();
    inFlight.set(input.transactionId, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(input.transactionId);
    }
  };
  return { establish };
};