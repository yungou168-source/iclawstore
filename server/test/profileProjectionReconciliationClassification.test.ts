import { describe, expect, it } from 'bun:test';
import {
  classifyProfileProjectionDifference,
  unclassifiedProfileProjectionDifference,
} from '../src/domains/profile-projections/profileProjectionReconciliationClassification.js';

describe('profile projection reconciliation classification', () => {
  it('requires an allowed classification and an approval reference', () => {
    expect(classifyProfileProjectionDifference({
      classification: 'expected_retired_fixture',
      approvalRef: 'CAB-123',
    })).toEqual({ classification: 'expected_retired_fixture', approvalRef: 'CAB-123' });
    expect(() => classifyProfileProjectionDifference({
      classification: 'expected_retired_fixture',
      approvalRef: ' ',
    })).toThrow('approval reference');
  });

  it('keeps newly observed differences unclassified', () => {
    expect(unclassifiedProfileProjectionDifference({
      batchId: 'batch-1', legacyConvexId: 'skills:one', fieldName: 'record',
      differenceKind: 'missing', summary: 'target projection is absent',
    })).toMatchObject({ domain: 'profile_projections', classification: 'unclassified' });
  });
});