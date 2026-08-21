# 规格文档

`specs/` 保存维护者使用的实现意图、运维手册、迁移门禁、安全不变量、
回归证据和设计历史，不会同步到 ClawHub 公开文档站点。

## 按任务查找

- 仓库和发布运维：[`deploy.md`](deploy.md)、[`ci.md`](ci.md)、
  [`dev-worktrees.md`](dev-worktrees.md)、[`dev-seeding.md`](dev-seeding.md)、
  [`manual-testing.md`](manual-testing.md) 和历史服务器搬迁参考 [`server-migration.md`](server-migration.md)。
- Convex 退出和迁移：见下方的分层权威文档。
- 产品和子系统行为：使用 AI 直聘、注册表、安全和界面规格。
- 历史证据：`regression-notes/`、`superpowers/` 和 `plans/`；这些目录不是当前政策。

公开用户文档应放在 `docs/`。如果规格内容需要面向用户发布，应将公开部分
迁移或摘要到 `docs/`，并在这里保留设计记录。

## Convex 退出和环境权威文档

以下文件共同构成分层契约，每个文件都有独立的评审边界：

1. [`convex-exit-migration.md`](convex-exit-migration.md)：总体政策、状态机、
   单一写入权威、回滚和生产冻结。
2. [`convex-exit-domain-ledger.md`](convex-exit-domain-ledger.md)：领域状态、
   源/目标所有权、对账证据和删除门禁。
3. [`convex-exit-functional-matrix.md`](convex-exit-functional-matrix.md)：各领域的
   功能、API、身份、存储和兼容性覆盖情况。
4. [`profile-migration-handoff.md`](profile-migration-handoff.md)：Profile 与头像
   的候选迁移执行和验收门禁。
5. [`publisher-migration-handoff.md`](publisher-migration-handoff.md)：Publisher/组织
   的候选迁移执行和验收门禁。
6. [`profile-downstream-projections-review.md`](profile-downstream-projections-review.md)：`/user/:handle`
   下游 published/starred/manifest 只读投影的实现状态、candidate 运行门禁与后续评审条件。
7. [`skill-package-migration-handoff.md`](skill-package-migration-handoff.md)：Skill/Package 当前代码边界、MySQL-only 公开只读协议、CLI catalog client、版本详情和下载前 metadata 门禁、资产下载暂不可用边界、可复现隔离测试和执行禁止项。
8. [`independent-auth-session.md`](independent-auth-session.md)：独立 JWT/JWKS 验证、MySQL session 撤销、provider callback、token 签发和认证切换的边界与验收门禁。
9. [`soul-security-migration-boundary.md`](soul-security-migration-boundary.md)：Soul 的独立 identity、版本文件、资产、社交、ACL，以及 moderation/scan/appeal/ownership/audit 前置事实模型；当前仅为冻结边界，不授权迁出。
10. [`asset-migration-handoff.md`](asset-migration-handoff.md)：受管资产元数据、上传 ticket、事务回滚、下载授权与 SHA-256 响应契约；当前要求先完成 MySQL migration 与完整 HTTP 回归，才可开放 artifact 下载。
11. [`convex-dependency-baseline.json`](convex-dependency-baseline.json)：机器可读的
   依赖基线；由 [`../scripts/check-convex-dependency-baseline.mjs`](../scripts/check-convex-dependency-baseline.mjs)
   读取并与当前源码精确比较，不得通过重建基线隐藏新的 Convex 使用。
12. [`convex-exit-deficits.json`](convex-exit-deficits.json)：机器可读的强制迁出缺口、
   允许降级边界和恢复验收条件；不构成任何环境执行或删除授权。

当前 Profile 与 Publisher 状态：Profile 仍须完成非空历史 alias fixture、公开读/写授权回归、故障恢复、回滚和观察期；Publisher candidate 数据门禁已通过（全量同步、`unclassifiedDifferences=0` 的 reconciliation 与 `ready=true` preflight），唯一差异为精确批准的旧 org fixture retention。两域均仍为 `convex_authoritative`，不得启用 `*_READ_MODE=mysql_authoritative` 或将候选证据视为生产切换批准。详细批次与边界只记录在对应 handoff。

环境配置有意分层：

- [`.env.local.example`](../.env.local.example)：本地开发和本地 Convex 配置模板。
- [`.env.migration.example`](../.env.migration.example)：隔离候选迁移配置模板，
  仓库中不得放入真实密钥。
- 候选服务器实际环境文件固定为 `/etc/iclawstore-candidate.env`，不属于仓库文件；
  其数据库必须为 `iclawstore_candidate`，候选站点为 `https://candidate.iclawstore.com`，
  资产目录为 `/www/iclawstore-candidate/assets`。使用前只做脱敏检查，不要把文件复制到项目目录。
- [`deploy.md`](deploy.md)：生产密钥、部署目标、冻结规则和禁止操作。

## 产品和子系统规格

- AI 直聘：[`ai-direct-hiring-progress.md`](ai-direct-hiring-progress.md)、
  [`ai-direct-web-server-roadmap.md`](ai-direct-web-server-roadmap.md)、
  [`ai-direct-desktop-platform-integration.md`](ai-direct-desktop-platform-integration.md)、
  [`ai-direct-identity-bridge.md`](ai-direct-identity-bridge.md) 和 [`wallet-ledger.md`](wallet-ledger.md)。
- 注册表和发布：[`github-backed-skills.md`](github-backed-skills.md)、
  [`github-import.md`](github-import.md)、[`orgs.md`](orgs.md)、
  [`official-publishers.md`](official-publishers.md)、[`slug-routing.md`](slug-routing.md) 和
  [`search-relevance.md`](search-relevance.md)。
- 安全和审核：[`security-moderation.md`](security-moderation.md)、
  [`download-metering.md`](download-metering.md) 和 [`ui-proof.md`](ui-proof.md)。

- `server/src/domains/souls/`：Soul candidate DTO、规范化、MySQL facts repository、分页 source port、资产复制 consumer 和 Fastify/CLI 兼容端口；所有导入仍必须显式传入 batch ID。
- `server/src/domains/moderation/`：社交/审核 facts、权限矩阵和审计哈希链；只接受服务端解析的角色，不接受客户端自报身份。
- `server/src/domains/runtime/mysqlRuntimeStore.ts` 与 `server/src/migrationRuntimeWorkerProcess.ts`：MySQL 行锁 lease、checkpoint 和受控 worker；worker 仅在 MySQL URL 存在时启动。


- 如果代码改变安全边界、所有权规则、上传门禁、扫描结果、迁移门禁或公开兼容契约，
  必须更新对应的权威规格。
- 当前状态和历史证据必须明确区分。候选代码已实现或单元测试通过，不代表已经完成生产切流。
- 优先链接到权威规格，不要在多个文件中复制同一命令或政策。