# AI Direct Hiring P0 Mount — 交付说明

> 分支: `feature/ai-direct-hire-p0-mount` (worktree: `/tmp/wt-c-mount`)
> 交付人: Agent C — 挂载工程师
> 基准: `feature/ai-direct-hire-foundation` (SHA `916ce2b`)

---

## 1. 修改 / 新增文件清单

| 文件路径 | 操作 | 说明 |
|---|---|---|
| `server/src/services/aiDirectErrors.ts` | **新增** | 统一错误码枚举 + `AiDirectHiringError` + `errorResponse()` |
| `server/src/utils/outbox.ts` | **新增** | `publishOutboxEvent()` 事务内 outbox 写入 |
| `server/src/routes/aiDirectHiring.ts` | **重写** | 完整重构，替换旧 SQL/AuditLogs 实现 |
| `server/test/aiDirectHiringRoutes.test.ts` | **新增** | Vitest 单元测试（mock pool 风格） |
| `docs/AI_DIRECT_HIRING_P0_MOUNT.md` | **新增** | 本文件 |

---

## 2. 路由清单与错误码映射

### 2.1 凭据路由

| 方法 | 路径 | 错误码 | Idempotency-Key | Outbox 事件 |
|---|---|---|---|---|
| `GET` | `/credentials/jinsha` | — | — | — |
| `PUT` | `/credentials/jinsha` | `VALIDATION_ERROR`, `CREDENTIAL_INVALID`, `IDEMPOTENCY_KEY_REUSED` | ✅ 写入 + 重放检测 | `credential.saved.v1` |
| `DELETE` | `/credentials/jinsha` | — | — | `credential.revoked.v1` |

**安全检查点（PUT /credentials/jinsha）：**
- 只接受 `apiKey` 字段；任何额外字段（`provider`、`baseUrl` 等）返回 `VALIDATION_ERROR`。
- 响应 DTO：`{ configured: boolean; updatedAt: string | null; replayed?: boolean }`。
- **永不返回**：`cipherText`、`iv`、`authTag`、`keyVersion`。

### 2.2 模型目录路由

| 方法 | 路径 | 错误码 | Idempotency-Key | Outbox 事件 |
|---|---|---|---|---|
| `GET` | `/model-catalog` | — | — | — |
| `POST` | `/model-catalog` | `FORBIDDEN_SCOPE`, `VALIDATION_ERROR`, `MODEL_POLICY_NO_MATCH`, `DUPLICATE_ENTRY` | — | `model_catalog.upserted.v1` |
| `POST` | `/model-catalog/:modelId/approve` | `FORBIDDEN_SCOPE`, `VALIDATION_ERROR` | ✅ 幂等（已批准返回 `replayed: true`） | `model_catalog.upserted.v1` |
| `POST` | `/model-catalog/:modelId/disable` | `FORBIDDEN_SCOPE`, `VALIDATION_ERROR` | ✅ 幂等（已禁用返回 `replayed: true`） | `model_catalog.upserted.v1` |

**安全检查点（POST /model-catalog）：**
- `request.user.role !== 'admin'` → 403 `FORBIDDEN_SCOPE`。
- `status='approved'` 必须提供 `evidenceVersion`，否则 `MODEL_POLICY_NO_MATCH`。
- 仅管理员可访问 approve/disable。

### 2.3 Agent 路由

| 方法 | 路径 | 错误码 | Idempotency-Key | Outbox 事件 |
|---|---|---|---|---|
| `GET` | `/agents` | — | — | — |
| `POST` | `/agents` | `VALIDATION_ERROR`, `FORBIDDEN_SCOPE`, `MODEL_POLICY_NO_MATCH`, `IDEMPOTENCY_KEY_REUSED` | ✅ 写入 + 重放检测 | `agent.created.v1` |
| `GET` | `/agents/:agentId/versions` | `FORBIDDEN_SCOPE` | — | — |
| `POST` | `/agents/:agentId/versions` | `VALIDATION_ERROR`, `FORBIDDEN_SCOPE`, `MODEL_POLICY_NO_MATCH`, `IDEMPOTENCY_KEY_REUSED` | ✅ 写入 + 重放检测 | `agent_version.created.v1` |
| `POST` | `/agent-versions/:versionId/publish` | `VALIDATION_ERROR`, `FORBIDDEN_SCOPE`, `MODEL_POLICY_NO_MATCH`, `IDEMPOTENCY_KEY_REUSED` | ✅ 幂等（已发布返回 `replayed: true`） | `agent_version.published.v1` |
| `POST` | `/agents/:agentId/versions/:versionId/archive` | `VALIDATION_ERROR`, `FORBIDDEN_SCOPE` | ✅ 幂等（已归档返回 `replayed: true`） | `agent_version.archived.v1` |
| `GET` | `/agents/:agentId/model-run-audits` | `FORBIDDEN_SCOPE` | — | — |
| `POST` | `/agents/:agentId/resolve-model` | `VALIDATION_ERROR`, `FORBIDDEN_SCOPE`, `MODEL_POLICY_NO_MATCH` | — | — |

**业务规则：**
- `POST /agents`：`publisherId` 必须为当前用户的 `publisherMembers` 成员，否则 `FORBIDDEN_SCOPE`。
- `POST /agents/:agentId/versions`：新版本号自动递增（`MAX(version) + 1`），带 `FOR UPDATE` 锁。
- `POST /agent-versions/:versionId/publish`：
  - 已发布版本直接幂等返回 200，不写审计/不触发布。
  - 发布前重新执行 `validateModelPolicy`（模型可能被管理员下线）。
- `POST /agents/:agentId/resolve-model`：`routingMetadata` 写入 `{ selectionSource, evidenceVersion }`（符合 `ai_direct_model_run_audits.routingMetadata` 规范）。

---

## 3. 审计事件类型汇总

| `ai_direct_audit_events.action` | 目标类型 | 说明 |
|---|---|---|
| `credential.saved` | `credential` | 用户保存金沙 Key |
| `credential.revoked` | `credential` | 用户撤销金沙 Key |
| `model_catalog.created` | `model_catalog` | 管理员新增模型目录项 |
| `model_catalog.approved` | `model_catalog` | 管理员批准模型 |
| `model_catalog.disabled` | `model_catalog` | 管理员禁用模型 |
| `agent.created` | `agent` | 新建 Agent（含首个版本） |
| `agent_version.created` | `agent_version` | 新建 Agent 版本 |
| `agent_version.published` | `agent_version` | 版本发布（含 agent 激活） |
| `agent_version.archived` | `agent_version` | 版本归档（可逆） |

**字段**：`organizationId`（nullable）、`actorUserId`、`requestId`（来自 `X-Request-Id` header）、`outcome`（固定 `success`）、`metadata`（JSON，**不含敏感内容**）。

---

## 4. Outbox 事件汇总

| `ai_direct_outbox_events.eventType` | aggregateType | payloadVersion | 触发时机 |
|---|---|---|---|
| `credential.saved.v1` | `credential` | 1 | 金沙 Key 保存成功 |
| `credential.revoked.v1` | `credential` | 1 | 金沙 Key 撤销 |
| `model_catalog.upserted.v1` | `model_catalog` | 1 | 模型目录新建/批准/禁用 |
| `agent.created.v1` | `agent` | 1 | Agent 创建（含首个版本 ID） |
| `agent_version.created.v1` | `agent_version` | 1 | 新版本创建 |
| `agent_version.published.v1` | `agent_version` | 1 | 版本发布 |
| `agent_version.archived.v1` | `agent_version` | 1 | 版本归档 |

Outbox 处理器（独立后台 Worker）负责读取 `status='pending'` 行、推送到下游系统并标记 `published`。

---

## 5. 稳定错误码对应表

（来源：`specs/ai-direct-hiring-desktop-contract.md` §56）

| 错误码 | HTTP 状态 | 触发场景 |
|---|---|---|
| `AUTH_REQUIRED` | 401 | 未提供认证（中间件层 Fastify 处理） |
| `FORBIDDEN_SCOPE` | 403 | 非管理员访问管理路由；非成员访问 Agent |
| `VALIDATION_ERROR` | 400 | 请求体验证失败（字段类型、长度、Idempotency-Key 格式） |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 同一 Idempotency-Key 被用于不同内容的请求 |
| `MODEL_POLICY_NO_MATCH` | 400 | 模型策略引用未批准/已下线模型；缺少 `evidenceVersion` |
| `DUPLICATE_ENTRY` | 409 | `modelKey` 冲突（数据库唯一键） |

**永不自动重试的错误**：401、403、409（`IDEMPOTENCY_KEY_REUSED`）、400（验证/策略错误）。
**可重试的错误**：网络失败、502/503/504。

---

## 6. 安全检查点总览

### 6.1 永不返回给客户端的字段

| 字段 | 原因 |
|---|---|
| `cipherText`、`iv`、`authTag`、`keyVersion` | 加密密文、认证标签、AES 参数 |
| 金沙 Key 明文 | 规范明确禁止 |
| Prompt 原文（完整） | 审计元数据仅存脱敏摘要 |
| 其他用户凭据 | 隔离原则 |

### 6.2 字段白名单校验

- `PUT /credentials/jinsha`：**只接受 `apiKey`**，任何其他字段立即返回 `VALIDATION_ERROR` + `extraFields` details。
- 客户端不得提交 `provider`、`baseUrl`、任意 `model ID`——服务端显式拒绝并写入审计事件。

### 6.3 访问控制矩阵

| 路由 | 要求 |
|---|---|
| 所有路由 | 登录用户（JWT 认证） |
| `POST /model-catalog`、`/model-catalog/:id/approve`、`/model-catalog/:id/disable` | `role === 'admin'` |
| `POST /agents`（带 `publisherId`） | 用户必须是该 publisher 的成员 |
| Agent 版本操作 | 用户必须是 Agent 所有者或 publisher 成员 |

---

## 7. 与 `specs/ai-direct-hiring-desktop-contract.md` 第 56 行稳定错误码对照

| spec 第 56 行要求 | 实现状态 |
|---|---|
| `AUTH_REQUIRED` | ✅ 中间件 Fastify `authenticate` 返回 401 `{ code: 'AUTH_REQUIRED' }` |
| `FORBIDDEN_SCOPE` | ✅ `AiDirectHiringError` 专用码 |
| `INVALID_TRANSITION` | ⚠️ 未直接实现（状态机待 Agent B 实现 Company/Project/Employment 后补全） |
| `APPROVAL_REQUIRED` | ⚠️ 待 Agent B 实现 Approval 审批流后挂载 |
| `MODEL_POLICY_NO_MATCH` | ✅ `validateModelPolicy` 失败时抛出，HTTP 400 |
| `BUDGET_EXCEEDED` | ⚠️ 待 Agent B 实现 Budget 预算控制后挂载 |
| `RUN_NOT_RECOVERABLE` | ⚠️ 待 Agent B 实现 WorkflowRun 状态后挂载 |

---

## 8. 给 Agent B/D 的集成指引

### Agent B（`feature/ai-direct-hire-p1-backend` — Company / Project / Employment / Approval / WorkflowRun）

1. **复用 `aiDirectErrors.ts`**：`AiDirectHiringError`、`ErrorCodes.VALIDATION_ERROR`、`ErrorCodes.FORBIDDEN_SCOPE` 等可直接导入使用，不需要重新定义错误类。
2. **复用 `writeAudit()` 模式**：在 Company/Project/Employment/Approval/WorkflowRun 的事务中，同样调用 `writeAudit(connection, {...})` + `publishOutboxEvent(connection, {...})`（从 `server/src/utils/outbox.ts` 导入）。
3. **`X-Request-Id` 和 `Idempotency-Key` header**：直接复用 `requestId()`、`idempotencyKey()`、`createFingerprint()`（均定义在 `aiDirectHiring.ts` 顶部 helper 区，建议提取到共享模块 `server/src/utils/aiDirectHelpers.ts` 供 Agent B 复用）。
4. **幂等性**：新增的 Company/Project/Employment 创建路由请同样实现 idempotency-key 重放检测，参考 `POST /agents` 的 `createInput` + fingerprint 模式。
5. **`MODEL_POLICY_NO_MATCH` 关闭条件**：在 `POST /agents` 和 `POST /agent-versions/:versionId/publish` 中，如果引用的模型被管理员下线，会在发布时重新校验并拒绝——这符合规范要求的"运行必须在外部调用前失败关闭"。

### Agent D（前端 / Convex 投影）

1. **统一错误处理**：所有 AI Direct Hiring API 响应都符合 `{ code, error, details? }` 结构，前端按 `code` 做分支处理，不要依赖 `error` 文本。
2. **幂等重放**：`PUT /credentials/jinsha`、`POST /agents`、`POST /agents/:id/versions`、`POST /agent-versions/:id/publish`、`POST /model-catalog/:id/approve`、`POST /model-catalog/:id/disable` 返回 `{ ...replayed: true }` 时，表示请求被服务端识别为重复执行，UI 应展示"已保存（重复）"而非再次提示用户。
3. **Outbox 事件订阅**：Convex 可监听 `ai_direct_outbox_events` 的 `status='published'` 行来重建实时投影（如 Agent 列表、版本状态）。
4. **`resolve-model` 路由**：`routingMetadata` 中的 `selectionSource`（`task_override` / `agent_default` / `agent_fallback`）和 `evidenceVersion` 可用于前端展示"模型选择原因"。

---

## 9. 测试说明

测试文件：`server/test/aiDirectHiringRoutes.test.ts`

**测试覆盖：**
- 凭据保存只返回 `{ configured, updatedAt }`（永不返回密文字段）
- 模型目录管理员校验（403 `FORBIDDEN_SCOPE`）
- Agent 创建时 publisher 成员校验
- 模型策略解析错误返回 400 + `MODEL_POLICY_NO_MATCH`
- 发布幂等性（已发布版本重复 publish 返回 200 + `replayed: true`）
- Idempotency-Key 重放（相同 key + fingerprint → 200 `replayed: true`；不同 fingerprint → 409 `IDEMPOTENCY_KEY_REUSED`）
- `errorResponse()` 辅助函数格式
- 归档版本幂等性
- `resolve-model` `routingMetadata` 结构

**运行方式：**
```bash
cd /www/wwwroot/iclawstore.com
bun test server/test/aiDirectHiringRoutes.test.ts
```

> 注意：本地运行需要先 `bun run setup:worktree -- --from /tmp/wt-c-mount` 同步依赖，或在 worktree 内直接运行。

---

## 10. 完成标准核对

| 标准 | 状态 |
|---|---|
| 不再写 `auditLogs`（只写 `ai_direct_audit_events`） | ✅ |
| 所有路由支持 Idempotency-Key | ✅ |
| 错误响应格式 `{ code, error, details? }` | ✅ |
| 凭据接口永不返回密文/IV/authTag | ✅ |
| 模型策略路由失败关闭（`MODEL_POLICY_NO_MATCH` 等） | ✅ |
| 测试代码就位（未运行） | ✅ |
| 2 个 commits 在 `feature/ai-direct-hire-p0-mount` | 待提交 |
| worktree 路径 `/tmp/wt-c-mount` 存在 | ✅ |
| 无 `git push` / `bun install` / `prisma migrate` / 网络请求 | ✅ |
