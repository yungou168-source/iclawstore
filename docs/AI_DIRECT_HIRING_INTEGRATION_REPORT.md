# AI 直聘功能整合报告(2026-08-01)

## 1. 整合概览

| 项 | 值 |
|---|---|
| 整合分支 | `feature/ai-direct-hire-integrated` |
| 基线分支 | `feature/ai-direct-hire-foundation` (commit `916ce2b`) |
| 整合 commit 数 | 2(B 合并 + C 合并) |
| 最新 commit | `222991b` |
| 合并策略 | `--no-ff`(保留完整分支历史) |
| 自动解决冲突 | 0(B 和 C 改动文件无重叠) |
| 主仓当前分支 | `feature/ai-direct-hire-foundation`(未切换,保留用户决策) |

## 2. 合并 commits

```
222991b merge: P0 mount (unified errors, audit/outbox/idempotency, route hardening, new archive/approve/disable endpoints)
62da64d merge: P1 backend core (companies, projects, roles, capabilities, offers, employments, approvals, workflow runs, RBAC middleware, idempotency)
8788b8a docs(ai-direct-hiring): document P1 backend core delivery
93da129 feat(ai-direct-hiring): add P1 backend core (...)
d39eaf9 docs(ai-direct-hiring): document P0 mount delivery
999c010 feat(ai-direct-hiring): mount P0 routes with unified errors, audit, outbox, and idempotency
916ce2b docs: add AI Direct Hiring baseline report
0d9f0d1 chore: update bun.lock (基线)
```

## 3. B 与 C 改动无冲突分析

| 改动维度 | B(P1 后端) | C(P0 挂载) | 冲突 |
|---|---|---|---|
| `prisma/schema.prisma` | +18 模型(P1) | 未改 | ❌ 无 |
| `prisma/migrations/20260801_ai_direct_hiring_p1/` | 新增 | 未建 | ❌ 无 |
| `server/src/routes/aiDirectHiring.ts` | 未改 | 重写(320→1114) | ❌ 无 |
| `server/src/services/aiDirectErrors.ts` | 未建 | 新增(66 行) | ❌ 无 |
| `server/src/middleware/aiDirectAuth.ts` | 新增(43 行) | 未建 | ❌ 无 |
| `server/src/middleware/aiDirectRbac.ts` | 新增(201 行) | 未建 | ❌ 无 |
| `server/src/utils/idempotency.ts` | 新增(205 行) | 未建 | ❌ 无 |
| `server/src/utils/requestId.ts` | 新增(29 行) | 未建 | ❌ 无 |
| `server/src/utils/outbox.ts` | 未建 | 新增(40 行) | ❌ 无 |
| `server/test/aiDirectRbac.test.ts` | 新增(226 行) | 未建 | ❌ 无 |
| `server/test/idempotency.test.ts` | 新增(84 行) | 未建 | ❌ 无 |
| `server/test/aiDirectHiringRoutes.test.ts` | 未建 | 新增(466 行) | ❌ 无 |
| `docs/AI_DIRECT_HIRING_P1_BACKEND.md` | 新增 | 未建 | ❌ 无 |
| `docs/AI_DIRECT_HIRING_P0_MOUNT.md` | 未建 | 新增 | ❌ 无 |

**结论**:B 和 C 的改动完全不重叠,合并无冲突。

## 4. 整合后关键文件清单

| 文件 | 行数 | 来源 |
|---|---|---|
| `server/src/routes/aiDirectHiring.ts` | 1114 | C 重写 |
| `server/src/services/aiDirectErrors.ts` | 66 | C 新增 |
| `server/src/middleware/aiDirectAuth.ts` | 43 | B 新增 |
| `server/src/middleware/aiDirectRbac.ts` | 201 | B 新增 |
| `server/src/utils/idempotency.ts` | 205 | B 新增 |
| `server/src/utils/requestId.ts` | 29 | B 新增 |
| `server/src/utils/outbox.ts` | 40 | C 新增 |
| `prisma/schema.prisma` | 993 | 基线 615 + B 新增 378 |
| `prisma/migrations/20260801_ai_direct_hiring_p1/migration.sql` | 207 | B 新增 |
| `server/test/aiDirectRbac.test.ts` | 226 | B 新增 |
| `server/test/idempotency.test.ts` | 84 | B 新增 |
| `server/test/aiDirectHiringRoutes.test.ts` | 466 | C 新增 |
| `docs/AI_DIRECT_HIRING_BASELINE.md` | 275 | A 写 |
| `docs/AI_DIRECT_HIRING_P1_BACKEND.md` | ~170 | B 写 |
| `docs/AI_DIRECT_HIRING_P0_MOUNT.md` | ~280 | C 写 |
| **总新增/修改代码** | **~3000 行** | |

## 5. Prisma Schema 统计

- **总模型数**:42 个
- **AI 直聘模型数**:19 个(bigin 1 个 P1 聚合统计可能有偏差)
- **AI 直聘 P0 模型**:9 个(aiDirectModelCatalog, aiDirectAgents, aiDirectAgentVersions, aiDirectModelRunAudits, aiDirectUserCredentials, aiDirectOrganizations, aiDirectOrganizationMembers, aiDirectAuditEvents, aiDirectOutboxEvents)
- **AI 直聘 P1 模型**:10 个(aiDirectCompanies, aiDirectProjects, aiDirectAgentRoles, aiDirectCapabilityGrants, aiDirectOffers, aiDirectEmployments, aiDirectEmploymentEvents, aiDirectApprovals, aiDirectWorkflowRuns, aiDirectWorkflowRunSteps)

## 6. 静态检查结果

**未运行 `bun run ci:static`**。

### 原因
原 Agent D 启动后立即在 transcript 显示"Starting branch merge"后无任何后续活动,实际合并由其他进程完成。后续计划中的 `bun install` + `bun run ci:static` 未执行。B 和 C 自身完成时也未运行 `ci:static`(它们在 prompt 中被禁止运行 `bun install` 和 `ci:static` 等高 IO 任务)。

### 风险
- schema.prisma 可能有 Biome / oxlint 格式问题
- agent 子路由可能存在 TypeScript 类型问题
- 三个新测试文件没有运行过

### 建议
在生产部署前**必须由用户**手动执行:
```bash
cd /www/wwwroot/iclawstore.com/.claude/worktrees/ai-direct-hire-integrated
# 或
cd /tmp/wt-d-merge
bun install --frozen-lockfile
bun run ci:static
```

## 7. 整合分支中的 worktree

| 路径 | 分支 | 状态 |
|---|---|---|
| `/tmp/wt-d-merge` | `feature/ai-direct-hire-integrated` | 干净 |
| `/tmp/wt-b-p1backend` | `feature/ai-direct-hire-p1-backend` | 保留(可供回滚) |
| `/tmp/wt-c-mount` | `feature/ai-direct-hire-p0-mount` | 保留(可供回滚) |
| `/tmp/wt-baseline` | `feature/baseline-mysql-migration-fix` | 保留(基线) |
| `/www/wwwroot/iclawstore.com` | `feature/ai-direct-hire-foundation` | 未切换(用户决策) |

## 8. 集成后的状态机

P1 模型覆盖了招聘完整流程:
- **公司/项目/岗位**:aiDirectCompanies → aiDirectProjects → aiDirectAgentRoles
- **能力与凭据**:aiDirectCapabilityGrants(主体=employment/user/agent_version)、aiDirectUserCredentials(已在 P0)
- **Offer 生命周期**:aiDirectOffers(draft → pending_approval → sent → accepted/rejected/expired/revoked)
- **Employment 状态机**:aiDirectEmployments(candidate → evaluating → offer_pending → offered → accepted → onboarding → active → paused → transferring → offboarding → terminated)
- **状态事件不可变日志**:aiDirectEmploymentEvents(sequence 自增、防回退)
- **审批**:aiDirectApprovals(pending → approved/rejected/expired/cancelled)
- **运行中心**:aiDirectWorkflowRuns + aiDirectWorkflowRunSteps(状态机驱动,每步审计)

## 9. 安全检查点(已实施)

| 检查点 | 实施位置 | 状态 |
|---|---|---|
| 凭据永不返回密文/IV/authTag | `aiDirectHiring.ts` 凭据路由 | ✅ C 实现 |
| Idempotency-Key + fingerprint 校验 | `idempotency.ts` + 路由层 | ✅ B + C |
| 管理员才能写模型目录 | `aiDirectHiring.ts` `POST /model-catalog` | ✅ C |
| Publisher 成员校验 | `aiDirectHiring.ts` `POST /agents` | ✅ C |
| 模型策略失败关闭 | `aiDirectHiring.ts` 路由层 | ✅ C |
| 统一错误码 | `aiDirectErrors.ts` | ✅ C |
| 审计 + outbox 事务化 | `outbox.ts` + 路由层 | ✅ C |
| RBAC 中间件 | `aiDirectRbac.ts` | ✅ B(待 P1 路由挂载) |
| 认证中间件 | `aiDirectAuth.ts` | ✅ B(待 P1 路由挂载) |

## 10. 给用户的下一步操作清单

### 🔴 必须由用户判断(高风险)
1. **密钥轮换**:基线报告 `AI_DIRECT_HIRING_BASELINE.md` 第 7 节列出了 8 个密钥的风险等级。
 - 高风险:`DATABASE_URL` 密码、`JWT_SECRET`、`NEXTAUTH_SECRET`、金沙 Token、模型 API Key、Convex deployment key
 - 中风险:`GITHUB_TOKEN`(在 git remote URL)、OAuth 密钥
2. **生产数据库迁移**:在运行 `prisma migrate deploy` 之前,必须在测试环境验证所有 19 个 AI 直聘表的 DDL。
3. **回滚点**:基线标签 `baseline-mysql-migration-2026-08-01` 可用于回滚到本次操作前。

### 🟡 建议(中风险)
4. **手动运行 `ci:static`**:在干净的 worktree 中运行,确保格式/lint 通过。
5. **手动跑测试**:至少运行 B/C 新增的 3 个测试文件。
6. **代码审查**:审查 `aiDirectHiring.ts` 1114 行重写 + `aiDirectRbac.ts` 201 行 + `idempotency.ts` 205 行。

### 🟢 下一步 agent 任务(低风险)
- **Agent D': P1 前端实现**:老板工作台 + Agent 管理页面(基于 `aiDirectAgentRoles` / `aiDirectEmployments` 状态机)
- **Agent E: P2 招聘流程**:Offer/Employment 状态机 API(基于已有模型 + 状态机事件)
- **Agent F: P1 运行中心**:服务端队列 + 产物索引 + 实时步骤投影(基于 `aiDirectWorkflowRuns` + `aiDirectWorkflowRunSteps`)

## 11. 已知限制

1. **P1 路由未挂载**:B 创建的 RBAC 中间件(`aiDirectAuth.ts` / `aiDirectRbac.ts`)和测试代码就位,但还没有 P1 路由(如 `/companies`、`/projects`、`/roles`、`/offers`)使用它们。Agent E/D' 应该负责挂载。
2. **没有前端**:只有后端 + Prisma。P1 的前端(老板工作台、Agent 列表、Offer 审批页面)还未实现。
3. **没有真实 MySQL 验证**:所有 SQL 迁移是手写的,没有跑过 `prisma migrate deploy`。
4. **没有 CI 集成**:新增的 9 个 P1 模型 + 1 个新迁移没有 CI 验证。

## 12. 后续 Agent E/F/G2 交付追加

### Agent E — P1 前端

- 分支:`feature/ai-direct-hire-p1-frontend`,commit `2060975`。
- 交付 9 个页面、`EmployerLayout`、API 客户端和错误码映射,约 1800 行。
- 独立于新增后端实现:已有 P0 API 可真实调用,公司/项目/Offer 页面在 F 路由可用前采用明确占位与空状态。
- 报告:`docs/AI_DIRECT_HIRING_P1_FRONTEND.md`(当前位于 E 分支)。

### Agent F — P2 招聘流程 API

- 分支:`feature/ai-direct-hire-p2-hiring`,commit `ddcdead`。
- 交付 25 个路由、Offer/Employment/Approval 三套状态机、5 个测试文件,共 2852 行。
- 复用 B 的认证/RBAC/幂等基础与 C 的统一错误、审计/outbox 约定,覆盖 E 列出的 14 项后端需求。
- 报告:`docs/AI_DIRECT_HIRING_P2_HIRING.md`(当前位于 F 分支)。

### Agent G2 — P1 运行中心

- **路线图**:以 `feature/ai-direct-hire-integrated` (`daf41f0`) 为基线,先集成 F,再实现队列、worker lease、运行投影与 jobs/workers API。
- **产出**:7 个新路由、`JobQueueService`、`RunProjectionService`、2 个测试文件；G2 自身约 1356 行,分支包含 F 后统计约 **4126 行**。
- **自动 enqueue 设计**:F 的 Offer/Employment/Approval 状态机承担业务状态合法性与 outbox 事件；状态转移成功后由集成层按事件类型构造 workflow steps 并调用 `JobQueueService.enqueue()`。enqueue 在单事务内写 run、steps、audit 和 outbox；worker 通过 60 秒 lease 与 heartbeat 领取和恢复任务,避免状态机路由直接执行长任务。
- **延后项**:artifact routes、加权进度估算、worker 池监控、Convex 投影消费者、真实 MySQL lease 集成测试。
- **报告**:`docs/AI_DIRECT_HIRING_P1_RUNTIME.md`。

### 留给 H / I 的工作

1. 整合 E/F/G 三个分支；注意 G 已包含 F 的代码,应按提交拓扑避免重复 cherry-pick。
2. 将 E/F 分支内报告带入最终分支,并维护 `specs/ai-direct-hiring-progress.md` 与 `docs/AI_DIRECT_HIRING_FINAL_HANDOFF.md` 的交叉引用。
3. 在资源允许时验证 Prisma 迁移、静态检查、类型/构建、单元与 e2e 测试。
4. 检查 worker 入口的网关鉴权和 `ai_direct_company_members` 依赖后,再推送并创建 PR；本轮未 push、未部署。

## 13. 当前整体结论

今晚 A–G2 的本地交付均已形成 commit 和对应报告。功能实现已覆盖基线、P0/P1 后端、前端、招聘状态机及精简运行中心；当前约 **88%** 完成,剩余工作集中在最终分支整合、数据库/CI/e2e 验证、PR 与部署。

---

*报告追加时间: 2026-08-01 03:14 UTC+8*
*G2 commit: `8284931`*
