import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { EncryptedCredentialEnvelope } from '../contracts/credentialStore.js';
import type { CredentialKeyring } from './credentialKeyring.js';

export type CredentialCipherContext = Readonly<{
  credentialId: string;
  ownerUserId: string;
  providerKey: string;
  credentialVersion: number;
}>;

const ALGORITHM = 'aes-256-gcm';

function additionalData(context: CredentialCipherContext, keyVersion: string): Buffer {
  if (!Number.isSafeInteger(context.credentialVersion) || context.credentialVersion < 1) {
    throw new Error('Credential content version is invalid');
  }
  return Buffer.from(
    JSON.stringify([
      'ai-direct-credential-v1',
      context.credentialId,
      context.ownerUserId,
      context.providerKey,
      context.credentialVersion,
      keyVersion,
    ]),
    'utf8',
  );
}

function encryptionKey(keyring: CredentialKeyring, version: string): Uint8Array {
  const key = keyring.encryptionKeys.get(version);
  if (!key) throw new Error(`Credential key version is unavailable: ${version}`);
  return key;
}

export function fingerprintCredential(keyring: CredentialKeyring, secret: Uint8Array): string {
  return createHmac('sha256', keyring.fingerprintKey).update(secret).digest('hex');
}

export function encryptCredential(
  keyring: CredentialKeyring,
  context: CredentialCipherContext,
  secret: Uint8Array,
): EncryptedCredentialEnvelope {
  const keyVersion = keyring.activeVersion;
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(keyring, keyVersion), nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(additionalData(context, keyVersion));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return {
    algorithm: ALGORITHM,
    keyVersion,
    ciphertext: new Uint8Array(ciphertext),
    nonce: new Uint8Array(nonce),
    authenticationTag: new Uint8Array(authenticationTag),
  };
}

export function decryptCredential(
  keyring: CredentialKeyring,
  context: CredentialCipherContext,
  envelope: EncryptedCredentialEnvelope,
): Uint8Array {
  if (envelope.algorithm !== ALGORITHM) throw new Error('Credential encryption algorithm is unsupported');
  if (envelope.nonce.byteLength !== 12 || envelope.authenticationTag.byteLength !== 16) {
    throw new Error('Credential envelope shape is invalid');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(keyring, envelope.keyVersion),
    envelope.nonce,
    { authTagLength: 16 },
  );
  decipher.setAAD(additionalData(context, envelope.keyVersion));
  decipher.setAuthTag(envelope.authenticationTag);
  const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  try {
    return Uint8Array.from(plaintext);
  } finally {
    plaintext.fill(0);
  }
}