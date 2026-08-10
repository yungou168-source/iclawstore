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

| 顺序 | 管理能力              | 当前状态                                             | 本轮已落实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 仍需完成                                                                                                                                                    |
| ---- | --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 组织/公司管理         | **代码完成，待验证、待发布验收**                     | 组织与公司管理 DTO、稳定 cursor、状态过滤、成员 RBAC、撤权即时生效、最后 owner 保护、公司受约束停用/归档；Web 页面已接入 `/management?view=organizations`，并保留领域角色独立入口。                                                                                                                                                                                                                                                                                                                                                    | 串行执行 schema 校验、定向测试、服务端类型检查、隔离 MySQL 迁移链和真实 Bearer token/RBAC 烟测。                                                            |
| 2    | 模板发布审核          | **代码完成，已迁移，待验证、待发布验收**             | 独立审核队列、批准/拒绝/重新提交/发布/下架、版本与 entitlement 审计；审核状态与公开目录状态拆分并兼容旧消费者；Web 页面已接入 `/management?view=templates`。                                                                                                                                                                                                                                                                                                                                                                           | 补定向测试和真实 Publisher/平台 staff 认证验收。不得伪造平台模板事件的组织归属。                                                                            |
| 3    | 中央审计              | **代码完成，已迁移、已运行接线，待验证、待发布验收** | 组织级统一查询、actor/resource/action/request ID 过滤、稳定 cursor、权限 grant、递归脱敏、异步导出 Job、短时下载授权和 Web 审计中心；CSV consumer 已实现水印、公式注入防护、10,000 行/16 MB 上限及单连接受限批量，并以 `iclawstore-audit-export` 单实例运行。                                                                                                                                                                                                                                                                          | 补审计路由与 worker 的定向测试、隔离 MySQL 及真实认证验收；保持仅通过 `AUDIT_EXPORT_ENABLED=true` 显式启用。                                                |
| 4    | 经营总览              | **代码完成，待验证、待发布验收**                     | 新增组织范围只读聚合 DTO：在职 AI 员工、运行队列、近 30 天 Token/成本和待审批数量；管理端 `/management?view=overview` 已接入。                                                                                                                                                                                                                                                                                                                                                                                                         | 补定向路由/页面测试和真实组织权限烟测；不得在前端跨列表拼接指标。                                                                                           |
| 5    | AI 员工目录           | **隔离闭环已验证，待生产真实身份验收**               | `ai_direct_workforce_employee_digests` 已部署；Offer 接受和 Employment 状态迁移在同一事务同步投影。员工目录 API 仅从 digest 读取，按公司 recruiter RBAC、状态/部门/职位和稳定 opaque cursor 返回安全展示字段；路由、分页、越权测试和 TypeScript 构建已通过。新增可回收的受保护 API fixture：依次创建 Agent、组织、公司成员、项目、Role、Department、Position、Offer、Approval 和 Employment，不直写业务表；在全新隔离 MySQL 的 17 段迁移链上，有数据 `200`、授权空列表 `200`、无成员公司 `403` 三项验收 `3/3` 通过，测试库已自动删除。 | 仍需使用可回收 QA 真实身份在生产或等价目标环境重放同一受保护 API 链路，确认 Convex Bearer 身份桥和生产配置；不得把隔离 JWT/MySQL 验收记为生产真实身份通过。 |
| 6    | AI Job / 运行成本账本 | **代码完成，待验证、待发布验收**                     | 从 WorkflowRun + Provider model run audit 生成最多 31 天的稳定 cursor 成本明细，金额保持微美元整数语义，展示层才格式化 USD。                                                                                                                                                                                                                                                                                                                                                                                                           | 补时间窗口、跨组织和空账本测试；预算限额/异常告警仍需独立交付。                                                                                             |
| 7    | 审批中心              | **付款前意图语义与隔离事务已验证，待生产身份验收**   | 审批继续复用锁后授权、委派、不可变事件、中央审计和 outbox；Approval 已不再更新旧 Offer 终态。批准后的雇佣意图进入待支付，拒绝、取消和超时仅终止付款前意图。                                                                                                                                                                                                                                                                                                                                                                            | 使用可回收真实 Bearer 身份重放授权矩阵；仅在配置 `APPROVAL_TIMEOUT_ENABLED=true` 后才允许启动 worker。                                                      |
| 8    | 系统状态              | **代码完成，待验证、待发布验收**                     | 新增组织范围只读状态 DTO：运行队列、过期 lease、活跃 Worker 和 outbox 堆积；管理端 `/management?view=system` 已接入。                                                                                                                                                                                                                                                                                                                                                                                                                  | 补告警分级、定向测试和生产身份/RBAC 烟测；禁止向浏览器返回密钥、内部路径或完整错误载荷。                                                                    |

## 本轮审批治理与验证记录（2026-08-14，历史实现证据）

> 以下证明旧 Approval 事务实现的并发与原子性，可作为付款前雇佣意图审批的重构基础；其中 Approval→Offer 状态映射已被新的“支付即雇佣”产品契约废弃。

- `20260814_ai_direct_approval_governance` 已应用；生产 `prisma migrate status` 显示 17 个 migration，数据库 schema 为最新状态。
- 委派与裁决共享锁后授权边界：先锁定并重读 Approval，再锁定组织成员事实。批准/拒绝允许当前审批人或组织 `admin/owner`；取消仅允许请求者或当前审批人；委派仅允许组织 `admin/owner`，受委派人必须是同组织活跃成员。委派事务原子写当前审批人、不可变 `ai_direct_approval_delegations`、`approval.delegated` 事件、中央审计和 outbox，路由不再执行事务外预查。
- 委派不是 Approval 终态：终态先提交时后续委派失败；委派先提交时旧审批人立即失权，新审批人可以裁决，timeout 仍可基于最新委派状态过期。Approval 行锁保证这些顺序可解释且不会使用旧授权。
- Approval 裁决只有一个事务入口：人工批准、人工拒绝、人工取消和 timeout worker 都必须先锁定并重读 Approval，只有最新状态仍为 `pending` 才能继续。关联 Offer 的固定映射为 `approved → sent`、`rejected → rejected`、`cancelled → revoked`、`expired → expired`；`targetType = offer` 时 Offer 必须仍以同一 `approvalId` 处于 `pending_approval`，否则 Approval 状态、事件、审计和 outbox 全部回滚，禁止捕获并忽略联动错误。非 Offer 目标没有关联 Offer 更新，仍在同一裁决事务内提交自身治理记录。
- timeout worker 只扫描到期候选 ID，每个 Approval 使用独立裁决事务；人工批准、拒绝、取消与超时并发时由 Approval 行锁串行化，后到者按终态冲突退出，不生成第二份历史。`APPROVAL_TIMEOUT_ENABLED` 保持未配置，PM2 未启动该 worker。
- Approval 相关定向测试 `24/24` 通过，其中统一裁决 `11/11`、授权策略、委派事务与路由边界 `13/13`；全新隔离 MySQL 的裁决事务 `6/6`、授权与委派闭环 `4/4` 通过。后者覆盖指定审批人、组织 admin、越权成员、请求者取消、无关 owner 取消、委派后旧审批人失权、委派/终态竞争和委派后 timeout。核心招聘 MySQL fixture 闭环 `1/1` 通过。
- 本轮仅执行 migration 与只读复核，没有执行 PM2 restart/reload/start。复核时 API、runtime dispatcher、审计导出 worker 均为 `online`。

## 付费雇佣实现与验证记录（2026-08-15）

- `20260815_ai_direct_paid_hiring` 与 Prisma schema 已增加 Agent 版本化价格、HiringIntent、PaymentOrder、平台/开发者账本及人工 settlement 数据；订单创建时必须固化明确 `positionId`、AgentVersion、开发者归属、价格版本和 20%/80% 金额。
- 支付宝通知只有在 RSA2 验签及 `app_id`、`seller_id`、`out_trade_no`、`trade_no`、`trade_status`、`total_amount` 全部核对通过后才可履约。支付宝下单成功或客户端跳转不构成支付成功。
- 支付成功事务原子更新订单、创建唯一 Offer 和 Employment、写平台收入与开发者应付、领域事件、中央审计及 outbox。任何写入失败整体回滚；重复或并发通知只能得到同一份履约结果。
- Approval 已改为付款前雇佣意图语义，不再更新 Offer 的 accepted/rejected/expired/revoked 状态。旧 Offer 写操作与直接创建 Employment 的公开入口均已关闭。
- Prisma validate、服务端 TypeScript、定向 Biome、单元/契约测试和全新隔离 MySQL 迁移/事务门禁均通过。生产仍需真实 Bearer 授权矩阵、迁移发布和支付宝沙箱/商户联调。

## 架构边界

- `/management` 是平台 staff 的统一管理壳，不替代组织 owner/admin 或 Publisher 的领域入口；最终权限始终由 Fastify API 校验。
- 前端沿用现有 Bearer token 获取机制，不新增第二套认证、Cookie 或本地 JWT 回退。
- 高风险写入必须在同一事务提交业务状态、不可变审批领域事件与中央审计记录；需要下游处理时同时写 outbox。
- 审计导出由 API 入队、独立 consumer 处理，禁止同步全表导出。
- 平台级事件没有可靠组织上下文时保持平台级，禁止为了统一查询而伪造 `organizationId`。
- 成本管理只使用 AI 调用成本、Token、预算和 Job 运行账本语义；支付、退款、分账和结算不在本清单范围内。

## 付费雇佣运营更新（2026-08-08）

- `20260816_ai_direct_paid_hiring_operations` 已新增、尚未应用。它仅以加法字段补充 PaymentOrder 对账次数、渠道状态、错误码、下次调度和 lease，不改写历史订单金额、Offer、Employment 或账本。
- `alipay.trade.query` 在发送 RSA2 签名请求后，必须从原始 JSON 中提取 `alipay_trade_query_response` 节点进行 RSA2 验签；签名缺失、节点篡改、商户、订单号或金额不符均不能触发履约。
- reconciliation worker 是 opt-in 单进程：`PAID_HIRING_RECONCILIATION_ENABLED=true` 与完整支付配置缺一不可。它以 `FOR UPDATE SKIP LOCKED` 领取 pending 订单，设置 90 秒 lease，并在失败后按 30 秒至 1 小时指数退避；worker 与通知/显式对账共享 `fulfillPaidHiring`，不得创建第二条履约路径或自动冲正。
- 人工结算服务已实现平台 staff 专用的余额、可结算分录、批次列表/详情和最小运营告警 API。批次在锁定分录后遵循 `pending → processing → failed → processing（retry）→ completed`；创建和每次状态推进均原子写 audit/outbox，完成强制记录人工打款参考号，重复纳入账本分录被事务锁定拒绝。staff 由 `AI_DIRECT_SETTLEMENT_STAFF_IDS` 显式配置，默认拒绝所有人。
- 当前 v1 不再缺少新的服务端实现项；尚未完成的是发布验收而非功能开发：两段 migration 应用、最小 staff allowlist、真实 Convex Bearer 权限矩阵、支付宝沙箱下单/查询/通知/重复通知，以及隔离 MySQL 的 worker/结算并发和回滚门禁。上述渠道异常仅能生成可见运营告警，绝不自动冲正 Offer、Employment 或账本。
- 退款、拒付、税费、渠道费、自动打款、自动冲正、结算周期和最低打款额明确不属于 v1；如需支持，必须作为追加分录与独立状态机交付，不能改写既有履约事实。
