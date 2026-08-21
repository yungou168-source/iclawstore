import { describe, expect, it } from 'bun:test';
import {
  profileProjectionBatchSize,
  requireProfileProjectionMigrationAuthorization,
} from '../src/domains/profile-projections/profileProjectionMigrationRuntime.js';

describe('profile projection migration authorization', () => {
  it('fails closed unless explicitly authorized for candidate', () => {
    expect(() => requireProfileProjectionMigrationAuthorization({})).toThrow(
      'PROFILE_PROJECTION_MIGRATION_EXECUTION=1 is required',
    );
    expect(() => requireProfileProjectionMigrationAuthorization({
      PROFILE_PROJECTION_MIGRATION_EXECUTION: '1',
      PROFILE_PROJECTION_MIGRATION_ENV: 'production',
      PROFILE_PROJECTION_MIGRATION_APPROVAL_REF: 'review-1',
    })).toThrow('PROFILE_PROJECTION_MIGRATION_ENV must be candidate');
  });

  it('requires an approval reference and bounds page size', () => {
    expect(() => requireProfileProjectionMigrationAuthorization({
      PROFILE_PROJECTION_MIGRATION_EXECUTION: '1',
      PROFILE_PROJECTION_MIGRATION_ENV: 'candidate',
    })).toThrow('PROFILE_PROJECTION_MIGRATION_APPROVAL_REF is required');
    expect(profileProjectionBatchSize(undefined)).toBe(100);
    expect(() => profileProjectionBatchSize('251')).toThrow('PROFILE_PROJECTION_MIGRATION_BATCH_SIZE');
  });
});