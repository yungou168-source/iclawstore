---
summary: "Convex 退出的源到目标领域账本。它记录迁移边界、数据缺口、对账门槛和切换证据；不代表任何域已迁移。"
read_when:
  - 设计或评审 Convex 到 MySQL/Fastify/ManagedAssetStore 的领域切片
  - 新增迁移表、适配器、导入或对账任务
  - 判断某个 Convex 表、HTTP 路由、worker 或 Storage 引用能否删除
---

# Convex 退出领域账本

> **状态**：发布冻结，所有生产领域仍由 Convex 权威。此账本是实现和评审输入，不授权生产导入、回填、读写切换、Convex 发布或基础设施下线。
>
> **数据处置**：不创建 Convex 加密归档或恢复演练。每个领域仅在目标侧完成完整性、关系、资产、权限和契约对账并通过独立切换验收后，才销毁对应 Convex 源数据和 Storage 对象；最终基础设施退役后源侧不可恢复。

## 通用迁移契约

每个领域必须明确以下字段，再开始实现其导入器：

| 字段             | 约束                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `source`         | Convex 表、函数、HTTP 路由、`_storage` 引用和 worker 触发器的完整集合。                                     |
| `target`         | MySQL 事实模型、ManagedAssetStore 对象、可重建搜索投影、Fastify route 与 worker consumer。                  |
| `identity`       | 保留 legacy Convex ID，或使用永久、唯一、不可复用的 `legacyConvexId -> targetId` 映射。映射冲突是阻断错误。 |
| `batch`          | 记录 source cursor、source hash、状态、累计计数、失败码和重试次数；相同批次必须可重跑。                     |
| `reconciliation` | 记录数/状态分组、legacy ID 唯一性、外键孤儿、规范化逐行 hash、文件字节和 SHA-256、权限允许/拒绝样本；每次运行都必须落库 batch report，其中未分类差异从当前批次的未解决记录重新统计。       |
| `authority`      | 同一对象在任一时刻只有一个写权威。切换前的读比较只能返回当前权威数据。                                      |
| `compatibility`  | Web、SSR、CLI、HTTP、上传、下载和 worker 的公开契约、错误语义、ACL、软删除、封禁和审计语义不漂移。          |
| `evidence`       | 导入/对账报告、固定客户端回归、无 Convex 网络回归和回退演练；未分类差异为零。                               |

共享基础设施应吸收现有 Profile 的已验证模式，但不得调用其 Convex snapshot function 或在冻结期运行其 backfill：

- legacy ID 映射、批次/游标、差异和 outbox 的共享实现位于 `prisma/migrations/20260821_convex_exit_migration_foundation/migration.sql` 与 `server/src/domains/migration/migrationPort.ts`；Profile 页级事务编排位于 `server/src/profileBackfillProcess.ts`；
- 读 port、主读/影子读和规范化比较的边界参考 `server/src/domains/profiles/`；
- 同事务 outbox 和幂等消费的参考实现位于 `server/src/utils/outbox.ts` 与 `server/src/services/outboxDispatcher.ts`；
- 资产写入、SHA-256、受限路径、回收与删除的参考实现位于 `server/src/services/managedAssetStore.ts`。

## 域状态机

```text
convex_authoritative
  -> importing
  -> shadow_reading
  -> mysql_reading
  -> mysql_authoritative
  -> convex_read_only
  -> retired
```

- `importing` 和 `shadow_reading` 都不改变 Convex 写权威。
- `mysql_reading` 只在已验证的增量路径存在时允许；写权威切换前必须进行短暂停写与最终对账。
- 写权威已切换后，禁止重新启用独立 Convex 写入。回退只能通过已验证的增量回放或继续由 MySQL 作为唯一权威。

## 强制迁出状态机

强制策略只改变非核心切片的完成路径，不降低核心数据、授权和资产边界。以下状态与上方数据迁移状态机并列存在，前者用于可追踪缺口和删除评审：

| 状态 | 含义 | 允许进入条件 | 禁止推断 |
| --- | --- | --- | --- |
| `core_blocked` | 核心能力仍缺目标模型、完整性、授权或恢复证明。 | 缺口已登记，且当前 Convex 权威明确。 | 不得移除任何 Convex 路径或把降级作为替代。 |
| `degraded_mysql_reading` | 非核心公开读能力已有最小 MySQL/Fastify 替代；可明确降级。 | 缺口、降级行为、smoke 与删除路径均已登记。 | 不等同于候选运行、数据同步、读切换或写权威迁移完成。 |
| `convex_removed` | 某独立切片的 Convex 路径已删除。 | 已删除路径、替代路径、缺口验收和不可逆批准均有证据。 | 不代表相邻领域或共享数据源已经迁出。 |

- 每一状态事实必须同时写入本账本和 [`convex-exit-deficits.json`](convex-exit-deficits.json)。机器清单中缺失、`pending` 或无批准引用的记录不能作为删除依据。
- 资料页下游投影当前为 `core_blocked`：repository 准备完成，但 candidate release、expand-only schema、同步、对账、compare 与读切换均未获执行授权。
- Profile、Publisher、Skill/Package、资产、认证、审核安全、CLI/HTTP/worker 的生产权威不因本分层改变，除非其对应切片完成独立删除门禁。

## 领域账本

| 域                       | Convex 源                                                                                                          | 现有目标覆盖                                                                                                                                                                                                                  | 必须补齐的目标                                                                                                                                 | 首要对账与兼容门禁                                                                                                            | 当前状态                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 资料与身份资料           | `users`、Auth 表、头像 `_storage`                                                                                  | Profile 候选代码已接入通用 batch/cursor/legacy map/outbox；Prisma schema、只读 preflight、Profile alias、managed avatar consumer 进程、真实源/目标对账进程、按批次持久化的 reconciliation report、运行时健康聚合和 Fastify-only `/profile/:slug` 客户端路径均已就绪。头像 consumer 的成功与失败回写均由 `claimToken` 保护，过期 worker 无权覆盖被回收任务。候选域名、独立 MySQL schema、资产根目录及 TLS vhost 已创建，且不代理生产。 | 补齐历史 alias 的源端变更来源和隔离 fixture；随后执行持续同步、真实头像复制、全量/增量对账、候选 HTTP/SSR/浏览器阻断回归、候选写入/身份隔离、checkpoint 故障恢复、回滚与观察期；在这些门禁通过前不得启用 `PROFILE_READ_MODE=mysql_authoritative` | handle/slug/当前及历史 alias、公开字段、删除/停用/封禁/purge 可见性、头像字节/hash、身份拒绝路径；未分类差异为零                                | `convex_authoritative`（候选一次性对账完成；未完成读切换门禁） |
| 发布者与目录组织         | `publishers`、`publisherMembers`、`officialPublishers`；`publisherAbuse*` 延后到审核/安全域                        | 独立 Publisher snapshot、成员、官方、checkpoint、legacy map、组织头像 outbox/consumer、权限事实/对账、候选公共详情/目录/成员 adapter、Convex compare/fallback、读取可观察性、切流 readiness gate、Fastify Publisher routes，以及前端 `/publishers` 与 `/user/:handle` 的 Publisher core HTTP 接入均已落地；candidate 全量同步、对账与 preflight 已通过 | 候选 HTTP/SSR/浏览器阻断回归、观察期和独立读切换评审；成员/组织/official/trusted 管理写入及生产授权迁移继续后置 | 逐行成员、至少一名 active owner、official/trusted 区分、头像 hash、非生产候选 URL；`unclassifiedDifferences=0`，唯一 retention 必须精确批准 | `convex_authoritative`（candidate 数据 gate 通过；未读切换） |
| 用户资料页下游投影       | `/user/:handle` 的 `publishers.listPublishedPage`、`listStarredPage`、`getPublishedDisplayManifest`；其 `skills`、`packages`、`stars` 与 `githubSkillSources` 依赖 | expand-only projection schema（含尚未应用的 canonical `sourceHref` migration）、独立 port DTO、catalog decoder、共享公开 Publisher 可见性 helper、四类受索引 internal snapshot source、页级事务同步、reconciliation checkpoint/report/runner、source-page target adapter，以及保持 Convex 返回值的 Fastify shadow route 已落地；页面下游三个读取仍直接使用 Convex，未运行 candidate migration/sync/reconciliation/compare | target-only orphan 扫描、approval 分类、candidate-only reconciliation process、manifest MySQL display read 的严格还原已实现；仍需受控 candidate release/runbook、网络阻断与观察期 | 不回填 Profile/Publisher；公开可见性、排序/cursor、canonical stats、canonical href、manifest 顺序/状态、个人/组织收藏边界；未分类差异为零 | `implementing`（无 candidate 运行证据、未切换） |
| Skill、版本与制品        | `skills`、`skillVersions`、`skillSlugAliases`、GitHub source/content、fingerprints、badges、`_storage`             | expand-only `skill_package_*` 基础模型、P1 facts DTO/规范化、facts 对账、受控 `convex/skillPackageMigration.ts` internal snapshot、候选授权、MySQL 页级事务 repository、目标分页读取、checkpoint/report/reconciliation runner、规范化版本/制品/扫描对账、双 claim-token 制品 outbox 与 Convex-authoritative compare port 已部分落地；P1 facts schema、source projection、target facts upsert/read 和真实运行证据仍未完成。 | 完成 alias/GitHub/fingerprint/ownership/version-file 与 Package token/upload/trusted-publisher/inspector facts 的 source projection、事务 repository、逐字段对账和隔离测试；随后才可申请 candidate migration 和真实证据 | slug/version 顺序、制品 SHA-256、隐藏/封禁/安装资格、所有权与发布授权、固定 CLI resolve/download 闭环；任一 `unclassified`、`orphan`、缺失资产或未完成 checkpoint 均阻断 candidate-ready | `core_blocked`（P1 facts schema 未应用；生产保持 Convex 权威） |
| Package/插件发布         | `packages`、`packageReleases`、badges、trusted publishers、publish tokens/upload tickets、inspector 表、`_storage` | 已创建 P1 publish-token/upload-ticket/trusted-publisher/inspector expand-only 候选模型文件；仍未接入只读 source、MySQL facts upsert/read、对账或 HTTP/CLI，生产仍完全由 Convex 权威。 | 完成 token 哈希/撤销、trusted publisher、upload ticket、inspector/scan facts 的只读投影、逐字段对账、隔离测试和 candidate 迁移审批 | `/api/v1/packages`、release 解析、Token 即时撤销、制品 hash、旧 CLI 发布/下载                                                 | `core_blocked`（P1 facts schema 未应用；生产保持 Convex 权威） |
| Soul | `souls`、`soulVersions`、fingerprints、embeddings、comments/stars、`_storage` | candidate Soul snapshot 表、事务 repository、source page port、资产复制 consumer、公开 Fastify 只读路由与 CLI catalog client 已加入；未执行真实 source 导入或资产复制 | 真实分页导入、source watermark/checkpoint、资产字节/SHA 对账、详情/版本/下载/社交/ACL 固定客户端回归；未分类差异为零 | `convex_authoritative` |
| 社交、审核与安全 | comments/stars/reports/appeals、moderation logs、package/soul 变体、audit、scan logs、ownership transfers | candidate social/moderation facts 表、报告/证据/审计持久化基础和角色权限矩阵已加入；尚未切流 | 实际评论/星标/举报/申诉/扫描 consumer、权限拒绝矩阵、审计链连续性和幂等回归 | `convex_authoritative` |

| 文件与上传               | `_storage`、版本 files、upload tickets、scan 输入                                                                  | `ManagedAssetStore` 提供本地资产操作；没有通用目录资产 metadata                                                                                                                                                               | asset ID、owner/ACL、源 storage ID、MIME/大小/SHA-256、软删除、下载授权和历史 URL 映射                                                         | 先复制二进制后元数据；文件数/大小/hash；授权下载；回退读端                                                                    | `convex_authoritative`                                                         |
| 搜索、统计与任务         | embedding/digest 表、daily/global stats、leaderboards、stat events/cursors、cron/actions                           | skill embeddings/daily stats/stat events/global stats 部分存在；现有 outbox 可复用                                                                                                                                            | search digests、package/soul 投影、leaderboard、事件 cursor、重放/consumer 去重                                                                | 固定评测集排序/分页、事件连续、聚合 hash、worker 重放和无重复副作用                                                           | `convex_authoritative`                                                         |
| Web/桌面认证与 API Token | Auth 表、`apiTokens`、`cliDeviceCodes`、`desktopOAuthTokenFamilies`、rate limits/shards                            | users/apiTokens/rateLimits/reserved slugs/handles 与 AI Direct identities 部分存在                                                                                                                                            | session、OAuth code/PKCE、refresh family/reuse detection、revocation、JWKS/issuer 生命周期、CLI device flow                                    | 新旧 issuer 有限共存、即时撤销、CSRF/state/PKCE、全部 RBAC 拒绝                                                               | `convex_authoritative`                                                         |
| CLI、HTTP 与后台协议     | `convex/http.ts`、`httpApi.ts`、`httpApiV1/`、`crons.ts`、security/card workers                                    | Fastify 与 AI Direct worker/outbox 已存在；目录 API/CLI 仍在 Convex                                                                                                                                                           | Fastify compatibility routes、错误/限流/遥测语义、worker leases/queue、cron scheduler                                                          | 固定 CLI 版本：search/resolve/download/publish/device auth；worker 幂等、Nginx/SSR/API 回归                                   | `convex_authoritative`                                                         |

## 必须先于首个业务切片实现的通用模型

以下是本账本要求的**本地/隔离环境 expand-only** 基础模型；它们不应因本文件而在生产执行：

1. `migration_batches`：领域、来源、状态、审批/操作者引用、source cursor、计数、失败码、时间。
2. `migration_legacy_id_maps`：领域、legacy Convex ID、target ID、唯一性约束和冲突检测。
3. `migration_reconciliation_records`：领域、batch、对象 legacy ID、差异分类、稳定记录 key、摘要和观察时间。
4. `managed_assets`：稳定资产 ID、legacy Storage ID、owner/ACL、storage key、MIME、原名、字节数、SHA-256、软删除/回收状态和审计时间。
5. `migration_outbox` 或对现有 outbox 的通用化：稳定 event ID、领域对象 ID、版本、幂等键、consumer 状态和失败策略。
6. `candidate_fixture_retention_records`：只在显式候选环境记录精确已清理旧 fixture 的 snapshot、固定 marker、确认短语和既有失败 outbox 证据。该事实不可用作通用差异豁免，不能修改或删除 snapshot、asset、outbox 或 reconciliation 记录。

这些模型应以一个共享、函数式 migration port 暴露：`startBatch`、`loadCursor`、`persistProgress`、`ensureLegacyIdMap`、`recordDifference`、`publishDomainEvent`。各领域只提供 source page decoder、target transformer、repository 和规范化比较器，不能把 Convex 类型、Prisma 细节或 HTTP transport 泄漏进调用方。

## 删除门禁

- **Profile/头像试点**：页级事务、Prisma schema 对齐、只读 preflight、头像 consumer 独立进程、候选 Profile backfill、一次完整源/目标对账、运行时聚合和 Fastify-only Profile 客户端路径的候选代码及候选证据已就绪；但历史 alias 源 feed/非空 fixture、持续同步、真实资产复制、候选公开读写与身份回归、checkpoint 故障恢复、回滚、观察期和读切换均未完成。在这些证据完成前不得启用 `PROFILE_READ_MODE=mysql_authoritative`，也不得移除 Profile 或 Publisher 的 Convex 运行时依赖。详见 [`profile-migration-handoff.md`](profile-migration-handoff.md)。
- **Publisher/组织切片**：契约、expand-only snapshot 模型、Convex source port、preflight、分页原子同步、权限事实/对账、组织头像 consumer、候选公共详情/目录/成员读取、compare/fallback、读取指标、只读 cutover readiness gate、Fastify routes、前端 Publisher core HTTP 接入和候选阻断回归代码已就绪；但 migration、真实同步、真实资产复制、生产对账、真实非生产候选 HTTP/浏览器回归、切流和部署均未执行。下游 Skill/package、stars、GitHub manifest 及全部管理写/生产授权仍由各自 Convex 权威路径承担。详见 [`publisher-migration-handoff.md`](publisher-migration-handoff.md)。

- **用户资料页下游投影（published/starred/manifest）**：expand-only Prisma 模型、独立 DTO、同 Publisher manifest 复合外键、共享公开 Publisher 可见性 helper、四类受索引 internal snapshot source、页级事务同步、reconciliation checkpoint/report/runner、source-page target adapter、Fastify shadow route 与 typed client 已实现。`20260830_profile_projection_source_href` 会补存 strict reconciliation 必需的 canonical `href`，但它及其他本领域 migration 均尚未在 candidate 应用。target-only orphan 对账、差异 approval 分类、candidate-only reconciliation process、manifest MySQL display 还原已完成代码实现；candidate release、真实同步/对账/compare、阻断回归、观察期和独立评审仍未完成。该领域保持 `convex_authoritative`；不得执行或授权读切换、启用 `mysql_authoritative`，或删除任何 Convex 路径。详见 [`profile-downstream-projections-review.md`](profile-downstream-projections-review.md)。

删除任一 Convex 表、函数、HTTP route、cron、Storage 引用或 SDK 使用前，账本对应行必须满足：

1. 所有关系、文件和历史 ID 已迁移并在目标侧完成对账；
2. 新读写权威、CLI/API、worker 和认证路径已通过独立回归；
3. 已在阻断 Convex DNS/网络的候选环境运行；
4. 观察期证据为零运行时依赖；
5. 删除已获明确的不可逆批准，且源数据销毁已记录为不可恢复。
