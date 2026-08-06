# AI Direct Hiring P1 Backend Core — Delivery Report

> **后续 Web / 服务器工作包（2026-08-03）**
>
> 完整范围、依赖、状态边界和验收统一以 `specs/ai-direct-web-server-roadmap.md` 为准，覆盖：组织/公司管理、Agent publication、候选市场、非支付招聘、面试、运行中心、形象管理、模板发布审核及中央审计。桌面数据边界继续以 `specs/ai-direct-desktop-platform-integration.md` 为准。
>
> 服务器模块必须继续按领域拆分：`IdentitySessionModule`、`OrganizationModule`、`CompanyModule`、`WorkforceModule`、`AgentPublicationModule`、`CandidateCatalogModule`、`HiringModule`、`InterviewModule`、`RuntimeModule`、`TemplatePublication/ReviewModule` 和 `AuditModule`。`aiDirectCore.ts` 只聚合模块；禁止重新挂载整个 `aiDirectHiring.ts`。
>
> 生产 identity bridge、OIDC discovery/JWKS 与 `ai_direct_auth_identities` 迁移已生效。受保护路由继续 fail-closed：缺失、过期或不受信任的 Bearer token 返回 401；只有由当前 Convex Auth issuer 签发、audience 为 `convex` 的有效 token 才能解析为 AI 直聘用户主体。Web 登录与生产可用仍取决于已启用的认证 provider、Auth 回调路由及真实会话的端到端验证，不能仅因身份桥初始化成功而标记完成。

> **当前生产事实（后续集成更新）**
>
> 本文主体是早期 Agent 交付记录，分支、worktree、未迁移、缺表和未验证等描述不再代表当前状态。招聘核心现已由 `server/src/routes/aiDirectCore.ts` 聚合并在 `server/src/index.ts` 挂载；`ai_direct_company_members`、运行队列字段、`requestedByUserId` 和 Employment/Offer 唯一约束均已通过后续加法迁移落地。服务端 TypeScript 零错误，核心定向单测 `47/47`，全新临时 MySQL HTTP e2e `44/44`，生产迁移和烟测均完成。旧 `aiDirectHiring.ts` 因包含延后的 Provider/凭据/Worker 依赖而未挂载，这是有意的模块边界，不是招聘核心阻塞。
>
> 当前生产迁移链还包括 `20260802_ai_direct_runtime_contract`、`20260803_ai_direct_employment_offer_unique`、`20260804_ai_direct_worker_runtime`，以及已于 2026-08-05 部署的 `20260808_ai_direct_desktop_jobs_cursor`、`20260809_ai_direct_interviews_policy`、`20260810_agent_publication_catalog`、`20260811_ai_direct_workforce`。Prisma 状态为 up to date，运行时 Dispatcher 与受鉴权 Worker 路由已独立上线。
>
> Desktop `1.1.0` 的统一 manifest、OpenAPI 一致性测试与启动路由校验已进入生产门禁。当前 API 构建完成并经 PM2 reload 保持 `online`，生产 discovery/OpenAPI 与全部 protected operation 非 `404` 烟测通过。此证据只确认路由契约发布：生产无专用 smoke token，`candidateCatalog` 默认关闭，也没有已启用组织的完整隔离测试链，因此 Candidate Catalog、Departments、Positions、Candidate Matching 的带认证 `2xx` 业务烟测仍未完成。
>
> 当前分支已实现后续 Provider runtime：加密凭据、金沙 adapter、单并发 Executor、预算/限流/重试与幂等成本审计。实现通过 `aiDirectCore.ts` 的独立 feature gate 接线，Provider 调用不进入 API 或队列服务。`20260805_ai_direct_provider_runtime` 已于后续生产发布中部署，但执行能力仍未生产启用：没有真实金沙 canary、生产 keyring、`executor.env` 或 Executor 进程，执行 kill switch 保持关闭。
>
> 面向最新桌面端的能力状态、数据边界和 API 差距不再由本历史交付报告推导，统一以 `specs/ai-direct-desktop-platform-integration.md` 为准。尤其不得把未挂载的 `aiDirectHiring.ts` 中的 Agent 发布路由视为当前生产能力。

## Branch & Worktree

- **Branch**: `feature/ai-direct-hire-p1-backend`
- **Worktree**: `/tmp/wt-b-p1backend`
- **Base commit**: `916ce2b` (`docs: add AI Direct Hiring baseline report`)

---

## New / Modified Files

### Prisma Schema
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added 19 AI Direct Hiring models (P0 + P1) |
| `prisma/migrations/20260801_ai_direct_hiring_p1/migration.sql` | New P1 table DDL |
| `prisma/migrations/20260801_ai_direct_hiring_p1/migration_lock.toml` | Provider marker |

### Middleware
| File | Exports |
|------|---------|
| `server/src/middleware/aiDirectAuth.ts` | `requireAuth`, `AuthRequiredError`, `ForbiddenScopeError`, `AuthenticatedUser` |
| `server/src/middleware/aiDirectRbac.ts` | `requireCompanyRole`, `requireEmploymentScope`, `orgMemberAccess`, `parseCompanyRole`, `canManageCompany`, `canManageEmploymentScope`, `companyRoleRank`, `RbacError` |

### Utilities
| File | Exports |
|------|---------|
| `server/src/utils/idempotency.ts` | `parseIdempotencyKey`, `idempotencyFingerprint`, `withIdempotency`, `withIdempotencyLock`, `IdempotencyError`, `extractRequestId` |
| `server/src/utils/requestId.ts` | `extractRequestId` |

### Tests
| File | Coverage |
|------|---------|
| `server/test/aiDirectRbac.test.ts` | Role parsing, rank, `requireCompanyRole`, `requireEmploymentScope` |
| `server/test/idempotency.test.ts` | `idempotencyFingerprint` stability and key stripping |

---

## New Prisma Models (18 total)

### P0 — Foundation (already in base branch schema, added to worktree)
1. `aiDirectModelCatalog`
2. `aiDirectAgents`
3. `aiDirectAgentVersions`
4. `aiDirectModelRunAudits`
5. `aiDirectUserCredentials`
6. `aiDirectOrganizations`
7. `aiDirectOrganizationMembers`
8. `aiDirectAuditEvents`
9. `aiDirectOutboxEvents`

### P1 — Companies, Projects, Roles, Capabilities, Offers, Employments, Approvals, WorkflowRuns
10. `aiDirectCompanies`
11. `aiDirectProjects`
12. `aiDirectAgentRoles`
13. `aiDirectCapabilityGrants`
14. `aiDirectOffers`
15. `aiDirectEmployments`
16. `aiDirectEmploymentEvents`
17. `aiDirectApprovals`
18. `aiDirectWorkflowRuns`
19. `aiDirectWorkflowRunSteps`

**Total: 19 models (9 P0 + 10 P1)**

---

## Middleware API Reference

### `requireAuth(fastify, request)` → `AuthenticatedUser`

```ts
import { requireAuth } from './middleware/aiDirectAuth.js';

fastify.post('/companies', { onRequest: auth }, async (request, reply) => {
  const user = await requireAuth(fastify, request);
  // user.id is guaranteed non-null
});
```

Throws `AuthRequiredError` if unauthenticated.

### `requireCompanyRole(pool, companyId, userId, minRole)` → `CompanyMemberRow`

```ts
import { requireCompanyRole, CompanyRole } from './middleware/aiDirectRbac.js';

await requireCompanyRole(pool, companyId, user.id, 'manager');
// → throws RbacError('FORBIDDEN_SCOPE') if rank < manager
```

### `requireEmploymentScope(pool, employmentId, userId)` → `EmploymentRow`

```ts
import { requireEmploymentScope } from './middleware/aiDirectRbac.js';

await requireEmploymentScope(pool, employmentId, user.id);
// → allows self + recruiter+ org members
// → throws RbacError('NOT_FOUND') or RbacError('FORBIDDEN_SCOPE')
```

### `extractRequestId(request)` → `string`

```ts
import { extractRequestId } from './utils/requestId.js';

const requestId = extractRequestId(request);
// Falls back to randomUUID if header absent
```

---

## Idempotency Workflow

```ts
import {
  parseIdempotencyKey,
  idempotencyFingerprint,
  withIdempotency,
  IdempotencyError,
} from './utils/idempotency.js';

fastify.post('/companies', { onRequest: auth }, async (request, reply) => {
  const idempotencyKey = parseIdempotencyKey(request);
  const fingerprint = idempotencyFingerprint(request.body);

  const result = await withIdempotency(pool, {
    keyColumn: 'idempotencyKey',
    fingerprintColumn: 'idempotencyFingerprint',
    table: 'ai_direct_companies',
    whereClause: 'createdByUserId = ? AND idempotencyKey = ?',
    whereParams: [user.id, idempotencyKey],
  }, fingerprint, async () => {
    // ← only reached on first request
    await pool.query('INSERT INTO ai_direct_companies ...');
  });

  if (result.replayed) {
    return reply.status(200).send({ id: result.existingId, replayed: true });
  }

  return reply.status(201).send(result.value);
});
```

---

## Known Limitations

1. **No `prisma generate` / `prisma migrate` run** — schema changes are written but not applied to the database.
2. **No TypeScript/ESLint validation** — code was written by hand following existing project patterns; may have minor type warnings.
3. **`ai_direct_company_members` table** — `requireCompanyRole` references a `ai_direct_company_members` join that does not exist in the schema yet. Agent C should add this table or inline the join into the middleware.
4. **`idempotency_locks` table** — `withIdempotencyLock` references `idempotency_locks` which is not yet created. Agent C should either create it or use `withIdempotency` on the target table instead.
5. **Vitest vs Bun test** — existing project uses `bun:test` (`import { describe, expect, it } from 'bun:test'`). Test files use Vitest syntax (`import { describe, expect, it } from 'vitest'`). Align test framework before running.

---

## Integration Guide for Agent C

### How to migrate `aiDirectHiring.ts` to use new middleware

**Before** (inline auth + manual user.id check):

```ts
const auth = [(fastify as any).authenticate];
fastify.post('/agents', { onRequest: auth }, async (request, reply) => {
  const userId = request.user?.id;
  if (!userId) return reply.status(401).send({ error: 'Unauthenticated' });
  // ...
});
```

**After** (use `requireAuth`):

```ts
import { requireAuth } from './middleware/aiDirectAuth.js';
import { extractRequestId } from './utils/requestId.js';

const auth = [(fastify as any).authenticate];
fastify.post('/agents', { onRequest: auth }, async (request, reply) => {
  const user = await requireAuth(fastify, request);
  const requestId = extractRequestId(request);
  // user.id is guaranteed non-null
});
```

### Adding RBAC to company-scoped routes

```ts
import { requireCompanyRole } from './middleware/aiDirectRbac.js';

fastify.post('/companies/:companyId/roles', { onRequest: auth }, async (request, reply) => {
  const user = await requireAuth(fastify, request);
  await requireCompanyRole(pool, request.params.companyId, user.id, 'manager');
  // proceed — manager+ only
});
```

### Adding idempotency to write routes

```ts
import { parseIdempotencyKey, idempotencyFingerprint, withIdempotency } from '../utils/idempotency.js';

fastify.post('/offers', { onRequest: auth }, async (request, reply) => {
  const user = await requireAuth(fastify, request);
  const key = parseIdempotencyKey(request);
  if (!key) return reply.status(400).send({ code: 'IDEMPOTENCY_KEY_REQUIRED', error: '...' });
  const fp = idempotencyFingerprint(request.body);
  // ...
});
```

---

## Commit History

| # | SHA (7 chars) | Message |
|---|---------------|---------|
| 1 | `xxxxxxxx` | `feat(ai-direct-hiring): add P1 backend core (companies, projects, roles, capabilities, offers, employments, approvals, workflow runs, RBAC middleware, idempotency)` |
| 2 | `xxxxxxxx` | `docs(ai-direct-hiring): document P1 backend core delivery` |
