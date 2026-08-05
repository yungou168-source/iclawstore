import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';

export type CredentialKeyring = Readonly<{
  activeVersion: string;
  encryptionKeys: ReadonlyMap<string, Uint8Array>;
  fingerprintKey: Uint8Array;
}>;

type SerializedKeyring = {
  activeVersion?: unknown;
  keys?: unknown;
  fingerprintKey?: unknown;
};

const VERSION = /^[A-Za-z0-9._-]{1,32}$/;

function readKey(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string') throw new Error(`${field} must be a base64 string`);
  const decoded = Buffer.from(value, 'base64');
  try {
    if (decoded.length !== 32 || decoded.toString('base64') !== value) {
      throw new Error(`${field} must contain exactly 32 base64-encoded bytes`);
    }
    return Uint8Array.from(decoded);
  } finally {
    decoded.fill(0);
  }
}

function readRestrictedFile(path: string): string {
  const directory = lstatSync(dirname(path));
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('Credential keyring directory must be a regular directory');
  }
  if ((directory.mode & 0o777) !== 0o700) throw new Error('Credential keyring directory mode must be 700');
  if (directory.uid !== process.getuid?.()) {
    throw new Error('Credential keyring directory must be owned by the runtime user');
  }

  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = fstatSync(descriptor);
    if (!file.isFile()) throw new Error('Credential keyring must be a regular file');
    if ((file.mode & 0o777) !== 0o600) throw new Error('Credential keyring mode must be 600');
    if (file.uid !== process.getuid?.()) {
      throw new Error('Credential keyring must be owned by the runtime user');
    }
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function loadCredentialKeyring(path: string): CredentialKeyring {
  const serialized = JSON.parse(readRestrictedFile(path)) as SerializedKeyring;
  if (typeof serialized.activeVersion !== 'string' || !VERSION.test(serialized.activeVersion)) {
    throw new Error('Credential keyring activeVersion is invalid');
  }
  if (!serialized.keys || typeof serialized.keys !== 'object' || Array.isArray(serialized.keys)) {
    throw new Error('Credential keyring keys must be an object');
  }

  const encryptionKeys = new Map<string, Uint8Array>();
  let fingerprintKey: Uint8Array | undefined;
  try {
    for (const [version, value] of Object.entries(serialized.keys)) {
      if (!VERSION.test(version)) throw new Error('Credential keyring contains an invalid version');
      encryptionKeys.set(version, readKey(value, `keys.${version}`));
    }
    if (!encryptionKeys.has(serialized.activeVersion)) {
      throw new Error('Credential keyring activeVersion is not present in keys');
    }

    fingerprintKey = readKey(serialized.fingerprintKey, 'fingerprintKey');
    if ([...encryptionKeys.values()].some((key) => timingSafeEqual(key, fingerprintKey!))) {
      throw new Error('Credential fingerprint key must be independent from encryption keys');
    }

    return Object.freeze({
      activeVersion: serialized.activeVersion,
      encryptionKeys,
      fingerprintKey,
    });
  } catch (error) {
    fingerprintKey?.fill(0);
    for (const key of encryptionKeys.values()) key.fill(0);
    throw error;
  }
}