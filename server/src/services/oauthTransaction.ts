import { createHash, randomBytes } from 'node:crypto';

export type OAuthTransaction = {
  id: string;
  stateHash: string;
  nonceHash: string;
  verifierHash: string;
  redirectUri: string;
  clientId: string;
  expiresAt: Date;
  consumedAt?: Date;
  callbackResult?: OAuthCallbackResult;
};

export type OAuthCallbackResult = { sessionId: string; userId: string };

export type OAuthTransactionStore = {
  insert(transaction: OAuthTransaction): Promise<void>;
  find(id: string): Promise<OAuthTransaction | null>;
  consume(id: string, consumedAt: Date): Promise<OAuthTransaction | null>;
  saveCallbackResult(id: string, result: OAuthCallbackResult): Promise<void>;
};

export type OAuthTransactionValues = {
  transactionId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  expiresAt: Date;
};

export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const createOAuthTransaction = async (
  store: OAuthTransactionStore,
  input: Omit<OAuthTransactionValues, 'transactionId' | 'state' | 'nonce' | 'codeVerifier' | 'expiresAt'> & {
    transactionId?: string;
    expiresAt: Date;
    random?: () => string;
  },
): Promise<OAuthTransactionValues> => {
  const random = input.random ?? (() => randomBytes(32).toString('base64url'));
  const values: OAuthTransactionValues = {
    transactionId: input.transactionId ?? random(),
    state: random(),
    nonce: random(),
    codeVerifier: random(),
    redirectUri: input.redirectUri,
    clientId: input.clientId,
    expiresAt: input.expiresAt,
  };
  if (values.expiresAt.getTime() <= Date.now()) throw new Error('OAuth transaction expired');
  await store.insert({
    id: values.transactionId,
    stateHash: sha256(values.state),
    nonceHash: sha256(values.nonce),
    verifierHash: sha256(values.codeVerifier),
    redirectUri: values.redirectUri,
    clientId: values.clientId,
    expiresAt: values.expiresAt,
  });
  return values;
};

export type OAuthCallbackInput = {
  transactionId: string;
  code: string;
  state: string;
  nonce: string;
  codeVerifier: string;
};

/** Atomically consumes state/nonce/verifier; a second callback can only replay its saved result. */
export const consumeOAuthCallback = async (
  store: OAuthTransactionStore,
  input: OAuthCallbackInput,
  now = new Date(),
): Promise<OAuthTransaction | OAuthCallbackResult> => {
  const transaction = await store.find(input.transactionId);
  if (!transaction) throw new Error('OAuth transaction not found');
  if (transaction.callbackResult) return transaction.callbackResult;
  if (transaction.expiresAt <= now) throw new Error('OAuth transaction expired');
  if (transaction.stateHash !== sha256(input.state)) throw new Error('OAuth state mismatch');
  if (transaction.nonceHash !== sha256(input.nonce)) throw new Error('OAuth nonce mismatch');
  if (transaction.verifierHash !== sha256(input.codeVerifier)) throw new Error('OAuth PKCE verifier mismatch');
  const consumed = await store.consume(input.transactionId, now);
  if (!consumed) {
    const replay = await store.find(input.transactionId);
    if (replay?.callbackResult) return replay.callbackResult;
    throw new Error('OAuth transaction already consumed');
  }
  return consumed;
};