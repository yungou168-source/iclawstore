import { describe, expect, it } from 'bun:test';
import { runProfileAvatarAssetConsumerProcess } from '../src/profileAvatarAssetConsumerProcess.js';
import { runProfileMigrationPreflightProcess } from '../src/profileMigrationPreflightProcess.js';
import { runProfileReconciliationProcess } from '../src/profileReconciliationProcess.js';

describe('Profile migration process entrypoints', () => {
  it('are import-safe and expose explicit runners', () => {
    expect(runProfileMigrationPreflightProcess).toBeInstanceOf(Function);
    expect(runProfileAvatarAssetConsumerProcess).toBeInstanceOf(Function);
    expect(runProfileReconciliationProcess).toBeInstanceOf(Function);
  });
});