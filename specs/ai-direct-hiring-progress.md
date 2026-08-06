
> **QA 组织与公司实测（2026-03-14，以浏览器实际行为为准）**
>
> - 可回收 QA 身份已通过邮箱 OTP 登录，并在受保护组织管理页面创建隔离组织 `QA-EmployeeDirectory-2026-03-14`；该身份在组织中显示为 `owner`。这证明 Web Bearer 身份桥与组织创建写路径可用，但不等同于生产发布完成。
> - 已在该组织创建 active 公司 `company-A`。组织成员与公司实体是两类资源：误把 `company-A` 填入“组织成员用户 ID”只会创建成员关系，不能替代公司创建。
> - 当前 Web 管理页支持组织、公司、公司成员、项目和 Agent 岗位管理；它不提供真实 Agent 雇佣表单。`/recruit-ai` 仅在浏览器内选择目录项，选择不持久化，且“在客户端继续招聘”只跳转桌面客户端下载页。
> - 员工目录的下一条可验证链路必须是：为 `company-A` 建立 QA 的 `recruiter` 成员关系 → 创建有效 Employment → 同事务写入 workforce employee digest → 以该 QA 身份请求目录。仅在完整链路具备可清理 fixture 后，分别断言有数据 `200`、授权空列表 `200` 与无成员公司 `403`。
> - 不得索取、复制或记录 QA 的密码、OTP、Bearer token、JWT 或任何凭据；fixture 只能通过已认证受保护 API 创建和清理，禁止直接写数据库。

> **审批治理与生产迁移更新（2026-08-14，以实时结果为准）**
>
> - `20260814_ai_direct_approval_governance` 已应用。生产 `prisma migrate status` 显示 migration 链共 17 段，数据库 schema 为最新状态。
> - 审批委派与超时均有独立的不可变领域历史：委派同时写入 delegation、审批事件、中央审计与 outbox；超时在行锁和 `pending` 条件更新成功后才写入 `approval.expired` 事件、审计与 outbox。当前审批记录只保存当前审批人和当前状态。
> - `iclawstore-approval-timeout` 未启动。`APPROVAL_TIMEOUT_ENABLED` 未配置，避免在没有显式运维确认时启用自动决策进程。
> - timeout worker 定向测试 `2/2` 通过；本轮早期服务端 TypeScript 检查通过。后续可用内存仅约 507 MiB，swap 约使用 1.7 GiB，未执行额外前端构建、全量测试或隔离 MySQL；这不是测试失败。
> - 本轮未执行 PM2 restart、reload 或 start。复核时 API、runtime dispatcher 与审计导出 worker 均为 `online`。审批业务仍待真实身份、委派链、并发裁决、Offer 联动与 timeout worker 显式启用后的运行验收。

> **当前运行态验收（2026-08-05，以实时结果为准）**
>
> - `iclawstore-api` 已恢复并以 PM2 受限配置运行，内存上限 `256M`；本机 `/health` 与公网 `/api/v1/desktop/contract` 均返回 `200`，契约版本为 `1.1.0`。本次恢复同时补齐了 manifest 已声明但未装配的模板审核/授权契约路径，并通过 server 构建与 Desktop 契约测试 `7/7`。
> - `iclawstore-runtime-dispatcher` 独立 `online`，内存上限 `128M`；只读队列核验为空，近期运行指标在内存预算内。历史 closed-connection 日志不构成当前失败证据。
> - Prisma 使用本机受限 DDL 迁移账号核验为 `Database schema is up to date`，`20260812_ai_direct_template_review` 与 `20260813_ai_direct_audit_governance` 已应用。
> - 原生桌面 OAuth、认证 Session 成功链路和 Feature Flag 正反行为**均未完成真实验收**：运行环境缺少桌面 OAuth issuer/client ID/audience 配置，公网 discovery 不含 `auth`；仅确认未认证 `/session` 返回 `401`；没有可回收测试身份或隔离组织用于验证 `/session` 的 `200` 以及开关启用、禁用和组织覆盖。
> - 因此状态仍是 **部分发布，业务验收未完成**。后续必须按 OAuth discovery/JWKS → PKCE → 认证 `/session` → 各 Feature Flag enabled/disabled 的顺序完成真实闭环；在此之前不得把路由可达、迁移完成或未认证 `401` 记录为 OAuth/Session/Feature Flag 通过。
>

> 完整缺口顺序、状态定义和后续后台工作包见 [`ai-direct-admin-capability-gaps.md`](./ai-direct-admin-capability-gaps.md)。
>
> - 后台管理：组织/公司、模板审核、中央审计、经营总览、AI 员工目录、成本账本、审批中心与系统状态均已完成代码整合；模板审核、中央审计和审批治理迁移已应用。
> - 中央审计的导出 consumer 以 `iclawstore-audit-export` 单实例运行；审批 timeout worker 已实现并在 PM2 配置中保持 opt-in，但因 `APPROVAL_TIMEOUT_ENABLED` 未配置而未启动。
> - 审批中心新增不可变审批事件与委派记录。委派、裁决和超时的状态变更必须在同一事务写领域事件、中央审计与 outbox；当前审批记录不是历史载体。
> - 验证证据：组织管理、模板审核、审计路由/导出 worker 的定向测试已通过；timeout worker 定向测试 `2/2` 与本轮早期服务端 TypeScript 检查通过。其后可用内存低于门槛，前端构建、全量测试及隔离 MySQL 未执行。
> - 当前状态只能记为 **部分发布，业务验收未完成**：迁移已应用不代表审批 worker 已启用，也不代表真实身份/RBAC、委派链和 Offer 联动已通过生产验收。
>
> **对外品牌与兼容边界（2026-08-04）**
>
> - 对外平台中文名固定为 `AI直聘`，英文名固定为 `Ai Work`；网站标题、导航、登录、PWA、SEO 与分享图均使用该品牌，主交互色为青绿色。
> - `AI Direct Hiring` 仅表示招聘业务模块及 `/api/v1/ai-direct-hiring` 的 API 语义，不能替代平台主名称。
> - `clawhub`、`clawdhub` 的 CLI、npm 包名、公开 API 路径、发现协议及内部历史标识为兼容层，禁止因本次改名修改；Soul 模式跳转到兼容站点时可继续展示其原名称。
> - 官方静态 Logo 源为仓库根目录 `ai-work-icon.svg`，发布资产为 `public/ai-work-icon.svg`；根页分享图为 `public/og.svg`。不得继续引用旧红色 OG 或龙虾 Logo 资产。


> **Desktop 1.1.0 生产发布更新（2026-08-05）**
>
> - 已创建迁移前 AES-256 加密全库备份 `/home/ubuntu/backups/iclawstore/production-migrations/iclawstore-before-desktop-1.1-20260804T172510Z.sql.gz.enc`，并通过解密、`gzip -t` 与 SHA-256 完整性校验。
> - `20260808_ai_direct_desktop_jobs_cursor`、`20260809_ai_direct_interviews_policy`、`20260810_agent_publication_catalog`、`20260811_ai_direct_workforce` 已按 Prisma 顺序部署；迁移状态为 up to date，关键表、字段和索引只读核验通过。
> - Server TypeScript 构建通过，`iclawstore-api` 已 reload 并保持 `online`；启动 manifest 校验未发现缺失路由。
> - 生产 discovery/OpenAPI 与逐 protected operation 烟测通过：`1` 个测试文件通过，`2 passed | 3 skipped`，原 Candidate Catalog、Workforce 和 Candidate Matching 的 8 个 `404` 已消除。
> - 以上证据只解除路由契约发布阻塞。生产没有专用 smoke token，`candidateCatalog` 默认关闭，且没有已启用组织的完整隔离测试数据链；因此 Candidate Catalog、Departments、Positions、Candidate Matching 的带认证 `2xx` 业务烟测未执行。未修改 feature flag，未创建或清理生产业务数据。
>
> **当前任务核对快照（以当前工作区代码、已挂载路由、测试与规格为证据）**
>
> 本节覆盖 `oauth-identity`、`session-capabilities`、`jobs-artifacts`、`agent-publication`、`candidate-catalog`、`interviews`、`hiring-closure`、`workforce-audit` 与 `release-gate`。状态含义：
>
> - **实现完成，待发布验收**：核心代码和定向测试已存在，但尚未通过真实客户端闭环与统一发布门禁；
> - **部分完成**：已有可复用实现，但 DTO、状态机、测试或机器契约仍缺；
> - **未实现**：当前核心入口没有该领域能力；旧的未挂载源码和仅有表结构不算完成。
>
> | 任务 | 当前状态 | 已有证据 | 尚缺 |
> | --- | --- | --- | --- |
> | `oauth-identity` | **实现完成，待发布验收** | Convex OAuth/OIDC Provider、Authorization Code + PKCE S256、固定 public client 注册逻辑、双 redirect 类型、refresh rotation/reuse detection、30 天绝对期限、7 天空闲期限、账号停用/删除触发 family revoke、RFC 7009 revoke、Fastify Web/Desktop 双 issuer bridge 与定向测试均已落盘。 | 在目标环境执行并锁定静态 client 注册；真实桌面浏览器授权、custom URI 与 loopback 两条闭环；生产配置烟测；统一静态、类型、迁移和发布门禁。 |
> | `session-capabilities` | **路由已发布，业务验收部分完成** | `/session` 已挂载，按 active membership 返回用户、组织、显式选择结果、`grantVersion`、角色权限、组织级 flags 与 `runtimeCapabilities`；既有真实 GitHub token `/session` 成功路径与定向路由测试已通过。 | 真实 native OAuth token 的管理员组织权限闭环；Candidate Catalog/Workforce 场景的专用 token + 隔离组织验收。 |
> | `jobs-artifacts` | **路由契约已发布，业务验收待补** | Jobs cursor 列表/详情、受控 artifact metadata 与内容流式读取已挂载并进入 Desktop OpenAPI；`20260808_ai_direct_desktop_jobs_cursor` 已部署，完整路由烟测通过。 | 配置并验证真实 `AI_DIRECT_ARTIFACT_ROOT`、跨组织可见性与篡改对象的带认证端到端门禁。 |
> | `agent-publication` | **迁移与路由发布完成，业务验收待补** | 独立 `AgentPublicationModule` 已挂入 core；草稿、版本、审核提交/裁决、发布、审计/outbox 和发布时 digest 更新均已实现；`20260810_agent_publication_catalog` 已部署。 | 补真实认证、RBAC、写入幂等与事务的受控生产验收。 |
> | `candidate-catalog` | **路由发布完成，组织能力默认关闭** | digest 服务、目录/详情/分类路由、服务端全文搜索、稳定 cursor、组织 membership + feature flag 授权和安全 DTO 已存在；迁移已部署且生产路由不再 `404`。 | 当前无启用 `candidateCatalog` 的组织或专用 smoke token；带认证 `2xx`、跨组织、撤权和投影回归仍待验收。 |
> | `interviews` | **迁移与路由发布完成，组织能力默认关闭** | 独立路由、保留策略、legal hold、用户删除队列、受管图片/PDF 附件与低资源 cleanup consumer 均已实现；`20260809_ai_direct_interviews_policy` 已部署。 | 按组织显式开启 `interviews`，完成真实认证业务与清理任务验收。 |
> | `hiring-closure` | **代码完成，待发布验收** | `POST /offers/:id/accept` 是唯一 Employment 创建入口；Offer/Employment 同事务、`offerId` 唯一、重放幂等，并同步更新组织 `isEmployed` 投影。 | 补全撤销、取消、交接和 `transferring` 业务规则；完成统一发布与生产回归。 |
> | `runtime-guardrails` | **受控运行中，验收未完成** | API/dispatcher/executor 已拆分进程预算与连接池：API pool 6、dispatcher pool 2、executor pool 1 且并发 1；executor 保持关闭。 | 完成 30 分钟 RSS/heap/swap/队列深度观测；低内存拒绝与排队压测尚未执行。 |
> | `workforce` | **迁移与路由发布完成，业务验收待补** | 独立 WorkforceModule、Department → Position → AgentRole、开放职位校验、Candidate Matching 和 Employment 编制投影已实现；`20260811_ai_direct_workforce` 已部署且生产路由不再 `404`。 | 当前无完整隔离测试组织链和短期 token；补 Departments、Positions、Matching 的带认证 `2xx`，以及跨公司、编制满额、重放和终止释放回归。 |
> | `workforce-audit` | **三个后台核心包代码完成，待验证** | 组织/公司统一 DTO、cursor、状态机和 `/management` 页面已整合；独立模板审核模块具备待审/拒绝/发布/下架、审计/outbox；中央审计具备组织权限、脱敏、cursor、异步导出 Job、短时 token 和单连接 CSV consumer，新路由已挂载且加法迁移/Prisma 声明已落盘。 | 串行完成 schema、服务器定向测试（含导出 worker）、管理前端测试、TypeScript 与隔离 MySQL；将 opt-in consumer 接入生产进程配置；为平台模板事件建立真实组织归属前不得混入组织审计；完成迁移和生产验收。 |
> | `release-gate` | **路由发布门禁已完成** | Desktop `1.1.0` 使用单一 method/path manifest；OpenAPI 完整一致性测试、Fastify 启动路由校验、故意缺路由失败测试、四段生产迁移和逐 operation 非 `404` 烟测均通过。 | 真实 native OAuth 与 artifact 闭环；对需声明业务可用的组织能力补专用 token + 隔离组织的认证 `2xx` 门禁。 |
>
> **下一开发顺序**：先准备专用短期生产 token 和可回收的隔离组织夹具，以组织级 flag 灰度完成 Candidate Catalog、Departments、Positions、Candidate Matching 的带认证 `2xx`、RBAC 与关闭路径验收；未完成前不得把“路由已发布”升级为“业务已启用”。OAuth Provider 的 custom URI/loopback 真实授权闭环与 artifact 受管存储验收继续独立推进，Executor 保持关闭。内存受限服务器不得并行运行构建、MySQL 集成测试或全量测试。

> **统一 Web / AI 直聘身份（2026-08-03）**
>
> - 身份源统一为 Convex Auth。GitHub、Resend 邮箱 magic-link、微信网站应用均进入 Convex Auth；Fastify/MySQL 不维护 OAuth token、登录 Cookie 或第二套 GitHub OAuth。旧 `server/src/routes/auth.ts` 已删除且未发现残留引用。
> - Web 调用 Fastify 时只发送短生命周期 Bearer token，显式使用 `credentials: "omit"`；401 最多强制刷新一次，刷新失败不回退旧 token 或 Cookie。
> - Fastify 严格验证 Convex JWT issuer、`aud=convex`、JWKS 与有效期。Convex Auth 的 `sub` 为 `userId|sessionId`：身份桥严格解析两个非空、无空白分段，使用第一段稳定 `userId`，并要求它与同一 token 查询得到的 Convex `users:me._id` 一致；账号删除、停用、查询失败或不一致均 fail-closed。
> - MySQL `ai_direct_auth_identities` 只保存已验证的 `issuer + userId -> userId` 稳定映射，禁止保存完整复合 `sub` 或 `sessionId`。组织上下文每请求读取 active membership；请求指定的组织已撤权时不能成为当前组织。
> - 身份桥初始化与 API 可用性已隔离：配置、OIDC discovery 或 JWKS 不可用时，健康检查和公开 API 仍可启动，但所有受保护 AI 直聘路由稳定返回 401。不得回退历史 `JWT_SECRET` 认证。
> - Fastify 必需配置：`CONVEX_AUTH_ISSUER`（可回退 `CONVEX_SITE_URL`）、`CONVEX_URL`（可回退 `VITE_CONVEX_URL`）；`CONVEX_AUTH_AUDIENCE` 默认 `convex`；反向代理无法公开 discovery 时可显式设置 `CONVEX_AUTH_JWKS_URI`，但其密钥仍必须属于同一 issuer。
> - Convex provider 配置：GitHub 使用 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`；邮箱使用 `AUTH_RESEND_KEY`，可选 `AUTH_EMAIL_FROM`；微信只有 `AUTH_WECHAT_APP_ID` 与 `AUTH_WECHAT_APP_SECRET` 同时存在时启用。禁止记录 provider options 或 client secret。
> - 数据库迁移为 `20260807_ai_direct_identity_bridge`。发布前必须先在隔离测试库应用并验证唯一键并发；生产回滚先停用身份桥路由，再删除该映射表。表中没有 OAuth token，无需迁移账号凭据。
> - OIDC discovery 与 JWKS 已在本机和公网验证可用；Nginx 对 `/.well-known/openid-configuration` 与 `/.well-known/jwks.json` 的精确转发已生效。
> - 缺失 token 的受保护 AI 直聘请求仍返回 401，身份桥继续 fail-closed；不得回退历史 `JWT_SECRET` 认证。
> - 真实 GitHub 登录 Bearer token -> `/api/v1/ai-direct-hiring/session` 成功路径已于 2026-08-04 验收：刷新后的短期 token 返回 `200`，组织数量 `0`、当前组织 `null`，feature flags 为 `aiDirectHiring=true`、`desktopIdentityBridge=true`、`wechatLogin=false`。脱敏生产库核验显示 1 条稳定身份映射、复合 subject 数量为 0，API 日志无新的异常分支；统一身份桥已具备生产成功路径证据。
> - 已通过：身份桥/Session 定向测试 `14/14`、服务端 `tsc -p server/tsconfig.json --noEmit`。根项目全量门禁未运行；不得在当前机器运行全量 `ci:unit`、前端构建或并行测试。

> **生产 SSR 运行快照（2026-08-03）**
>
> - 正式前端由 systemd 单独管理，unit 为 `/etc/systemd/system/iclawstore.service`，启动 entry 为 `.output/server/index.mjs`，监听 `127.0.0.1:3000`；PM2 不得重新接管此前的 Vite 开发服务器入口。
> - unit 必须加载项目 `.env.local`。缺少构建时所需的公开 Convex URL 配置会导致主页 SSR 返回 500；文档不得记录该配置的实际值。
> - 受限内存构建使用 `NODE_OPTIONS='--max-old-space-size=1536' bun --smol x vite build`，随后执行 `bun scripts/copy-og-assets.ts`；验收要求 `.output/server/index.mjs` 存在。
> - Nitro beta 会把根 `assets/` 中的 CSS 作为 `serverAssets` 内嵌并生成带 `.css` 后缀的 raw 虚拟模块，进而被 PostCSS 错误处理为 CSS。构建配置必须排除此内部 CSS 内嵌；`.output/public` 下的静态 CSS 仍按常规方式发布。
> - 已验证直连 `127.0.0.1:3000`、使用本机 Nginx HTTPS 转发以及真实公网 HTTPS 首页均返回 SSR HTML。此结论不等同于身份桥的有效 token 成功路径已验收。

> **Web / 服务器后续代开发入口（2026-08-03）**
>
> - 组织/公司管理、Agent 开发者中心、候选市场、非支付招聘、面试、云端运行中心、形象管理、模板发布审核和中央审计的完整工作包已统一写入 `specs/ai-direct-web-server-roadmap.md`。
> - 该路线图记录已有基础、真实缺口、模块职责、依赖和完成定义；写入路线图不代表路由、页面、迁移或生产能力已经完成。
> - 桌面与平台的数据边界仍以 `specs/ai-direct-desktop-platform-integration.md` 为准；生产事实仍以本进度文档顶部快照和实时行为为准。
>
> **桌面端文档对齐结论（2026-08-03）**
>
> - 已以 `AI直聘桌面端/docs/` 为产品真值完成服务器侧契约分层和差距盘点，新增 `specs/ai-direct-desktop-platform-integration.md`。
> - 当前生产 discovery/OpenAPI 声明 `Desktop Client API 1.1.0`；`20260808` 至 `20260811` 迁移、当前 API 构建部署、启动 manifest 校验和逐 operation 非 `404` 烟测均已完成，原 Candidate Catalog、Workforce 与 Candidate Matching 的 8 个路由漂移已解除。该结论不代表组织能力已启用：`candidateCatalog` 默认关闭，相关带认证 `2xx` 业务烟测仍待专用 token 和隔离测试组织。
> - 当前挂载服务已有组织、公司、项目、岗位、Offer、Employment、审批、能力授权、Jobs 和 Worker runtime，但这些能力并未全部进入桌面 OpenAPI；未挂载的 `aiDirectHiring.ts` 中 Agent 发布路由不算生产能力。
> - 后端下一优先级调整为：`/session` 与 OAuth/OIDC PKCE 契约、按组织 feature flags、Jobs 桌面 OpenAPI、Agent publication 拆分、候选目录、面试和非支付招聘闭环。支付、设备真实性认证、签名更新、团队/皮肤商业化继续后置。
> - 桌面本地 `projectId`、队列、产物、审批责任标签、`.aidhbackup`、模板业务数据和本地记忆不得静默上传，也不得被解释为企业身份、授权或中央审计。
> - 已识别两项需产品统一的桌面文档冲突：侧栏“账号跨设备同步”与“设备本地偏好”，以及 Electron `safeStorage` 设备 Key 与服务端跨端凭据。服务器保持已上线 v1，不扩大同步范围；任何设备 Key 上云都必须由用户显式提交。

> **生产发布结论（2026-08-03 03:40 UTC+8）**
>
> - 严格加密备份、解密/gzip/SHA-256 完整性检查和只读冲突预检均已通过；`20260805_ai_direct_provider_runtime` 的零 DDL failed 记录已按 Prisma 流程标记 rolled back，随后与 `20260806_agent_appearance_desktop_contract` 一并成功部署。
> - Prisma 共 8 段迁移，生产状态为 up to date，未解决 failed migration 为 0；迁移后核对 19 个 Provider runtime 列、9 张形象/桌面表、2 个形象外键，控制权冲突、孤儿和回填不一致均为 0。
> - 临时迁移账号已撤销，bootstrap 文件已删除；删除回执暴露凭据后 MySQL root 密码已再次轮换，不再为发布保留 root 凭据文件。
> - 服务器受管本地存储已配置为仓库外 `/home/ubuntu/.local/share/iclawstore/managed-assets`，目录权限 `0750`，`api.env` 保持 `0600`。不使用 S3/R2。
> - PM2 已按 `ecosystem.config.cjs` reload；Web、API、outbox dispatcher 均为 `online`。生产尚无 `executor.env`，因此 Provider executor 未启动，真实金沙 canary 仍不属于本次发布结果。
> - 首次 reload 暴露 `MANAGED_ASSET_ROOT` 缺项并已修复；烟测又发现 Fastify 错误处理器晚于子路由注册，导致未认证桌面接口返回 500。错误边界已调整为先注册、后挂载路由，相关 20 项测试和服务端 TypeScript 构建通过。
> - 本机健康、Web、公网站点、桌面契约/OpenAPI、未认证 401 边界均通过；短时随机身份的侧栏首次写入、stale revision 409、重置、Logo 上传/受控读取/删除、模板目录、Agent 404 以及公网已认证读取均通过，烟测数据库记录与回收站文件已清理。
> - Employment 控制权接管/竞争/终止归还和模板 entitlement 已通过隔离真实 MySQL 并发门禁；生产库当前没有可用 Employment/模板业务夹具，因此本次公网烟测没有制造生产公司、Agent 或模板数据来重复这些破坏性流程。
> - 下一主交付应转向桌面客户端运行时：消费已发布的 v1 契约，实现侧栏同步、Agent 2D/3D 展示和本地 HTML 模板安装/运行；Web 继续不使用桌面侧栏。
>
> 下方 `2026-08-02 09:15` 快照保留为发布前历史记录；与本区块冲突时以本区块和实时运行行为为准。

> **当前生产快照（2026-08-02 09:15 UTC+8）**
>
> - 招聘核心、事务 outbox/dispatcher、Jobs、运行指标和受鉴权 Worker 路由均已通过 `aiDirectCoreRoutes` 挂载到 `/api/v1/ai-direct-hiring`；旧 `aiDirectHiring.ts` 未挂载。当前分支凭据路由也由核心入口独立接线，但生产 feature gate 关闭。
> - 生产迁移链已应用至 `20260804_ai_direct_worker_runtime`；分支新增的 `20260805_ai_direct_provider_runtime` 尚未部署，因此不得再把当前 Prisma migration status 描述为最新。
> - 发布门禁：服务端 TypeScript 零错误；核心单测 `62/62`；全新临时 MySQL 门禁已覆盖招聘 HTTP、Agent 形象控制权、双公司并发接管、侧栏 revision 行锁冲突、dispatcher 事务/幂等、worker 组织隔离/lease 回收/artifact 验证。
> - PM2：`iclawstore-api` 与 `iclawstore-runtime-dispatcher` 均为 `online`，进程列表已保存；前端 `iclawstore` 未因后端发布或凭据轮换重启。API 与 Dispatcher 分别使用独立、仅限业务库 DML 的 MySQL 账号；Dispatcher 连接池上限为 2。生产凭据已移出仓库，存放在 `/home/ubuntu/.config/iclawstore/`，目录权限 `700`、文件权限 `600`；PM2 dump 权限固定为 `600`。
> - 安全轮换：API JWT secret 和 MySQL 根密码已生成随机新值，历史根凭据已验证失效；生产模式缺少 `JWT_SECRET` 时 API 会拒绝启动。上线基线中 outbox 与 workflow run 均为空，观察窗口内未新增错误日志。
> - 生产烟测：本地 `/health` 为 `200`；本地/公网招聘、Obsidian、Jobs、runtime、worker 未认证均为 `401`；公网主页为 `200`。公网 `/health` 未由现有反向代理暴露，返回 `404`。
> - Worker runtime 迁移前备份：`/home/ubuntu/backups/iclawstore/production-migrations/iclawstore-before-worker-runtime-20260801T203832Z.sql.gz`，目录与文件权限受限，`gzip -t` 通过。
> - 金沙 Provider 执行层、加密凭据运行时、单并发 Executor、RPM/TPM 限流、预算与模型成本审计已在当前分支实现；Provider 网络调用只存在于独立 Executor，不进入 API 或 `jobQueue.ts`。
> - `20260805_ai_direct_provider_runtime` 仍未部署生产；没有生产 `executor.env`、keyring 或 Executor 进程，没有执行真实金沙凭据 canary，`PROVIDER_EXECUTION_ENABLED` 保持关闭。
> - 当前分支 Provider/Executor 定向与临时 MySQL 测试累计 `34/34` 通过，其中包含本机短生命周期 mock HTTP 对 Worker API 与金沙 Chat Completions 的端到端串联，以及全新临时库上的 7 段迁移链/Worker lease 测试；临时库已删除。最终 TypeScript 复核因可用内存低于 700 MB 门禁而未启动，不是编译失败。
> - Agent 形象、桌面侧栏和模板服务端 v1 已在当前工作区实现：`20260806_agent_appearance_desktop_contract`、受管本地文件存储、Employment 同事务控制权、OpenAPI 3.1 与客户端文档均已落盘；尚未部署生产。
> - 本次低内存门禁验证：服务端 TypeScript 构建通过；形象权限、文件安全、侧栏、模板和契约定向测试 `22/22` 通过；OpenAPI YAML 成功解析为 21 个 paths、17 个 schemas。
> - 全新 MySQL 闭环已通过：使用仅限 `clawhub_it_%` 的本机测试管理账号创建随机空库，完整应用 8 段迁移链，并串行运行 4 个测试文件、7 个真实 MySQL 用例；覆盖双公司并发接管时恰好一个成功/一个 `APPEARANCE_CONTROL_CONFLICT`、终止归还控制权、侧栏同 revision 并发写入时一个成功/一个稳定 409、outbox 与 Worker runtime 事务。测试库均已自动删除，未使用生产 schema。
> - `20260805_ai_direct_provider_runtime` 与 `20260806_agent_appearance_desktop_contract` 均未部署生产；生产只读 migration status 已确认二者 pending，控制权预检为 `conflictCount=0`、`orphanCount=0`。本轮未执行生产备份、迁移、PM2 reload 或公网新路由烟测。
> - 当前服务器约 3.7 GB 内存，本轮执行任务以 10% 可用内存为硬门禁、512 MB Node 堆和测试单并发运行；swap 使用率偏高，因此禁止并行启动构建、MySQL 测试或生产发布任务。
>
> 下方 Agent/分支/“未运行测试”等内容是凌晨交接快照，仅作历史记录；与本区块冲突时以本区块和实时运行行为为准。

> **目的**:给后续 Agent (E、F、...) 和人类维护者一份"现在我们到了哪里、还差什么"的速查表。
> **当前快照**:`feature/ai-direct-hire-p1-runtime` commit `8284931`(2026-08-01,含 F + G2 运行中心)。
> **整体工作完成度**:**约 88%** — 今晚 7 个 Agent 均已完成各自本地交付；剩余为 E/F/G 分支正式整合、迁移与 CI/e2e 验证、部署和 PR。
> **关联文档**:
>
> - `docs/AI_DIRECT_HIRING_BASELINE.md` - A 基线
> - `docs/AI_DIRECT_HIRING_P1_BACKEND.md` - B 交付
> - `docs/AI_DIRECT_HIRING_P0_MOUNT.md` - C 交付
> - `docs/AI_DIRECT_HIRING_INTEGRATION_REPORT.md` - D 整合报告
> - `docs/AI_DIRECT_HIRING_P1_FRONTEND.md` - E 交付(分支 `feature/ai-direct-hire-p1-frontend`)
> - `docs/AI_DIRECT_HIRING_P2_HIRING.md` - F 交付(分支 `feature/ai-direct-hire-p2-hiring`)
> - `docs/AI_DIRECT_HIRING_P1_RUNTIME.md` - G2 运行中心交付
> - `specs/ai-direct-provider-runtime.md` - Provider 凭据、Executor、成本审计与上线安全契约
> - `docs/AI_DIRECT_HIRING_FINAL_HANDOFF.md` - H 最终交接
> - `specs/ai-direct-agent-appearance.md` - Agent 头像、2D/3D 形象秀与雇佣控制权契约（服务端 v1 已实现，生产待部署）
> - `specs/desktop-sidebar-local-html-templates.md` - 桌面侧栏、本地 HTML 模板与模板市场契约（服务端 API 已实现，客户端运行时待实现）

## 1. 总体进度

| 阶段                                         | 状态          | 产出                                                    | 负责 Agent |
| -------------------------------------------- | ------------- | ------------------------------------------------------- | ---------- |
| **基线快照**                                 | ✅ 完成       | `baseline-mysql-migration-2026-08-01` 标签              | A          |
| **P0 挂载(数据库模型 + 核心路由)**           | ✅ 完成       | 9 个 P0 模型 + 6 个核心路由                             | C          |
| **P1 后端核心(招聘工作流基础设施)**          | ✅ 完成       | 18 个 P1 模型 + RBAC + 幂等键                           | B          |
| **整合 + 静态检查**                          | 🟡 部分完成   | B/C 已整合,`ci:static` 未运行                           | D          |
| **P1 前端(老板工作台 + Agent 管理)**         | ✅ 本地完成   | 9 页面 + 1 布局组件 + 2 库文件,约 1800 行               | E          |
| **P2 招聘流程 API(Offer/Employment 状态机)** | ✅ 本地完成   | 25 路由 + 3 状态机 + 5 测试,2852 行                     | F          |
| **P1 运行中心(队列 + 产物索引)**             | ✅ 精简版完成 | 7 路由 + lease 队列 + 投影 + 2 测试；分支累计约 4126 行 | G2         |
| **最终文档交接**                             | ✅ 完成       | 进度、整合报告和最终 handoff                            | H          |

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

| 工具                                                           | 提供方 | 用途                              |
| -------------------------------------------------------------- | ------ | --------------------------------- |
| `aiDirectErrors.ts` (ErrorCodes enum)                          | C      | 统一错误码(desktop-contract 兼容) |
| `outbox.ts` (publishOutboxEvent)                               | C      | 事务化 outbox 写入                |
| `idempotency.ts` (withIdempotency)                             | B      | 幂等键 + 指纹                     |
| `aiDirectRbac.ts` (requireCompanyRole, requireEmploymentScope) | B      | 权限                              |
| `aiDirectAuth.ts` (requireAuth)                                | B      | 认证                              |

**⚠️ 重复/冲突**:B 和 C 都创建了 `utils/` 下的文件,但**没有命名冲突**——B 的是 `idempotency.ts` / `requestId.ts`,C 的是 `outbox.ts`。

## 5. 测试状态

| 测试                                               | 状态        | 负责 |
| -------------------------------------------------- | ----------- | ---- |
| `server/test/aiDirectHiringRoutes.test.ts`(466 行) | ⚠️ 写完未跑 | C    |
| `server/test/aiDirectRbac.test.ts`(226 行)         | ⚠️ 写完未跑 | B    |
| `server/test/idempotency.test.ts`(84 行)           | ⚠️ 写完未跑 | B    |

**未跑原因**:服务器资源有限,不允许 `bun test` / `bun run ci:unit`。**必须由用户手动跑**。

## 6. 静态检查状态

| 检查                   | 状态        |
| ---------------------- | ----------- |
| `bun run ci:static`    | ❌ **未跑** |
| `bun run format:check` | ❌ 未跑     |
| `bun run lint`         | ❌ 未跑     |
| `bunx tsc`             | ❌ 未跑     |

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

| 路径                          | 分支                                   | 状态               |
| ----------------------------- | -------------------------------------- | ------------------ |
| `/www/wwwroot/iclawstore.com` | `feature/ai-direct-hire-foundation`    | 主仓(用户决策保留) |
| `/tmp/wt-d-merge`             | `feature/ai-direct-hire-integrated`    | ✅ 整合完毕        |
| `/tmp/wt-b-p1backend`         | `feature/ai-direct-hire-p1-backend`    | B 独立分支(保留)   |
| `/tmp/wt-c-mount`             | `feature/ai-direct-hire-p0-mount`      | C 独立分支(保留)   |
| `/tmp/wt-baseline`            | `feature/baseline-mysql-migration-fix` | 基线(保留)         |
| `/tmp/wt-e-p1frontend`        | `feature/ai-direct-hire-p1-frontend`   | 🟡 **E 即将创建**  |

## 10. 今晚 7 个 Agent 完成情况

| Agent | 职责        | 分支 / Commit                                      | 状态                  | 报告                                      |
| ----- | ----------- | -------------------------------------------------- | --------------------- | ----------------------------------------- |
| A     | 基线快照    | `feature/baseline-mysql-migration-fix` / `916ce2b` | ✅ 完成               | `AI_DIRECT_HIRING_BASELINE.md`            |
| B     | P1 后端核心 | `feature/ai-direct-hire-p1-backend` / `8788b8a`    | ✅ 完成               | `AI_DIRECT_HIRING_P1_BACKEND.md`          |
| C     | P0 挂载     | `feature/ai-direct-hire-p0-mount` / `d39eaf9`      | ✅ 完成               | `AI_DIRECT_HIRING_P0_MOUNT.md`            |
| D     | B/C 整合    | `feature/ai-direct-hire-integrated` / `daf41f0`    | ✅ 代码整合；⚠️ 未 CI | `AI_DIRECT_HIRING_INTEGRATION_REPORT.md`  |
| E     | P1 前端     | `feature/ai-direct-hire-p1-frontend` / `2060975`   | ✅ 本地完成           | `AI_DIRECT_HIRING_P1_FRONTEND.md`(分支内) |
| F     | P2 招聘 API | `feature/ai-direct-hire-p2-hiring` / `ddcdead`     | ✅ 本地完成           | `AI_DIRECT_HIRING_P2_HIRING.md`(分支内)   |
| G2    | P1 运行中心 | `feature/ai-direct-hire-p1-runtime` / `8284931`    | ✅ 精简版完成         | `AI_DIRECT_HIRING_P1_RUNTIME.md`          |

## 11. G2 运行中心完成情况

- 新增 7 个路由:4 个 jobs 路由、3 个 worker 路由。
- 实现 60 秒 lease、≤30 秒 heartbeat、`FOR UPDATE SKIP LOCKED` 并发领取和过期 lease 回收。
- `JobQueueService` 提供 enqueue/lease/ack/complete/fail/cancel/retry/heartbeat；`RunProjectionService` 提供运行列表和详情投影。
- F 的状态机与路由已在 G2 分支中作为基线集成；后续业务状态转移可自动调用 `enqueue()` 创建 workflow run 与步骤。
- G2 自身约 1356 行，G2 分支包含 F 后交付统计约 **4126 行**；2 个测试文件已写但未运行。
- 延后项:artifact 路由、加权进度估算、worker 池监控、Convex 投影消费和真实 MySQL lease 集成测试。

## 12. 后续集成任务

1. 以 `feature/ai-direct-hire-integrated` 为基线，依次整合 F、E、G；G 已含 F，实际合并时必须避免重复提交。
2. 将 E/F 分支内报告一并带入最终整合分支，并保持本进度文档和 `AI_DIRECT_HIRING_FINAL_HANDOFF.md` 的交叉引用。
3. 资源恢复后执行迁移验证、静态检查、单元测试、类型/构建与 e2e；通过后再创建 PR 和部署。

---

_更新时间: 2026-08-01 03:14 UTC+8_
_运行中心 commit: `8284931`_

## 当前工作区与生产能力快照

- `CandidateMatchingModule` 已实现并挂载：仅对 recruiter 可读的 `GET /workforce/positions/{positionId}/candidate-matches`，从 Position/Role 需求和 Candidate Catalog digest 计算固定的 `capability-coverage-v1` 匹配评分。
- 输出不含 Agent prompt、模型策略、审核信息或 Employment 明细；仅含匹配能力、缺失能力、可用性和组织范围 employment disclosure。
- `20260810_agent_publication_catalog` 与 `20260811_ai_direct_workforce` 已部署，Candidate Matching 已进入生产 `1.1.0` route contract 并通过非 `404` 烟测。实际 `2xx` 仍依赖 open Position、recruiter RBAC 与显式组织 `candidateCatalog` flag；当前生产默认 flag 关闭且未执行带认证业务烟测。
