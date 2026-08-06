# AI 直聘 Web 与服务器 P1/P2 开发路线图

> **文档状态**：待开发工作包与验收基准
> **最近更新**：2026-08-13
> **适用范围**：Web 管理端、`/api/v1/ai-direct-hiring`、MySQL/Prisma、受管资产和远端运行时
> **状态真值**：生产运行行为 → 已挂载路由 → Prisma migration status → 本文档。本文中的“可开发”不代表已经实现或上线。
> **后台缺口索引**：三个核心管理工作包和后续后台能力的逐项状态见 [`ai-direct-admin-capability-gaps.md`](./ai-direct-admin-capability-gaps.md)。

## 1. 目标与共同边界

### 对外品牌与兼容性

- Web 平台名称为中文 `AI直聘`、英文 `Ai Work`；网页标题、导航、登录界面、PWA、SEO 和 OG 图必须保持一致，品牌交互色使用青绿色。
- 首页公共导航固定提供“首页”“招聘 AI 员工”“客户端下载”；语言切换右侧始终保留登录入口，`Github` 位于就绪状态前并跳转到官方仓库。
- “技能”“插件”是已登录开发者的专属入口，不得作为匿名用户的首页公共导航或页脚浏览项；页脚仅保留公共浏览、友情链接、社交图标、版权与备案信息。
- SSR 在认证状态解析期间仍必须渲染可见的禁用态登录按钮，禁止用空白占位替代，避免访客误判登录能力不可用。
- `AI Direct Hiring` 只用于招聘业务模块和 `/api/v1/ai-direct-hiring` 路由语义，不得作为产品名。
- `clawhub` / `clawdhub` 的 CLI、包名、公开 API、发现协议和内部历史标识均为兼容性边界，任何 Web 品牌修改不得改变它们。

本路线图把 AI 直聘下一阶段拆成可独立委托、可并行开发、可逐项验收的服务器与 Web 工作包。桌面本地项目、队列、聊天、模板运行数据和侧栏不属于 Web 管理端，不得为了复用页面而上传或合并。

所有工作包必须遵守以下共同边界：

1. Convex Auth 是 Web 唯一登录身份源；Fastify 只验证 Bearer token、映射业务用户并解析组织/RBAC，不维护第二套 OAuth、登录 Cookie或本地 JWT 回退。
2. `/session` 返回当前业务用户、active organizations、当前组织与服务器签发的权限/feature flags；客户端标签、路由参数和缓存不能自行授权。
3. 每个组织级请求都重新读取 active membership；撤权后立即失效。
4. 高风险写入在单一 MySQL 事务中提交业务状态、状态事件、审计事件和 outbox。
5. 未挂载的 `server/src/routes/aiDirectHiring.ts` 不算可用 API，不得直接让 Web 调用，也不得整体重新挂载。
6. 数据表或迁移存在不代表功能启用。Provider、支付、目录、面试等能力必须由独立 feature flag 和运行状态明确返回。
7. 本期不实现支付成功。价格只能是 `free`、`internal_use`、`quote_required` 或 `purchase_unavailable` 等服务器状态，客户端不得虚构金额或支付结果。
8. 新列表接口采用稳定 cursor 分页、服务端过滤和明确排序；禁止先全表扫描再由 Web 过滤授权数据。

### 当前服务端能力与优化状态

以下状态以当前工作区代码和定向测试为准；只有 migration 已应用、feature flag 已开启并完成生产验收后，才可对外称为可用。

| 能力 | 当前状态 | 已落实的优化或边界 | 生产前条件 |
| --- | --- | --- | --- |
| Session / Jobs / 产物读取 | 候选实现完成 | Jobs 使用稳定 cursor；产物下载重验组织可见性并流式核验 hash/size，不暴露 `storagePath`。 | native OAuth 发布、`AI_DIRECT_ARTIFACT_ROOT` 配置和端到端验收。 |
| Agent 发布 / 候选目录 | 代码完成，待迁移与发布验收 | 独立写模块；发布事务原子写审计/outbox；目录只读 digest 与组织计数投影，SQL 全文搜索与稳定 cursor 避免 N+1。 | 应用 `20260810_agent_publication_catalog`，显式开启组织 `candidateCatalog`。 |
| Offer 接受 / Employment | 代码完成，待发布验收 | 唯一接受入口在同一事务创建或复用 Employment；`offerId` 唯一且重放幂等；同步更新组织已聘计数。 | 统一发布门禁和生产回归。 |
| Workforce：部门 / 职位 / 编制 | 代码完成，待迁移与发布验收 | Company → Department → Position → AgentRole；Offer/Employment 继续仅引用 `roleId`。开放职位与编制计数在招聘事务中锁定并维护，列表使用稳定 cursor。 | 应用 `20260811_ai_direct_workforce`，补真实 MySQL 事务门禁与生产发布。 |
| 面试合规与清理 | 代码完成，待迁移与发布验收 | 90 天保留、用户删除立即不可见、legal hold 延迟物理删除；清理进程单连接、批次不超过 20。 | 应用面试策略 migration；按组织显式开启 `interviews`。 |
| 低内存运行 | 受控运行中 | API、dispatcher、executor 独立进程预算与连接池；API 默认 pool 6，dispatcher pool 2，executor pool 1/并发 1。 | 完成 30 分钟观测；低内存拒绝/排队压测尚未执行。 |

## 2. 共享前置：身份、Session 与统一权限 DTO

### 当前状态

- Web 身份桥、Bearer-only Web 客户端、`/session`、显式组织选择、`grantVersion`、组织级 feature flags 与 `runtimeCapabilities` 已在当前工作区实现；真实 GitHub 登录 Bearer token 到 `/session` 的生产成功路径已有证据。
- 原生桌面 OAuth/OIDC 已实现独立 issuer/audience、Authorization Code + PKCE S256、固定 public client 注册约束、custom URI/IP loopback redirect、refresh rotation/reuse detection、30 天绝对期限、7 天空闲期限、账号停用/删除触发 family revoke、revoke endpoint 和 Fastify 双 issuer bridge。
- 桌面身份能力仍是“实现完成，待发布验收”：必须先在目标环境锁定静态 client 注册，完成真实浏览器的 custom URI 与 loopback 两条授权闭环、生产配置烟测和统一发布门禁，才能向客户端开启。
- 当前 `/session` 已返回显式组织选择、`grantVersion`、组织级 flags 与运行时能力；能力默认关闭。仍需通过 OAuth 真实浏览器闭环和发布门禁后才能向桌面客户端开启 native login。
- 当前定向证据包括 Session 的 3 项路由测试，以及 OAuth token family policy、账号撤销和双 issuer claim 校验测试；全量门禁状态以 `specs/ai-direct-hiring-progress.md` 为准。

### 服务器必须稳定返回

```text
SessionDto
  user
  organizations[]
    id, name, slug, role, permissions[]
  currentOrganization | null
  featureFlags
  runtimeCapabilities
```

`runtimeCapabilities` 至少明确 Provider Executor、候选目录、面试、模板审核和审计导出是否可用。Web 必须依据服务器返回值展示“未启用”，不能根据表或路由是否存在推断。

### 完成门禁

- Convex issuer/JWKS/discovery 可用，错误 issuer、audience、过期 token 和失效账号均返回 401。
- `20260807_ai_direct_identity_bridge` 在隔离 MySQL 验证并发唯一键后再部署。
- 跨组织、撤权、显式组织选择和 feature flag 默认关闭测试通过。

## 3. 工作包 A：Web 端组织和公司管理（P1）

### 可开发范围

- 创建、查看和切换组织；
- 组织成员列表、邀请/添加、角色调整和移除；
- 创建、编辑和停用公司；
- 公司成员与角色管理；
- 创建和管理项目；
- 创建和管理 Agent 岗位；
- 项目与岗位的权限控制。

### 已有服务器基础

- organizations、organization members；
- companies、company members；
- projects、Agent roles；
- 组织/公司 RBAC、幂等和审计基础；
- 当前工作区已有 `/session` 与统一身份桥代码。

### 当前 Workforce 实现

- `WorkforceModule` 独立于 Company/Project 路由，提供 company-scoped Department、Department-scoped Position 与 Position–AgentRole 绑定接口。
- Position 是编制与职位状态的权威模型；既有 Offer/Employment 不迁移外键，仍通过 `roleId` 找到唯一绑定 Position。
- 新 Offer 只允许使用绑定到 active Department、`open` Position 的 Role；接受 Offer 时原子占用编制，Employment 离开在编状态时原子释放编制。
- `20260811_ai_direct_workforce` 尚未应用，以上能力不能标记为生产可用。

### 当前分支实现状态

- **QA 实测（2026-03-14）**：可回收 QA 身份已在真实组织管理页面创建隔离组织 `QA-EmployeeDirectory-2026-03-14` 和 active 公司 `company-A`，身份显示为组织 `owner`。这只证明身份桥及组织/公司写路径可用，不证明 Offer、Employment 或员工目录业务闭环。
- 组织成员、公司、项目、Agent 岗位与 Employment 属于不同的领域资源。将文本 `company-A` 添加到“组织成员用户 ID”只会尝试创建成员关系，不能创建公司；创建 Agent 岗位也不创建 Employment。
- `/recruit-ai` 当前是本地目录选择页，选择状态不持久化；“在客户端继续招聘”跳转桌面客户端发布页。Web 未提供“选择候选 → Offer → 接受 → Employment”的可操作表单，不能把页面选择标记为已雇佣。
- 员工目录 QA fixture 仍需经受保护 API 建立 company recruiter、有效 Employment 和 workforce digest；禁止直写数据库或请求用户提供 Bearer token、OTP、密码等凭据。
- **代码完成，待验证**：组织、成员、公司、公司成员、项目和 Agent 岗位已统一使用状态过滤、opaque cursor 与权限 DTO；新页面同时保留领域角色独立入口，并接入 `/management?view=organizations`。
- 成员写入包含最后 active owner 保护；每次组织级请求继续读取 active membership，撤权后不依赖前端缓存授权。
- 公司删除已收敛为受约束归档：必须先停用，并拒绝仍有 active 项目、开放岗位、未完成 Offer/Employment 或运行任务的公司；不执行物理删除。
- 新代码尚未完成本轮定向测试、Prisma schema 校验、隔离 MySQL 迁移链和生产发布，因此不得标记为已上线。

### 剩余缺口

- assignments、跨职位调动和部门停用后既有 Role 的批量处置尚未形成完整领域模型；
- 需要在隔离 MySQL 验证 owner/admin/manager/member、跨组织、撤权、cursor 与停用冲突；
- 管理页仍需生产 Bearer token、403 和冲突恢复烟测。

### 模块职责

- `OrganizationModule`：组织生命周期、成员和组织角色；
- `CompanyModule`：公司生命周期、成员和公司角色；
- `WorkforceModule`：department、position、assignment；
- `ProjectRoleModule`：项目与 Agent 岗位，不处理 Employment 状态迁移。

### 验收

- owner/admin/manager/member 的可见与可写矩阵有服务器测试；
- 撤销 membership 后旧页面下一次请求立即 403/404；
- 不能移除最后一个 active owner；
- 停用资源不再接受新写入，但历史审计和 Employment 仍可按权限读取；
- 该工作包不依赖桌面同步或支付。

## 4. 工作包 B：Agent 开发者中心与版本发布（P1）

### 可开发范围

- Agent 草稿创建和编辑；
- AgentVersion 创建与模型策略配置；
- 头像、最多 5 张 2D 图片、GLB 3D 形象管理；
- 安全审核状态、提交审核、批准/拒绝结果展示；
- 发布不可变版本、版本归档；
- 使用、运行和模型审计摘要。

### 当前实现与硬边界

- 独立 `AgentPublicationModule` 已通过 `aiDirectCore.ts` 挂载；旧 `aiDirectHiring.ts` 继续未挂载。
- 草稿创建、版本创建、提交审核、管理员审核裁决和发布均由该模块承担；发布事务写 active version、审计、outbox，并按受控目录字段更新或移除 digest。
- `20260810_agent_publication_catalog` 尚未应用，因此本节能力是“代码完成、待迁移与发布验收”，不能标记为生产可用。
- Agent/Version 是权威写模型；目录字段、审核裁决与安全状态均为独立字段，禁止从业务 JSON 或单一状态字段推断。

### 发布状态机

```text
draft -> submitted -> approved -> published -> archived
                 \-> rejected -> draft
```

- published version 不可变；修改产生新版本。
- 审核状态、安全状态和目录可见状态分离，不能共用一个模糊 `status`。
- 发布事务同时写版本、审核决策引用、审计和 outbox。

### 验收

- 未挂载旧路由无法被 Web 访问；
- 非 owner/授权 Publisher 成员不能创建或发布版本；
- published version 的内容写入返回稳定冲突；
- 形象控制权属于公司时，开发者中心形象区只读；
- 运行审计摘要不返回 Prompt、凭据、完整输入或敏感输出。

## 5. 工作包 C：Agent 候选市场（P1）

### 可开发范围

- 候选 Agent 列表、分类、搜索和公开档案；
- 审核后的姓名、介绍、能力摘要和 AgentVersion 详情；
- 已批准头像、2D/3D 形象；
- viewer-scoped disclosure、availability；
- 当前组织可见候选数和已聘数；
- 模型能力与兼容性摘要；
- 服务器裁决的价格状态。

### 服务器 DTO 最低字段

```text
agentId
agentVersionId
displayName
viewerDisclosure
availability
capabilitySummary
approvedAppearance
priceStatus
```

### 当前实现、可见性与投影边界

- `CandidateCatalogModule` 已通过 `aiDirectCore.ts` 挂载，提供 `/catalog/agents`、`/catalog/agents/:agentId` 与 `/catalog/categories`；这是 `1.1.0` candidate，不属于生产 `1.0.0` discovery。
- 列表和详情只读取 `ai_direct_candidate_catalog_digests` 与组织维度计数投影；不逐条联查 Agent、版本、形象、Employment 或成员关系。列表以 `displayName, agentId` 固定排序，opaque cursor 不可由客户端推导。
- category 和全文搜索在 SQL 中过滤；可见性由 active membership、授权的 `X-Organization-Id` 和显式 `candidateCatalog` flag 共同决定。该 flag 默认关闭。
- 发布事务仅在 `org_authenticated`、`available` 的受控目录字段下写 digest；Offer 接受创建 Employment 时在同一事务更新当前组织的 `isEmployed` 投影。
- 返回 DTO 仅含安全显示字段、能力摘要、获准形象引用、availability、`priceStatus` 与当前组织的 viewer disclosure；不得返回 prompt、模型/执行策略、内部审核内容、Employment 明细、storage path 或支付金额。
- `20260810_agent_publication_catalog` 尚未应用。未完成迁移、未开启 flag、撤销 membership、不可用或没有 digest 的候选必须被排除，而不是由客户端过滤。

## 6. 工作包 D：非支付招聘闭环（P1）

### 目标流程

```text
选择候选 -> 评估 -> 创建 Offer -> 审批 -> 发送 Offer
-> 接受 Offer -> 创建 Employment -> onboarding -> active
```

### 已有基础

- Offer 创建与状态操作；
- Employment 创建、读取、事件和事务状态迁移；
- `accepted` 时形象控制权原子接管，`terminated` 时条件释放；
- 第二家公司控制权冲突；
- approval 与 capability grant 基础。

### 当前实现与剩余边界

- `POST /offers/:id/accept` 是唯一的 Offer 接受入口；它与 Employment 创建或幂等复用、审计/outbox 和组织 `isEmployed` 计数投影在同一事务内完成。
- `offerId` 在 Employment 侧唯一；重复接受同一 Offer 返回既有 Employment，不能制造并发重复雇佣。
- 无 appearance profile 的 Agent 在接受事务中加锁，避免跨 Offer 的形象控制权竞争；这不改变 Agent 所有权或版本发布权。
- 仍须在生产前补齐失败/撤销/取消/交接与 `transferring` 的完整业务语义，并由 Web 明确区分“Offer 已接受”“onboarding”与“active”。

### 禁止行为

- 不创建虚假 payment/order/webhook；
- 不把 Offer accepted 直接渲染为 active Employment；
- 不由前端跳过中间状态；
- 不用形象控制权代替 Agent 所有权或版本发布权。

## 7. 工作包 E：面试会话与未读消息（P1）

### 可开发范围

- 创建或恢复远端面试会话；
- cursor 分页消息与发送消息；
- 服务器选择允许的 AgentVersion 和模型策略；
- 每用户 read cursor、未读数；
- SSE/WebSocket 仅推送会话 ID、最新 sequence 和未读数；
- 重连后通过 HTTP 对账。

### 当前实现与发布边界

- 面试路由、组织级 `InterviewRetentionPolicy`、legal hold、用户删除队列和受管附件规则已完成；清理任务只处理到期或用户删除的记录，active legal hold 会阻止物理删除。
- 面试功能默认关闭。只有 migration 已应用、组织管理员显式启用 `interviews`，且远端模型授权与成员 opt-out 均满足时，才允许展示或使用远端面试能力。
- cleanup consumer 是受控的独立低资源进程，不得由 API 自动启动，也不得为了验证而常驻运行。

### 独立数据模型

```text
InterviewConversation
InterviewParticipant
InterviewMessage
InterviewReadCursor
InterviewRetentionPolicy
```

消息正文不能塞进会话数组。消息使用会话内单调 sequence；read cursor 以 `(conversationId, userId)` 唯一。

### 已确认的 v1 合规策略

- 正文保留 90 天，达到 `retentionExpiresAt` 后由清理任务物理删除；有效的法务保留可以延迟物理删除，但不恢复用户可见性。
- 用户删除后正文立即不可见，并进入删除队列。审计只记录操作与最小化的目标标识，不保留正文副本。
- 组织管理员可启用远端模型使用；参与者可以 opt-out。未获该组织授权或已 opt-out 的参与者正文不得发送至远端模型。
- 附件仅允许图片与 PDF，单文件最大 10 MiB，必须使用受管存储，并继承消息的保留和删除规则。
- 清理消费者固定连接池 1、单批最多 20 条；它只删除到期或用户删除且没有 active 法务保留的记录。法务保留只能由组织 admin 创建或释放。

### 实现约束

- `InterviewRetentionPolicy` 是组织级版本化策略；当前 API 只接受上述固定 v1 取值，避免客户端静默放宽保留期。
- 远端面试与桌面本地聊天是两个数据域，不自动上传、同步或合并历史消息。
- 消息正文不能塞进会话数组。消息使用会话内单调 sequence；read cursor 以 `(conversationId, userId)` 唯一。

## 8. 工作包 F：云端运行中心 Web 页面（P1）

### 可开发范围

- Jobs 列表、详情、步骤和状态时间线；
- 模型、Token、成本、延迟；
- 失败码与恢复建议；
- 取消和终态失败/取消后的重试；
- 产物元数据；
- runtime metrics 管理视图。

### 已有基础

Jobs 列表/详情/取消/重试、Worker lease/heartbeat/complete/fail、artifact metadata、`GET /jobs/:id/artifacts`、outbox dispatcher 和 Provider Executor 代码已存在。Worker complete 接受的是经校验的 `storagePath`、hash、size、MIME 与 visibility 元数据；当前没有定义 Worker 将真实字节写入受管存储的上传协议，也没有按 visibility 授权的单产物下载路由，因此“产物元数据存在”不能解释为“产物可下载”。

### 当前桌面 Jobs 契约

`GET /jobs` 使用 `(createdAt, runId)` opaque cursor，按 `createdAt DESC, id DESC` 返回历史 Job。它只接受服务端过滤后的状态，不允许客户端全量下载后筛选。`GET /jobs/:id/artifacts` 只返回元数据和受控 `contentUrl`，永不暴露 `storagePath`。当 `AI_DIRECT_ARTIFACT_ROOT` 未配置时，下载路由返回 `503`；配置后先流式核验落盘文件的 size/SHA-256，再以流式响应返回字节。`requester` 可见产物仅可由原请求者或组织 manager+ 读取。

### 必须补齐

- 定义 Worker 受控上传或服务端受管对象写入流程，使写入和读取共用同一存储根；
- 补正常、跨组织、requester-only、篡改 hash、缺失对象和终态重试的端到端测试。

### 运行能力边界

生产目前没有 keyring、`executor.env`、Executor 进程或真实金沙 canary，Provider 执行开关保持关闭。Session/runtime DTO 必须返回 `providerExecutionEnabled: false`，Web 显示“执行能力未启用”。迁移存在、Job 表存在或页面可打开都不能推导可执行。

即使执行关闭，也可以交付历史、投影、失败、审计与产物元数据页面。

## 9. 工作包 G：Agent 形象管理 Web 页面（P1）

### 可开发范围

- Agent 独立头像；
- 最多 5 张 2D 图片、排序、删除和默认模式；
- 自包含 GLB 3D 模型上传；
- 当前控制公司和 Employment；
- 开发者只读状态；
- 公司 owner/admin/manager 管理。

Web 只消费服务端控制权 DTO，不自行推导 Employment。该页面不实现桌面侧栏、桌面 2D/3D 容器或本地模板运行时；Web 不使用桌面侧栏的产品边界保持不变。

## 10. 工作包 H：桌面模板 Web 发布与审核后台（P1）

> **当前状态：代码完成，待验证。** 当前分支已拆出管理员 `TemplateReviewModule`，提供待审 cursor 队列、详情、批准、拒绝、发布、下架、版本/entitlement/下载审计接口；Publisher 路由补充版本状态与重新提交。审核裁决、发布和 entitlement 高风险写入在同一事务写业务状态、审计与 outbox。加法迁移与 Prisma 声明已落盘，页面已接入 `/management?view=templates`，但尚未完成本轮 schema、定向测试、隔离 MySQL 与生产发布验收。

> 旧 `status`/`publishedAt` 暂时保留并在发布状态机中同步维护，避免切断桌面 `1.1.0` 公开目录和下载消费者；新代码不得重新用旧单一状态推断审核裁决。

> 本节也是“模板发布审核后台”的唯一任务定义；不再维护重复的第 11 项。

### Publisher 工作台

- 创建模板；
- 上传 `.clawtemplate`；
- 上传 1–4 张截图；
- 查看 manifest、包结构和安全校验结果；
- 提交审核；
- 发布审核通过的不可变版本；
- 查看下载审计和版本历史。

### 管理员审核台

- 待审队列；
- manifest/截图/包校验摘要；
- 批准、拒绝和原因；
- 发布/下架；
- 免费模板目录；
- entitlement 测试管理；
- 包下载审计。

### 明确不做

- 支付购买；
- 在 Web 运行模板；
- Web 读取模板本地业务数据；
- 桌面模板沙箱和安装器；
- 自动同步模板业务数据。

模板审核必须使用独立 `TemplatePublicationModule`/`TemplateReviewModule`，不能把管理员权限塞入公开模板下载路由。Web 后台只处理包、manifest、截图、审核和 entitlement 元数据。

## 11. 工作包 I：中央审计与权限治理（P2）

> **当前状态：核心代码完成，待验证与 consumer 接线。** 当前分支已挂载组织级审计查询、显式 `audit:read`/`audit:export` grant、递归字段脱敏、稳定 cursor、异步导出 Job、单次短时下载 token 与 Web 审计中心；授权变更、导出入队、下载授权及对应审计均使用事务提交。加法迁移和 Prisma 声明已落盘，但本轮定向测试、schema 校验、隔离 MySQL 和生产发布尚未完成。

> 导出 worker 的 lease/complete/fail、CSV 脱敏/水印/公式注入防护和单连接 consumer 进程已实现；consumer 由 `AUDIT_EXPORT_ENABLED=true` 显式启用，尚未加入生产进程配置或发布。平台模板事件是平台级事件，当前没有可信组织归属；`desktop_template_audit_events.organizationId` 仅作为后续有明确组织上下文的投影入口，禁止为了并入组织审计而伪造组织 ID。

### 可开发范围

- 按组织、操作者、资源、动作和时间查询审计事件；
- request/correlation ID 查询；
- Employment 历史；
- capability grant 授予、撤销和有效期；
- Provider 模型调用审计与成本汇总；
- 敏感字段脱敏；
- 受权限控制的审计导出。

### 当前缺口

已有多个写入点，但缺少统一授权查询 API 和 Web 审计中心。`AuditModule` 应统一查询、保留、脱敏和导出策略，不要求一次重写所有领域写入。

### 授权与导出

- 默认组织 owner/admin 可查询；更细权限由显式 `audit:read`、`audit:export` grant 控制；
- 普通成员只能看到与自身明确相关且产品允许的事件；
- Provider 审计不返回 API key、Prompt、完整输入输出或内部重试载荷；
- 导出采用异步 Job、短时下载授权、审计水印和导出事件，不能同步全表下载；
- 所有查询必须有组织范围和时间范围，采用 cursor 分页。

## 12. 推荐开发顺序与并行关系

```text
身份/OIDC生产恢复 + Session/RBAC门禁
  -> A 组织/公司 Web
  -> D 非支付招聘闭环

B Agent publication
  -> C 候选市场
  -> D 非支付招聘闭环

G 形象 Web --------------------┐
F 运行中心 Web -----------------+-> I 中央审计与治理
H 模板发布审核后台 -------------┘

E 面试模块可与 F/G/H 并行，但必须先冻结保留、删除、脱敏和同意策略。
```

优先顺序不是页面顺序，而是数据职责顺序：先稳定身份与组织上下文，再稳定可发布 AgentVersion 和候选 DTO，最后闭合招聘状态机。模板审核、形象管理和只读运行中心可独立并行。

### CandidateMatchingModule（1.1.0 candidate）

`GET /workforce/positions/{positionId}/candidate-matches` 只读组合已授权 `open` Position 的需求摘要、其已绑定且 open 的 Role 能力要求，以及候选目录 digest。评分固定为 `capability-coverage-v1`：以必需能力覆盖率给出 0–100 分，并以 `score DESC, displayName ASC, agentId ASC` 稳定排序和 opaque cursor 分页。每次 HTTP 请求只执行该 Position 作用域内的受控 digest 查询；不建立订阅、缓存写入或后台匹配任务。

该模块不读取 Agent prompt、模型策略、审核数据或 Employment 明细；仅返回能力匹配/缺失、可用性和当前组织范围内的 employment disclosure。它依赖候选目录 migration 与组织 `candidateCatalog` feature flag，尚未迁移或发布。

## 13. 每个工作包的完成定义

每个工作包只有同时满足以下条件才能标记完成：

1. Prisma 加法迁移在全新隔离 MySQL 验证；
2. 路由由 `aiDirectCore.ts` 或明确的版本入口实际挂载；
3. Web 只调用挂载 API，不引用未挂载旧路由；
4. DTO、状态机、错误码、权限和 feature flag 有机器可读契约；
5. 401、403、跨组织、撤权、状态冲突和幂等测试通过；
6. 高风险写入同时产生审计和 outbox；
7. 空态、禁用态、失败态和恢复建议在 Web 可见；
8. 明确排除支付、桌面本地数据和未启用 Provider 能力；
9. 生产发布、烟测和回滚记录完成后，才能从“代码完成”改为“已上线”。
