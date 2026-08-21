---
summary: "Convex 退出前的业务功能矩阵与领域端口边界。"
read_when:
  - 为现有业务域新增 MySQL、对象存储或搜索实现
  - 设计 Convex 影子读取、切流或回滚
  - 修改直接 Convex 客户端、HTTP、Storage、认证或发布依赖
---

# Convex 退出功能矩阵

## 使用方式

- **Server 退出状态**：本仓库的 `server/` 已切断 Convex runtime、HTTP client、identity bridge、Profile/Publisher/Projection 路由注册及相关启动适配器。该状态不等于 Web 前端或 `convex/` 后端已经下线；后续业务 API 必须以独立身份核心为前置。
- **候选状态**：本矩阵描述代码边界、兼容契约和验收要求，不代表数据迁移、候选同步、对账、观察期或生产切流已经完成。领域状态以 [`convex-exit-domain-ledger.md`](convex-exit-domain-ledger.md) 为准。
- 一个领域只能从 `convex_authoritative` 经过回填、影子读取、MySQL 读取，最后成为 MySQL 写入权威；禁止形成双写权威。
- `specs/convex-dependency-baseline.json` 是静态依赖的机器可读基线。`node scripts/check-convex-dependency-baseline.mjs` 只扫描当前工作区的 `convex/`、`server/`、`packages/` 与存在时的 `src/`，要求当前命中与已提交基线精确一致：新增或增加会失败，减少后未同步收缩基线也会失败。基线只能由显式 `--write-baseline` 重建，不得把它用于掩盖新增依赖。
- 领域端口位于 `server/src/domains/<domain>/`。路由只负责协议、身份和输入输出；port 定义领域读写契约；adapter 封装 Convex、Prisma、资源存储或搜索实现；compare adapter 只返回主读结果并异步记录规范化差异。

## 领域边界

| 域                   | 当前读端 / 写端                                                                                                  | 身份与文件依赖                                      | 必须保持的兼容契约                                                                                                                               | 退出门禁                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公开用户资料         | **冻结态：生产仍为 `convex_authoritative`；Fastify Profile/Identity 读取、候选 HTTP/SSR/浏览器回归代码已存在，但生产读切换禁止** | 独立 JWT/session、Profile snapshot、头像 ManagedAssetStore | `/profile/<slug>`、`/api/profiles/<slug>`、`/api/identities/<handle>`、canonical/历史 alias、公开字段、软删除与停用可见性 | 历史 alias 非空 fixture、增量 cursor/checkpoint 故障恢复、头像 bytes/SHA-256/ACL、候选 HTTP/SSR/浏览器阻断与观察期全部通过后，才可评审读切换 |
| 发布者与组织         | **冻结态：生产仍为 `convex_authoritative`；Publisher core Fastify 只读候选边界已实现** | 独立 JWT/session、Profile legacy map、Publisher managed assets | `/user/<handle>`、`/publishers`、`/api/publishers`、canonical handle、成员 owner/admin/publisher、official/trusted 独立事实 | Publisher/member/official/Projection 的排序分页权限、头像 bytes/SHA-256、增量恢复、候选 HTTP/SSR/浏览器阻断和未分类差异为零；不得迁移写授权 |

| Skill 目录与发布     | Convex 仍为 SSR/browser、CLI、HTTP v1 与写入权威；候选 DTO/snapshot/import/reconciliation/asset-copy/compare contract 已实现但未执行 | Convex Auth、Skill/版本文件 Storage                 | slug、版本、下载、转移、隐藏/封禁和安装资格                                                                                                      | candidate + execution flag + approval 才可运行页级导入；制品 SHA-256、扫描/来源/owner 对账、CLI 旧版本闭环与无 Convex 回归通过前禁止切换 |
| 插件与包             | Convex package/release API、CLI 与 token/upload ticket 仍为唯一权威；候选 contract 未接入 HTTP/CLI | 发布 Token、Convex Storage、trusted publishing      | `/api/v1/packages`、release 解析、制品和完整性元数据                                                                                             | Token 撤销、upload ticket、trusted publishing、规范化 API、制品 hash 对账和旧 CLI publish/download 全部通过前禁止切换 |
| Soul                 | **冻结态：生产仍为 `convex_authoritative`；尚未批准数据迁出**                                                                  | 独立 Soul identity、版本文件、ManagedAssetStore、社交关系和 ACL 事实模型（待评审） | 列表、详情、版本、文件、收藏、评论、可见性与安装资格                                                                                             | 先批准独立事实模型、版本/文件/资产/社交/ACL ERD 和权限矩阵；完成 moderation/scan/appeal/ownership/audit 依赖后，才可设计候选 source/target 对账 |
| 社交、审核与安全     | **冻结态：生产仍为 `convex_authoritative`；审核和安全事实尚未形成可迁移独立链**                                  | moderation events、scan facts、appeals、ownership transfers、audit ledger、受控资产状态                  | 举报、申诉、人工覆盖、封禁、扫描、所有权转移、审计和上传门禁                                                                                     | 先完成事件模型、不可变审计链、扫描事实与重试幂等、申诉状态机、转移 ACL 和所有拒绝路径；未完成前不得迁出 Soul 或恢复相关写入 |

| 文件与上传           | Convex Storage、`uploads`、下载/HTTP route                                                                       | 上传所有权、MIME/大小约束                           | 稳定资源 ID、历史 URL、字节和 SHA-256                                                                                                            | 先通过同一份生产整卷加密归档与隔离恢复证据；随后二进制先复制后切元数据，文件数/大小/hash 对账和可回退读端通过                                    |
| 搜索、统计与任务     | Convex search/digest/stats/cron；worker 使用 Convex HTTP                                                         | 仅必要用户上下文，部分资源文件                      | 排序、分页、热门值、统计与任务幂等                                                                                                               | 固定评测集达标；事件连续性、聚合与回放对账                                                                                                       |
| Web 认证与桌面 OAuth | `server` 当前无身份桥；独立 JWT/JWKS 或 OIDC verifier 待实现，现有受保护 API fail-closed             | issuer/audience、JWT/JWKS、桌面 PKCE                | 登录、退出、切换、桌面 authorization code + PKCE                                                                                                 | issuer、撤销、会话映射和所有 RBAC 拒绝路径通过后，才能恢复受保护 API；不得恢复 Convex identity bridge |
| CLI、HTTP 与部署     | Convex HTTP v1、CLI、workflow Convex deploy                                                                      | API/publish Token、部署环境变量                     | resolve/download、错误语义、限流和遥测边界                                                                                                       | 固定 CLI 版本闭环；同一份整卷归档/隔离恢复证据；Nginx/SSR/API 生产烟测；无 Convex 网络演练                                                       |

## Skill/Package 候选迁出边界（P1 事实模型部分完成，未执行）

- 领域交接、可复现测试和待开发任务以 [`skill-package-migration-handoff.md`](skill-package-migration-handoff.md) 为权威；该文档不构成 candidate 或生产执行批准。
- P1 DTO/规范化、MySQL facts upsert/read、只读 source projection 和逐字段对账代码已形成隔离候选边界；候选 migration 未应用，真实 source/target 未连接。
- `server/src/domains/skill-packages/` 的 DTO、normalizer、reconciliation、import runner、MySQL page repository、asset consumer 与 compatibility port 都是隔离边界。不得在 import 时创建连接、读取 Storage bytes、注册 process，或修改 HTTP/CLI 读写路径。
- 当前定向测试仍覆盖 4 个文件、13 个断言并通过；这些 fake pool/connection 测试不替代候选真实数据证据。生产状态继续保持 Convex authoritative。
- 在 P1 facts 候选代码的隔离测试补齐前，不能开始真实对账；之后也必须先完成候选 schema 审查和非生产证据，再讨论任何业务读写迁出。身份核心和 API 契约属于更高优先级前置工作。

## Publisher/组织切片边界（候选代码已就绪，未执行）

- `publishers` 是个人与组织的 canonical 发布身份。个人 Publisher 必须通过 `linkedUserId` 关联 active user；Profile handle/profileSlug 不能替代 Publisher handle，也不生成 Publisher alias。
- `publisherMembers.role` 的等级为 `owner > admin > publisher`。个人 Publisher 的关联用户拥有 owner 语义且 owner membership 不可移除；组织必须至少保留一名 active owner。admin 可管理普通成员，但不能提升为 owner、移除 owner 或删除组织。
- `officialPublishers` 与 `trustedPublisher` 是不同事实：official 仅允许 active org，由平台 admin 管理；trusted 是独立的内部信任标记，不得由 official 推导。
- 本切片的 MySQL membership/access adapter 只用于候选公开读取和允许/拒绝对账。Convex 仍是 `createOrg`、profile/avatar 更新、member upsert/remove、official/trusted 管理、publish target 解析和组织删除级联的唯一写权威。
- Publisher snapshot、成员、官方、legacy map、checkpoint、组织头像 outbox/consumer、权限事实/对账、公共详情/目录 candidate adapter、Convex compare/fallback adapter、读取指标和只读 readiness gate 已落地。`compare` 只返回 Convex 权威结果；`mysql_authoritative` miss 必须 fail closed；readiness gate 只生成证据，不自动切流。
- Publisher 公共读取 adapter 只接收受控窄 `query` capability，不新增独立 Convex HTTP client transport，也不得通过修改 `specs/convex-dependency-baseline.json` 放宽依赖基线。
- `/user/<handle>` 继续统一展示个人与组织，`/p/<handle>`、`/orgs/<handle>` 继续重定向。Publisher core、公开成员和 `/publishers` 目录属于本域；published Skill/package、stars 和 GitHub display manifest 通过下游 port 组合，分别留在 Skill/package、社交与 GitHub source 领域。
- 组织头像可复制到 ManagedAssetStore；个人 Publisher 头像复用 Profile managed asset。仅有外部 `image` URL 而无 `imageStorageId` 的组织保持 external/pending，不能满足 `mysql_authoritative` readiness。
- `publisherAbuse*` 的评分、复核和 cron 归社交/审核/安全域，不进入 Publisher 核心权限模型。
- Fastify 已暴露 `GET /api/publishers`、`GET /api/publishers/:handle` 与 `GET /api/publishers/:handle/members`，并接入 Publisher port factory。`src/routes/publishers/index.tsx` 与 `src/routes/user/$handle.tsx` 的 Publisher core/公开成员读取已改走 Fastify HTTP；Skill/package published items、stars 和 GitHub display manifest 仍显式保留在各自 Convex 权威下游。
- 候选 HTTP/浏览器阻断回归代码已覆盖 `/publishers`、`/user/:handle`、`/p/:handle`、`/orgs/:handle`、个人/组织、成员、official badge、头像、分页和 404，并强制显式非生产候选 URL。当前只运行了不触网 helper 测试；真实候选 HTTP 与 Playwright 回归尚未执行。
- 仍未执行 Prisma migration、真实同步、真实组织头像复制、生产对账、真实非生产候选回归、切流或部署；生产状态保持 `convex_authoritative`。成员管理、组织管理、official/trusted 写入、所有权转移、组织删除和生产授权迁移继续后置。

## 首个切片：公开用户资料影子读取（冻结）

> 当前仅保留实现边界作为后续整体迁移参考。发布冻结期间不得应用 migration、运行 backfill、设置 `PROFILE_READ_MODE` 或 reload。必须先通过 `specs/server-migration.md` 的整卷归档与隔离恢复演练，随后将 Profile 作为独立领域重新获批。

边界为 `server/src/domains/profiles/`，而非 React 路由：

```text
profiles/
  publicProfilePort.ts      # getPublicProfile(slug)
  convexPublicProfile.ts    # 旧权威 adapter
  mysqlPublicProfile.ts     # 新投影 adapter
  comparePublicProfile.ts   # 主读 Convex，影子 MySQL，记录已脱敏差异
  normalizePublicProfile.ts # 只保留客户端可见字段的等价比较
```

- `src/routes/profile/$slug.tsx` 使用应用 client 调用 Fastify `GET /api/profiles/:slug`；当前切片不保留客户端 Convex fallback。Fastify 不可用时必须按应用错误契约失败，不得绕过 API 重新建立浏览器 Convex 读取。
- 当前实现已具备 `PROFILE_READ_MODE=convex|compare|mysql`，但生产尚未执行 migration、回填或读模式变更，故域状态仍是 `convex_authoritative`。`convex` 为缺失/无效配置的默认值；`compare` 只返回 Convex 并记录 MySQL 影子差异；`mysql` 仅 MySQL 命中时返回 MySQL，缺失或异常立即回退 Convex。
- 进入 `backfilling` 的前提是由 `main` 自动 Deploy 成功应用 expand-only migration。以唯一的 `PROFILE_BACKFILL_BATCH_ID` 和 `PROFILE_BACKFILL_BATCH_SIZE=100` 单进程运行 `bun run --cwd server db:profiles:backfill`，直至 batch/cursor completed；重复同一 batch 必须不重读。
- 进入 `shadow_reading` 的前提是 completed batch、`errorCount=0`、snapshot/map 计数及孤儿 SQL 检查通过。设置受限 `api.env` 中的 `PROFILE_READ_MODE=compare` 并受控 PM2 reload 后，至少覆盖一个完整正常流量周期；检查 `profile_reconciliation_records`，所有差异必须分类且未解释差异为零。
- compare 与 mysql 阶段分别抽样已激活、有/无头像、handle fallback、删除/停用、封禁和未知 slug 的 `/api/profiles/:slug`、`/profile/:slug`；确认 HTTP status/body、SEO/SSR 与 Convex 基线等价。封禁可见性必须按 Convex `toPublicUser` 的实际契约判断：当前由 `deletedAt`/`deactivatedAt` 隐藏，不能仅因 `banReason` 非空扩大过滤。MySQL adapter 异常、API 可用性异常或任一未解释差异都必须将 `PROFILE_READ_MODE=convex` 并 reload。
- 受保护的 `/health/runtime` 提供 `profileReads.mysqlHit`、`fallback`、`diff`、`adapterError` 累计计数，用于 compare/mysql 观察和回退判断；这些指标由 profile adapters 记录，路由不读取模式或判断后端。
- 进入 `mysql_reading` 前还必须完成 MySQL miss 的 Convex fallback 验证；切换后观察错误率与 fallback 指标，并演练恢复 `PROFILE_READ_MODE=convex`。DDL 不回滚；出现 schema 问题只能追加兼容 migration。
