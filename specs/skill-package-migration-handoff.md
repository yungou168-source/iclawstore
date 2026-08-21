---
summary: "Skill/Package 非 Convex 只读迁移、CLI 协议适配、事实对账与资产完整性的交接记录。"
read_when:
  - 继续 Skill、Package、版本或制品的 Convex 迁出
  - 修改 `server/src/domains/skill-packages/`、`packages/clawhub/src/` 或 `skill_package_*` 表
  - 进行资产上传、下载、SHA-256 校验或 Convex 依赖基线收缩
---

# Skill/Package Convex 迁出交接

> **当前状态（2026-03-14）**：`server/` 已移除 Convex runtime、Convex HTTP client 和 identity bridge。认证候选实现为独立 JWT/JWKS verifier 加 MySQL `auth_sessions` 撤销状态。Skill/Package 已提供 MySQL-only Fastify 只读目录协议和隔离事实对账边界，但全仓仍不是 Convex-free，生产仍由 Convex 权威。
>
> 本文记录候选代码和隔离测试证据，不构成 candidate 或 production 执行授权。

## 当前只读协议

- Skill：`GET /api/skills`、`GET /api/skills/resolve/:name`、`GET /api/skills/:id`、`GET /api/skills/:id/versions`、`GET /api/skills/:id/versions/:version`。
- Package：对应 `/api/packages` 路径。
- 响应使用 canonical DTO，仅暴露公开 owner/publisher、latest version、版本 SHA-256、标签和公开统计字段。
- 隐藏、软删除或不满足公开安装资格的条目不得进入公开结果。
- `page`、`limit` 必须为正整数；非法值返回 `400`，服务端限制分页上限。
- 资产元数据和授权闭环完成前，制品下载返回 `503`；不得暴露物理路径、Convex Storage URL 或伪造下载地址。

## 认证边界

受保护路由要求 JWT `sub`、`sid`、issuer、audience、签名和 MySQL session 状态全部有效。缺少 JWT 配置、session 不存在、已撤销、已过期、用户停用或用户删除时必须 fail-closed。

Server 当前不负责本地 JWT 签发。后续登录闭环必须由明确的 OIDC/OAuth provider adapter 完成 callback、state、nonce、PKCE、账号绑定和 token 生命周期；provider 已验证 claims 后，才允许通过 `authSessionRepository` 创建 session。不得将候选 verifier 测试描述为登录迁移完成。

## 已完成的候选代码边界

| 边界 | 文件 | 保证 |
| --- | --- | --- |
| 认证 provider | `server/src/services/oauthProvider.ts` | 候选 provider 配置、Authorization Code + PKCE URL、token endpoint/JWKS adapter；只接受显式 issuer、audience、redirect URI 和 JWKS 生命周期配置。 |
| 认证闭环 | `server/src/services/oauthProvider.ts`、`accountBinding.ts`、`oauthTransaction.ts`、`sessionEstablishment.ts`、`refreshTokenFamily.ts` | candidate-only provider 端口、state/nonce/PKCE 摘要、callback 幂等、显式账号绑定、refresh rotation、family revoke、reuse detection 和 logout-all。尚未注册生产 callback 路由或切换认证。 |
| 资产测试 port | `server/src/services/fakeManagedAssetPort.ts` | 隔离验证 store/open/trash 生命周期和 SHA-256 记录；不连接真实 Storage。 |
| CLI 只读适配 | `packages/clawhub/src/catalogApi.ts`、`packages/clawhub/src/cli/commands/skills.ts`、`packages/clawhub/src/cli/commands/packages.ts` | Skill/Package 的 resolve、详情、版本列表、版本详情、版本解析和下载前 metadata 已统一使用 catalog API；catalog 版本 artifact 不可用时下载前明确阻断。写入命令仍冻结在 legacy 路径；旧 CLI 测试 fixture 仍需按新协议更新。 |
| 规范化 | `skillPackageNormalizer.ts` | 名称、路径、MIME、SHA-256、版本排序、版本文件 metadata 和对象字段顺序稳定化。 |
| 聚合对账 | `skillPackageReconciliation.ts` | aggregate、owner、version、artifact、source metadata、scan snapshot、version file metadata、missing、orphan 和 mismatch。 |
| P1 facts 对账 | `reconcileSkillPackageFacts` | alias、GitHub、fingerprint、ownership、publish token、upload ticket、trusted publisher、inspector、version files、install eligibility。列表排序不影响结果。 |
| 只读 source | `convex/skillPackageMigration.ts` | 仅提供 internal 分页快照，不读取 Storage bytes、不写目标、不注册公开 API。 |
| 导入控制 | `skillPackageMigrationRuntime.ts`、`skillPackageImportRunner.ts` | 只接受 candidate 执行位和非空 approval reference，拒绝 production target。 |
| MySQL target | `mysqlSkillPackageTargetRepository.ts` | 页级 DTO 读取与事务写入边界；target-only aggregate/version/artifact 标记为 orphan。 |
| 制品 outbox/资产扫描 | `mysqlSkillPackageAssetCopyRepository.ts`、`skillPackageAssetCopyConsumer.ts`、`managedAssetScannerWorker.ts` | 复制消费者与 scanner worker 已有隔离 port；scanner worker 需显式 `ASSET_SCANNER_COMMAND`，未接入默认应用启动链，未开放下载。 |
| 兼容读取 | `skillPackageCompatibilityPort.ts` | compare 始终返回 Convex 权威值，只记录候选差异。尚未接入 Fastify 或 CLI 命令。 |

## 本轮验证证据

以下全部为隔离测试、fake store、Fastify mock 或 mock 数据库，不是实际迁移证据：

- 认证 provider、session、候选 auth route 和 fake asset 的隔离测试已通过；这些不是实际 provider、candidate 或 production 运行证据。
- server TypeScript `tsc --noEmit`：通过。
- `packages/clawhub` `bun run verify:build`：通过。
- `packages/clawhub` catalog API 定向测试：`1` 个文件、`3` 个测试通过。
- Server managed asset 定向回归：`3` 个文件、`5` 个测试通过。
- Convex dependency baseline：`305` 条记录一致，未新增依赖。
- 以上仍是隔离测试和构建证据，不代表真实 MySQL、真实 scanner、生产 HTTP 或浏览器下载链路已验证。

## 迁移边界与禁止项

- `convex/`、历史 migration source、snapshot projection、compare adapter 和 facts repository 只能由显式离线迁移工具使用，不得进入应用启动链。
- 未完成资产闭环前，不得开放 Skill/Package artifact 下载或把业务表物理路径暴露给客户端。
- 未完成写入阶段前，不得把 CLI publish、token、组织管理命令指向新只读协议。
- 不得通过修改 `specs/convex-dependency-baseline.json` 隐藏新增 Convex 依赖。
- 不得将 candidate 单元测试、schema 文件或本文解释为 candidate/production 执行批准。

## 后续开发队列

### P1：完成只读兼容协议

1. Skill/Package 的 catalog resolve、详情、版本列表、版本详情、版本解析和下载前 metadata 已完成 CLI 接入；继续补齐固定 CLI 版本的 catalog HTTP/fake-port 契约测试。
2. 更新旧 `inspect`、`skills`、`packages` 测试 fixture 和断言，删除对已迁移纯读路径的旧 `/api/v1` 请求假设；写入命令仍保留 legacy 协议。
3. 安装/更新/下载继续遵守 metadata、安装资格、资产 hash 与授权闭环；catalog artifact 不可用时必须阻断。publish、token、upload-ticket、ownership 和组织写入继续冻结。

### P2：完成资产 port

1. 完善通用 `ManagedAssetPort` fake 实现、MIME/大小/SHA-256 校验、断点、重试和幂等测试。
2. 验证 asset outbox 的 claim lease、陈旧 token、失败退避和恢复报告。
3. 在候选审批前不复制真实 Storage bytes，不注册 worker，不开放下载。

### P3：候选事实运行

只有获得独立 candidate 环境、批准引用、最小权限和回滚负责人后，才可评审：

1. 应用 expand-only facts schema；
2. 运行只读 source snapshot、MySQL import、reconciliation 和 asset consumer；
3. 收集全量/增量 cursor、source watermark、计数、孤儿、未分类差异和资产 SHA-256 证据；
4. 执行 HTTP/CLI/浏览器回归和阻断 Convex 网络回归；
5. 进入观察期并单独评审读切换。

生产写权威、认证切换、生产读切流和 Convex 删除均需另行不可逆批准，不能复用 candidate approval。

## 新工作站起点

```bash
cd /www/wwwroot/iclawstore.com/server
bun test test/authSessionRepository.test.ts test/jwtAuthenticator.test.ts \
  test/skillPackageFacts.test.ts test/skillPackageMigrationBoundaries.test.ts \
  test/skillPackageMigrationPort.test.ts test/skillPackageMigrationRepositories.test.ts
bun ../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

真实 MySQL、Convex source、Storage 和生产凭据在独立批准前不得连接。