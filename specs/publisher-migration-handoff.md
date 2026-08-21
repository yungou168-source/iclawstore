---
summary: "Publisher 与组织退出 Convex 的候选代码交接记录；生产仍由 Convex 权威。"
read_when:
  - 继续 Publisher、组织、成员角色、官方状态或组织头像迁移
  - 修改 /publishers、/user/:handle、/p/:handle 或 /orgs/:handle
  - 设计 Publisher 候选环境、对账、公共读取切换或 readiness gate
---

# Publisher 与组织迁移交接

> **状态**：Publisher/组织候选数据门禁已完成：候选函数发布、受确认保护的旧静态 Profile fixture 清理、全量同步、reconciliation 与 preflight 均已执行并通过。生产仍是 `convex_authoritative`；候选 HTTP/SSR/浏览器回归、观察期、读切流、写授权迁移与生产发布均未完成。
>
> **生产禁止项**：不得运行 Publisher sync、avatar consumer、reconciliation、readiness/cutover 入口连接生产数据；不得启用 `PUBLISHER_READ_MODE=mysql_authoritative`；不得把生产 URL 当作候选 URL；不得删除 Publisher 相关 Convex functions、SDK 使用、Storage 或 `/convex` 代理。
>
> **权威边界**：MySQL Publisher 投影目前只用于迁移、候选公共读取、影子比较、事实对账和 readiness 证据。Convex 仍是组织创建、成员管理、官方/trusted 管理、发布目标解析、组织删除和所有生产授权的唯一权威。

## 当前事实

| 范围              | 候选代码事实                                                                                                                                                                                                                                                                                                                                                                                             | 尚未完成的运行证据                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 领域契约          | `specs/convex-exit-domain-ledger.md` 与 `specs/convex-exit-functional-matrix.md` 已拆分 Publisher 核心、成员角色、official/trusted、头像资产和下游目录边界。                                                                                                                                                                                                                                             | 生产领域状态仍为 `convex_authoritative`；未批准写授权迁移。                                          |
| Schema            | `prisma/migrations/20260823_publisher_domain_expand/migration.sql` 与 `prisma/schema.prisma` 已定义独立 snapshot、member、official、checkpoint、avatar 和通用 migration/outbox 关联。                                                                                                                                                                                                                    | migration 未应用；没有真实 MySQL snapshot 行或 FK/索引运行证据。                                     |
| Source port       | `convex/publisherMigration.ts`、`server/src/domains/publishers/publisherMigrationSource.ts` 和 `convexPublisherMigrationSource.ts` 提供 Publisher、member、official 分页快照。                                                                                                                                                                                                                           | 未连接真实 Convex 源运行；未生成生产 batch/watermark。                                               |
| 同步编排          | `publisherSyncOrchestrator.ts` 按 Publisher → member → official 阶段推进，每页在同一 MySQL transaction 写 snapshot、legacy map、Profile map 关联、组织头像 outbox、cursor/checkpoint，并在全量终页收敛 source missing/tombstone。                                                                                                                                                                        | 未运行 sync 入口；无真实同步计数、lag、失败码或重放证据。                                            |
| Preflight/runtime | `publisherMigrationPreflight.ts`、`publisherMigrationRuntime.ts` 和 `publisherMigrationPreflightProcess.ts` import-safe，区分结构 readiness 与候选 backlog readiness。                                                                                                                                                                                                                                   | 未对真实候选数据库运行 preflight。                                                                   |
| 权限事实/对账     | `publisherAccess.ts`、`publisherReconciliation.ts`、`publisherReconciliationRunner.ts` 和 `publisherReconciliationProcess.ts` 覆盖 publish、profile update、member upsert/remove、owner promote/remove、org delete、official/trusted 管理事实；只生成 evidence，不参与生产授权。                                                                                                                         | 未对真实源/目标运行生产对账；未分类差异尚无真实零差异证据。                                          |
| 组织头像          | `publisherAvatarAssetConsumer.ts` 只消费 `publishers` 域 outbox，只接受 active org，个人 Publisher 头像复用 Profile asset；校验 source storage ID、MIME、bytes、SHA-256。                                                                                                                                                                                                                                | 未复制真实 Convex Storage 对象；外部 URL 或 pending/failed asset 仍阻断 readiness。                  |
| 公共读取          | `publicPublisherPort.ts`、MySQL/Convex/compare adapters、`publisherPortFactory.ts` 与 `routes/publicPublishers.ts` 已提供 `convex/compare/mysql/mysql_authoritative` Publisher core 读取边界，暴露 `GET /api/publishers`、`GET /api/publishers/:handle`、`GET /api/publishers/:handle/members`，覆盖公共详情、公开成员与目录分页/筛选/计数。`mysql_authoritative` miss 或 adapter error 均 fail closed。 | 未对真实非生产候选服务执行 HTTP 等价性和观察期验证；生产仍不得启用 `mysql_authoritative`。           |
| 前端组合边界      | `src/lib/publicPublisherApi.ts`、`src/routes/publishers/index.tsx` 与 `src/routes/user/$handle.tsx` 已将 Publisher core 和公开成员读取改为 Fastify HTTP。Skill/package published items、stars 与 GitHub display manifest 仍显式保留在各自 Convex 权威下游。                                                                                                                                              | 下游领域尚未迁移；不得把这些依赖误记为 Publisher core 已迁移或回填进 Publisher snapshot。            |
| 可观察性          | `publisherReadObservability.ts` 提供 read metrics 和迁移 snapshot 指标，包括 watermark、cursor age、retry、asset backlog、未分类差异和 `candidateReady`。                                                                                                                                                                                                                                                | 未建立候选/生产时序样本、阈值、告警或观察期。                                                        |
| Readiness gate    | `publisherCutoverReadiness.ts` 和 `publisherCutoverReadinessProcess.ts` 只读检查结构、backlog、资产、差异、running batch 与 Profile link，强制显式非生产 `PUBLISHER_PUBLIC_READ_CANDIDATE_URL`，拒绝生产 URL 作为候选。                                                                                                                                                                                  | gate 未对真实候选环境执行；即使 ready 也不自动切流。                                                 |
| Convex transport  | Publisher Fastify route 与 adapters 只接收受控窄 `query` capability，并复用既有公开 Convex query client 构造边界；未新增独立 `ConvexHttpClient` 或 `convex/browser` transport。前端 Publisher core 已移除浏览器直连 Convex，依赖基线随实际减少而收紧。                                                                                                                                                   | Skill/package、stars、GitHub manifest 等下游仍保留各自既有 Convex 权威依赖，必须按后续领域单独迁移。 |

## 边界与不变量

- 个人 Publisher 与 Profile 是不同身份边界。个人 Publisher 可通过 `linkedUserLegacyConvexId` 与 Profile legacy map 关联，但不得从 Profile handle/slug 推导或伪造 Publisher alias。
- 组织 Publisher 至少需要一名 active owner。`owner > admin > publisher`：admin 不能提升 owner、移除 owner 或删除组织。
- `officialPublishers` 与 `trustedPublisher` 是独立事实。official 只允许 active org；trusted 不由 official 推导。
- 个人 Publisher 头像复用 Profile managed asset；只有 org 自有 `imageStorageId` 进入 Publisher avatar outbox。外部 `image` URL 不等于已迁移资产。
- `compare` 模式只返回 Convex 权威结果并记录差异；`mysql` 模式允许 MySQL 命中优先、异常或 miss 回退 Convex；`mysql_authoritative` 必须 fail closed，不允许 Convex fallback。
- Publisher 权限投影只用于迁移、事实对账和证据，不进入生产授权路径。
- Skill/package published items、stars 和 GitHub display manifest 归后续 Skill/package/social/GitHub source 领域。Publisher core 不把这些下游事实回填为自己的权威数据。

## 已有代码落点

| 职责                            | 文件                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publisher source port           | `server/src/domains/publishers/publisherMigrationSource.ts`                                                                                                                                |
| Convex migration source adapter | `server/src/domains/publishers/convexPublisherMigrationSource.ts`                                                                                                                          |
| 原子同步编排                    | `server/src/domains/publishers/publisherSyncOrchestrator.ts`                                                                                                                               |
| 同步入口                        | `server/src/publisherSyncProcess.ts`                                                                                                                                                       |
| Preflight/runtime               | `server/src/domains/publishers/publisherMigrationPreflight.ts`, `server/src/domains/publishers/publisherMigrationRuntime.ts`                                                               |
| 权限事实                        | `server/src/domains/publishers/publisherAccess.ts`                                                                                                                                         |
| 对账与 runner                   | `server/src/domains/publishers/publisherReconciliation.ts`, `server/src/domains/publishers/publisherReconciliationRunner.ts`                                                               |
| 组织头像 consumer               | `server/src/domains/publishers/publisherAvatarAssetConsumer.ts`                                                                                                                            |
| 头像 source/repository/import   | `server/src/domains/publishers/convexPublisherAvatarSourceReader.ts`, `mysqlPublisherAvatarAssetRepository.ts`, `publisherAvatarAssetImport.ts`                                            |
| 公共读取 port/adapters          | `server/src/domains/publishers/publicPublisherPort.ts`, `mysqlPublicPublisherAdapter.ts`, `convexPublicPublisherAdapter.ts`, `comparePublicPublisherAdapter.ts`, `publisherPortFactory.ts` |
| Fastify Publisher routes        | `server/src/routes/publicPublishers.ts`, `server/src/index.ts`                                                                                                                             |
| 前端 Fastify client/loader      | `src/lib/publicPublisherApi.ts`, `src/routes/publishers/index.tsx`, `src/routes/user/$handle.tsx`                                                                                          |
| 候选 HTTP/浏览器门禁            | `e2e/helpers/candidateConvexNetwork.ts`, `e2e/candidate-http-regression.e2e.test.ts`, `e2e/candidate-convex-block.pw.test.ts`                                                              |
| 读取与迁移指标                  | `server/src/domains/publishers/publisherReadObservability.ts`                                                                                                                              |
| Cutover readiness               | `server/src/domains/publishers/publisherCutoverReadiness.ts`, `server/src/publisherCutoverReadinessProcess.ts`                                                                             |
| 测试                            | `server/test/publisher*.test.ts`                                                                                                                                                           |

## 已验证命令

以下验证均只检查代码、schema 或 mock 单元测试；没有连接数据库、没有运行 migration/sync/consumer/reconciliation/cutover/deploy 入口：

```bash
cd /www/wwwroot/iclawstore.com && \
  bun node_modules/prisma/build/index.js validate --schema prisma/schema.prisma

cd /www/wwwroot/iclawstore.com/server && \
  bun ../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

cd /www/wwwroot/iclawstore.com && \
  bun node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

cd /www/wwwroot/iclawstore.com/server && \
  bun test \
    test/publicPublisherRoutes.test.ts \
    test/publisherPublicRead.test.ts \
    test/publisherCutoverReadiness.test.ts \
    test/publisherMigrationProcesses.test.ts \
    test/publisherAccessReconciliation.test.ts \
    test/publisherAvatarAssetConsumer.test.ts \
    test/publisherSyncOrchestrator.test.ts \
    test/publisherMigrationPreflight.test.ts

cd /www/wwwroot/iclawstore.com && \
  bunx vitest run -c vitest.e2e.config.ts \
    e2e/helpers/candidateConvexNetwork.e2e.test.ts

cd /www/wwwroot/iclawstore.com/server && \
  bunx oxfmt --check \
    src/domains/publishers/publicPublisherPort.ts \
    src/domains/publishers/mysqlPublicPublisherAdapter.ts \
    src/domains/publishers/convexPublicPublisherAdapter.ts \
    src/domains/publishers/publisherReadObservability.ts \
    src/domains/publishers/comparePublicPublisherAdapter.ts \
    src/domains/publishers/publisherPortFactory.ts \
    src/domains/publishers/publisherCutoverReadiness.ts \
    src/publisherCutoverReadinessProcess.ts \
    test/publisherPublicRead.test.ts \
    test/publisherCutoverReadiness.test.ts \
    test/publisherMigrationProcesses.test.ts

cd /www/wwwroot/iclawstore.com && \
  bun scripts/check-no-new-convex-client-usage.ts
```

最近一次结果：Fastify Publisher routes 与 Publisher 定向服务端测试全部通过；候选 URL/fixture/Convex 阻断 helper `6 pass`；Prisma validate、server/root TypeScript、目标 `oxfmt --check`、目标 `git diff --check` 与收紧后的 Convex 依赖基线均通过。真实候选 HTTP 与 Playwright 回归未运行，因为尚未提供显式非生产候选 URL 和 fixtures。

## 候选 fixture 最终核验（2026-08-18）

以下均为候选环境 `https://candidate.iclawstore.com` 与 `iclawstore_candidate` 的记录，不代表生产 Publisher 迁移、读切流、写授权变更或生产发布完成。

- 当前世代 Official org `candidate-e2e-org-r20260314a` 是 active Official，至少有一名 owner。其受管头像快照为 `active`，`failureCode=null`；源 Storage ID 与 target asset ID 都已记录在候选 MySQL。资产为 `image/png`、68 bytes、SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`，公开 DTO 只提供站内 Publisher asset route。
- Publisher reconciliation 批次 `4de4f5a3-730b-4a96-a8e9-c9cc34038fbf`：source/target Publishers 为 31/33，members 为 32/32，Official 为 1/1，difference/unclassified 各 3，`candidateReady=false`。这些 target-only 历史 records 来自清理后仍须保留的旧静态 fixture snapshots；禁止删除 MySQL snapshot、伪造 Convex source 或将差异伪装为已解决。
- Publisher readiness 为 `ready=false`，blocks 为 `publisher_candidate_backlog_not_ready`、`publisher_assets_pending`、`publisher_reconciliation_unresolved`、`publisher_reconciliation_unclassified`；结构检查已通过、无 running batch、缺失 Profile link 为 0。唯一 pending avatar 是旧静态 `candidate-e2e-org` fixture，失败码 `publisher_avatar_source_missing`。它与同类 Profile 历史失败均须独立保留，不能写成成功或清零失败证据。
- 显式 candidate URL 的 HTTP regression 为 6/6 通过。Chromium 与 Mobile Chrome 的 Candidate Convex-block gate 各 2/2 通过，覆盖目录、个人/Official Publisher、成员、重定向、受管头像、404 以及零浏览器 Convex HTTP/WebSocket。Mobile Safari 仍受宿主缺少 WebKit 系统库阻塞；不得为通过该测试修改主机级依赖。
- 候选 Profile SSR 仅做了候选 release 构建与发布：使用隔离 Nitro 输出目录，将产物复制到 `/www/iclawstore-candidate/releases/candidate-next/` 后重启候选 SSR。不得将此步骤用于生产构建或生产服务。

## 历史 fixture 保留证据（仅候选）

- 候选 MySQL 已应用 `20260827_candidate_fixture_retention`。该 append-only 表只含精确的旧 `candidate-e2e-profile` 和 `candidate-e2e-org` 记录；登记须同时验证候选开关、确认短语、snapshot 与原有 `*_avatar_source_missing` outbox 证据。禁止用它登记当前世代、普通对象或任意新 target-only 差异。
- Publisher reconciliation 批次 `d81b70b3-f1ab-42de-9139-041e3137b16f`：Publisher source/target 为 31/33、difference 3；其中 `expected_retired_fixture=1`、`unclassified=2`，因此 `candidateReady=false`。未分类差异继续阻断，不得通过删除快照、伪造 Convex 源或扩大保留匹配绕过。
- Publisher preflight 的当前 pending/failed assets 均为 0，历史 retained pending 为 1；readiness 仅报告两个未分类对账阻塞，不再将该已验证历史头像事件作为当前 backlog。这不构成生产迁移、读切流或写授权批准。

## 候选数据门禁记录（2026-08-18）

- candidate vhost 仅将 Convex 控制面/数据面精确命名空间 `/api/get_config_hashes`、`/api/v1/`、`/api/deploy2/` 与 `/api/function` 代理至候选 backend `127.0.0.1:3210`；通用 Fastify `/api/` 不变，未触及 production vhost。
- `cleanupLegacyStaticProfileAction` 仅在候选环境开关与确认短语 `candidate-e2e-fixtures` 同时满足时运行。它只匹配固定旧静态 Profile handle、已验证 fixture marker 与固定 legacy member ID；会删除其 personal Publisher/member/official 关系，包含父 Publisher 已不存在的 orphan member，不能扩展为普通业务记录或全表清理。
- 函数发布后，候选全量同步批次 `c6e97529-2e1a-4555-a72c-56deab8467bc` 已完成（`upserted=0`、`unchanged=63`）。reconciliation 批次 `9a15fd06-d3ca-4168-a134-01bdc41186fe` 为 source/target Publishers `31/32`、members `31/31`、official `1/1`、`unclassifiedDifferences=0`、`retainedFixtureDifferences=1`、`candidateReady=true`。
- 最终 preflight 为 `ready=true`、`candidateReady=true`、无结构缺口、运行 batch、资产积压或未解决差异。唯一差异是已批准的旧 `candidate-e2e-org` fixture retention；不得将任何其他历史或业务记录归为 retention。


1. **准备显式非生产候选环境**：提供与生产 URL 不同的候选 Fastify base URL，以及个人/组织 Publisher handle、历史入口、official、头像和分页 fixtures；任何生产 URL 都必须被门禁拒绝。
2. **执行真实候选 HTTP/浏览器回归**：运行已落地的 candidate HTTP 与 Playwright 阻断测试，验证 `/publishers`、`/user/:handle`、`/p/:handle`、`/orgs/:handle`、个人/组织、成员、official、头像、分页和 404；同时区分 Publisher core 与仍属 Convex 权威的下游请求。
3. **评审候选数据运行授权**：若需生成 MySQL 候选数据，必须单独批准 expand-only Prisma migration、Publisher sync、头像复制、对账和 readiness gate 的环境、凭据、回滚与观察计划。
4. **保持写与授权后置**：成员管理、组织管理、official/trusted 写入、所有权转移、组织删除、发布授权及任何生产授权读取仍由 Convex 权威，必须作为独立切片设计。
5. **切流单独批准**：即使真实候选门禁全部通过，也不得自动启用 `mysql_authoritative`、移除 Convex fallback 或部署；切流与生产发布需要明确后续授权。

## 切流门槛

以下全部成立前，禁止启用 Publisher `mysql_authoritative` 或移除 Publisher Convex 依赖：

1. expand-only migration 已在明确候选环境应用，且只读 preflight 结构 ready；
2. 全量与增量 Publisher sync 已产生可恢复 cursor、watermark、retry 和 failure evidence；
3. Publisher、member、official、Profile link、权限矩阵、组织头像 bytes/SHA-256 对账零未分类差异；
4. 资产 consumer 已处理所有 org avatar outbox，pending/failed/external 均为零或已分类豁免；
5. Fastify DTO 与 Convex 主读的规范化响应等价，`compare` 观察期无未解释差异；
6. 显式非生产候选 URL 的 HTTP/浏览器阻断回归通过，且生产 URL 不能作为候选；
7. Publisher 仍只有一个写权威。成员管理、组织管理、official/trusted 写入、所有权转移、组织删除和生产授权迁移必须后置单独设计。

相关总账本见 [`convex-exit-domain-ledger.md`](convex-exit-domain-ledger.md)，整体退出约束见 [`convex-exit-migration.md`](convex-exit-migration.md)。
