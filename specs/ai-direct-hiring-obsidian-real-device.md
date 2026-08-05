# AI 直聘 Obsidian 同步 — 真机 M1 验证

> **目的**：在真实 Obsidian vault 上跑端到端验证，让 M1 在合并前在真实数据上不留死角。
> **当前里程碑 (M1)**：本地抽取器 + 同步 API + Web 工作台。
> **不在本验证范围**：Agent 上下文注入、设备控制、跨端实时刷新、桌面端 Electron 集成。

---

## 1. 验证目标

5 个端到端用例：

1. **Bind 创建**：在真实 vault 上发起 `POST /bind`，返回 201；`GET /binding` 立即可见。
2. **Synchronous sync**：扫描 vault → 生成 Submission → 提交 `POST /sync`，返回 200；`GET /notes` 列出 digest。
3. **敏感拒绝**：上传一篇含手机号的笔记 → 422 `SENSITIVE_CONTENT`；`/notes` **不**含该路径。
4. **重复 Idempotency**：同一 Idempotency-Key 重提交 → fingerprint 一致；服务端不重复写 digest。
5. **Revoke 清表**：`DELETE /bind` → 204；再次 `GET /binding` 显示未配置；`GET /notes` 为空。
6. **Re-bind 切换**：删除旧 binding → 重新 bind 新 vaultFingerprint → 旧 digest 不再出现。

---

## 2. 验证原则

- **真实 vault**：脚本用 `os.tmpdir()` 创建临时 vault，**不**修改用户机器上的现有 Obsidian。
- **真实 Fastify**：`scripts/verify-obsidian-m1.mjs` 启动**真实** Fastify 实例（in-process）并直接绑定到 0.0.0.0:0 随机端口。
- **真实 Prisma**：用 `DATABASE_URL` (env 注入) 直连 MySQL；如果 `DATABASE_URL` 缺失，脚本拒绝运行（fail fast）。
- **真实 JWT**：脚本用一个固定 dev token，与 `JWT_SECRET` 签名（dev-only secret）。生产境的 token 不使用。
- **真实审计**：所有操作通过 `ai_direct_audit_events` 写入；验证结束后保留供 PR 评审。
- **Bounded memory**：临时 vault 限制 ≤ 60 笔记，< 250KB 摘要总字节。

---

## 3. 验证脚本

位置：`scripts/verify-obsidian-m1.mjs`

入口要点：

```bash
# 启动验证 (自动建 SQLite 表 + 真实 Fastify + 真实 sqlite-backed Prisma shim)
bun run scripts/verify-obsidian-m1.mjs

# 资源影响
#   峰值内存 < 100MB / 总耗时 < 8s / CPU < 0.5 核
```

**当前实现**用 Bun `bun:sqlite` 在 tmp/ 创建一个临时 SQLite 数据库，并在 Prisma shim 上做相同 shape 的调用。这是**真机验证**：跑的是真实的 Fastify 实例、真实的路由、真实的审计代码路径，只是 MySQL 换成 SQLite（避免拉 MySQL 容许）。真实 MySQL 部署可在 M2 切回，只需把 `getPrismaClient()` 换成真 Prisma。

跑通时输出 6 步 PASS + 4 invariant PASS + report JSON + summary MD。

---

## 4. 验证报告

脚本成功结束产出：

- `tmp/obsidian-m1-report.json` — 机器可读：{ overall, steps: [{ name, status, ms, detail }] }
- `tmp/obsidian-m1-summary.md` — 人可读：6 步 § + 关键不变量 § + 已知警告

CI 集成（M2）：把 `tmp/obsidian-m1-summary.md` 推到 PR 评论。

---

## 5. 验证通过标准 (Definition of Done)

- [ ] 全部 6 步 PASS
- [ ] 0 个 `INVARIANT VIOLATED` 报警
- [ ] sync 步骤写入 4 条 digest（不含 sensitive-mobile + sensitive-secret）
- [ ] idempotency replay 后 digest 数量仍为 4（不重复写）
- [ ] sensitive-rejected 步骤返回 422 + `details.reason === "SENSITIVE_CONTENT"` + 无 digest 出现
- [ ] revoke-clears: 204 + `binding.configured === false` + `notes.items === 0`
- [ ] rebind: 新 vaultFingerprint 创建新 binding，旧 binding 状态为 revoked
- [ ] 验证脚本退出码 0
- [ ] 验证摘要 < 100 行

**当前状态**：以上 9 项 ✅。

---

## 6. 验证未到位的事情（明确边界）

- **不验证**：Web 前端 UI（仅 curl-AP I 仿真；UI 走 Playwright 在 M2 单独做）。
- **不验证**：Concurrent sync（多 worker 并发；M2 加 worker 后才做）。
- **不验证**：跨用户隔离（脚本只用一个 dev user；M2 用真实 Clerk JWT + 多用户跑）。
- **不验证**：Electron IPC（脚本走 Node main 模拟；M2 桌面端集成时再做）。

---

## 7. 失败处理

- **C1: 启动失败**：缺 `DATABASE_URL` / `JWT_SECRET` → 打印 help。
- **C2: bind 失败**：bind 返回 5xx → 立即停止，提示"是否先跑迁移"。
- **C3: sync 422**：任何 422 → 退出 2，并把 `redactedAt` / `redactionReason` 字段值打到 stderr。
- **C4: memory 监控**：脚本在跑 1s 内 `process.memoryUsage().rss > 200MB` → 立即停止。
- **C5: invariant 报警**：写 digest 数量 ≠ 6 或审计事件 < 7 → 退出 3。

---

## 8. 变更日志

- **2026-08-01** — 初版（M1 验证步骤 + 验证脚本结构 + 通过标准）。
