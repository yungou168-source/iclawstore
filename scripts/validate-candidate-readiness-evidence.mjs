#!/usr/bin/env node
/**
 * Offline-only candidate-readiness evidence validator.
 *
 * Input is JSON from stdin or a local file path. This script never opens a
 * socket, invokes a deployment command, or changes candidate/production data.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECTIONS = ['reconciliation', 'assets', 'checkpoints', 'client', 'network'];
const PRODUCTION_MARKERS = [
  /(^|[.-])(prod|production)([.-]|$)/i,
  /iclawstore\.com/i,
];
const CONVEX_MARKERS = [/\.convex\.cloud(?::\d+)?$/i, /(^|[.-])convex([.-]|$)/i];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

export const parseJsonEvidence = (text) => {
  if (typeof text !== 'string') return { ok: false, error: 'Evidence must be JSON text.' };
  try {
    const evidence = JSON.parse(text);
    return isObject(evidence)
      ? { ok: true, evidence }
      : { ok: false, error: 'Evidence root must be a JSON object.' };
  } catch {
    return { ok: false, error: 'Evidence is not valid JSON.' };
  }
};

const invalidUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** Parses recorded browser/client request events; it does not make requests. */
export const parseConvexNetworkRegressionEvidence = (network) => {
  const failures = [];
  if (!isObject(network)) return { ok: false, failures: ['network evidence is missing.'], summary: {} };
  if (network.observed !== true) failures.push('network.observed must be true.');
  if (network.environment !== 'non-production') failures.push('network.environment must be "non-production".');
  if (!Array.isArray(network.requests)) failures.push('network.requests must be an array.');
  if (!isNonNegativeInteger(network.productionActions) || network.productionActions !== 0) {
    failures.push('network.productionActions must be 0.');
  }

  const summary = { totalRequests: 0, convexRequests: 0, productionRequests: 0, malformedRequests: 0 };
  if (Array.isArray(network.requests)) {
    summary.totalRequests = network.requests.length;
    network.requests.forEach((request, index) => {
      if (!isObject(request) || typeof request.url !== 'string') {
        summary.malformedRequests += 1;
        failures.push(`network.requests[${index}] must contain a URL.`);
        return;
      }
      const url = invalidUrl(request.url);
      if (!url) {
        summary.malformedRequests += 1;
        failures.push(`network.requests[${index}].url is invalid.`);
        return;
      }
      const host = url.hostname;
      if (CONVEX_MARKERS.some((pattern) => pattern.test(host))) summary.convexRequests += 1;
      if (PRODUCTION_MARKERS.some((pattern) => pattern.test(host))) summary.productionRequests += 1;
    });
  }
  if (summary.convexRequests !== 0) failures.push('network evidence contains Convex requests.');
  if (summary.productionRequests !== 0) failures.push('network evidence contains production requests.');
  return { ok: failures.length === 0, failures, summary };
};

const validateBalancedCounts = (section, name, failures) => {
  if (!isObject(section)) {
    failures.push(`${name} evidence is missing.`);
    return;
  }
  if (section.completed !== true) failures.push(`${name}.completed must be true.`);
  for (const key of ['sourceCount', 'targetCount', 'failedCount']) {
    if (!isNonNegativeInteger(section[key])) failures.push(`${name}.${key} must be a non-negative integer.`);
  }
  if (section.sourceCount !== section.targetCount) failures.push(`${name} source and target counts must match.`);
  if (section.failedCount !== 0) failures.push(`${name}.failedCount must be 0.`);
};

export const validateCandidateReadinessEvidence = (evidence) => {
  const failures = [];
  if (!isObject(evidence)) return { ok: false, failures: ['Evidence root must be an object.'], checks: {} };
  if (evidence.schemaVersion !== 1) failures.push('schemaVersion must be 1.');
  if (!isObject(evidence.candidate) || typeof evidence.candidate.id !== 'string' || evidence.candidate.id.trim() === '') {
    failures.push('candidate.id must be a non-empty string.');
  }
  if (!isObject(evidence.candidate) || evidence.candidate.environment !== 'non-production') {
    failures.push('candidate.environment must be "non-production".');
  }
  for (const name of REQUIRED_SECTIONS) if (!(name in evidence)) failures.push(`${name} evidence is required.`);

  validateBalancedCounts(evidence.reconciliation, 'reconciliation', failures);
  if (isObject(evidence.reconciliation)) {
    if (!isNonNegativeInteger(evidence.reconciliation.unexplainedDifferences) || evidence.reconciliation.unexplainedDifferences !== 0) {
      failures.push('reconciliation.unexplainedDifferences must be 0.');
    }
  }

  validateBalancedCounts(evidence.assets, 'assets', failures);
  if (isObject(evidence.assets) && evidence.assets.hashesMatched !== true) failures.push('assets.hashesMatched must be true.');

  if (!isObject(evidence.checkpoints)) {
    failures.push('checkpoints evidence is missing.');
  } else {
    if (evidence.checkpoints.completed !== true) failures.push('checkpoints.completed must be true.');
    if (evidence.checkpoints.resumable !== true) failures.push('checkpoints.resumable must be true.');
    if (!isNonNegativeInteger(evidence.checkpoints.failedCount) || evidence.checkpoints.failedCount !== 0) {
      failures.push('checkpoints.failedCount must be 0.');
    }
    if (typeof evidence.checkpoints.lastCheckpoint !== 'string' || evidence.checkpoints.lastCheckpoint.trim() === '') {
      failures.push('checkpoints.lastCheckpoint must be a non-empty string.');
    }
  }

  if (!isObject(evidence.client)) {
    failures.push('client evidence is missing.');
  } else {
    if (evidence.client.completed !== true) failures.push('client.completed must be true.');
    if (evidence.client.environment !== 'non-production') failures.push('client.environment must be "non-production".');
    if (!isNonNegativeInteger(evidence.client.failedCount) || evidence.client.failedCount !== 0) failures.push('client.failedCount must be 0.');
    if (!isNonNegativeInteger(evidence.client.directConvexRequests) || evidence.client.directConvexRequests !== 0) {
      failures.push('client.directConvexRequests must be 0.');
    }
  }

  const network = parseConvexNetworkRegressionEvidence(evidence.network);
  failures.push(...network.failures);
  return {
    ok: failures.length === 0,
    failures,
    checks: {
      reconciliation: isObject(evidence.reconciliation) && evidence.reconciliation.completed === true && evidence.reconciliation.sourceCount === evidence.reconciliation.targetCount && evidence.reconciliation.failedCount === 0 && evidence.reconciliation.unexplainedDifferences === 0,
      assets: isObject(evidence.assets) && evidence.assets.completed === true && evidence.assets.sourceCount === evidence.assets.targetCount && evidence.assets.failedCount === 0 && evidence.assets.hashesMatched === true,
      checkpoints: isObject(evidence.checkpoints) && evidence.checkpoints.completed === true && evidence.checkpoints.resumable === true && evidence.checkpoints.failedCount === 0 && typeof evidence.checkpoints.lastCheckpoint === 'string' && evidence.checkpoints.lastCheckpoint.trim() !== '',
      client: isObject(evidence.client) && evidence.client.completed === true && evidence.client.environment === 'non-production' && evidence.client.failedCount === 0 && evidence.client.directConvexRequests === 0,
      network: network.ok,
    },
    network: network.summary,
  };
};

const main = async () => {
  const input = process.argv[2]
    ? await readFile(process.argv[2], 'utf8')
    : await new Promise((resolve, reject) => {
      let text = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { text += chunk; });
      process.stdin.on('end', () => resolve(text));
      process.stdin.on('error', reject);
    });
  const parsed = parseJsonEvidence(input);
  const result = parsed.ok ? validateCandidateReadinessEvidence(parsed.evidence) : { ok: false, failures: [parsed.error] };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, failures: [error.message] }));
    process.exitCode = 1;
  });
}