# AI Direct Hiring P1 Runtime Center — Delivery Report

> **Web 运行中心后续范围（2026-08-03）**
>
> Jobs 列表/详情/步骤、取消、终态重试、产物元数据、模型/Token/成本/延迟、失败恢复建议和 runtime metrics 页面，统一按 `specs/ai-direct-web-server-roadmap.md` 的“工作包 F”开发。中央运行审计与导出归“工作包 I”，不塞入 Jobs 路由。
>
> Provider Executor 当前未生产启用。Web 必须消费服务器 `runtimeCapabilities` 并显示“执行能力未启用”，不能根据迁移、表、路由或历史 Job 推断 Provider 可执行。即使执行关闭，历史、状态投影、失败、审计和产物元数据页面仍可独立交付。

> **Provider Executor current production boundary (2026-08-03 alignment)**
>
> The additive `20260805_ai_direct_provider_runtime` migration is deployed in production, but migration deployment is not Provider execution enablement. Production still has no `executor.env`, keyring, Executor process, or real Jinsha canary; `AI_DIRECT_PROVIDER_RUNTIME_ENABLED` and `PROVIDER_EXECUTION_ENABLED` remain off. The API, Dispatcher, and queue service do not perform Provider network calls. Any older statement below saying that `20260805` is pending is historical and no longer current.
>
> The desktop integration baseline is `specs/ai-direct-desktop-platform-integration.md`. Jobs list/detail/cancel/retry and artifact metadata exist, but Jobs are not yet included in `server/openapi/desktop-client-v1.yaml`; remote artifact download remains deferred until a versioned desktop DTO and authorization contract are published.

> **当前实现与生产事实（2026-08-02 更新）**
>
> P1 运行闭环已完成并上线：`20260802_ai_direct_runtime_contract` 与 `20260804_ai_direct_worker_runtime` 已部署；`workflowTemplateRegistry` 将 outbox 事件映射为稳定步骤模板，独立 `iclawstore-runtime-dispatcher` 通过短事务和 `FOR UPDATE SKIP LOCKED` 原子创建 workflow run/steps 并发布事件。API 与 Dispatcher 使用相互独立、仅限业务库 DML 的 MySQL 账号，Dispatcher 连接池上限为 2；PM2 进程已启动、稳定并执行 `pm2 save`。上线时生产 outbox 与 workflow run 均为空，没有历史事件需要补消费。
>
> 生产数据库连接和 JWT secret 不再写入仓库：API、Dispatcher 和 MySQL 管理凭据分别保存在 `/home/ubuntu/.config/iclawstore/` 的独立文件中，目录权限为 `700`、文件和 PM2 dump 权限为 `600`。API JWT secret 与 MySQL 根密码已轮换，历史根凭据已验证失效；`NODE_ENV=production` 且缺少 `JWT_SECRET` 时 API 必须拒绝启动。Dispatcher 不接收 JWT secret。
>
> Worker 路由已由 `aiDirectCoreRoutes` 挂载并采用组织级哈希 token 鉴权，不再信任可伪造的单独 `X-Worker-Id`。lease 领取、heartbeat、过期回收和 complete/fail 均校验组织与当前 lease owner；artifact 元数据与步骤结果在同一事务写入，路径唯一性使用 `(runId, storagePathHash)`。Jobs 与 runtime 管理路由使用用户 JWT 和独立组织 RBAC；organizationless run 仅请求者可见。
>
> 发布门禁已通过：服务端 TypeScript 零错误，核心单测 `62/62`；三个全新临时 MySQL 门禁分别覆盖招聘 HTTP、dispatcher 事务/幂等和 worker lease/artifact。迁移前备份为 `/home/ubuntu/backups/iclawstore/production-migrations/iclawstore-before-worker-runtime-20260801T203832Z.sql.gz`，权限受限且 gzip 完整性校验通过。本地 `/health` 为 `200`；本地与公网招聘、Obsidian、Jobs、runtime、worker 未认证访问均为 `401`；公网首页为 `200`，公网 `/health` 因反向代理未暴露仍为 `404`。
>
> **Provider Executor 当前分支状态（2026-08-02）**
>
> 加密凭据运行时、金沙 OpenAI-compatible adapter、显式 Provider execution descriptor、独立单并发 Executor、heartbeat/lease 续期、超时中止、RPM/TPM token bucket、稳定失败分类/退避、预算预检、catalog 定价成本计算和幂等模型审计已实现。Executor 通过受鉴权 Worker HTTP API lease/heartbeat/complete，不直接提交队列状态；Provider 调用不在 API、Dispatcher 或 `jobQueue.ts` 中执行。步骤完成后 run 返回 `queued`，下一步骤重新按 Worker capability 领取，避免 Provider Executor 越权消费普通生命周期步骤。
>
> 当前分支定向与临时 MySQL 测试累计 `34/34` 通过：Executor/成本/HTTP 串联 `6/6`、queue `7/7`、凭据运行时 `10/10`、凭据路由 `2/2`、Provider adapter `6/6`、Worker runtime MySQL `3/3`。本机 HTTP 用例覆盖 Worker API 与金沙 Chat Completions 两侧边界，并确认密钥不进入完成回报；MySQL 用例在全新临时库应用 7 段迁移链后验证 capability-safe 步骤推进、lease 回收与 artifact，临时库已删除。最终 TypeScript 复核因 `MemAvailable` 低于 700 MB 门禁而未启动，这不是编译失败。
>
> **这不是生产启用状态。** `20260805_ai_direct_provider_runtime` 尚未部署；仓库外 `executor.env` 与真实 keyring 尚未创建；没有生产 Executor 进程，也没有真实金沙凭据 canary。`AI_DIRECT_PROVIDER_RUNTIME_ENABLED` 与 `PROVIDER_EXECUTION_ENABLED` 默认关闭，未通过低成本 canary 前不得启用。`ecosystem.config.cjs` 仅在受限的 `/home/ubuntu/.config/iclawstore/executor.env` 存在时才包含单实例 Executor 定义。
>
> 下方正文是早期交付记录，与本区块冲突时以本区块和实时行为为准。

> **Agent**: G (retry) — P1 Runtime Center (simplified)
> **Branch**: `feature/ai-direct-hire-p1-runtime`
> **Base branch**: `feature/ai-direct-hire-integrated` (commit `daf41f0`)
> **Working dir**: `/www/wwwroot/iclawstore.com` (main repo, **no `/tmp` worktree**)
> **Date**: 2026-08-01

---

## 1. New Routes (7 total)

### Job queue routes (`/api/v1/ai-direct-hiring/jobs`)

| Method | Path               | Purpose                        | Auth          | RBAC                                              |
| ------ | ------------------ | ------------------------------ | ------------- | ------------------------------------------------- |
| `GET`  | `/jobs`            | List active runs for a company | `requireAuth` | `manager+` on `organizationId`                    |
| `GET`  | `/jobs/:id`        | Run detail with steps          | `requireAuth` | `manager+` on run's org (or none for system runs) |
| `POST` | `/jobs/:id/cancel` | Cancel a queued/active run     | `requireAuth` | `manager+` on run's org                           |
| `POST` | `/jobs/:id/retry`  | Clone a failed/cancelled run   | `requireAuth` | `manager+` on run's org                           |

Cancel requires a `reason` string (1–500 chars) in the body.
Retry rejects with `409 INVALID_TRANSITION` when the source run is still `queued`/`active`.

### Worker interface routes (`/api/v1/ai-direct-hiring/workers`)

| Method | Path                 | Purpose                                                 | Required header |
| ------ | -------------------- | ------------------------------------------------------- | --------------- |
| `POST` | `/workers/heartbeat` | Extend lease on a leased run                            | `X-Worker-Id`   |
| `GET`  | `/workers/lease`     | Claim next queued run (204 when empty)                  | `X-Worker-Id`   |
| `POST` | `/workers/complete`  | Mark a step succeeded/failed; closes run when last step | `X-Worker-Id`   |

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

| File                                     | Lines | Coverage                                                                                     |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `server/test/jobQueue.test.ts`           | 168   | enqueue validation, insert audit/outbox, heartbeat return values, retry guard + step cloning |
| `server/test/aiDirectJobsRoutes.test.ts` | 107   | ErrorCodes inventory, errorResponse shape, header/payload validation, retry guard            |

**Not run** — server is under memory pressure (no `bun test` allowed).
Tests follow the existing `bun:test` convention from `aiDirectHiringRoutes.test.ts`.

---

## 4. Reused Utilities (no duplicates)

| Tool                                                   | Source                                  | Used in                                                                                           |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `requireAuth`                                          | `server/src/middleware/aiDirectAuth.ts` | `aiDirectJobs.ts`                                                                                 |
| `requireCompanyRole`                                   | `server/src/middleware/aiDirectRbac.ts` | `aiDirectJobs.ts`                                                                                 |
| `AiDirectHiringError` + `errorResponse` + `ErrorCodes` | `server/src/services/aiDirectErrors.ts` | all routes                                                                                        |
| `publishOutboxEvent`                                   | `server/src/utils/outbox.ts`            | not directly — internal `publishOutboxEvent` helper inside `JobQueueService` mirrors the contract |
| `extractRequestId` / `idempotencyFingerprint`          | `server/src/utils/idempotency.ts`       | available, not yet wired into jobs (queue owns requestId internally)                              |

The internal audit/outbox helpers in `jobQueue.ts` are deliberately local to keep
the service self-contained without re-importing from `routes/`. They share the
exact SQL shape used by `aiDirectHiring.ts` (line 116–130, 226–242).

---

## 5. Not Implemented (Deferred)

| Item                                                        | Reason                                                                                                                | Target                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Artifact routes (`/jobs/:id/artifacts`, `/artifacts/:id`)   | Out of scope for "精简版"; queue stores `outputIndex` JSON instead of a separate table                                | Next iteration             |
| Progress estimator (weighted steps)                         | Used simple `completedSteps/total` ratio                                                                              | Next iteration             |
| Worker pool monitoring + dead-worker sweeper                | Lease reclaim already handles crashes; explicit metrics endpoint deferred                                             | Next iteration             |
| Convex projection consumer                                  | Out of G's scope                                                                                                      | Agent D'                   |
| `withIdempotency` wiring on `POST /jobs` (manual `enqueue`) | Queue idempotency is enforced via `idempotencyKey` on `ai_direct_workflow_runs.idempotencyKey` (column not yet added) | When schema permits        |
| Live `SELECT ... FOR UPDATE SKIP LOCKED` test against MySQL | Memory-constrained; no test runner allowed                                                                            | User runs `bun test` later |

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

| #   | SHA       | Message                                                                                    |
| --- | --------- | ------------------------------------------------------------------------------------------ |
| 1   | `f58a3b4` | `chore: integrate F's P2 routes + services into G baseline`                                |
| 2   | `45ef645` | `feat(ai-direct-hiring): P1 runtime center - job queue + projection + jobs/workers routes` |
| 3   | `e79b78f` | `test(ai-direct-hiring): add jobQueue + jobs/workers schema tests`                         |
| 4   | `8284931` | `docs(ai-direct-hiring): P1 runtime center delivery report`                                |

---

## 9. Special Note: No `/tmp` Worktree

Unlike the previous G run (and Agents B/C/D), **this work was done directly
inside `/www/wwwroot/iclawstore.com`** on the `feature/ai-direct-hire-p1-runtime`
branch. No worktree was created in `/tmp`. This was an explicit decision to
reduce memory pressure and worktree cleanup risk on the 4-core / 3.6 GB server.
All file edits, commits, and branch operations happened in-place.
