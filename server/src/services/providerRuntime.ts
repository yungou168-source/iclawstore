import type { Pool } from 'mysql2/promise';
import type { CredentialStore } from '../contracts/credentialStore.js';
import type { CredentialKeyring } from './credentialKeyring.js';
import { loadCredentialKeyring } from './credentialKeyring.js';
import { createJinshaProvider } from './jinshaProvider.js';
import { createMysqlCredentialStore } from './mysqlCredentialStore.js';
import { createProviderRegistry, type ProviderRegistry } from './providerRegistry.js';

export type ProviderRuntime = Readonly<{
  credentialStore: CredentialStore;
  keyring: CredentialKeyring;
  providers: ProviderRegistry;
}>;

function enabled(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('AI_DIRECT_PROVIDER_RUNTIME_ENABLED must be true or false');
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required when provider runtime is enabled`);
  return value.trim();
}

function optionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

export function loadProviderRuntime(
  pool: Pool,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderRuntime | null {
  if (!enabled(environment.AI_DIRECT_PROVIDER_RUNTIME_ENABLED)) return null;

  const keyring = loadCredentialKeyring(required(
    environment.CREDENTIAL_KEYRING_PATH,
    'CREDENTIAL_KEYRING_PATH',
  ));
  try {
    const jinsha = createJinshaProvider({
      baseUrl: required(environment.JINSHA_BASE_URL, 'JINSHA_BASE_URL'),
      timeoutMs: optionalInteger(environment.JINSHA_TIMEOUT_MS, 'JINSHA_TIMEOUT_MS'),
      maxResponseBytes: optionalInteger(
        environment.JINSHA_MAX_RESPONSE_BYTES,
        'JINSHA_MAX_RESPONSE_BYTES',
      ),
    });
    return Object.freeze({
      credentialStore: createMysqlCredentialStore(pool, keyring),
      keyring,
      providers: createProviderRegistry([jinsha]),
    });
  } catch (error) {
    keyring.fingerprintKey.fill(0);
    for (const key of keyring.encryptionKeys.values()) key.fill(0);
    throw error;
  }
}

export function clearProviderRuntime(runtime: ProviderRuntime): void {
  runtime.keyring.fingerprintKey.fill(0);
  for (const key of runtime.keyring.encryptionKeys.values()) key.fill(0);
}