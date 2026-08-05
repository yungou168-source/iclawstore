# AI 直聘 Obsidian 同步 — M1 Spec

> **范围**：让用户在桌面端把本地 Obsidian vault 的脱敏摘要同步到 ClawHub 工作台。
> **当前里程碑 (M1)**：本地抽取器 + 同步 API + MySQL 摘要表 + Web 工作台。
> **不在 M1 范围**：自动上下文注入、设备控制、跨端实时刷新、桌面端 RPC、Agent 工具调用。
> **目标读者**：维护者、PR 评审者、未来的桌面端工程师。

---

## 1. 动机 / 用户故事

- 作为 **在职 AI 直聘 Agent 的运营者**，我有时需要把 Obsidian 里"今日流程改进"的核心笔记喂给 Agent 当上下文，但不想把原文上传。
- 作为 **安全审核者**，我需要保证无论怎么实现，平台**永远接收不到** Obsidian 笔记的原始正文、绝对路径、以及任何敏感字段。
- 作为 **桌面端工程师**，我需要一份不依赖 Electron / UI 框架、可以独立单测的同步管道。

M1 解决的是**契约 + 流水线 + 审计**，M2+ 才接入 Agent 上下文。

---

## 2. 不变量（Invariants）

这些 invariant 不允许任何后续 PR 破坏：

1. **正文不上传**。`POST /sync` 的 body 永远不包含 `body` / `text` / `content` 字段；任何路径包含这些字段 → 服务端 `422 VALIDATION_ERROR`。
2. **绝对路径不上传**。`notePath` 必须是 vault **相对** POSIX 路径，且 `NOTE_PATH` 正则拒绝控制字符与空 body。
3. **正文一字不存**。`ai_direct_memory_digests` 表没有任何字段保存原文。`tagsJson` / `linksJson` / `summaryMd` 经校验管道派生。
4. **敏感模式触发整条丢弃**。`detectSensitiveContent` 一旦命中（中国手机号 / 身份证 / 银行卡 / `sk-` / `AKIA` / `ghp_` / 邮箱），整条 digest 拒绝写入并审计。
5. **摘要字节上限 = 20% + 1（B 字节）**。服务端**重新**调用 `extractSummary` 校验；不符合 → `422 SUMMARY_TOO_LONG` + 审计。
6. **vault 路径不出服务端**。握手 API（`/binding`、`/bindings`、`/notes`）只返回 `vaultFingerprint`（64 hex），不返回路径、邮箱、用户元数据。
7. **撤销 = 即时清表**。`DELETE /bind` 在事务内撤销绑定并删除该 binding 下的所有 digest；写入 `memory.obsidian.revoked` 审计。
8. **幂等**。`POST /sync` 要求 `Idempotency-Key` 头（1–128 字符）。fingerprint 写入 `ai_direct_audit_events.metadata.fingerprint`。
9. **绑定幂等**。同一 `(userId, vaultFingerprint)` 重复 bind：服务端不创建新 binding，而是 `200` 返回原 binding + `replayed: true`；**不同** vaultFingerprint 出现时，**自动**把旧 binding 设为 `revoked` 后建新 binding（同时清旧 digest），做到"换笔记本自动迁移"。
10. **认证必须**。所有路由走 `(fastify as any).authenticate` + `requireAuth` 中间件。

---

## 3. URL / 路由契约

所有路由挂在 `/api/v1/memory/obsidian`。

| Method | Path | 用途 | 鉴权 | 状态码 |
|--------|------|------|------|--------|
| `POST` | `/bind` | 创建 / 激活 vault binding | 必登录 | 201 / 200 (replay) |
| `DELETE` | `/bind` | 撤销绑定 + 同步清表 | 必登录 | 204 |
| `GET` | `/binding` | 当前 binding 状态（不暴露路径） | 必登录 | 200 |
| `GET` | `/bindings` | 工作台摘要（noteCount + tagCount + topTags） | 必登录 | 200 |
| `POST` | `/sync` | 提交摘要 batch | 必登录 + Idempotency-Key | 200 / 422 |
| `GET` | `/notes?limit=N` | 列出 digest 指针 | 必登录 | 200 |
| `GET` | `/notes/:notePath` | 单条 digest 摘要 | 必登录 | 200 / 404 |

### 3.1 `POST /sync` 请求体

```jsonc
{
  "vaultFingerprint": "<64-hex>",
  "evidenceVersion": "2026-08-01",
  "pointers": [
    {
      "path": "notes/today.md",
      "mtime": "2026-08-01T10:00:00.000Z",
      "size": 1024,
      "hash": "<64-hex>",
      "tags": ["mood", "journal"],
      "links": ["note-a"]
    }
  ],
  "summaries": [
    {
      "path": "notes/today.md",
      "title": "Today's notes",
      "summary_md": "first 20% of the body",
      "top_headings": ["Heading 1"],
      "summaryBytes": 200,
      "sourceBytes": 1024,
      "frontmatter": { "title": "Today's notes", "tags": ["mood"] }
    }
  ]
}
```

`pointers.length` 必须等于 `summaries.length`；最大 5000 条；摘要总字节 ≤ `MAX_BATCH_BYTES` (1 MB)。

### 3.2 错误码

- `AUTH_REQUIRED` — 未登录
- `VALIDATION_ERROR` — 入参不合法（带 message，含原因）
- `BINDING_NOT_FOUND` — `/sync` 时找不到 active binding
- `VAULT_FINGERPRINT_MISMATCH` — 提交指纹与 current binding 不一致
- `EVIDENCE_VERSION_MISMATCH` — evidenceVersion 已过期，需要重新 bind
- `SUMMARY_TOO_LONG` — 摘要 > 20% + 1B
- `SENSITIVE_CONTENT` — 摘要或正文含敏感模式
- `EMPTY_BATCH` / `BATCH_TOO_LARGE` / `POINTER_SUMMARY_MISMATCH` / `DUPLICATE_PATH`

每次 reject 写入 `ai_direct_audit_events` (action: `memory.obsidian.sync.rejected`, outcome: `rejected`)。

---

## 4. 数据模型

### 4.1 `ai_direct_memory_bindings`

来源：`server/prisma/schema.prisma`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID |
| `userId` | VARCHAR(191) | ClawHub user id |
| `vaultFingerprint` | CHAR(64) | SHA-256 of canonical vault path + config |
| `status` | VARCHAR(32) | `active` / `revoked` |
| `extractorVersion` | VARCHAR(64) | 桌面端抽取器版本 |
| `evidenceVersion` | VARCHAR(64) | 摘要契约版本 |
| `noteCount` | INT | 派生（每次 sync 后 refetch） |
| `tagCount` | INT | 派生（本次 batch 唯一 tag 数） |
| `lastSyncAt` | DATETIME | NULL 允许 |
| `revokedAt` | DATETIME | NULL 允许 |

Unique: `(userId, vaultFingerprint)`。

### 4.2 `ai_direct_memory_digests`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID |
| `bindingId` | VARCHAR(36) FK | 关联 binding |
| `userId` | VARCHAR(191) | 冗余，便于按用户过滤 |
| `vaultFingerprint` | CHAR(64) | 冗余，便于分享跨 binding 检索 |
| `notePath` | VARCHAR(1024) | vault 相对路径 |
| `noteHash` | CHAR(64) | SHA-256 of `path + \0 + body` |
| `title` | VARCHAR(512) | frontmatter 派生或 hint |
| `tagsJson` / `linksJson` | JSON | 数组 |
| `summaryMd` | TEXT | 经过 `extractSummary` 校验 |
| `summaryBytes` / `sourceBytes` | INT | 用于审计 |
| `redactedAt` / `redactionReason` | DATETIME / VARCHAR | 留 M2+ 红行动词 |
| `frontmatterJson` | JSON | 仅白名单字段 |
| `mtime` | DATETIME | NULL 允许 |
| `size` | INT | 字节 |

Unique: `(bindingId, notePath(255))`。

### 4.3 审计

全部走 `ai_direct_audit_events`（已有 schema；`action` 命名空间 `memory.obsidian.*`）：
- `memory.obsidian.bind`
- `memory.obsidian.bind.replayed`
- `memory.obsidian.revoked`
- `memory.obsidian.sync`
- `memory.obsidian.sync.rejected`

---

## 5. 客户端组件

### 5.1 抽取器（`server/src/services/obsidianExtract.ts`）

- `EXTRACTOR_VERSION = "2026-08-01"`
- `DEFAULT_EVIDENCE_VERSION = "2026-08-01"`
- `MAX_SUMMARY_RATIO = 0.2`
- `MAX_BATCH_BYTES = 1 MB`
- `FRONTMATTER_ALLOWED_FIELDS = [title, tags, created, modified, aliases]`

功能：
- `parseFrontmatter(body)` — 仅白名单字段；其他字段归入 `extras`，**不上传**。
- `extractSummary(body, sourceBytes)` — 移除 frontmatter 与 headings 后按**字节**截断（不按字符）。
- `extractTagsAndLinks(body)` — `[[wiki]]` 链接 + `#tag` 内联标签。
- `detectSensitiveContent(text)` — 5 种模式（手机/身份证/银行卡/secret prefix/邮箱）。
- `extractNote(note)` — 单条流水线，先做敏感检测再做摘要校验（敏感优先）。
- `extractBatch(notes)` — 批量，合计 `summaryBytes` 超过 `MAX_BATCH_BYTES` 时提前停止。

### 5.2 桌面端扫描器（`server/src/services/obsidianScanner.ts`）

- `computeVaultFingerprint(root, configHash)` — SHA-256 of `canonical_path + \0 + configHash`。
- `iterMarkdownFiles(root, { maxDepth = 8, ignoreDirs })` — 流式生成器，**不**把整棵目录读入内存。
- `readNote(file, vaultRoot, maxBytes = 256 KB)` — 单文件读取；超限也返回 stub（summaryBytes=0）让服务端拒绝。
- `scanVault(root, options)` — 限 `maxNotes`（默认 5000），输出 `Submission`。

M1 范围：模块 + 单元测试。**不**集成 Electron。后续由桌面端工程师 `import { scanVault } from '@clawhub/server/services/obsidianScanner'` 然后从 `main.ts` 调用。

### 5.3 Web 工作台（`src/routes/settings/memory.tsx`）

- 仅展示：绑定状态、noteCount / tagCount、tag 云、最近笔记列表 + 摘要展开。
- "撤销"按钮二次确认。
- 网关占位 fingerprint：M1 早期允许 Web 端创建临时绑定占位（桌面端启动后会被真实绑定顶替）。
- M2 引入桌面端握手：Web 端只读，不创建 binding。

### 5.4 API 客户端（`src/lib/fastifyApi.ts`）

新方法：`getMemoryBinding` / `getMemoryBindings` / `bindMemoryVault` / `revokeMemoryVault` / `listMemoryNotes` / `getMemoryNote`。

---

## 6. 测试策略

- 单元 (`bun test ./test/obsidianExtract.test.ts`) — 11 项：frontmatter、tags-links、20% 字节上限、headings、敏感模式、empty / 非 md / 校验 / 批量 / 版本。
- 单元 (`./test/obsidianScanner.test.ts`) — 4 项：生成器、单文件读、指纹、端到端 Submission。
- 集成（**真机 M1**，下一里程碑）— 见 `specs/ai-direct-hiring-obsidian-real-device.md`。

---

## 7. 与桌面端工程师的接口

```ts
// 桌面端 main.ts 调用示例
import { scanVault } from "@clawhub/server/services/obsidianScanner";

const submission = await scanVault(vaultRootPath, {
  evidenceVersion: "2026-08-01",
  configHash: layoutHashFromObsidianConfig(),
  maxNotes: 5000,
  maxBytes: 256 * 1024,
});

await fetch("/api/v1/memory/obsidian/sync", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${clerkToken}`,
    "Idempotency-Key": uuid(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify(submission),
});
```

**绝不**直接把 `body` 字段放进 `Submission` 或 `pointers` / `summaries`。

---

## 8. 设计决策与未解答的问题

- **不存原文**：M1 决定 digest 表里**没有任何原文字段**。后续 M2 是否需要"拉取完整正文看"？—— 答案永远是"原文在用户本地，桌面端按需提供"，服务端不存。
- **schema 复用了 `ai_direct_audit_events`**：M1 直接写审计，避免引入第二份审计基础设施。
- **Web 端创建临时 binding**：M1 阶段允许，给桌面端工程师**对齐 UI**。M2 切换为"只在桌面端 bind"。
- **绑定迁移**：换笔记本时旧 binding 自动 `revoked` + digest 全删。这里没有"软保留"，因为 digest 与新 binding 完全不兼容。
- **M2 待办**：
  - 桌面端 ↔ Web 实时刷新（WebSocket / SSE）
  - Agent 注入：`memory_query` 工具给 AI
  - 同步冲突策略（hash 冲突时是否保留旧 digest）
  - 跨设备增量同步（vs 当前全量 `replace`）

---

## 9. 部署与验收安全规则

- `scripts/verify-obsidian-m1.mjs` 默认必须使用临时 SQLite，不得因为 Bun 自动加载 `.env` 而隐式连接生产 MySQL。
- 只有运维人员显式设置 `OBSIDIAN_VERIFY_MYSQL=1` 时，验收脚本才可使用 `DATABASE_URL`；执行前必须完成数据库备份。
- 生产迁移使用 `prisma migrate deploy`，不使用 `db push`；迁移 SQL 保持加法、幂等，不删除现有字段或数据。
- 生产入口只挂载已经完成定向测试和 HTTP 链路验收的 M1 路由。未完成的 P1/P2 聚合器不得为了复用前缀而整体上线。

---

## 10. 变更日志

- **2026-08-02** — 生产应用 M1/P1 迁移；固化 SQLite 默认验收与 MySQL 显式 opt-in 规则。
- **2026-08-01** — M1 落地（spec/extract/scanner/route/web/test）。详见 `docs/AI_DIRECT_HIRING_OBSIDIAN_M1.md`。
