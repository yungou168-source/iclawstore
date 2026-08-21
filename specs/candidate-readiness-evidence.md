---
summary: "Candidate readiness evidence JSON contract for offline Convex-regression validation."
read_when:
  - collecting candidate migration readiness evidence
  - running a non-production Convex network regression
  - changing the candidate evidence validator
---

# Candidate readiness evidence contract

`scripts/validate-candidate-readiness-evidence.mjs` is an **offline parser and validator**. It reads a JSON document from standard input or an explicitly supplied local file. It does not open network connections, invoke deployment tooling, write data, or perform production actions.

A result is ready only when every required section is present and valid. Unknown or incomplete evidence does not grant readiness.

```json
{
  "schemaVersion": 1,
  "candidate": { "id": "candidate-name", "environment": "non-production" },
  "reconciliation": {
    "completed": true,
    "sourceCount": 12,
    "targetCount": 12,
    "failedCount": 0,
    "unexplainedDifferences": 0
  },
  "assets": {
    "completed": true,
    "sourceCount": 3,
    "targetCount": 3,
    "failedCount": 0,
    "hashesMatched": true
  },
  "checkpoints": {
    "completed": true,
    "resumable": true,
    "failedCount": 0,
    "lastCheckpoint": "cursor-12"
  },
  "client": {
    "completed": true,
    "environment": "non-production",
    "failedCount": 0,
    "directConvexRequests": 0
  },
  "network": {
    "observed": true,
    "environment": "non-production",
    "productionActions": 0,
    "requests": [{ "url": "http://candidate.internal.test/api/example" }]
  }
}
```

The validator fails closed unless reconciliation and asset source/target counts match, all failed/unexplained counts are zero, asset hashes match, a non-empty resumable checkpoint exists, and client evidence records no direct Convex request.

The network parser evaluates only the supplied recorded `requests` URLs. It rejects malformed URLs, Convex hosts, production-marked hosts (including `iclawstore.com`), non-production environment omissions, and any nonzero `productionActions`. It does not replay, probe, or otherwise contact those URLs.

## Evidence collection boundary

The current candidate components provide inputs but do not generate a readiness record automatically:

- Soul repository/import runs must provide source/target counts, a fixed source watermark, reconciliation differences and checkpoint state.
- Soul asset-copy runs must provide source/target file counts, failed/pending counts, and byte/SHA-256 comparison results. A copied metadata row without the source byte proof is insufficient.
- Fixed Web, desktop and CLI runs must provide their own request trace and assertion summary; `directConvexRequests` must be counted from recorded traffic, not set optimistically.
- The runtime lease/checkpoint store only provides durable state. It cannot prove a domain job was processed until the worker writes a domain-specific result and reconciliation evidence.

No repository component, this validator, or a passing build may populate these fields as a substitute for an isolated candidate execution.


```bash
node scripts/validate-candidate-readiness-evidence.mjs < candidate-evidence.json
node scripts/validate-candidate-readiness-evidence.mjs candidate-evidence.json
node --test scripts/__tests__/validate-candidate-readiness-evidence.test.mjs
```

A passing result is readiness evidence only; it is not authorization for migration, traffic changes, deployment, or any production action.

## Bootstrap command

`server` exposes `bun run bootstrap:candidate`, backed by `scripts/bootstrap-candidate.mjs`. It is an orchestration tool, not a deployment shortcut. It requires all of the following explicit inputs:

- `SOUL_CANDIDATE_ADMIN_DATABASE_URL`: non-production MySQL administrator URL;
- `CANDIDATE_RELEASE_DIR` and `CANDIDATE_RELEASE_START_COMMAND`: the fixed candidate release and its local start command;
- `CLAWHUB_CANDIDATE_SITE`: a non-production HTTP(S) origin;
- `CANDIDATE_NETWORK_EVIDENCE`: a previously captured HTTP/WebSocket blocking record.

The command creates a random database/user, writes a synthetic Soul JSONL snapshot, asset bytes, Profile/Publisher fixture manifest, and restricted `candidate.env` under `artifacts/candidate/<run-id>/`. It then applies schema migrations, starts the release detached, runs `full-import`, `incremental-sync`, `asset-copy`, and `reconcile`, and invokes this validator.

It fails closed when `DATABASE_URL` is present, any supplied URL contains a production marker, the release path is absent, or network evidence is missing. It does not infer blocked traffic from HTTP 200 and does not create production users, domains, or credentials. Generated reports are evidence artifacts and never authorize a production switch.
