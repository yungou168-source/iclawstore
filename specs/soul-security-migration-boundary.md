---
summary: "Soul 与审核安全迁出前的独立事实模型、权限边界和冻结条件。"
read_when:
  - 设计 Soul、版本文件、社交、ACL 或资产迁出
  - 设计 moderation event、scan facts、appeal、ownership transfer 或审计链
  - 评审是否可以从 convex_authoritative 进入 Soul 候选迁移
---

# Soul 与审核安全迁出边界

> **状态（2026-03-14）**：生产继续保持 `convex_authoritative`。候选态已有独立文件/对象存储 source、snapshot/version/file 表、MySQL 事务 repository、页级 watermark/checkpoint import primitive、资产复制状态机、MySQL reconciliation runner、四类 job composition、CLI executor dispatch、运维 dry-run/确认解析器与基础测试。已在隔离 MySQL 8.4 fixture 上验证 snapshot/version/file 导入、资产复制、SHA-256/size/MIME/metadata 对账、重复运行幂等、retryable failure 恢复，以及 changed/orphan reconciliation 阻断；worker 的真实 lease、续租、过期回收、重启后接管和重复 claim 防护也已通过 Bun runner 回归。对象存储 fixture 已验证源读取失败恢复、ETag 变化阻断和非法分页参数 fail-closed。Soul 候选链不得链接 Convex client、function reference 或运行时 transport；它没有接入任何外部 source、应用生产迁移或执行读切换，不构成生产数据同步或写权威变更授权。

MySQL fixture 启动方式：`sudo -n docker compose -f server/test/fixtures/docker-compose.mysql.yml up -d --wait`，随后显式设置 `SOUL_FIXTURE_DATABASE_URL` 运行集成测试；未设置该变量时 fixture 测试跳过，不读取生产数据库。
## 1. Soul 事实模型尚未等价

Soul 不能直接复用 Profile、Publisher 或 Skill/Package 的 snapshot。独立模型至少需要以下事实域：

| 事实域 | 必须独立保存 | 迁出前约束 |
| --- | --- | --- |
| Soul identity | canonical slug、owner、publisher/组织关联、公开/隐藏/删除状态、source legacy ID | identity 不得由 Profile handle 或 Publisher handle 推导；删除和停用必须有明确 tombstone |
| Version | 版本号、发布时间、changelog、source commit、当前/历史状态 | 版本唯一性、排序和 latest 指针必须可重建；软删除版本不能成为 latest |
| Version files | 相对路径、规范化 MIME、大小、SHA-256、文件角色和版本关联 | 路径穿越、重复路径、跨版本引用和 hash 不一致必须拒绝 |
| Managed assets | asset ID、storage key、owner domain、ACL、扫描状态、生命周期和引用 | 业务表不得暴露物理路径；复制完成前不得公开引用；删除必须保留审计和回收状态 |
| Social facts | star/comment identity、创建时间、软删除、目标状态和作者状态 | 社交写入不能由公开投影代替；隐藏 Soul 必须按当前公开规则过滤互动读取 |
| ACL | owner/admin/member/reader/install actor、组织成员快照或可验证引用、拒绝原因 | ACL 判定必须独立于公开 DTO；owner 删除、成员降权、封禁和 transfer 中间态要即时阻断 |

建议 ERD 方向为 `soul_snapshots`、`soul_version_snapshots`、`soul_version_file_snapshots`、`convex_exit_managed_assets` 引用、`soul_stars`、`soul_comments`、ACL/ownership transfer 事实表，以及共享 migration batch/cursor/outbox/reconciliation 记录。当前 candidate migration 已创建前三张 snapshot 表；repository 使用 batch ID 做事务 upsert，资产 consumer 必须先校验源字节大小与 SHA-256、再落入受管资产 metadata 并回写 `targetAssetId`。source 使用独立文件/对象存储分页 port；不得实现 Convex source adapter。

## 2. 审核与安全是 Soul 的前置依赖

Soul 迁出前必须先建立与业务对象解耦的安全事实链：

- `moderation_events`：不可变对象、actor、角色、动作、前状态、后状态、原因、幂等键、来源和时间。
- `scan_facts`：artifact/version、scanner、attempt、输入摘要、结论、发现、原始证据引用、重试次数和状态；扫描事实不能直接等同于最终公开裁决，除非明确的 policy gate 采纳。
- `appeals`：对象、申请人、状态机、裁决人、裁决理由、证据和幂等约束；申诉不能绕过封禁、删除或扫描门禁。
- `ownership_transfers`：发起方、当前 owner、目标 owner、过期时间、接受/拒绝/取消状态、版本冲突和最终审计事件。
- `audit_events`：append-only、事件 ID/链序号、actor、对象、动作、前后摘要和相关 request/idempotency key；不能用可变 projection 代替合规账本。

所有安全事实都必须支持重放、幂等和拒绝路径测试。worker 重试不得产生重复 moderation event、重复 scan decision、重复 transfer 或重复审计事件。

### 本轮实现边界

- Soul public routes are registered only when `SOUL_READ_MODE=candidate`; absent or any other value leaves them unavailable. This switch is candidate-only, does not select MySQL as authoritative, and must never be enabled in production without its separate gate.
- `soulAssetCopyConsumer` 仅对 `pending` 文件执行读取、大小/SHA-256 校验、受管存储写入和 metadata 回写；必须由隔离候选 worker 提供受控 source adapter 后才可运行。`copied` 只表示 candidate 资产元数据已建立，不等同于公开下载已开放。
- moderation facts 目前只提供报告 case、去重 evidence 和 hash-keyed audit event 持久化。它没有实现评论、星标、scan、appeal、ownership transfer 或完整 append-only sequence；所有这些仍为 candidate gate 前置条件。
- runtime worker 的 lease/checkpoint 保护受控循环执行；job composition 已提供 full-import 与 incremental-sync 的独立 source 接线，默认未注册 source/job 时不执行写入。资产复制与 reconciliation job 仍需接入后才能作为完整 worker parity 证据。
- 本轮新增 `server/src/domains/souls/soulSecurityFacts.ts` 和 `mysqlSoulSecurityFactsRepository.ts`：前者定义发布/隐藏/删除/封禁/转移中的 ACL deny 优先规则及五类事实的幂等 append，后者在 MySQL 单事务内写入事实与审计链、拒绝非法状态转换、按 deny 优先解析 ACL，并提供审计链恢复校验；新增候选迁移 `20260911_soul_security_facts`。数据库集成测试已编写，但因未配置 `SOUL_FIXTURE_DATABASE_URL` 当前仅跳过，不能宣称真实 MySQL 并发/回滚已通过。


1. 先冻结 Soul ERD、版本文件规范化、asset port、社交模型和 ACL 权限矩阵。
2. 再实现 moderation/scan/appeal/ownership/audit 的独立 port 与 fake adapter 测试。
3. 为每个状态转换补充允许/拒绝矩阵、并发冲突、幂等重试、回滚和审计连续性测试。
4. 在独立安全事实链通过后，使用独立文件/对象存储 source、cursor/checkpoint、目标写入和未分类差异阻断。
5. 只有候选全量/增量对账、资产 SHA-256、公开可见性、ACL 和浏览器无 Convex 网络回归通过后，才可评审 Soul 只读候选。

## 4. 本轮验证记录

- 完整 Bun server 回归已通过：`425 pass`、`48 skip`、`0 fail`，共 `473` 个测试；此前审批超时、桌面 OpenAPI、Profile report 和 public adapter 的 7 个失败/2 个模块加载错误已清除。
- 审批超时 worker 现在只把真正的并发终态冲突视为可忽略；关联 `hiring_intent` 更新失败会回滚事务并阻断计数。
- 桌面 OpenAPI 资源按模块位置解析，不依赖当前工作目录；契约版本与 OpenAPI 路由清单已同步验证。
- 已运行并通过 server static、unit、types/build、Soul 相关测试和 MySQL/对象存储 fixture 回归；fixture 仍默认跳过，必须显式配置 `SOUL_FIXTURE_DATABASE_URL`。
- Playwright 测试列表可解析，但真实 Chromium、候选站点启动、Smoke 和 Convex 网络阻断尚未通过。当前没有安全的非生产 `PLAYWRIGHT_BASE_URL`，不得使用注入生产 Convex URL 的 `server.cjs` 作为候选启动器。

## 5. 当前剩余开发与验证

- 已补齐可独立测试的 Soul 安全事实内核和候选 schema 基础：评论、星标、扫描事实、申诉、所有权转移的事实类型/幂等追加，ACL deny 优先规则，以及内存审计链连续性测试。仍需将该内核接入 MySQL 事务写路径，补充真实数据库并发、回滚和状态机非法迁移测试后，才能宣称安全事实链完成。
- 获得非生产 Convex 只读批准后，才接入真实只读 source capability；执行候选 full import、incremental sync、asset copy、SHA/size/MIME/metadata reconciliation，并保留可复查报告。当前不得连接真实 Convex 或生产数据。
- 补充进程级 crash 注入、长时间对象存储失败/恢复、真实对象存储后端和回滚/恢复演练；验证 worker lease、checkpoint、资产状态和 report 在重启后保持幂等。
- 提供不含生产 Convex 变量的独立候选 Web 启动器或明确候选 URL，安装可用 Chromium 后运行 `bun run ci:playwright`，取得 candidate Convex block、HTTP/Smoke 和浏览器网络证据。
- 完成固定 Web、桌面、CLI 客户端契约回归，以及候选发布前的 CI/E2E/Smoke 汇总；在所有门禁通过前保持 `convex_authoritative`，不启用候选读路由、不做生产切换、不删除 Convex 数据。
- 评论、星标、扫描、申诉、所有权转移和完整 ACL/审计仍是独立的安全产品线，不属于当前迁移基础设施完成项。

## 6. 明确禁止

- 不把 Soul 直接映射为 Skill、Package、Profile 或 Publisher 表。
- 不在缺少 ACL 与 moderation facts 时迁移 Soul 版本、文件、收藏或评论。
- 不把 `scan` 结果直接当作公开隐藏/下载阻断决定；必须经过明确 policy/moderation gate。
- 不将候选 projection、历史 Convex snapshot 或 fake 测试解释为生产安全链完成。
- 不修改 `convex_authoritative`、不启用 Soul MySQL read mode、不接入生产写入、不删除 Convex functions/Storage。

## 8. 2026-03-14 候选 source capability 与门禁记录

- `createConfiguredSoulSource` 现在强制 `SOUL_SOURCE_CAPABILITY=soul-source:readonly-candidate`，并要求 `SOUL_SOURCE_KIND` 显式为 `file-jsonl` 或 `object-jsonl`。它拒绝共享数据库和站点变量；该 port 没有外部后端 transport，因此 capability 只授权已物化的、候选环境快照，而非任何在线 source。
- 运维入口改用 `SOUL_CANDIDATE_DATABASE_URL`，并在发现 `DATABASE_URL` 时 fail-closed。执行仍需 `SOUL_MIGRATION_OPERATOR`、`SOUL_MIGRATION_CONFIRM=yes` 与 `--execute`。因此不会因默认环境变量意外连入共享数据库。
- 用于受控候选验证的最小环境为：`SOUL_SOURCE_CAPABILITY=soul-source:readonly-candidate`、`SOUL_SOURCE_KIND=file-jsonl`、绝对路径 `SOUL_SNAPSHOT_PATH`、`SOUL_CANDIDATE_DATABASE_URL`、`SOUL_BATCH_ID`、`SOUL_ASSET_ROOT`、`SOUL_MIGRATION_OPERATOR`。这仅允许已审批的候选快照导入；没有新的 online source adapter，也不等同于获得真实非生产只读授权。
- 隔离 MySQL fixture 已验证 full/incremental import、资产对账与安全事实事务链；本轮 `ci:soul` 已通过：静态基线 305 条、11 个测试文件/31 个测试、类型检查与 server build。fixture 测试通过 `--no-file-parallelism` 串行化，避免多个 suite 共享隔离数据库时互相 reset。
- 新增 ACL 角色/生命周期 deny-first 矩阵、ownership transfer 合法/终态冲突测试，以及 worker lease renewal、crash 后不 checkpoint、成功页 checkpoint 恢复测试。对象存储已有 transient failure、ETag replacement 和非法分页 fail-closed 测试；这些是 fixture/单进程证据，不替代长时间进程演练。
- Playwright 用例列表可解析（12 个用例）。候选环境变量检查未发现已提供的候选 URL、候选数据库或 Profile/Publisher fixture；Chromium 下载进程此前长时间无进度，已终止重复下载。没有执行伪造浏览器通过验证，也没有关闭网络阻断。

## 9. 后续阻塞与完成条件

1. 提供经明确批准的非生产只读快照生产链，或在不接触生产变量的前提下交付审计过的 JSONL/object snapshot；随后才可执行 full import、incremental sync、asset copy 和完整 reconciliation。
2. 提供独立候选 Web URL、候选数据库和 Profile/Publisher fixture；安装可用 Chromium 后运行 `bun run ci:playwright`，保留 HTTP、WebSocket 与阻断报告。
3. 补齐安全事实的 ACL 状态组合矩阵、扫描重试与 ownership transfer 终态冲突测试，以及 worker crash/lease/checkpoint 和对象存储长期失败恢复演练。
4. 全部候选门禁和人工评审通过前，继续保持 `convex_authoritative`；不得启用生产读路由、生产导入或切换权威写路径。
