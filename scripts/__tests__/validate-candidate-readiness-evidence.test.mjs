import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseConvexNetworkRegressionEvidence,
  parseJsonEvidence,
  validateCandidateReadinessEvidence,
} from '../validate-candidate-readiness-evidence.mjs';

const validEvidence = () => ({
  schemaVersion: 1,
  candidate: { id: 'profile-read-candidate-2026-08-21', environment: 'non-production' },
  reconciliation: { completed: true, sourceCount: 12, targetCount: 12, failedCount: 0, unexplainedDifferences: 0 },
  assets: { completed: true, sourceCount: 3, targetCount: 3, failedCount: 0, hashesMatched: true },
  checkpoints: { completed: true, resumable: true, failedCount: 0, lastCheckpoint: 'cursor-12' },
  client: { completed: true, environment: 'non-production', failedCount: 0, directConvexRequests: 0 },
  network: {
    observed: true,
    environment: 'non-production',
    productionActions: 0,
    requests: [
      { url: 'http://127.0.0.1:3000/api/profiles/example' },
      { url: 'http://candidate.internal.test/api/profiles/example' },
    ],
  },
});

test('accepts complete non-production evidence with no Convex or production requests', () => {
  const result = validateCandidateReadinessEvidence(validEvidence());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.checks, {
    reconciliation: true,
    assets: true,
    checkpoints: true,
    client: true,
    network: true,
  });
});

test('fails closed when a required reconciliation condition is absent or nonzero', () => {
  const missing = validEvidence();
  delete missing.reconciliation;
  const missingResult = validateCandidateReadinessEvidence(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.failures.some((failure) => failure.includes('reconciliation evidence is required')));

  const divergent = validEvidence();
  divergent.reconciliation.unexplainedDifferences = 1;
  const divergentResult = validateCandidateReadinessEvidence(divergent);
  assert.equal(divergentResult.ok, false);
  assert.ok(divergentResult.failures.some((failure) => failure.includes('unexplainedDifferences')));
});

test('fails closed for mismatched assets, incomplete checkpoints, and direct client Convex traffic', () => {
  const evidence = validEvidence();
  evidence.assets.targetCount = 2;
  evidence.checkpoints.resumable = false;
  evidence.client.directConvexRequests = 1;

  const result = validateCandidateReadinessEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes('assets source and target counts')));
  assert.ok(result.failures.some((failure) => failure.includes('checkpoints.resumable')));
  assert.ok(result.failures.some((failure) => failure.includes('client.directConvexRequests')));
});

test('parser rejects recorded Convex and production network requests without making requests', () => {
  const evidence = validEvidence().network;
  evidence.requests.push(
    { url: 'https://blue-sky-123.convex.cloud/api/query' },
    { url: 'https://iclawstore.com/api/profiles/example' },
  );
  evidence.productionActions = 1;

  const result = parseConvexNetworkRegressionEvidence(evidence);
  assert.equal(result.ok, false);
  assert.equal(result.summary.convexRequests, 1);
  assert.equal(result.summary.productionRequests, 1);
  assert.ok(result.failures.some((failure) => failure.includes('Convex requests')));
  assert.ok(result.failures.some((failure) => failure.includes('production requests')));
  assert.ok(result.failures.some((failure) => failure.includes('productionActions')));
});

test('JSON parsing rejects malformed or non-object input', () => {
  assert.deepEqual(parseJsonEvidence('{'), { ok: false, error: 'Evidence is not valid JSON.' });
  assert.deepEqual(parseJsonEvidence('[]'), { ok: false, error: 'Evidence root must be a JSON object.' });
});