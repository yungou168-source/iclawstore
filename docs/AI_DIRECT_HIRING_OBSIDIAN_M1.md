# AI Direct Hiring — Obsidian Sync M1 Delivery Report

> **Agent**: M1 (Obsidian memory binding)
> **Branch**: `feature/ai-direct-hire-p1-runtime` (current) — committed as P1 runtime the same branch
> **Date**: 2026-08-01
> **Spec**: `specs/ai-direct-hiring-obsidian-sync.md`
> **Scope**: M1 — local extractor + sync API + MySQL digest tables + Web workspace + audit. **No** agent injection, **no** device control, **no** real-time sync.

---

## 1. 落地清单

### 1.1 Prisma schema / migration

- `prisma/schema.prisma`（`server/prisma` 指向该目录）— 加 `aiDirectMemoryBindings` + `aiDirectMemoryDigests` 两个 model
- `prisma/migrations/20260801_ai_direct_hiring_obsidian_m1/migration.sql` — 幂等 `CREATE TABLE IF NOT EXISTS`

### 1.2 后端服务层

| 文件                                     | 用途                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `server/src/services/obsidianExtract.ts` | frontmatter 白名单、敏感模式、20% 摘要上限、批量管道 |
| `server/src/services/obsidianScanner.ts` | 流式 vault 扫描器、vault 指纹、bounded RawNote       |
| `server/src/routes/aiDirectMemory.ts`    | 7 个 REST 端点                                       |

### 1.3 后端挂载

- `server/src/index.ts` — 将 `aiDirectMemoryRoutes` 直接挂载到 `/api/v1`；生产路径为 `/api/v1/memory/obsidian/*`
- M1 数据访问复用 Fastify 的 Prisma 装饰器；MySQL pool 已在入口按 `DATABASE_URL` 条件注册，供后续 P1/P2 路由使用
- 未完成的 `aiDirectHiringRoutes` 聚合器暂不进入生产入口，避免缺失服务模块影响 M1 与现有 API

### 1.4 Web

- `src/routes/settings/memory.tsx` — `/settings/memory` 工作台
- `src/lib/fastifyApi.ts` — 6 个 client method
- `src/routeTree.gen.ts` — 同步 `SettingsMemoryRoute`
- `src/styles.css` — 新增 `.memory-*` 样式块

### 1.5 测试

- `server/test/obsidianExtract.test.ts` — 11 项
- `server/test/obsidianScanner.test.ts` — 4 项

---

## 2. 路由 / 端点

| Method   | Path                                      | Auth                       | 备注                                                                              |
| -------- | ----------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/memory/obsidian/bind`            | required                   | 201 / 200 (replay)                                                                |
| `DELETE` | `/api/v1/memory/obsidian/bind`            | required                   | 204，事务内清表                                                                   |
| `GET`    | `/api/v1/memory/obsidian/binding`         | required                   | `{configured, vaultFingerprint, ..., noteCount, tagCount, lastSyncAt, updatedAt}` |
| `GET`    | `/api/v1/memory/obsidian/bindings`        | required                   | 工作台摘要 + topTags                                                              |
| `POST`   | `/api/v1/memory/obsidian/sync`            | required + Idempotency-Key | 200 / 422                                                                         |
| `GET`    | `/api/v1/memory/obsidian/notes?limit=N`   | required                   | 1 ≤ N ≤ 200                                                                       |
| `GET`    | `/api/v1/memory/obsidian/notes/:notePath` | required                   | 200 / 404                                                                         |

错误码走 `aiDirectErrors.ts` 的 `ErrorCodes` 枚举（`AUTH_REQUIRED` / `VALIDATION_ERROR`）并写入审计。

---

## 3. 关键约束（落地验证）

- **正文不接收也不存储**：`POST /sync` 入参 schema 不含 `body` 字段；`ai_direct_memory_digests` 表无原文字段。
- **绝对路径不接收**：`NOTE_PATH` 正则拒绝控制字符 + 文件名必须 `.md`。
- **敏感模式触发整条拒绝**：5 种模式在中国/英文常见密钥/邮箱都被覆盖；命中即 `extractNote` 失败，端到端 audit 记录。
- **摘要按 byte 截断**：`extractSummary` 用 `Buffer.byteLength`；不是按字符。
- **vault 指纹 64 hex**：服务端不接收绝对路径，只接收 fingerprint。
- **撤销 = 即时清表**：`DELETE /bind` 在 `prisma.$transaction` 中先 `update status=revoked` 再 `deleteMany digests`。

---

## 4. 跨人/跨 Agent 协调

- **复用既有**(P1 runtime): `AiDirectHiringError` / `ErrorCodes`、Prisma 装饰器、Web 鉴权流程。
- **不介入**(P2): 状态机、outbox、RBAC（这些是招聘工作流用的，与 Obsidian 同步无关）。
- **桌面端集成**：M1 给桌面端工程师一份"可在 Node 里独立运行"的服务端模块 (`obsidianScanner`)，**不**绑定 Electron，避免与未来桌面端耦合。

---

## 5. 已知遗留 / 下一版 (M2)

- **Web 端创建临时 binding**：M1 留给 UX 提早对齐，M2 切换为"只在桌面端创建"。
- **同步冲突策略**：当前 `(bindingId, notePath)` 唯一，同 hash upsert；M2 应支持"客户端拒收时保留旧 digest"模式。
- **P1/P2 聚合器**：招聘核心已拆到 `aiDirectCoreRoutes` 并独立进入生产；旧聚合器继续保持未挂载。当前分支新增的凭据路由仅在 `AI_DIRECT_PROVIDER_RUNTIME_ENABLED=true` 时通过核心入口挂载，默认生产行为不变。
- **Provider Executor 状态**：金沙 adapter、加密凭据、单并发 Executor 与成本审计已在当前分支实现，但 `20260805_ai_direct_provider_runtime` 未部署、真实 canary 未执行、生产 Executor 不存在且执行开关关闭；这与 Obsidian M1 数据流相互独立。
- **桌面端接入**：扫描器与真实 HTTP 验收脚本已落地；Electron main 进程集成留到 M2。

---

## 6. 测试结果

```
$ bun test ./test/obsidianExtract.test.ts ./test/obsidianScanner.test.ts
 15 pass
  0 fail
 40 expect() calls
Ran 15 tests across 2 files. [93.00ms]

$ bun run scripts/verify-obsidian-m1.mjs
[✓] bind (47ms)
[✓] sync (38ms) — accepted=4 totalBytes=289
[✓] idempotency-replay (26ms) — accepted a=4 b=4 digests=4
[✓] sensitive-rejected (14ms) — code=VALIDATION_ERROR reason=SENSITIVE_CONTENT
[✓] revoke-clears (15ms) — 204 + configured:false + items:0
[✓] rebind-different-fingerprint (13ms) — new fp accepted
=== PASS in 265ms ===
```

`scripts/verify-obsidian-m1.mjs` 默认只使用临时 SQLite。只有显式设置 `OBSIDIAN_VERIFY_MYSQL=1` 时才允许连接 `DATABASE_URL`，防止 Bun 自动加载 `.env` 后误写生产数据库。

后续招聘核心集成已清理 P1/P2 历史类型债务，当前完整服务端 `tsc --noEmit` 为零错误。M1 定向单测、SQLite HTTP 链路与生产启动烟测均通过。

---

## 7. 生产部署（2026-08-02）

- 迁移前完成 `iclawstore` 全库单事务压缩备份：`/home/ubuntu/backups/iclawstore/production-migrations/iclawstore-before-obsidian-m1-20260801T181606Z.sql.gz`（318308 字节，目录权限 `700`、文件权限 `600`，`gzip -t` 通过）。
- `prisma migrate deploy` 已应用：
  - `20260801_ai_direct_hiring_obsidian_m1`
  - `20260801_ai_direct_hiring_p1`
- 生产表 `ai_direct_memory_bindings`、`ai_direct_memory_digests` 已创建；部署时均为空表。
- PM2 `iclawstore-api` 与 `iclawstore` 已重启并保存进程列表。
- 验收：`GET http://127.0.0.1:3002/health` 返回 `200`；未认证访问 `/api/v1/memory/obsidian/binding` 返回预期 `401`；站点本机与公网 HTTPS 均可访问。

---

## 8. 变更日志

- **2026-08-02** — 完成生产迁移、M1 路由挂载、服务重启与线上健康检查。
- **2026-08-01** — M1 初版：extract / scanner / routes / web / tests / docs。
