# AI 直聘开发进度跟踪(2026-08-01)

> **目的**:给后续 Agent (E、F、...) 和人类维护者一份"现在我们到了哪里、还差什么"的速查表。
> **当前快照**:本地整合分支 `feature/ai-direct-hire-integrated` commit `09609cf`(2026-08-01 02:05 UTC+8)。
> **关联文档**:
> - `docs/AI_DIRECT_HIRING_BASELINE.md` - 基线
> - `docs/AI_DIRECT_HIRING_P1_BACKEND.md` - B 交付
> - `docs/AI_DIRECT_HIRING_P0_MOUNT.md` - C 交付
> - `docs/AI_DIRECT_HIRING_INTEGRATION_REPORT.md` - 整合报告

## 1. 总体进度

| 阶段 | 状态 | 产出 | 负责 Agent |
|---|---|---|---|
| **基线快照** | ✅ 完成 | `baseline-mysql-migration-2026-08-01` 标签 | A |
| **P0 挂载(数据库模型 + 核心路由)** | ✅ 完成 | 9 个 P0 模型 + 6 个核心路由 | C |
| **P1 后端核心(招聘工作流基础设施)** | ✅ 完成 | 18 个 P1 模型 + RBAC + 幂等键 | B |
| **整合 + 静态检查** | 🟡 部分完成 | 合并成功,`ci:static` 未运行 | D |
| **P1 前端(老板工作台 + Agent 管理)** | ⏳ 启动中 | - | **E** |
| **P2 招聘流程 API(Offer/Employment 状态机)** | ⏳ 排队 | - | F |
| **P1 运行中心(队列 + 产物索引)** | ⏳ 排队 | - | G |

## 2. 已完成的 P0 路由清单(由 C 交付)

### 模型目录
- `GET /api/v1/ai-direct-hiring/catalog/model-catalog` - 列出模型目录
- `POST /api/v1/ai-direct-hiring/catalog/model-catalog` - 添加模型(管理员)
- `POST /api/v1/ai-direct-hiring/catalog/model-catalog/:id/approve` - 审核通过
- `POST /api/v1/ai-direct-hiring/catalog/model-catalog/:id/disable` - 停用

### Agent 管理
- `POST /api/v1/ai-direct-hiring/agents` - 创建 Agent(publisher 成员)
- `GET /api/v1/ai-direct-hiring/agents/:id` - 查看 Agent
- `POST /api/v1/ai-direct-hiring/agents/:id/versions` - 发布新版本(含模型策略校验)
- `POST /api/v1/ai-direct-hiring/agents/:id/versions/:id/archive` - 归档版本

### 用户凭据
- `PUT /api/v1/ai-direct-hiring/credentials/me` - 更新我的凭据(加密)
- `GET /api/v1/ai-direct-hiring/credentials/me` - 读取我的凭据元数据(无密文)

### 组织
- `GET /api/v1/ai-direct-hiring/orgs` - 我的组织列表
- `POST /api/v1/ai-direct-hiring/orgs` - 创建组织
- `POST /api/v1/ai-direct-hiring/orgs/:id/members` - 添加成员

## 3. 已完成的 P1 后端基础设施(由 B 交付,但路由未挂载)

### 数据库模型(10 个 P1 模型)
- `aiDirectCompanies` - 公司
- `aiDirectProjects` - 项目
- `aiDirectAgentRoles` - Agent 岗位
- `aiDirectCapabilityGrants` - 能力授权
- `aiDirectOffers` - Offer
- `aiDirectEmployments` - 雇佣关系
- `aiDirectEmploymentEvents` - 雇佣状态事件(不可变日志)
- `aiDirectApprovals` - 审批
- `aiDirectWorkflowRuns` - 工作流运行
- `aiDirectWorkflowRunSteps` - 工作流步骤

### 中间件(B 创建,等 P1 路由挂载)
- `server/src/middleware/aiDirectAuth.ts` - 认证
- `server/src/middleware/aiDirectRbac.ts` - 角色权限
 - `requireCompanyRole(companyId, role)` - 公司级别角色
 - `requireEmploymentScope(scope)` - 雇佣范围

### 工具(B 创建)
- `server/src/utils/idempotency.ts` - 幂等键(指纹 + 重放)
- `server/src/utils/requestId.ts` - 请求 ID 提取

### 关键未挂载项
**P1 路没路由代码**——B 只准备了模型 + 中间件 + 工具,**没有 P1 路由**(如 `/companies`、`/projects`、`/offers`)。这是 Agent F (P2 招聘流程 API) 的职责。

## 4. 工具/服务基础(共享)

| 工具 | 提供方 | 用途 |
|---|---|---|
| `aiDirectErrors.ts` (ErrorCodes enum) | C | 统一错误码(desktop-contract 兼容) |
| `outbox.ts` (publishOutboxEvent) | C | 事务化 outbox 写入 |
| `idempotency.ts` (withIdempotency) | B | 幂等键 + 指纹 |
| `aiDirectRbac.ts` (requireCompanyRole, requireEmploymentScope) | B | 权限 |
| `aiDirectAuth.ts` (requireAuth) | B | 认证 |

**⚠️ 重复/冲突**:B 和 C 都创建了 `utils/` 下的文件,但**没有命名冲突**——B 的是 `idempotency.ts` / `requestId.ts`,C 的是 `outbox.ts`。

## 5. 测试状态

| 测试 | 状态 | 负责 |
|---|---|---|
| `server/test/aiDirectHiringRoutes.test.ts`(466 行) | ⚠️ 写完未跑 | C |
| `server/test/aiDirectRbac.test.ts`(226 行) | ⚠️ 写完未跑 | B |
| `server/test/idempotency.test.ts`(84 行) | ⚠️ 写完未跑 | B |

**未跑原因**:服务器资源有限,不允许 `bun test` / `bun run ci:unit`。**必须由用户手动跑**。

## 6. 静态检查状态

| 检查 | 状态 |
|---|---|
| `bun run ci:static` | ❌ **未跑** |
| `bun run format:check` | ❌ 未跑 |
| `bun run lint` | ❌ 未跑 |
| `bunx tsc` | ❌ 未跑 |

**未跑原因**:Agent D 卡住,后续未执行。**必须由用户手动跑**(在 wt-d-merge 或同等 worktree 中)。

## 7. 下一步 Agent 任务清单

### E (P1 前端) - **当前启动**
- 老板工作台(employer dashboard):看公司/项目/角色、Offer、审批
- Agent 管理页面:看模型目录、发布 Agent、查看版本
- 技术栈:React + TanStack Start + 现有 API 客户端
- 主要 API:`/api/v1/ai-direct-hiring/...`(已挂载)
- 主要数据:9 个 P0 模型 + 10 个 P1 模型(只读 + 表单)

### F (P2 招聘流程 API)
- 挂载 P1 路由:`/companies`、`/projects`、`/roles`、`/offers`、`/employments`
- 实现 Offer 状态机 + Employment 状态机(基于已有 Prisma 模型)
- 复用 B 的中间件(`requireCompanyRole` / `requireEmploymentScope`)
- 复用 B 的幂等工具
- 复用 C 的错误类 + outbox
- 预期代码量:800-1500 行

### G (P1 运行中心)
- 服务端队列(JOB_QUEUE)
- 产物索引(PPTX/PDF 资源链接)
- 实时步骤投影(基于 `aiDirectWorkflowRuns` + `aiDirectWorkflowRunSteps`)
- 投影 API 给前端用

## 8. 已知风险 / 待办

### 高风险(影响生产)
- 🔴 密钥未轮换(见 `AI_DIRECT_HIRING_BASELINE.md` §7)
- 🔴 数据库迁移未在测试环境验证
- 🔴 `ci:static` 未跑 → 不知道是否有 lint 错误

### 中风险(影响 P1 前端)
- 🟡 前端未做 i18n key 提取(E 需要)
- 🟡 前端 schema 校验(zod/raw)未统一
- 🟡 错误码到用户消息的映射未在前端实现

### 低风险(影响后续)
- 🟢 招聘/E 模型后续要加 not-found 缓存
- 🟢 RBAC 中间件未来需要更细粒度的"项目级"权限

## 9. 工作树状态

| 路径 | 分支 | 状态 |
|---|---|---|
| `/www/wwwroot/iclawstore.com` | `feature/ai-direct-hire-foundation` | 主仓(用户决策保留) |
| `/tmp/wt-d-merge` | `feature/ai-direct-hire-integrated` | ✅ 整合完毕 |
| `/tmp/wt-b-p1backend` | `feature/ai-direct-hire-p1-backend` | B 独立分支(保留) |
| `/tmp/wt-c-mount` | `feature/ai-direct-hire-p0-mount` | C 独立分支(保留) |
| `/tmp/wt-baseline` | `feature/baseline-mysql-migration-fix` | 基线(保留) |
| `/tmp/wt-e-p1frontend` | `feature/ai-direct-hire-p1-frontend` | 🟡 **E 即将创建** |

## 10. 启动 Agent E 的指令

接下来的 Agent E 应当:
1. **基于 `feature/ai-direct-hire-integrated`** 创建 `feature/ai-direct-hire-p1-frontend`
2. **只添加前端代码**(不修改后端 schema 或后端路由)
3. **复用 B/C 的 API**(调用 `/api/v1/ai-direct-hiring/...`)
4. **遵循 TanStack Start 项目规范**(已有大量现有页面可参考)
5. **做前后端契约自检**:对照 `docs/AI_DIRECT_HIRING_P0_MOUNT.md` 路由清单,确认前端调用的 API 都存在
6. **不要 `git push`**(本地分支)
7. **不要执行 `bun run dev` / `bun run build` / `bun test`**(高 IO)
8. **可以使用 `rg` / `Read` / `Grep` 读源码**(只读)
9. **完成后写 `docs/AI_DIRECT_HIRING_P1_FRONTEND.md`** 报告

---

*更新时间: 2026-08-01 02:06 UTC+8*
*整合 commit: `09609cf`*
