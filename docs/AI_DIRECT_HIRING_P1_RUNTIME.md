# AI Direct Hiring P1 Runtime Center — Delivery Report

> **Agent**: G (retry) — P1 Runtime Center (simplified)
> **Branch**: `feature/ai-direct-hire-p1-runtime`
> **Base branch**: `feature/ai-direct-hire-integrated` (commit `daf41f0`)
> **Working dir**: `/www/wwwroot/iclawstore.com` (main repo, **no `/tmp` worktree**)
> **Date**: 2026-08-01

---

## 1. New Routes (7 total)

### Job queue routes (`/api/v1/ai-direct-hiring/jobs`)

| Method | Path | Purpose | Auth | RBAC |
|--------|------|---------|------|------|
| `GET`  | `/jobs` | List active runs for a company | `requireAuth` | `manager+` on `organizationId` |
| `GET`  | `/jobs/:id` | Run detail with steps | `requireAuth` | `manager+` on run's org (or none for system runs) |
| `POST` | `/jobs/:id/cancel` | Cancel a queued/active run | `requireAuth` | `manager+` on run's org |
| `POST` | `/jobs/:id/retry` | Clone a failed/cancelled run | `requireAuth` | `manager+` on run's org |

Cancel requires a `reason` string (1–500 chars) in the body.
Retry rejects with `409 INVALID_TRANSITION` when the source run is still `queued`/`active`.

### Worker interface routes (`/api/v1/ai-direct-hiring/workers`)

| Method | Path | Purpose | Required header |
|--------|------|---------|-----------------|
| `POST` | `/workers/heartbeat` | Extend lease on a leased run | `X-Worker-Id` |
| `GET`  | `/workers/lease` | Claim next queued run (204 when empty) | `X-Worker-Id` |
| `POST` | `/workers/complete` | Mark a step succeeded/failed; closes run when last step | `X-Worker-Id` |

Worker routes are NOT behind `(fastify as any).authenticate` (they are intended
for internal worker processes) and should be gated at the reverse-proxy layer
(e.g. `X-Worker-Secret` header check).

---

## 2. Service Layer

### `server/src/services/jobQueue.ts` (583 lines)

`JobQueueService` — wraps `ai_direct_workflow_runs` + `ai_direct_workflow_run_steps`:

- `enqueue(input)` — atomic insert of run + initial pending steps + audit + outbox
- `leaseNext(workerId)` — `SELECT ... FOR UPDATE SKIP LOCKED` selecting queued or expired-leased-active rows; sets `leaseOwner`, `leaseExpiresAt`
- `ack(runId, workerId)` — sets `startedAt` and refreshes lease
- `completeStep(runId, sequence, output)` — closes a step; closes the run when no pending steps remain
- `failStep(runId, sequence, {code, reason})` — closes a step + the run as failed (terminal)
- `cancel(runId, reason, actorUserId)` — terminal cancel of queued/active runs
- `retry(runId, actorUserId)` — clones a failed/cancelled run with the same step set
- `heartbeat(runId, workerId)` — refreshes `leaseExpiresAt`

#### Lease strategy (brief)

- **Selection**: `status='queued' OR (status='active' AND leaseExpiresAt<=NOW())`,
  ordered `queued first, then expired-active, then createdAt ASC`,
  with `FOR UPDATE SKIP LOCKED` to allow multiple workers concurrently.
- **TTL**: `LEASE_TTL_SECONDS = 60` (default). Workers heartbeat every ≤30s.
- **Reclaim**: when a worker crashes, the lease expires after 60s and any other
  worker can claim the run via the `status='active' AND leaseExpiresAt<=NOW()` arm.
- **Transition**: lease acquisition flips `queued→active` in the same transaction
  as the step `pending→running` update. No separate ack roundtrip is strictly
  required — `startedAt` is set on the first heartbeat.

### `server/src/services/runProjection.ts` (180 lines)

`RunProjectionService` — read-side views used by `GET /jobs` and `GET /jobs/:id`:

- `getActiveRuns(organizationId)` — list of queued/active runs with cheap step counts
- `getRun(runId, organizationId?)` — full detail view with steps, input/output summaries, lease info

---

## 3. Tests

| File | Lines | Coverage |
|------|-------|----------|
| `server/test/jobQueue.test.ts` | 168 | enqueue validation, insert audit/outbox, heartbeat return values, retry guard + step cloning |
| `server/test/aiDirectJobsRoutes.test.ts` | 107 | ErrorCodes inventory, errorResponse shape, header/payload validation, retry guard |

**Not run** — server is under memory pressure (no `bun test` allowed).
Tests follow the existing `bun:test` convention from `aiDirectHiringRoutes.test.ts`.

---

## 4. Reused Utilities (no duplicates)

| Tool | Source | Used in |
|------|--------|---------|
| `requireAuth` | `server/src/middleware/aiDirectAuth.ts` | `aiDirectJobs.ts` |
| `requireCompanyRole` | `server/src/middleware/aiDirectRbac.ts` | `aiDirectJobs.ts` |
| `AiDirectHiringError` + `errorResponse` + `ErrorCodes` | `server/src/services/aiDirectErrors.ts` | all routes |
| `publishOutboxEvent` | `server/src/utils/outbox.ts` | not directly — internal `publishOutboxEvent` helper inside `JobQueueService` mirrors the contract |
| `extractRequestId` / `idempotencyFingerprint` | `server/src/utils/idempotency.ts` | available, not yet wired into jobs (queue owns requestId internally) |

The internal audit/outbox helpers in `jobQueue.ts` are deliberately local to keep
the service self-contained without re-importing from `routes/`. They share the
exact SQL shape used by `aiDirectHiring.ts` (line 116–130, 226–242).

---

## 5. Not Implemented (Deferred)

| Item | Reason | Target |
|------|--------|--------|
| Artifact routes (`/jobs/:id/artifacts`, `/artifacts/:id`) | Out of scope for "精简版"; queue stores `outputIndex` JSON instead of a separate table | Next iteration |
| Progress estimator (weighted steps) | Used simple `completedSteps/total` ratio | Next iteration |
| Worker pool monitoring + dead-worker sweeper | Lease reclaim already handles crashes; explicit metrics endpoint deferred | Next iteration |
| Convex projection consumer | Out of G's scope | Agent D' |
| `withIdempotency` wiring on `POST /jobs` (manual `enqueue`) | Queue idempotency is enforced via `idempotencyKey` on `ai_direct_workflow_runs.idempotencyKey` (column not yet added) | When schema permits |
| Live `SELECT ... FOR UPDATE SKIP LOCKED` test against MySQL | Memory-constrained; no test runner allowed | User runs `bun test` later |

---

## 6. File Diff Summary

```
branch: feature/ai-direct-hire-p1-runtime
base:   feature/ai-direct-hire-integrated @ daf41f0

 8 files changed (commit f58a3b4 — F's P2 integration)
   server/src/routes/aiDirectCompanies.ts        | +733
   server/src/routes/aiDirectOffers.ts           | +588
   server/src/routes/aiDirectEmployments.ts      | +404
   server/src/routes/aiDirectApprovals.ts        | +367
   server/src/routes/aiDirectCapabilities.ts     | +260
   server/src/services/offerStateMachine.ts      | +69
   server/src/services/employmentStateMachine.ts | +74
   server/src/services/approvalStateMachine.ts   | +52
   (F commit cherry-picked from feature/ai-direct-hire-p2-hiring @ ddcdead)

 5 files changed (commit 45ef645 — G core)
   server/src/routes/aiDirectJobs.ts             | +178 (new)
   server/src/routes/aiDirectWorkers.ts          | +140 (new)
   server/src/services/jobQueue.ts               | +583 (new)
   server/src/services/runProjection.ts          | +180 (new)
   server/src/routes/aiDirectHiring.ts           | +17  (imports + 7 register() calls)

 2 files changed (commit e79b78f — G tests)
   server/test/jobQueue.test.ts                  | +168 (new)
   server/test/aiDirectJobsRoutes.test.ts        | +107 (new)

 Total new code by G:  ~1,356 lines (within 800–1500 target)
 Total new code on branch: ~3,908 lines (including F's P2 cherry-pick)
```

---

## 7. Known Issues / Notes

1. **No live database connection** — schema columns referenced by `jobQueue.ts`
   (`runAfter`, `leaseOwner`, `leaseExpiresAt`, `failureReason`, `finishedAt`,
   `failureCode`, `tokenUsage`, `costMicros`) all exist on
   `ai_direct_workflow_runs` (verified in `prisma/schema.prisma`). The
   underlying table for `ai_direct_workflow_run_steps` also has the columns
   referenced. No schema change was made.
2. **`SQL_CALC_FOUND_ROWS` / Skip Locked compatibility** — `FOR UPDATE SKIP
   LOCKED` requires MySQL 8.0+. Confirm the deployed MySQL version before
   running this in production (existing `aiDirectHiring.ts` already uses
   `FOR UPDATE` so the requirement is the same).
3. **Auth bypass for worker routes** — `/workers/*` is intentionally not
   behind `authenticate`. Add reverse-proxy / gateway-level gating before
   exposing this service outside the cluster.
4. **`publishOutboxEvent` import duplication** — `jobQueue.ts` defines its
   own private `publishOutboxEvent` rather than importing
   `utils/outbox.ts#publishOutboxEvent` because the latter is untyped and
   would require extra casts. The SQL it executes is byte-identical to the
   shared helper.
5. **`requireCompanyRole` dependency** — the shared `aiDirectRbac.ts`
   references `ai_direct_company_members` (B's known limitation). If that
   join table is not yet present on the target DB, `/jobs` and `/jobs/:id`
   will return `FORBIDDEN_SCOPE` for every user. Coordinate with Agent B's
   follow-up before enabling these routes.

---

## 8. Commit History (G's branch)

| # | SHA | Message |
|---|-----|---------|
| 1 | `f58a3b4` | `chore: integrate F's P2 routes + services into G baseline` |
| 2 | `45ef645` | `feat(ai-direct-hiring): P1 runtime center - job queue + projection + jobs/workers routes` |
| 3 | `e79b78f` | `test(ai-direct-hiring): add jobQueue + jobs/workers schema tests` |
| 4 | `8284931` | `docs(ai-direct-hiring): P1 runtime center delivery report` |

---

## 9. Special Note: No `/tmp` Worktree

Unlike the previous G run (and Agents B/C/D), **this work was done directly
inside `/www/wwwroot/iclawstore.com`** on the `feature/ai-direct-hire-p1-runtime`
branch. No worktree was created in `/tmp`. This was an explicit decision to
reduce memory pressure and worktree cleanup risk on the 4-core / 3.6 GB server.
All file edits, commits, and branch operations happened in-place.