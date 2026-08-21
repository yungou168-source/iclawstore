---
summary: "在不丢失功能、数据、身份和文件的前提下，将应用从 Convex 渐进迁移到 Fastify、MySQL 与独立存储。"
read_when:
  - 新增或修改仍依赖 Convex 的业务功能
  - 迁移 Convex 表、函数、认证、文件或搜索能力
  - 设计候选环境切换、数据对账或 Convex 下线
---

# Convex 渐进退出规划

> **状态**：发布冻结；所有生产领域仍由 Convex 权威。
>
> **立即约束**：不得发布 Convex 函数或 schema、重试失败部署、改变 `PROFILE_READ_MODE`、执行 Profile 同步/回填/切流，或激活任何 Fastify/Worker/SSR 生产制品。当前 Convex 仅保留为现网运行依赖和只读迁移源。
>
> **数据处置决策**：不再创建 Convex 加密归档或执行恢复演练。每个领域在目标侧完成关系、资产、权限、历史 ID、契约与观察期验证后，记录不可逆销毁批准并直接删除对应 Convex 数据和 Storage；不得把旧的归档/恢复要求作为迁移或发布前置条件。
>
> **目标**：功能不丢失、权限不放宽、URL 与客户端契约尽量稳定，最终由 MySQL 成为唯一写权威，并移除应用对 Convex Runtime、Auth、Storage 和部署流程的依赖。

## 文档层级

本文件是渐进退出的总体约束；领域级事实和运行交接分别记录在：

- [`convex-exit-domain-ledger.md`](convex-exit-domain-ledger.md)：所有领域的源/目标边界、状态和删除门禁；
- [`profile-migration-handoff.md`](profile-migration-handoff.md)：Profile 与头像候选迁移；
- [`publisher-migration-handoff.md`](publisher-migration-handoff.md)：Publisher/组织候选迁移；
- [`convex-exit-functional-matrix.md`](convex-exit-functional-matrix.md)：功能与兼容契约矩阵。

这些文档描述候选代码和验收要求，不代表迁移已经执行。若交接记录、代码状态和运行证据不一致，以实时运行行为和最新候选验证结果为准；在没有真实批次、对账和候选阻断回归证据时，领域仍视为 `convex_authoritative`。

迁移采用 **Strangler Fig（绞杀者）模式**：在现有 Fastify/MySQL 旁建立稳定的领域接口，按业务域逐步把读取和写入从 Convex 切到 MySQL、对象存储、搜索服务和后台 Worker。Convex 在迁移期间继续运行，但每个业务对象在任一时刻只能有一个写入权威。

核心顺序为：

1. 保持生产发布冻结，盘点调用、源表、Storage 引用和公开契约；
2. 建立领域服务、稳定 ID、可恢复增量同步、目标侧对账与 outbox；
3. 迁移公开读取、资料、组织和文件；
4. 迁移技能、插件、Soul、社交、审核、Token、统计和搜索；
5. 最后迁移 Web/桌面认证并拆除 Convex 身份桥；
6. 完成阻断 Convex 网络回归与观察期后，记录不可逆销毁并下线基础设施。

本文件中历史的“归档”“隔离恢复”“导出原件”措辞不再是执行要求；它们仅用于解释旧方案，不能作为任何迁移门禁、发布冻结解除条件或数据处置前置。源侧数据的删除只能发生在对应领域目标侧对账、候选环境无 Convex 网络回归、观察期和不可逆销毁批准均已完成后。


### Candidate reconciliation evidence status (2026-03-14)

- Candidate remains `convex_authoritative`; this status is not a migration or release approval.
- The preflight gate counts open records by their persisted `classification`: `expected_retired_fixture` is retained evidence and is excluded from `unresolvedDifferences`; every other open record remains unresolved. The count must be read from the same `convex_exit_reconciliation_records` query used by the gate, not inferred from an earlier report.
- The current candidate database contains 27 open `unclassified` Profile alias records and one open `expected_retired_fixture` Profile record. The fixture may remain only with its exact marker, snapshot, and `profile_avatar_source_missing` outbox evidence.
- Each alias difference is designed to persist source alias state, target alias state, and an evidence hash. Classification through the lifecycle API is prohibited until the source and target states are captured and reviewed record by record.
- This evidence work does not authorize Prisma migration, Profile/Publisher read cutover, write restoration, Soul migration, production access, or Convex cleanup. Those stages still require their independent approvals and gates.

### Candidate expand-only Prisma migration checkpoint (2026-03-14)

- Candidate database `iclawstore_candidate` received migrations `20260828` through `20260905`; Prisma reports 39/39 migrations applied and the schema is up to date.
- Validation evidence: `prisma validate`, `prisma generate`, `prisma migrate status`, and `git diff --check` passed. No production database, production read mode, route, or write authority was changed.
- Two MySQL index-length failures occurred during candidate execution: `20260831` on `(versionSnapshotId, path)` and `20260902` on `(versionSnapshotId, path)` plus the trusted-publisher repository lookup. Recovery used `prisma migrate resolve --rolled-back`, idempotent replay protection for already-created tables, and bounded prefix indexes; no tables were manually dropped and no migration history was directly edited.
- The prefix-index repair is candidate evidence only. It must be reconciled with the Prisma `@@unique` declarations before production migration, preferably by introducing an explicit hash-key column/constraint rather than relying on a truncated path or workflow index. Until that review is complete, production migration is blocked.
- Managed-asset scanner transitions, real asset byte/SHA-256 checks, reconciliation clearance, candidate read cutover, production backup/approval, and production migration remain outstanding. This checkpoint does not authorize any of them.


### Candidate Soul/social/runtime foundation checkpoint (2026-03-14)

- Soul candidate now has a MySQL transaction repository for snapshot/version/file facts, a cursor-and-watermark source port, SHA/size-verifying managed-asset copy consumer, public Fastify read routes (`/api/souls/:slug` and legacy-ID lookup), and a typed catalog client suitable for fixed CLI protocol tests.
- Candidate social/moderation facts now persist reports, evidence and audit events. `moderationPermissions` is server-side role based; it is a policy matrix, not an authorization bypass or production approval. Scan, appeal workflow, and all role rejection cases remain outstanding.
- Candidate runtime now has row-locked MySQL leases and checkpoints plus a controlled worker process. It does not start production work by itself and has no authority to change domain ownership.
- Migration `20260907_convex_exit_runtime_social_foundation` is expand-only and has not been applied to production. No source import, asset copy, lock write, final sync, unified release activation, domain cutover, observation period or Convex retirement has occurred.
- The newly added routes and worker remain candidate implementation until real source pages, asset storage credentials, fixed Web/Desktop/CLI clients, network-block regression, CI/E2E/Smoke evidence and reconciliation reports are collected. Any unresolved or unclassified difference blocks readiness.


```text
Browser / Desktop Client
  |
  v
Nginx
  |-- TanStack Start SSR
  |     `-- Convex client/query/mutation/auth/storage
  |
  |-- Fastify API
  |     |-- JWT/JWKS verifier
  |     |-- MySQL / Prisma
  |     `-- domain services
  |
  `-- /convex
        `-- Convex functions/auth/storage
```

已确认的代码规模基线：

- `convex/schema.ts` 包含 60 多张业务表及认证表；
- `convex/` 至少有 54 个公开或内部函数模块；
- `specs/convex-dependency-baseline.json` 是当前机器口径：共 450 条静态依赖、涉及 102 个生产文件；其中受 CI 精确守护的 browser/http client、generated API 与 identity bridge 共 178 条、涉及 37 个文件。分类数量以该 JSON 的 `summary` 为准，不再维护独立人工估算；
- `prisma/schema.prisma` 已覆盖用户、发布者、技能、插件、评论、收藏、审核、Token、统计及 AI 直聘等大量模型；
- Fastify 已承接 AI 直聘、组织/公司、钱包、销售、雇佣、运行时、审计和桌面端 API；
- Prisma 中虽已有用户、发布者、技能等同名模型，但字段覆盖并不完整，例如公开资料后缀、Convex Storage ID 和开发者状态仍需正式字段映射，不能把“同名表存在”等同于已完成迁移；
- **Server 运行边界**：`server/` 已移除 Convex runtime、Convex HTTP client 和 `convexIdentityBridge`。Fastify 受保护路由在独立身份实现完成前 fail-closed；历史 Convex source/迁移进程不属于当前启动链。
- 生产业务数据与 `/convex` 流量位于自托管 Convex，历史 deployment 标识为 `cheerful-schnauzer-269`；`dutiful-seal-277` 是曾被错误配置到 Actions 的空云 deployment，不得作为生产权威；
- 2026-08-11 已通过本机管理端向自托管生产 Convex 单次推送缺失函数并验证 `/profile/ceo` 恢复 HTTP 200；自动发布必须继续验证公网 `appMeta:getDeploymentInfo.appBuildSha`，防止再次部署到无流量目标；
- 当前 SSR 由 `iclawstore.service` 运行 `.output`，Fastify API、dispatcher 和 audit worker 仍暂时从 `/home/ubuntu/releases/iclawstore/...` 的历史 release 运行；仓库已建立统一 release 机制，首次正式激活后它们必须收敛到同一 release manifest 与 Git SHA；
- `.github/workflows/deploy.yml` 已改为构建 SSR、`server/dist`、Worker、Prisma schema/migrations 和生产依赖的统一制品；`scripts/build-mysql-release.mjs` 生成逐文件 SHA-256 manifest，`ops/artifact-verify.mjs` 在服务端拒绝未列出、缺失、篡改和符号链接文件，`ops/artifact-migrate.mjs` 以打包 Prisma CLI 执行 status/deploy/status。

`docs/superpowers/plans/2026-06-27-convex-to-mysql-migration.md` 是早期整体迁移设想，可作为表结构参考，但其“一次开发、一次切换”的阶段划分不作为生产执行规范。本文件是渐进迁移和发布门禁的权威约束。

## 3. 目标架构

```text
Browser / Desktop Client
  |
  v
Nginx
  |-- TanStack Start SSR
  |     `-- typed application client
  |
  `-- Fastify API
        |-- domain services
        |     |-- identity
        |     |-- profiles & organizations
        |     |-- catalog & publishing
        |     |-- social & moderation
        |     |-- wallet & AI Direct
        |     `-- search & statistics
        |
        |-- MySQL / Prisma          # 业务事实与关系数据
        |-- Asset storage adapter   # 现有本地受管存储，可演进到 S3 兼容存储
        |-- Search adapter          # 全文/向量索引，可替换实现
        `-- Worker / outbox         # 异步任务、索引、邮件、统计
```

目标边界：

- MySQL 是业务事实的唯一权威数据库；
- 文件通过稳定的站内资源 ID 和 `/assets/...` URL 暴露，不向业务表泄漏具体存储商 URL；
- 搜索索引是可重建投影，不是业务事实；
- SSR 和浏览器不直接依赖 Prisma、Convex 或具体搜索/存储 SDK；
- Fastify 路由只处理协议、认证和输入输出，业务规则位于领域服务；
- 跨服务副作用使用 outbox/worker，不在请求中形成不可回滚的多系统双写；
- Web 与桌面端使用同一个身份核心，但保持各自 issuer、audience、PKCE 和 Token 生命周期约束。

## 4. 不可破坏的不变量

### 4.1 功能完整性

迁移前必须建立功能矩阵，至少覆盖：

- Web 登录、退出、切换账号、邮箱 OTP、GitHub/Google/微信 OAuth；
- 桌面 Authorization Code + PKCE、refresh rotation、reuse detection 和撤销；
- 用户资料、公开资料页、头像、开发者状态；
- 发布组织、成员和 owner/admin/publisher 权限；
- 技能、版本、文件、下载、收藏、评论和所有权转移；
- 插件、发布 Token、trusted publishing、检查器与安全报告；
- Soul、版本、收藏、评论和下载；
- 搜索、排行榜、统计、遥测和热门列表；
- 举报、申诉、封禁、审核覆盖和审计记录；
- CLI Token、设备登录、上传、发布和下载协议；
- AI 直聘身份桥相关功能及现有 Fastify/MySQL 业务。

某个域只有在功能矩阵全部通过后才能切流，不能用“主要页面可打开”代替完整验收。

### 4.1.1 Skill、插件与 MCP 获取/同步连续性

退出 Convex 不等于更换客户端协议。以下链路在迁移期间和迁移完成后都必须保持可用：

- Skill：CLI `sync` 使用的 `/api/v1/resolve`、`/api/v1/skills/...`、`/api/v1/download`，以及兼容期内的 legacy resolve/download 路由；
- 插件：`/api/v1/packages`、`/api/v1/code-plugins`、`/api/v1/bundle-plugins` 的列表、release 解析、制品下载和完整性元数据；
- GitHub Skill source：仓库快照、commit、content hash、增量同步、删除/恢复和冲突处理；
- MCP：当前没有独立的 MCP 资源模型或同步协议。MCP server/tooling 目前作为 Skill 内容或插件能力分类存在，因此分别服从 Skill 或插件契约。未来若新增独立 MCP registry，必须先增加单独的领域模型、版本/制品协议和迁移说明，不能假定由现有插件迁移自动覆盖。

每条链路的稳定契约包括资源标识、版本选择、hash/fingerprint、制品字节、审核/封禁可安装性、认证、限流、遥测的 best-effort 边界和错误语义。实现可以从 Convex adapter 切换到 Fastify/MySQL/Asset Storage adapter，但 registry discovery URL 和客户端可见 HTTP 契约不得随存储实现漂移。

切换 Skill 或插件权威前必须使用固定客户端版本执行以下闭环：

1. 搜索或解析资源；
2. 获取指定版本与 latest 版本；
3. 下载制品并核对 SHA-256/fingerprint；
4. 本地 `sync` 正确区分 `synced`、`new`、`update`；
5. 被隐藏、撤销、恶意或不可安装版本继续被拒绝；
6. GitHub source 在无变化、内容变化、删除和恢复四种状态下结果一致。

只有新旧 adapter 对这些契约的规范化响应和制品哈希一致，且旧 CLI 兼容窗口通过，才能切换读取；未完成这些证据时，“页面能展示 Skill/插件”不构成同步能力已迁移。

### 4.2 数据完整性

- 保留原 Convex ID，或维护永久、唯一、不可复用的 `legacyConvexId -> mysqlId` 映射；
- 迁移后的外键、唯一约束、软删除、封禁、保留 slug、版本顺序和权限关系必须与源数据一致；
- `_storage` 文件必须同时迁移元数据和二进制，不能只复制数据库字段；
- 统计字段迁移必须遵守当前 canonical stat 与 legacy nested stat 的兼容规则，完成对账前不得只取一套字段；
- 每批迁移记录源游标、数量、校验和、开始/结束时间、错误和重试次数；
- 源侧数据处置不使用归档或恢复演练；只有目标侧关系、资产、历史 ID、权限和契约对账完成，且候选环境与观察期均证明零运行时依赖后，才可按批准记录不可逆销毁对应 Convex 数据和 Storage。

### 4.3 权限与安全

- 不接受客户端提交的任意 `userId` 作为授权依据；
- 组织、审核、钱包、发布和管理权限必须由服务端当前身份派生；
- 迁移不能扩大公开字段、降低封禁检查或绕过资源所有权；
- Token 只迁移不可逆哈希、状态和必要元数据，不能导出或记录明文 Token；
- OAuth client secret、JWT 私钥、JWKS 私钥和存储密钥不得进入迁移文件或日志；
- 认证切换必须支持立即撤销，不能依赖用户重新登录后权限才生效。

### 4.4 可回滚性

回滚是“切回上一权威实现”，不是恢复一份未知时间点的数据库：

- 读切流允许立即回退到旧读端；
- 写切流前必须停止旧端写入或让旧端转发到新权威；
- 写切流后不得同时恢复旧端独立写入，否则形成双主；
- 如果需要回退写路径，必须先将新端增量按事件顺序回放到旧端并完成对账；
- 每个阶段独立开关，禁止一个全局布尔值同时切换所有业务域。

## 5. 迁移机制

### 5.1 领域端口，而不是页面直接选后端

前端和 SSR 只调用稳定的应用接口：

```text
profileClient.getPublicProfile(slug)
publisherClient.updateOrganization(input)
catalogClient.listSkills(query)
moderationClient.submitReport(input)
authClient.getSession()
```

迁移选择位于服务端适配层：

```text
domain port
  |-- Convex adapter      # 旧实现
  |-- MySQL adapter       # 新实现
  `-- compare adapter     # 主读 + 影子读 + 差异记录
```

不要在 React 页面散布 `if (USE_MYSQL)`，也不要让调用方同时理解 Convex ID、Prisma Model 和 Fastify Route。

### 5.2 单一写入权威

每个业务域使用以下状态机：

```text
convex_authoritative
  -> backfilling
  -> shadow_reading
  -> mysql_reading
  -> mysql_authoritative
  -> convex_read_only
  -> retired
```

状态含义：

- `convex_authoritative`：Convex 读写；
- `backfilling`：Convex 仍是唯一写端，持续回填 MySQL；
- `shadow_reading`：对外返回 Convex，后台读取 MySQL 并比较；
- `mysql_reading`：对外读 MySQL，写仍通过旧权威并同步；
- `mysql_authoritative`：所有写入进入 MySQL，必要时向 Convex 投影用于回滚观察；
- `convex_read_only`：Convex 不接受该域业务写入；
- `retired`：代码和数据运行依赖已移除。

禁止“Convex 和 MySQL 各自接受写入，再定期合并”。数据库无法可靠合并权限、版本、余额、审核和所有权冲突。

### 5.3 迁移事件与 outbox

MySQL 成为某域写入权威后，事务内同时写业务事实和 outbox：

```text
MySQL transaction
  |-- domain row changes
  `-- migration_outbox event

worker
  |-- search projection
  |-- compatibility projection
  |-- email / async action
  `-- audit projection
```

事件必须有稳定 `eventId`、业务对象 ID、版本号和幂等键。消费者以 `eventId` 去重。不得在 MySQL 提交后依赖一次不重试的网络调用来维持一致性。

### 5.4 对账

每个业务域至少执行：

- 记录数与活跃/软删除/封禁分组计数；
- 主键和 legacy ID 唯一性；
- 外键孤儿检查；
- 关键字段规范化后的逐行哈希；
- 文件数量、字节数和 SHA-256；
- 权限样本和拒绝样本；
- 最近增量窗口的事件连续性；
- 面向用户的 API 响应语义比较。
- 每次运行生成批次报告，记录源/目标/比较计数、失败状态、差异总数与从未解决记录重新统计的未分类差异数；报告不能代替真实执行证据。

差异按 `expected_transform`、`source_bug`、`migration_bug`、`concurrent_change` 分类。未分类差异不能进入切流。

## 6. 分阶段实施

阶段按退出门禁推进，不按日期强行推进。多个低耦合只读域可以并行，但同一业务域一次只改变一个变量。

### 阶段 0：稳定生产基线

目标：在发布冻结下取得可信、可审计的生产源清单；不得通过修复 Convex 发布链实现此目标，也不以归档或恢复演练作为前置条件。

工作项：

- 核验当前运行时身份、源访问边界和只读迁移凭据的最小权限；
- 生成当前表、索引、函数、环境变量名和文件存储清单；
- 冻结新增 Convex 业务域：新业务默认进入 Fastify/MySQL。

退出门禁：

- 源清单、功能矩阵和数据负责人均已确认，且候选迁移凭据不具备业务写入权限；
- 后续领域的目标侧关系、资产、历史 ID、权限和契约对账可独立形成证据。

### 阶段 1：建立迁移底座

目标：让后续迁移不需要逐页面临时改造。

工作项：

- 建立 `server/src/domains/<domain>` 领域服务和 repository ports；
- 生成或维护前端 typed client，页面不再新增直接 Convex 调用；
- 创建 legacy ID 映射、迁移批次、游标、差异和 outbox 表；
- 实现可恢复的 cursor backfill、增量回放和对账工具；
- 建立按域、按用户比例、按路由的服务端 feature flags；
- 建立 Convex 与 MySQL 响应规范化比较器；
- 将迁移指标接入健康检查和审计。

退出门禁：

- 在隔离数据集上可重复执行全量回填且第二次执行无副作用；
- 任意批次失败后能从游标恢复；
- feature flag 回退不需要重新构建前端；
- 对账结果可定位到具体业务对象和字段。

## 6.1 阶段 0/1 底座检查点（2026-08-12）

已完成、不改变生产流量或写入权威的底座工作：

- 已新增流式静态扫描器 `scripts/scan-convex-dependencies.ts`，覆盖 `src/`、`server/`、`packages/`、`scripts/`、`convex/` 和 `.github/workflows/`，排除测试、generated、fixture 与构建产物；机器可读结果提交在 `specs/convex-dependency-baseline.json`。
- 扫描基线当前记录 450 条静态依赖、涉及 102 个生产文件，包含浏览器 React client、一次性 HTTP client、生成 API、Fastify identity bridge、Convex Storage、HTTP routes、cron 与部署配置依赖。它是迁移盘点事实，不表示任何运行时迁移已完成；分类数量只从 JSON `summary` 读取。
- `bun run check:no-new-convex-client-usage` 已接入 `ci:static`，对直接 `convex/react`、`convex/browser`、generated API 与 identity bridge 执行 `category:file` 精确计数匹配：新增文件、类别或调用数量会失败，调用减少但未同步下调已提交基线也会失败。该门禁不阻止既有 Storage、HTTP route、cron 或部署依赖，避免把清理计划误当成立即下线。
- 已建立 `specs/convex-exit-functional-matrix.md`，定义域级读写权威、身份/文件边界、兼容契约和退出门禁；公开用户资料的 port、Convex/MySQL/compare adapters 与一次性快照回填准备已落地，但生产仍为 `convex_authoritative`。
- Profile 下一阶段的权威交接记录在 `specs/profile-migration-handoff.md`：现有快照回填不是持续同步，头像尚未复制/核验，`/profile/:slug` 和 `/user/:handle` 仍未完全脱离 Convex。
- Publisher/组织候选切片已具备独立 snapshot 模型、分页原子同步、权限事实/对账、组织头像 consumer、候选公共详情/目录/成员读取、compare/fallback、读取指标、cutover readiness gate、Fastify Publisher routes，以及前端 `/publishers` 与 `/user/:handle` 的 Publisher core HTTP 接入；交接记录在 `specs/publisher-migration-handoff.md`。这些代码不改变生产读写权威，也未执行 migration、真实同步、资产复制、生产对账、真实非生产候选 HTTP/浏览器回归或切流。

仍未完成：Profile 持续增量同步、目标侧状态/资产 SHA-256 对账、个人 Publisher DTO 等价、所有公开资料读取的 Fastify 收敛，以及阻断 Convex 网络的候选回归；Publisher 的真实 migration/同步/头像复制/生产对账、真实非生产候选 HTTP/浏览器阻断回归、观察期和切流仍未完成。Publisher core Fastify routes、公开成员读取、前端 `/publishers` 与 `/user/:handle` HTTP 接入及阻断回归代码已经落地，但没有显式非生产候选 URL/fixtures，因此尚无真实触网证据。成员/组织/official/trusted 管理写入和任何生产授权迁移继续后置。以上缺口持续阻止任何 Profile 或 Publisher 读切换、写权威变更或 Convex 依赖删除。历史归档/恢复演练不属于当前策略，也不再构成阶段退出条件。

### 候选环境基础设施检查点（2026-08-17）

候选环境仅用于迁移验证，严禁复用生产路径或凭据：

- `candidate.iclawstore.com` 已解析到候选服务器；独立 HTTP vhost 仅服务 `/\.well-known/acme-challenge/` 或跳转 HTTPS，HTTPS vhost 使用独立证书且其余请求返回 `503`，不会代理到生产服务；
- 候选 MySQL schema 与最小权限账号已创建，但尚未应用 Prisma migration；候选资产根目录固定为 `/www/iclawstore-candidate/assets`，与生产资产目录隔离；
- 系统 Nginx 是实际监听进程；已通过其配置语法检查并平滑重载。候选证书已从工作区移除，只保留在受限证书目录，私钥权限为 `0600 root:root`；
- 候选 SSR/Fastify 构建产物已生成在 `/www/iclawstore-candidate/releases/candidate-bootstrap`，并定义了使用 `3100`/`3102` 回环端口的禁用 systemd 单元；受限环境文件为 `/etc/iclawstore-candidate.env`，权限为 `0600 root:root`。候选 MySQL `DATABASE_URL`、只读 Convex 迁移凭据以及 Profile/Publisher 的 canonical、alias、handle 真实 fixtures 尚未通过受限方式配置，因此服务不得启动，migration、同步、头像复制、对账或候选回归均不得执行，也不能把候选环境作为切流证据。

### 6.1.1 Profile 与个人 Publisher 迁移准备（未在生产执行）

公开 Profile 是首个迁移试点，当前代码已具备但尚未改变任何生产读写权威：

- expand-only migration `20260820_profile_domain_expand` 定义 snapshot、legacy ID map、batch/cursor 与 reconciliation 表；通用迁移底座位于 `server/src/domains/migration/migrationPort.ts`。
- `server/src/domains/profiles/` 提供 Convex、MySQL 和 compare port adapter；`PROFILE_READ_MODE=convex|compare|mysql|mysql_authoritative`，默认且未知值为 `convex`。`mysql_authoritative` 是 fail-closed 的候选模式：它要求 MySQL，且不允许 Convex fallback；禁止在生产启用。
- 现有 `db:profiles:backfill` 是可重跑的全量快照 cursor 过程，不是连续增量同步：它没有 source watermark、重叠窗口、页级原子进度、删除扫描或同步 lag 指标。不得将已完成批次视为后续更新已同步。
- 当前 MySQL Profile 投影保留删除/停用/purge/ban、handle、slug 与头像 Storage 引用；但尚未复制头像二进制、保存资产字节/SHA-256，或对改名历史、源缺失 tombstone 和个人 publisher DTO 做完整对账。
- 公开资料的源可见性契约只按 `deletedAt`/`deactivatedAt` 判断；MySQL adapter 必须保持该规则，不能将单独 `banReason` 扩大为额外过滤条件。封禁状态仍必须作为原始事实参与同步与对账。
- compare 始终返回 Convex 主读结果。受保护的 `/health/runtime` 暴露 `profileReads.mysqlHit`、`fallback`、`diff` 与 `adapterError` 进程累计计数，但尚不包含 cursor age、watermark lag、资产队列或未分类对账差异。
- 前端 `/profile/:slug` 先请求 Fastify `/api/profiles/:slug`，API 不可用时仍回退 Convex；`/user/:handle` 的 loader、reactive profile/member/catalog/star reads 仍直接访问 Convex。两类页面尚未满足“无 Convex 网络”的候选环境验收。

继续实施必须遵循 [`specs/profile-migration-handoff.md`](profile-migration-handoff.md) 的顺序、数据契约和验收清单。

### 阶段 2：迁移公开只读查询

建议顺序：

1. 公开用户资料；
2. 发布者/组织公开资料；
3. 技能、插件、Soul 列表和详情摘要；
4. 排行榜与公共统计快照。

公开页先迁，是因为没有登录写入耦合，且容易进行 Convex/MySQL 响应比较。列表接口必须使用 MySQL 索引、digest/summary 表和游标，不得把 Convex 的全量扫描模式机械搬到 SQL。

退出门禁：

- 影子读取至少覆盖正常流量周期，关键字段零未解释差异；
- P95 延迟和错误率不劣于既有基线；
- 匿名页面、SEO、分页、排序、软删除和封禁过滤一致；
- 读流量可按路由立即退回 Convex。

### 阶段 3：迁移用户资料、发布组织与文件

范围：

- 用户资料、公开后缀、开发者状态；
- 发布者、组织成员和角色；
- 用户头像、组织头像；
- 资源上传授权和文件元数据。

文件迁移要求：

- 先定义统一 storage adapter；当前 `ManagedAssetStore` 的本地受管目录可以作为首个实现，不要求为了退出 Convex 同时强制迁移到 S3；
- 如果容量、容灾或多机部署需要，再增加 S3 兼容实现，并通过同一 adapter 切换；
- 对外保存稳定资源 ID，不直接把本地绝对路径、bucket 或 provider URL 作为业务事实；
- 迁移时先复制二进制并校验 SHA-256，再切换元数据；
- 旧 Storage ID 映射保留到所有历史 URL 和版本文件完成验证；
- 上传 MIME、大小、所有权和组织管理权限不得弱化。

写切流采用短窗口：暂停该域写入、回放最后增量、对账、切换 MySQL 权威、恢复写入。切换后 Convex 对应 mutation 必须拒绝或转发，不能继续独立写入。

退出门禁：

- 用户/组织 CRUD、权限拒绝、头像上传和公开页全部通过；
- 数据与文件对账通过；
- 已登录会话仍可通过现有 Convex Auth 使用新 Fastify 接口；
- 至少完成一次切回旧读端演练。

### 阶段 4：迁移目录、版本、发布与下载

按聚合迁移，不按单表迁移：

- Skill + versions + files + slug aliases + ownership；
- Package + releases + publish tokens/tickets + trusted publishers；
- Soul + versions + files；
- GitHub source、备份、恢复、导入和同步状态；
- 下载计量、版本选择、安装可用性和所有权转移。

关键约束：

- 发布一个版本的数据库事实、文件清单和审核初态必须原子可判定；
- 文件先上传临时区，事务提交后再标记可见；失败文件由回收任务清理；
- slug、版本号、fingerprint、hash 和发布幂等键保持唯一；
- 下载不能在版本不可安装、已隐藏或审核阻断时绕过检查；
- CLI 和 GitHub trusted publishing 的 HTTP 契约在兼容期保持稳定。

退出门禁：

- 真实但受控的发布、更新、下载、转移、删除和恢复闭环通过；
- 并发发布和重复请求不会产生双版本或重复统计；
- 旧 CLI 兼容窗口测试通过；
- 目录数据和文件可从 MySQL/对象存储独立恢复。

### 阶段 5：迁移社交、审核、安全和管理

范围：

- 收藏、评论、举报、申诉；
- moderation event logs、manual override、封禁和账号处置；
- security scan jobs、scan requests、skill cards、检查器结果；
- 管理后台、官方发布者、保留 slug/handle；
- API Token、发布 Token 和速率限制。

这些域必须保留现有安全意图，尤其是上传门禁、扫描结论、申诉、封禁、所有权和可安装性。迁移计划不得根据表字段自行推测规则，必须以对应 `specs/` 和运行时行为为准。

退出门禁：

- 普通用户、owner、moderator、admin 的允许/拒绝矩阵通过；
- 举报到审核、申诉、人工覆盖和审计链完整；
- Token 撤销立即生效，明文 Token 未进入迁移产物；
- 队列重试不会重复发送通知或重复修改审核事实。

### 阶段 6：迁移搜索、统计、任务和实时能力

范围：

- 全文搜索、向量搜索和 digest；
- 排行榜、日统计、全局统计和下载事件；
- cron、维护任务、回填任务、邮件和外部扫描 action；
- 页面确实需要的实时更新。

原则：

- 搜索索引从 MySQL/对象存储重建，不反向成为事实源；
- 先建立固定查询集和相关性基线，再选择 Meilisearch、MySQL FULLTEXT 或独立向量能力；
- 不能仅因关键词能搜到就认为向量+词法+热度排序等价；
- 统计使用事件/outbox 聚合，写入事实和计数更新保持幂等；
- 只有用户确实需要实时更新的页面才引入 SSE/WebSocket，其余使用一次性请求和显式刷新。

退出门禁：

- 搜索固定评测集达到已批准的相关性阈值；
- 统计与事件回放对账一致；
- Worker 可暂停、重试和从 checkpoint 恢复；
- 断开搜索/实时服务不会破坏核心交易写入。

### 阶段 7：迁移认证与桌面 OAuth

这是最后一个高风险业务阶段。

目标能力：

- Web 邮箱 OTP、GitHub、Google、微信登录；
- 服务端 session、退出、账号切换和 CSRF/PKCE/state 防护；
- Fastify 当前用户派生和组织 RBAC；
- 桌面 Authorization Code + PKCE `S256`；
- refresh token hash、rotation、reuse detection、绝对/空闲期限和撤销；
- 账号停用、软删除、封禁后立即拒绝；
- Web 与桌面 issuer/audience 分离。

迁移方式：

1. 新认证服务先作为旁路验证器，不签发生产 Token；
2. 使用受控 QA 身份跑 Web 与桌面完整授权链；
3. 建立明确会话迁移策略：短期接受旧 Convex Token，或要求用户重新登录；
4. 新 Token 只由新认证服务签发，Fastify 同时接受受限时间内的旧/新 issuer；
5. 观察期结束后停止接受 Convex issuer；
6. 删除 `convexIdentityBridge` 和 `convexUserId` 业务依赖，但保留 legacy ID 映射用于审计。

禁止复制 Convex Auth 的 Cookie、refresh token 明文或内部会话表来伪造无感迁移。如果无法安全迁移会话，应选择一次可解释、可控的重新登录。

退出门禁：

- Web 各 provider 登录、退出、切换账号和撤销通过；
- owner/outsider RBAC 与撤权即时失效通过；
- 桌面 custom URI 与 loopback 两条 PKCE 闭环通过；
- 旧 Token 接受窗口结束且没有仍依赖 Convex issuer 的客户端；
- Convex Auth 故障不再影响新登录和受保护 Fastify API。

### 阶段 8：Convex 只读观察与下线

工作项：

- 禁止所有 Convex 业务 mutation/action/cron；
- 移除前端 `ConvexProvider`、hooks、客户端和生成 API 引用；
- 移除 `/convex` Nginx 代理和 Convex Auth callback；
- 从自动发布中删除 Convex deploy、contract verification 和 `CONVEX_SELF_HOSTED_ADMIN_KEY`；
- 移除 `convex/` 运行代码与依赖，但保留必要的历史 schema、导出工具和迁移记录归档；
- 对 Convex 数据、文件、函数清单和环境变量名做最终加密归档；
- 进行无 Convex 网络访问的构建、启动和生产演练。

下线门禁：

- 代码搜索不存在生产路径 Convex 引用；
- 阻断 Convex 网络后完整回归通过；
- 连续观察期内没有 Convex 请求、旧 Token、任务或回调；
- 备份可恢复且有明确保留/销毁策略；
- 生产回滚不再依赖重新启用一个已失去增量数据的 Convex 写端。

## 7. 发布、灰度与回滚策略

### 7.1 发布单位

每次发布只迁移一个清晰业务域，并包含：

- schema 扩展；
- backfill/增量同步；
- 新 adapter；
- 对账；
- feature flag；
- 回滚路径；
- 对应测试和 spec 更新。

不要在同一发布中同时切换认证、文件存储和多个核心写域。

### 7.2 灰度维度

优先顺序：

1. 内部/QA 身份；
2. 只读影子流量；
3. 指定公开路由；
4. 稳定哈希用户百分比；
5. 全量读取；
6. 短暂停写后的全量写入切换。

权限和金融类写入不做随机双主灰度。钱包继续由现有 MySQL 事务权威管理，不因 Convex 迁移改变。

### 7.3 自动停止条件

出现以下任一情况应停止扩量并回退读流量：

- 未解释的数据差异；
- 401/403 比例异常；
- 软删除、封禁或审核过滤不一致；
- 文件校验失败或历史资源不可读；
- 发布/版本/Token 幂等冲突；
- P95 延迟或错误率超过阶段批准阈值；
- outbox 积压持续增长或事件出现断号。

写路径是否可回退取决于增量是否已完整回放，不能仅凭 feature flag 直接切回旧写端。

## 8. 测试与验收体系

每个域必须具备四层证据：

1. **契约测试**：旧 Convex 返回与新 API 规范化后等价；
2. **数据测试**：全量/增量回填、幂等、断点恢复、外键和哈希；
3. **行为测试**：允许路径、拒绝路径、并发、重试和状态机；
4. **生产烟测**：真实 Nginx/SSR/API/存储/搜索边界，不绕过代理直接证明成功。

发布完成定义：代码合并、自动部署成功、目标生产数据迁移完成、功能矩阵通过、监控稳定且回滚证据存在。只有 CI 绿色或 schema 已创建不算完成。

建议新增独立门禁：

```text
ci:migration-contract
ci:migration-reconciliation
ci:no-new-convex-client-usage
ci:no-convex-runtime
```

其中 `ci:no-new-convex-client-usage` 在迁移期间只允许白名单存量调用，并阻止新增页面直接依赖 Convex。

## 9. 里程碑与资源预期

本项目规模不适合按“几周整体重写”承诺。建议按退出门禁估算：

| 里程碑 | 可交付结果                         | 建议资源                        |
| ------ | ---------------------------------- | ------------------------------- |
| M0     | 生产目标统一、清单、备份、功能矩阵 | 1–2 名工程师                    |
| M1     | 领域端口、迁移底座、对账和灰度     | 2 名后端/全栈                   |
| M2     | 公开读取、资料、组织、文件迁移     | 2–3 名工程师 + QA               |
| M3     | 目录、发布、社交、审核迁移         | 2–3 名工程师 + QA/安全评审      |
| M4     | 搜索、统计、任务迁移               | 2 名工程师 + 搜索评测支持       |
| M5     | Web/桌面认证迁移                   | 2 名高级工程师 + 安全/客户端 QA |
| M6     | 只读观察、运行依赖清除、下线       | 1–2 名工程师 + 运维             |

在 2–3 名熟悉系统的工程师持续投入、需求冻结合理的前提下，应按数月而非数周规划。单人兼职实施可能跨越半年以上。任何具体日期都应在 M0 完成真实数据量、调用量、文件量和客户端版本盘点后再承诺。

## 10. 近期可执行工作包

在不影响当前生产修复的前提下，第一批只做底座，不切写流量：

1. 修复并验证当前生产 Convex deployment 一致性；
2. 生成 Convex 表/函数/调用方/文件/cron 清单；
3. 建立功能矩阵和业务域 owner；
4. 为 `users`、`publishers`、`publisherMembers`、公开 profile 建立 MySQL schema 差异清单；
5. 设计稳定资源 ID 和对象存储 adapter；
6. 实现公开 profile 的领域端口、MySQL adapter 和影子比较；
7. 增加禁止新增直接 Convex 客户端调用的 CI 白名单；
8. 在隔离环境完成首个可重复 backfill 和对账演练。

首个迁移切片建议选择“公开用户资料读取”，但它必须在当前 `/profile/<slug>` 的 Convex 生产错误修复之后开始。不能用迁移计划代替紧急生产修复，也不能让临时 MySQL 查询掩盖当前部署目标错配。

## 11. 构建与生产发布演进

### 11.1 当前阶段

统一 release 底座已建立，当前流水线边界为：

```text
GitHub Actions runner
  |-- strict Convex push + public target SHA verification
  |-- build Fastify/Workers + SSR + production dependencies
  `-- generate one manifest + checksummed release archive

Production server
  |-- verify archive checksum and every manifest file
  |-- Prisma migration status/deploy/status
  |-- activate and SHA-check Fastify/Workers
  |-- atomically switch and health-check SSR
  `-- persist one current-release pointer or restore prior processes/SSR
```

生产服务器目前约 3.6 GiB 内存，日常可用内存在 2 GiB 左右且 Swap 已有使用；磁盘剩余空间必须为当前、上一版和 staging release（包括 server production dependencies）留出余量。服务器只解包、校验、执行已构建的 Prisma CLI/migration 和重启进程，不运行依赖安装、TypeScript、Vite 或 Nitro 编译。移除 Convex 会减少一个后端部署步骤，却不会显著降低 Runner 上 Vite/Nitro 前端构建的峰值内存。

### 11.2 Fastify 成为核心后端前

统一 API/Worker release 已实现以下门禁：

1. Runner 构建 `server/dist`、Prisma Client/production dependencies 和 SSR；
2. manifest 记录同一个 Git SHA、组件入口、逐文件大小和 SHA-256（symlink 记录目标与摘要）；
3. 服务器在 staging release 中解包并再次验证 manifest，不在生产工作区运行 `bun install` 或 TypeScript 编译；
4. 对目标 MySQL 执行 `prisma migrate status`、已审核的 `prisma migrate deploy` 和最终 status；
5. 先由 PM2 激活 API/Worker，并要求 `/health.buildSha` 等于 release SHA；
6. 再切换 SSR，重启 `iclawstore.service` 并执行本机健康检查；
7. 任一步失败时恢复之前保存的 PM2 dump 和 SSR 指针；数据库迁移仍只能使用向前兼容的 expand/contract 方式，不能假定 DDL 可自动回滚。

API、dispatcher、启用的 Worker 和 SSR 必须从同一提交与 manifest 运行。首次统一 release 正式激活前，历史 PM2 进程仍可能暂时位于不同旧 release；此状态属于待清理迁移窗口，不得继续作为常规发布方式。正式激活后，`.release-current`、PM2 entrypoint、`.output` 和各健康检查报告的 SHA 必须一致。

### 11.3 Convex 完全退出后

最终流水线为：

```text
static/type/unit/contract gates
  -> build Prisma client + Fastify/Workers + SSR
  -> package and checksum one release
  -> production migration preflight
  -> expand-only Prisma migrate deploy
  -> activate API/Workers
  -> activate SSR
  -> anonymous/authenticated/CLI smoke
  -> tag verified production SHA
```

届时删除 Convex deploy、Convex contract verification 和 `CONVEX_SELF_HOSTED_ADMIN_KEY`，但仍保留 Runner 构建、服务器原子切换、低并发健康检查和上一个 release 回滚。最终发布步骤更少、目标更单一，但不能退化为在生产服务器的脏工作区直接构建和覆盖文件。

## 12. 配置参数演进

迁移文档当前定义的是配置职责，不代表这些变量已经存在于代码。参数只能随对应阶段实现和 schema 一起增加；不得现在预先写入空值并宣称迁移能力可用。

### 12.1 当前已存在且迁移期复用

- `DATABASE_URL`、`MYSQL_CONNECTION_LIMIT`：MySQL/Prisma 与连接池；
- `MANAGED_ASSET_ROOT`：现有本地受管资源目录；
- `MEILI_HOST`、`MEILI_API_KEY`：现有 Meilisearch 客户端配置，但生产启用前仍需确认服务、索引和相关性基线；
- `AI_DIRECT_FEATURE_FLAGS`：只属于 AI 直聘业务开关，不得复用为 Convex 迁移总开关；
- `CONVEX_URL`、`CONVEX_AUTH_ISSUER`、`CONVEX_AUTH_AUDIENCE` 及桌面 Convex Auth 参数：认证迁移完成前继续保留；
- `NITRO_OUTPUT_DIR`、`NITRO_BUILD_DIR`：隔离 SSR 构建目录，仅用于构建过程。

### 12.2 阶段 1 实现时建议新增

变量名以实现时的 typed config schema 为准，建议职责如下：

```text
MIGRATION_PROFILE_READ_MODE=convex|compare|mysql
MIGRATION_PUBLISHER_READ_MODE=convex|compare|mysql
MIGRATION_CATALOG_READ_MODE=convex|compare|mysql
MIGRATION_COMPARE_SAMPLE_RATE=0..1
MIGRATION_COMPARE_LOG_REDACTION=strict
```

要求：

- 按业务域配置，禁止单一 `USE_MYSQL=true` 同时切换全部功能；
- 生产默认 fail-closed：未知值、缺失依赖或 schema 不兼容时保持当前权威实现；
- compare 日志只记录对象 ID、字段名、摘要和分类，不记录 Token、邮箱等敏感明文；
- 配置应由服务端读取，前端不得通过构建变量决定写入权威。

迁移批次、游标、outbox、差异和 legacy ID 映射优先存入 MySQL 表，不使用环境变量保存动态状态。

### 12.3 选择 S3 兼容存储时才新增

如果本地 `ManagedAssetStore` 已满足容量、备份和单机部署要求，可以不增加 S3 参数。只有决定启用对象存储后，才增加类似：

```text
ASSET_STORAGE_DRIVER=local|s3
ASSET_S3_ENDPOINT
ASSET_S3_REGION
ASSET_S3_BUCKET
ASSET_S3_ACCESS_KEY_ID
ASSET_S3_SECRET_ACCESS_KEY
ASSET_S3_FORCE_PATH_STYLE
```

密钥只进入受限生产 Secret/环境文件。业务表保存稳定资源 ID 和 storage key，不保存 access key、临时签名 URL 或本地绝对路径。

### 12.4 认证迁移阶段才新增

新认证服务的 issuer、audience、Cookie、OTP、OAuth provider 和桌面 PKCE 参数必须在阶段 7 的独立安全 spec 中确定。不能直接复用历史 `JWT_SECRET` 代替非对称签名和 JWKS，也不能在规划阶段编造生产变量名。切换完成并结束旧 Token 接受窗口后，再删除所有 `CONVEX_*`、`VITE_CONVEX_*`、Convex Auth provider 变量和 GitHub `CONVEX_SELF_HOSTED_ADMIN_KEY`。

## 13. 文档维护规则

- 本文件记录迁移总目标、阶段和不可破坏的不变量；
- 每个业务域实施前在 `specs/` 增加域级迁移说明，记录字段映射、状态机、切流和回滚；
- `docs/` 只更新用户可见行为，不公开内部拓扑、密钥或迁移操作细节；
- 每完成一个阶段，更新状态、生产证据、剩余 Convex 依赖和下一门禁；
- 如果实时运行行为与本文冲突，以运行时证据为准，先修正文档漂移再推进迁移。
