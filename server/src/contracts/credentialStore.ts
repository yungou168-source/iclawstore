import type { CredentialLease } from './modelProvider.js';

export type EncryptedCredentialEnvelope = {
  algorithm: string;
  keyVersion: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
};

export type CredentialMetadata = {
  id: string;
  ownerUserId: string;
  providerKey: string;
  label: string;
  fingerprint: string;
  version: number;
  keyVersion: string;
  status: 'active' | 'revoked';
  validationStatus: 'unvalidated' | 'valid' | 'invalid';
  validatedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export type SaveEncryptedCredentialInput = {
  id: string;
  ownerUserId: string;
  providerKey: string;
  label: string;
  fingerprint: string;
  version: number;
  envelope: EncryptedCredentialEnvelope;
};

export type CredentialStore = Readonly<{
  saveEncrypted: (input: SaveEncryptedCredentialInput) => Promise<CredentialMetadata>;
  metadata: (credentialId: string, ownerUserId: string) => Promise<CredentialMetadata | null>;
  metadataForProvider: (ownerUserId: string, providerKey: string) => Promise<CredentialMetadata | null>;
  lease: (credentialId: string, ownerUserId: string) => Promise<CredentialLease | null>;
  rotate: (
    credentialId: string,
    ownerUserId: string,
    version: number,
    envelope: EncryptedCredentialEnvelope,
    fingerprint: string,
  ) => Promise<CredentialMetadata>;
  rewrap: (
    credentialId: string,
    ownerUserId: string,
    expectedCredentialVersion: number,
    expectedKeyVersion: string,
    envelope: EncryptedCredentialEnvelope,
  ) => Promise<boolean>;
  markValidation: (
    credentialId: string,
    ownerUserId: string,
    status: 'valid' | 'invalid',
  ) => Promise<boolean>;
  revoke: (credentialId: string, ownerUserId: string) => Promise<boolean>;
}>;