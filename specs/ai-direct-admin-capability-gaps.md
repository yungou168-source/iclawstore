# AI直聘后台管理能力缺口

> **文档状态**：后台管理域的缺口清单与交付状态索引
> **最近更新**：2026-08-14
> **适用范围**：AI直聘 Web 管理端、Fastify 管理 API、MySQL/Prisma 与后台 worker
> **状态真值**：生产运行行为 → 已应用迁移与运行配置 → 已验证代码 → 本文档。

本文按后台管理能力的开发顺序记录缺口，避免把“代码已落盘”“迁移已应用”“进程已启用”和“生产已验收”混为同一状态。详细模块契约与完成门禁见 [`ai-direct-web-server-roadmap.md`](./ai-direct-web-server-roadmap.md)，生产与当前分支证据见 [`ai-direct-hiring-progress.md`](./ai-direct-hiring-progress.md)。

## 状态定义

- **代码完成，待验证**：路由、服务、页面、测试和迁移文件已落盘，但本轮定向测试、类型检查或隔离数据库验证尚未完成。
- **待迁移**：加法迁移与 Prisma schema 已落盘，但尚未应用到目标数据库。
- **待运行接线**：独立 worker 已实现，但未加入生产进程配置或未显式启用。
- **待发布验收**：代码与验证完成后，仍需目标环境迁移、配置、进程和真实认证烟测。
- **已上线**：仅在生产迁移、运行配置和业务验收均有证据时使用。

## 能力缺口清单

| 顺序 | 管理能力 | 当前状态 | 本轮已落实 | 仍需完成 |
| --- | --- | --- | --- | --- |
| 1 | 组织/公司管理 | **代码完成，待验证、待发布验收** | 组织与公司管理 DTO、稳定 cursor、状态过滤、成员 RBAC、撤权即时生效、最后 owner 保护、公司受约束停用/归档；Web 页面已接入 `/management?view=organizations`，并保留领域角色独立入口。 | 串行执行 schema 校验、定向测试、服务端类型检查、隔离 MySQL 迁移链和真实 Bearer token/RBAC 烟测。 |
| 2 | 模板发布审核 | **代码完成，已迁移，待验证、待发布验收** | 独立审核队列、批准/拒绝/重新提交/发布/下架、版本与 entitlement 审计；审核状态与公开目录状态拆分并兼容旧消费者；Web 页面已接入 `/management?view=templates`。 | 补定向测试和真实 Publisher/平台 staff 认证验收。不得伪造平台模板事件的组织归属。 |
| 3 | 中央审计 | **代码完成，已迁移、已运行接线，待验证、待发布验收** | 组织级统一查询、actor/resource/action/request ID 过滤、稳定 cursor、权限 grant、递归脱敏、异步导出 Job、短时下载授权和 Web 审计中心；CSV consumer 已实现水印、公式注入防护、10,000 行/16 MB 上限及单连接受限批量，并以 `iclawstore-audit-export` 单实例运行。 | 补审计路由与 worker 的定向测试、隔离 MySQL 及真实认证验收；保持仅通过 `AUDIT_EXPORT_ENABLED=true` 显式启用。 |
| 4 | 经营总览 | **代码完成，待验证、待发布验收** | 新增组织范围只读聚合 DTO：在职 AI 员工、运行队列、近 30 天 Token/成本和待审批数量；管理端 `/management?view=overview` 已接入。 | 补定向路由/页面测试和真实组织权限烟测；不得在前端跨列表拼接指标。 |
| 5 | AI 员工目录 | **实现待运行验收** | `ai_direct_workforce_employee_digests` 已部署；Offer 接受和 Employment 状态迁移在同一事务同步投影。员工目录 API 仅从 digest 读取，按公司 recruiter RBAC、状态/部门/职位和稳定 opaque cursor 返回安全展示字段；路由、分页、越权测试和 TypeScript 构建已通过。2026-03-14 已用可回收 QA 身份创建隔离组织 `QA-EmployeeDirectory-2026-03-14` 与 active 公司 `company-A`，确认真实登录身份桥和组织/公司管理写路径可用。 | 仍缺 `company-A` 下 QA 的 recruiter 成员关系、有效 Employment 与对应 digest。完成后执行认证正向（有数据 `200`）、授权空目录（空 `200`）及无成员跨公司（`403`）验收；不得把组织或公司创建误记为 Agent 已雇佣。 |
| 6 | AI Job / 运行成本账本 | **代码完成，待验证、待发布验收** | 从 WorkflowRun + Provider model run audit 生成最多 31 天的稳定 cursor 成本明细，金额保持微美元整数语义，展示层才格式化 USD。 | 补时间窗口、跨组织和空账本测试；预算限额/异常告警仍需独立交付。 |
| 7 | 审批中心 | **代码完成，已迁移，待验证、待发布验收** | 审批列表改为显式组织范围；`mine` 仅返回请求人或指定审批人的事项，组织待办要求 `manager`；裁决仅允许指定审批人或组织 `admin/owner`。新增不可变审批事件与委派记录；组织 admin 可将 pending 审批委派给活跃成员。默认关闭的单实例 timeout worker 使用行锁和条件更新，将到期审批在同一事务转为 `expired` 并写审批事件、中央审计/outbox。 | 补授权矩阵、委派链、并发裁决、超时幂等和 Offer 联动测试；仅在配置 `APPROVAL_TIMEOUT_ENABLED=true` 后才允许启动 worker。 |
| 8 | 系统状态 | **代码完成，待验证、待发布验收** | 新增组织范围只读状态 DTO：运行队列、过期 lease、活跃 Worker 和 outbox 堆积；管理端 `/management?view=system` 已接入。 | 补告警分级、定向测试和生产身份/RBAC 烟测；禁止向浏览器返回密钥、内部路径或完整错误载荷。 |

## 本轮审批治理与验证记录（2026-08-14）

- `20260814_ai_direct_approval_governance` 已应用；生产 `prisma migrate status` 显示 17 个 migration，数据库 schema 为最新状态。
- 委派不再仅修改当前审批人：同一事务写入不可变 `ai_direct_approval_delegations`、`approval.delegated` 领域事件、中央审计和 outbox。审批人字段只表示当前责任人，不承载历史。
- timeout worker 以单连接、单实例、行锁与条件更新处理到期 `pending` 审批；仅在成功抢占时写入 `approval.expired` 领域事件、中央审计和 outbox，重复轮询不会生成重复历史。`APPROVAL_TIMEOUT_ENABLED` 保持未配置，PM2 未启动该 worker。
- timeout worker 定向测试 `2/2` 通过；本轮早期受限堆服务端 TypeScript 检查通过。随后可用内存降至约 507 MiB、swap 使用约 1.7 GiB，未执行新的前端构建、全量测试或隔离 MySQL。
- 本轮仅执行 migration 与只读复核，没有执行 PM2 restart/reload/start。复核时 API、runtime dispatcher、审计导出 worker 均为 `online`。


## 架构边界

- `/management` 是平台 staff 的统一管理壳，不替代组织 owner/admin 或 Publisher 的领域入口；最终权限始终由 Fastify API 校验。
- 前端沿用现有 Bearer token 获取机制，不新增第二套认证、Cookie 或本地 JWT 回退。
- 高风险写入必须在同一事务提交业务状态、不可变审批领域事件与中央审计记录；需要下游处理时同时写 outbox。
- 审计导出由 API 入队、独立 consumer 处理，禁止同步全表导出。
- 平台级事件没有可靠组织上下文时保持平台级，禁止为了统一查询而伪造 `organizationId`。
- 成本管理只使用 AI 调用成本、Token、预算和 Job 运行账本语义；支付、退款、分账和结算不在本清单范围内。