# AI 直聘桌面端与平台后端集成基准

> 文档状态：服务器端开发基准
> 桌面产品真值：`AI直聘桌面端/docs/`
> 最近对齐：2026-08-05
> 适用范围：`/api/v1/desktop`、`/api/v1/ai-direct-hiring`、MySQL/Prisma、运行时与桌面客户端联调

## 1. 目的

本文件把桌面端最新文档转换为服务器端可执行的职责、数据、状态机和 API 差距清单。面向 Web 管理端和服务器的逐项 P1/P2 工作包、依赖与验收统一维护在 `specs/ai-direct-web-server-roadmap.md`；本文件不再重复维护页面级任务列表。

桌面端文档决定产品行为和客户端边界；服务器源码、迁移状态、生产烟测与已发布 OpenAPI 决定“当前是否已经可用”。桌面端文档中的 `proposed` 接口不能因为写入本文件就被视为已上线。

发生证据冲突时按以下顺序判断当前能力：

1. 生产运行行为与迁移状态；
2. 生产逐 method/path 路由探测；
3. 通过一致性门禁的已发布 OpenAPI；
4. 当前生产构建实际挂载的路由；
5. 服务器规格、源码与交付记录。

OpenAPI 不能仅因 discovery 版本已更新就获得更高可信度。机器契约若声明了运行时返回 `404` 的 operation，应立即判定为契约漂移并阻止继续发布。

## 2. 契约分层

服务器后续文档和代码必须显式标注所属层级。

| 层级 | 状态 | 权威入口 | 使用规则 |
| --- | --- | --- | --- |
| Desktop Client API v1 | `1.2.0` 代码契约待发布；`1.1.0` 已生产发布 | `server/openapi/desktop-client-v1.yaml`、`server/src/desktopContractManifest.ts`、`docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md` | 保持 `1.x` 向后兼容；`1.2.0` 新增付费雇佣能力并明确旧 Offer 写操作不可用。发布前必须通过启动路由校验、逐 operation 非 `404` 烟测和真实业务门禁。 |
| Remote Runtime v1 | 已生产上线，文档契约 | `docs/AI_DIRECT_HIRING_P1_RUNTIME.md`、桌面端 `REMOTE_RUNTIME_CLIENT.md` | 覆盖 Jobs、Worker 后端和运行投影；面向桌面的 Jobs DTO 已进入 Desktop `1.1.0` OpenAPI，Worker 协议仍由独立运行时契约维护。 |
| Platform Backend proposed v1 | 产品提案，默认关闭 | 桌面端 `PLATFORM_BACKEND_INTEGRATION_CONTRACT.md` | 身份、企业目录、面试、支付、远程员工、迁移等必须逐能力实现和验收，不能整体宣称可用。 |
| Desktop local-only contract | 客户端本地真值 | 桌面端 `DESKTOP_WORKSPACE_CONTRACT.md` | 项目、队列、产物、审批辅助记录、备份、模板业务数据默认不上传。 |

`GET /api/v1/desktop/contract` 当前发现 Desktop Client API `1.1.0`。生产已应用 `20260808` 至 `20260811` 的四段加法迁移，当前 API 构建已部署并通过启动 manifest 校验与逐 operation 非 `404` 烟测，原 Candidate Catalog、Workforce 和 Candidate Matching 路由漂移已经解除。该结论只证明机器契约和路由装配有效；生产 `candidateCatalog` 默认仍为关闭，且尚未使用专用短期 token 和隔离组织完成这些能力的带认证 `2xx` 业务烟测。

## 3. 不可突破的数据归属

| 数据 | 权威位置 | 服务器责任 |
| --- | --- | --- |
| 用户、组织、公司、成员、角色授权 | MySQL/Prisma | 认证后逐请求解析租户与 RBAC；客户端标签不能授权。 |
| Agent、不可变 AgentVersion、发布与目录可见性 | MySQL/Prisma；既有资产目录仅作兼容来源 | 服务器审核、版本化、裁决可见性和 availability。 |
| Offer、Employment、控制权、能力授权、审计、outbox | MySQL/Prisma | 状态、事件、审计和 outbox 原子提交。 |
| WorkflowRun、步骤、成本、模型审计、产物索引 | MySQL/Prisma | 服务器授权、调度和审计；本地队列不能合并为云端事实。 |
| 账号级金沙 Key | 服务器加密凭据库 | 只返回配置状态；禁止返回明文、密文、nonce 或 tag。 |
| 桌面项目、工作流草稿、本地队列、本地输出 | 当前设备 | 不提供后台扫描或静默上传。 |
| 桌面审批责任标签和本地审计 | 当前设备 | 不接受其作为身份、企业审批或中央审计证据。 |
| `.aidhbackup` 与 recovery key | 用户控制的文件传输 | 除非用户明确选择迁移，不作为云备份；服务器不得接收任意路径。 |
| 模板业务数据、Markdown 备份 | 当前设备、每安装实例隔离 | 服务端仅管理目录、包、截图和 entitlement。 |
| 对话正文、附件、完整推理上下文 | 默认当前设备 | 远端面试或同步必须使用单独的同意、保留、删除和加密契约。 |
| 消息渠道凭据 | 未来服务器受管 enrollment | 桌面只能保存本地通知偏好，不得把偏好当作已绑定渠道。 |
| Obsidian/持久记忆 | 当前为显式本地导入导出 | 禁止后台扫描；未来远端同步必须 preview 后再 apply。 |

### 3.1 `projectId` 不是平台项目主键

桌面本地 `projectId` 是匹配 `^[a-z][a-z0-9-]{0,63}$` 的 opaque ID。它属于本地工作区，不得直接作为 `ai_direct_projects.id`、组织授权依据或任意文件路径。

如未来需要关联，必须新增显式映射，例如 `{ localProjectId, serverProjectId, deviceId, mappingVersion }`，并由用户确认；禁止按名称或路径自动合并。

## 4. 当前服务器能力矩阵

状态定义：

- **已上线**：迁移、路由、鉴权和生产烟测已有证据；
- **实现待发布**：代码、契约与定向测试已存在，但尚未经过统一发布门禁和生产烟测；
- **部分实现**：存在可用后端模块，但未满足桌面 proposed 契约或未进入机器契约；
- **未实现**：当前挂载服务没有该产品能力；未挂载旧源码不算实现。

| 桌面能力 | 当前服务器状态 | 已有基础 | 主要差距 |
| --- | --- | --- | --- |
| Desktop contract discovery | **路由契约已生产发布** | discovery/OpenAPI 返回 `1.1.0`；完整 manifest、OpenAPI 同步测试、启动路由校验和生产逐 operation 非 `404` 烟测均通过 | 继续保留启动与生产路由门禁；补 Candidate Catalog/Workforce/Matching 的带认证 `2xx` 业务烟测。 |
| Agent 头像、2D/3D 资产 | 已上线 | 受管本地存储、ETag、权限、控制权事务 | 桌面渲染组件、病毒扫描不属于服务器 v1。 |
| 账号级侧栏与 Logo | 已上线 | revision/ETag、首次 `sidebar-0`、受管 Logo | 与桌面最新“本地导航偏好”文字存在范围冲突，见第 9 节。 |
| 桌面模板目录和包 | 已上线 | 目录、版本、1–4 截图、审核、entitlement | 购买、签名、客户端沙箱、安装/升级不在 v1。 |
| 云端 Jobs | 路由契约已发布，业务验收待补 | cursor 列表/详情、产物元数据与受控下载已挂载并进入 Desktop OpenAPI；`20260808_ai_direct_desktop_jobs_cursor` 已部署，生产逐 operation 烟测通过 | 配置并验证真实 `AI_DIRECT_ARTIFACT_ROOT` 受管产物、带认证可见性和下载链路。 |
| OAuth/OIDC 桌面身份 | 实现待发布 | 独立 issuer/audience、Authorization Code + PKCE S256、固定 custom URI + IP loopback、OIDC discovery/JWKS/userinfo、refresh rotation/reuse detection、30 天绝对期限、7 天空闲期限、账号停用/删除触发 token family revoke、RFC 7009 revocation、Fastify 双 issuer bridge、Desktop contract `1.1.0` auth metadata | 尚缺目标环境静态 client 注册锁定、真实浏览器 custom URI/loopback 两条授权闭环、生产配置烟测和统一发布门禁。 |
| `/session` 与 feature flags | 路由已发布，业务验收部分完成 | session 已解析 Bearer 主体，并按 active membership 返回用户、组织、显式组织选择、`grantVersion`、角色权限、组织级 flags 与 `runtimeCapabilities`；既有真实 GitHub token `/session` 成功路径已验证 | 缺专用生产 smoke token 对 Candidate Catalog/Workforce 场景的组织权限闭环；能力 flag 继续默认关闭。 |
| 设备注册与真实性 | 未实现，本期非目标 | 无 | 不能由客户端自证；不得影响本期接口验收。 |
| 组织、公司、项目、岗位 | 部分实现 | organizations、companies、projects、roles 与成员 RBAC | proposed 角色集合、grant 版本、部门层级和统一分页尚未对齐。 |
| Agent 创建与不可变版本发布 | 迁移与路由发布完成，业务验收待补 | 独立 `AgentPublicationModule` 已挂入 core，包含草稿、版本、审核、发布和 digest；`20260810_agent_publication_catalog` 已部署 | 补真实认证、RBAC、写入幂等与事务的生产级受控验收；未启用组织不能视为可用。 |
| Agent 候选目录 | 路由发布完成，组织能力默认关闭 | 独立目录/详情/分类路由、digest、稳定 cursor、组织 flag 与安全 DTO 已挂载；`20260810_agent_publication_catalog` 已部署且生产路由不再 `404` | 当前没有启用 `candidateCatalog` 的组织或专用 smoke token；带认证 `2xx`、跨组织、撤权和投影回归仍待验收。 |
| 面试与未读数 | 迁移与路由发布完成，组织能力默认关闭 | conversation/messages/read cursor、保留策略、legal hold、附件与 cleanup consumer 已挂载；`20260809_ai_direct_interviews_policy` 已部署且路由探测非 `404` | 按组织显式开启并完成真实认证业务与清理任务验收。 |
| 报价、支付与开发者分账 | **代码与隔离数据库闭环已验证，待发布验收** | 支付宝/CNY、开发者版本化定价、固化 `positionId` 与开发者归属的 PaymentOrder、RSA2 验签、可信通知核对、20% 平台收入/80% 开发者应付账本和人工 settlement 模型均已落地；重复通知与并发履约只产生一份结果。 | 应用 `20260815_ai_direct_paid_hiring`，配置真实支付宝商户参数，完成真实下单/通知/错误商户与金额联调，以及生产 Bearer/RBAC 烟测；缺少商户配置时必须保持失败关闭。 |
| Offer | **新契约已实现，待发布验收** | Offer 只在支付成功事务内生成，是唯一、不可撤回的雇佣凭证；读取能力保留，accept/decline/reject/expire/revoke 写入口稳定返回 `409`。 | 发布前确认桌面端不再依赖旧 Offer 状态和写操作，并完成生产契约烟测。 |
| Employment | **支付创建路径已实现，待发布验收** | 只有可信支付通知能在同一事务内创建 Employment；旧公开直接创建入口已关闭，订单固化明确 Position，避免履约时从 Role 的多个 Position 猜测。 | 完成生产迁移、真实身份权限矩阵和支付宝沙箱/商户联调；后续 Employment 生命周期仍按独立状态机治理。 |
| 部门、远程员工和部门任务 | 员工目录实现待运行验收 | `ai_direct_workforce_employee_digests` 已部署；`GET /workforce/employees` 从该投影按公司 recruiter RBAC、状态/部门/职位过滤和稳定 opaque cursor 返回安全展示字段；Offer 接受与 Employment 状态转换在同一事务同步投影 | 缺专用 QA 组织和短期 Bearer token，尚未完成认证 `2xx`、空目录和跨公司 `403` 生产验收；assignment、department-task、统一 dismiss 与公开 audit 查询仍缺。 |
| 中央审计 | 部分实现 | 高风险写入已有 audit/outbox | 缺面向授权用户的 `GET /audit-events`、防篡改证明、统一保留与导出契约。 |
| 签名 Plugin/MCP | 未实现 | capability grant 数据与 API | 缺包签名、Publisher 身份、兼容范围、撤销和运行时 allowlist 验证闭环。 |
| AI 团队市场 | 未实现 | 桌面本地 team 不是远端团队 | 缺不可变 team version、目录、entitlement；支付相关继续延后。 |
| 本地试用数据迁移 | 未实现 | 无 | 缺 preview/apply、digest、ID mapping、幂等和失败不写入保证。 |
| 消息渠道 | 未实现 | 只有本地偏好 | 缺 enrollment、callback 验签、nonce/state、撤销、策略、去重投递与审计。 |
| 持久记忆远端同步 | 与目标契约不一致 | 已有 `/api/v1/memory/obsidian/*` 旧接口 | proposed 要求显式文件、preview/apply、collection/document grant；旧接口不能直接作为 `persistent_memory_sync_v1`。 |
| 开发者皮肤包市场 | 未实现 | Agent 形象和桌面模板资产存储可复用校验模块 | 商品、版本、预览、审核、entitlement 均需独立建模；不能把本地图片上传为商品。 |
| 金沙凭据跨端状态 | 部分实现，执行关闭 | 加密 vault、状态/保存/撤销路由模块、`20260805` 已部署 | Provider runtime 与 Executor 未生产启用；路由是否挂载依赖运行配置，不能把迁移部署等同于可调用。 |
| Provider 执行 | 实现但未启用 | 独立单并发 Executor、预算/限流/审计 | 无生产 keyring/Executor/真实 canary；两个 kill switch 保持关闭。 |
| 签名更新、设备策略、MDM/proxy | 未实现，后置 | 桌面本地发布流程 | 必须独立版本契约和安全验收，不在当前 v1 中伪造。 |

## 4.1 当前桌面联调入口

Web 登录链路已在生产完成 GitHub OAuth 与邮箱 magic link 的真实验证。Desktop `1.1.0` discovery、迁移和完整路由契约已经发布；原生桌面 OAuth 仍需真实授权闭环后才能作为正式客户端登录契约。桌面客户端当前只能通过平台拥有的短期 Bearer `TokenProvider` 调用已启用的受保护能力。

当前联调顺序：

```text
平台拥有的短期 TokenProvider
  -> GET /api/v1/ai-direct-hiring/session
  -> 已上线 Desktop API v1（形象、侧栏、模板）
```

桌面端必须以 `/session` 返回的身份和组织 scope 为唯一会话真值。不得复制浏览器 Cookie、在 Electron `safeStorage` 或磁盘持久化 Bearer token、解析 JWT 后自行授权，或将本地用户/组织数据作为请求中的授权依据。遇到 `401 AUTH_REQUIRED` 时清除内存 token 并回到平台登录入口。

原生 OAuth/PKCE、desktop custom URI callback、IP loopback callback、refresh rotation/reuse detection、30 天绝对期限、7 天空闲期限、账号停用/删除触发 family revoke、RFC 7009 revocation、双 issuer identity bridge 和版本化 auth discovery 已进入服务端实现。它们在目标环境静态 client 注册锁定、真实浏览器两条授权闭环、生产配置和统一发布门禁完成前保持未发布；客户端不得提前启用或自行实现替代协议。

## 5. Employment 与支付雇佣状态

### 5.1 付费雇佣创建边界

```text
awaiting_payment
  -> 支付宝可信成功通知
  -> paid + Offer issued + Employment onboarding + 20%/80% ledger
```

上述状态变化在同一数据库事务内提交。任一 Offer、Employment、账本、事件、审计或 outbox 写入失败，PaymentOrder 也不能保留为 `paid`；通知入口返回支付宝 `failure`，等待可信重复通知重试。客户端支付页面、同步跳转或支付宝下单成功均不能代替可信支付成功通知。

Offer 不存在 `accepted/rejected/expired/revoked` 产品状态。旧写入口保持稳定 `409`，桌面端只能读取支付履约生成的凭证，不得提供接受、拒绝或撤回操作。

### 5.2 Employment 后续生命周期

支付履约创建 Employment 后，后续 onboarding、active、paused、transferring、offboarding、terminated 仍由独立 Employment 状态机治理。桌面端只能展示服务器状态，不能根据支付动画、Offer UI 或本地 employee 记录推导 Employment。

形象控制权继续遵守既有独占与条件释放约束；支付雇佣事务不得用形象控制权代替 Agent 所有权、开发者收款权或版本发布权。

## 6. API 通用契约的版本差异

桌面 proposed 契约不能直接覆盖已上线 Desktop API v1。

| 项目 | 已上线 Desktop API v1 | proposed 平台契约 | 兼容策略 |
| --- | --- | --- | --- |
| 错误体 | `{ code, error, details? }` | `{ code, error, details?, requestId }` | 可向 v1 加可选 `requestId`；客户端不得要求其必有。 |
| 并发冲突 | `409 REVISION_CONFLICT` | `412 VERSION_CONFLICT` | v1 继续 409；新资源可采用 412，但必须在对应 OpenAPI 固定。 |
| 缺少 `If-Match` | `428 PRECONDITION_REQUIRED` | 未单列 | 保留 v1 行为。 |
| 写请求 | JWT；部分写接口支持/要求幂等 | Bearer + `X-Request-Id` + `Idempotency-Key` | 新高风险接口强制；旧 v1 不做破坏性变更。 |
| 分页 | 模板 `limit/offset` | cursor | 现有 v1 保留；新目录/事件使用 cursor。 |
| 身份 | Convex Auth 短期 Bearer；桌面先经 `/session` 建立 scope | OAuth/OIDC PKCE session | `1.1.0` auth discovery 和服务端 PKCE/refresh/revoke 已实现但未发布；统一门禁前仍只支持平台拥有的 TokenProvider。 |

后端不得同时对同一资源随机返回 `REVISION_CONFLICT` 和 `VERSION_CONFLICT`。错误码是机器契约，不是文案。

## 7. Feature flag 与启用规则

proposed flag 建议保持桌面端命名：

- `remote_identity_v1`
- `candidate_catalog_v1`
- `interviews_v1`
- `hiring_payment_v1`
- `remote_workforce_v1`
- `team_marketplace_v1`
- `signed_capabilities_v1`
- `local_trial_migration_v1`
- `message_channels_v1`
- `persistent_memory_sync_v1`
- `skin_marketplace_v1`

规则：

1. flag 由服务器按环境、组织、用户授权签发，客户端不能自开；
2. 数据表或路由存在不代表 flag 可以开启；
3. 每个 flag 必须绑定 API 版本、迁移版本、权限矩阵、失败关闭行为和测试证据；
4. session 缺失、过期、撤销或 flag 不存在时，客户端回到本地能力，不删除本地记录；
5. 不得用一个总开关一次开启全部 proposed 能力。

当前 `/api/v1/desktop/contract` 尚未发布这些 flag；服务器文档不得声称它们已可供客户端消费。

## 8. 后端模块职责建议

后续实现按领域拆分，避免继续扩大 `aiDirectCore.ts` 或复活单体 `aiDirectHiring.ts`：

```text
DesktopContractModule
  -> 发现、版本、能力清单，不做业务授权

IdentitySessionModule
  -> OIDC/PKCE、session、组织选择、feature flags

AgentPublicationModule
  -> Agent 草稿、不可变版本、审核和发布

CandidateCatalogModule
  -> viewer-scoped profile、disclosure、availability、分类和计数

InterviewModule
  -> conversation、message、read cursor、push reconciliation

HiringModule
  -> 雇佣意图、Offer、Employment、状态事件、控制权

PaidHiringModule
  -> 价格快照、PaymentOrder、支付宝适配、可信通知、20%/80% 账本与人工结算记录；支付成功事务调用 HiringModule 的受控履约端口

WorkforceModule
  -> department、position、assignment、task、capability grant

RuntimeModule
  -> run projection、worker lease、artifact metadata、Provider executor

AuditModule
  -> 统一写入端口、查询、保留、导出和脱敏

LocalMigrationModule
  -> preview plan、apply、digest、ID mapping；禁止任意路径
```

高风险业务写入的数据流固定为：

```text
认证主体 + 组织上下文
  -> RBAC / 当前版本 / feature flag
  -> 领域状态机
  -> 单一 MySQL 事务
       业务状态 + 领域事件 + 审计事件 + outbox
  -> 提交后异步投影/通知/运行
```

Provider、支付 webhook、客户端回调和本地责任标签均不能绕过该事务边界直接改 Employment 或 capability grant。

## 9. 待产品确认的桌面文档冲突

### 9.1 侧栏同步

桌面端 `DESKTOP_WORKSPACE_CONTRACT.md` 将导航偏好描述为单设备本地数据；服务器已发布的 Desktop API v1 与 `specs/desktop-sidebar-local-html-templates.md` 将侧栏定义为账号级跨设备同步。

处理规则：

- 不回退或删除已上线 v1；
- 在桌面产品文档统一前，不扩大同步字段；
- 服务端继续拒绝模板业务数据、浏览器存储、Markdown、绝对路径和任意远程 URL；
- 客户端启用同步前必须明确选择 v1 账号同步语义，而不是把本地偏好静默上传。

### 9.2 金沙凭据

桌面本地试用文档使用 Electron `safeStorage` 的设备凭据；凭据同步文档要求登录后服务器加密保存并跨端只同步“已配置”状态。二者应理解为两个模式：

- 未连接平台：设备凭据，不上传；
- 已登录且明确提交到平台：服务器凭据，只返回状态，运行由服务器调度。

迁移不得自动读取并上传 `safeStorage` 中的 Key。用户必须显式提交，并由固定金沙网关验证。

## 10. 开发优先级

### P0：让桌面能够安全识别平台能力

1. 设计并发布 `/session` 与 auth discovery，明确现有 JWT 到 OIDC/PKCE 的兼容期；
2. 为 session 增加组织、角色 grant 和逐能力 feature flags；
3. 把已上线 Jobs 的面向桌面 DTO 纳入机器可读 OpenAPI，修正文档中的 artifact 延后状态；
4. 统一新增接口的 request ID、幂等和错误码规则，不破坏 Desktop API v1。

### P1：候选目录与付费招聘发布闭环

1. 完成 Candidate Catalog、Workforce 与真实 Bearer 身份的组织权限验收；
2. 部署付费雇佣迁移与 Desktop `1.2.0` 契约；
3. 使用真实支付宝沙箱/商户配置验证下单、RSA2 通知、重复通知、错误商户和错误金额；
4. 验证 PaymentOrder、Offer、Employment、20%/80% 账本和 outbox 的生产原子性；
5. 确认桌面端不再展示 Offer accept/decline/revoke/expire。

### P2：显式迁移与企业安全

1. 本地试用 preview/apply 迁移；
2. 签名 Plugin/MCP 与撤销 allowlist；
3. 持久记忆重构为显式 preview/apply，不直接启用旧 Obsidian 路由；
4. 消息渠道 enrollment、callback 验证和投递审计。

### P3：扩展商业能力和企业设备能力

退款、拒付、税费、渠道费、自动结算、团队商品、皮肤商品、设备真实性、签名更新、MDM/proxy 均后置。首期付费雇佣只支持支付宝/CNY 和后台人工结算；未完成生产支付门禁前，`hiring_payment_v1` 继续保持关闭。

## 11. 每项能力的完成定义

一个 proposed 能力只有同时满足以下条件才能从“未实现/部分实现”改为“已上线”：

1. Prisma 加法迁移在全新 MySQL 和生产发布链验证；
2. 路由确实由当前生产入口挂载，API 启动时完整 manifest 校验通过；
3. manifest、机器可读 OpenAPI 与客户端文档的 method/path 完全同步；
4. 服务端逐请求执行租户、RBAC、状态和资源归属校验；
5. 高风险写入具备幂等、审计、outbox 和事务原子性；
6. 正常、401、403、跨组织、撤销、重复幂等、版本冲突和网络恢复测试通过；
7. feature flag 默认关闭并完成按组织灰度；
8. 生产以未认证请求逐个探测受保护 operation；允许认证、授权、校验或功能关闭响应，任何 `404` 都阻塞路由契约发布；
9. 对需要声明为业务可用的组织能力，使用专用短期 token 和隔离组织完成正常 `2xx`、RBAC、跨组织与 feature flag 关闭路径；仅通过非 `404` 烟测不得标记为业务已上线；
10. 可回滚发布记录完成。