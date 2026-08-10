# AI Direct Hiring — Final Handoff (今晚)

> **钱包与统一销售账本更新（2026-08-18）**：当前工作区已用 `ai_direct_agent_sales` 统一免费和付费招聘。免费成交生成 Sale、Offer、Employment 以及平台/开发者两条 0 元收入分录，但不创建 PaymentOrder、不扣钱包、不写钱包流水；付费成交继续原子完成钱包扣款和 20%/80% 收入。退款后可提现金额按同一 Sale 的开发者净收益计算。全新隔离 MySQL 从零应用 21 段迁移后状态机测试 `4 pass / 0 fail`；本轮再次通过 server TypeScript、main TypeScript 与生产前端构建。当前会话未注入 MySQL 管理连接，因此没有重复创建隔离库，也没有触碰生产数据库。`20260818_ai_direct_agent_sales` 尚未应用生产，API/前端也尚未切换，不能把本段写成已上线。
>
> **登录邮件品牌更新（2026-08-18）**：登录 OTP 的默认发件人、标题、HTML 与纯文本已统一为 `AI直聘`，品牌契约单测本轮为 `1 pass / 0 fail`；`AUTH_EMAIL_FROM` 仍可覆盖默认发件人。Convex 生产部署及真实收件验收尚未完成，因此当前只能记录为“源码、类型、构建与测试完成，待生产验收”。权威资金不变量见 `specs/wallet-ledger.md`，当前发布状态见 `specs/ai-direct-hiring-progress.md`。

> **当前生产状态覆盖**：本文主体是早期分支交接记录，其中“未部署、未迁移、未构建”的描述仅代表当时。生产已应用 `20260817_wallet_ledger`，钱包 API 与前端已发布。支付宝充值 notify 使用 `www.iclawstore.com` 的独立钱包回调；1.00 元真实充值已通过异步通知、主动查单、单次入账、交易号唯一及重复事件幂等验收。付费招聘已改为钱包余额扣款，充值余额不可提现，开发者收益通过人工审核提现。统一 Sale 和免费 0 元收入分录仍待本轮生产发布。
>
> **认证 UI 发布差异（2026-08-09）**：生产登录故障恢复使用上述固定 SHA 重建 SSR，因此恢复了该 SHA 中旧的登录框，同时没有包含工作区未提交的 4 位验证码紧凑 UI。workspace 导航还缺少可发现的退出入口，导致无法正常切换 QA 身份。修复闭包必须同时包含 workspace 账户菜单/`signOut()`、4 位验证码前端、Convex 4 位且 2 分钟有效的 OTP provider、对应测试与生产浏览器烟测；不得直接从脏工作区发布。Bearer token 只能保存在权限 `600` 的短期临时文件中，文档和交接记录不得包含明文。真实 owner 公司详情链路已通过，跨组织隔离与撤权即时失效仍需第二个可回收身份验收。

## 整体状态（历史快照）

- 4 个功能/整合分支就绪:`feature/ai-direct-hire-integrated`、`feature/ai-direct-hire-p1-frontend`、`feature/ai-direct-hire-p2-hiring`、`feature/ai-direct-hire-p1-runtime`。
- 6 份阶段性交付报告齐全(B、C、D、E、F、G2),另有 A 基线报告与本最终交接。
- 全部本地 commit,未 push,未部署；本轮因资源限制未执行 build/test/dev/install/迁移/类型检查。

## 分支状态表

| 分支                                   | Agent | Commit    |                          行数 | 报告                                      |
| -------------------------------------- | ----- | --------- | ----------------------------: | ----------------------------------------- |
| `feature/baseline-mysql-migration-fix` | A     | `916ce2b` |                      基线快照 | `AI_DIRECT_HIRING_BASELINE.md`            |
| `feature/ai-direct-hire-p1-backend`    | B     | `8788b8a` |                       约 1373 | `AI_DIRECT_HIRING_P1_BACKEND.md`          |
| `feature/ai-direct-hire-p0-mount`      | C     | `d39eaf9` |                       约 1726 | `AI_DIRECT_HIRING_P0_MOUNT.md`            |
| `feature/ai-direct-hire-integrated`    | D     | `daf41f0` |                   B+C 约 3000 | `AI_DIRECT_HIRING_INTEGRATION_REPORT.md`  |
| `feature/ai-direct-hire-p1-frontend`   | E     | `2060975` |                       约 1800 | `AI_DIRECT_HIRING_P1_FRONTEND.md`(分支内) |
| `feature/ai-direct-hire-p2-hiring`     | F     | `ddcdead` |                          2852 | `AI_DIRECT_HIRING_P2_HIRING.md`(分支内)   |
| `feature/ai-direct-hire-p1-runtime`    | G2    | `8284931` | 约 4126(含 F；G2 自身约 1356) | `AI_DIRECT_HIRING_P1_RUNTIME.md`          |

## 报告交叉引用

- 整体进度:`specs/ai-direct-hiring-progress.md`
- 整体整合:`docs/AI_DIRECT_HIRING_INTEGRATION_REPORT.md`
- 后端基础:`docs/AI_DIRECT_HIRING_P1_BACKEND.md`
- P0 挂载:`docs/AI_DIRECT_HIRING_P0_MOUNT.md`
- P1 前端:`docs/AI_DIRECT_HIRING_P1_FRONTEND.md`(E 分支)
- P2 招聘:`docs/AI_DIRECT_HIRING_P2_HIRING.md`(F 分支)
- 运行中心:`docs/AI_DIRECT_HIRING_P1_RUNTIME.md`

## 关键设计决策

1. **队列 lease 策略**:`FOR UPDATE SKIP LOCKED` 并发领取；60 秒 TTL、≤30 秒 heartbeat；queued 优先,其次回收过期 active lease。领取事务同时完成 run `queued→active` 和首步 `pending→running`。
2. **状态机**:Offer、Employment、Approval 分别以显式 allowed-from 表限制迁移,非法迁移统一返回 `INVALID_TRANSITION`；Employment 事件按 sequence 形成不可变审计轨迹。
3. **RBAC + 幂等 + outbox**:复用 B 的 `requireAuth`、公司/雇佣范围检查和幂等基础；复用 C 的稳定错误、审计/outbox 契约。队列 enqueue 在同一事务写 run、steps、audit 与 outbox。
4. **前端无后端依赖**:E 可独立合入；P0 API 真实调用,尚未挂载的公司/项目/Offer 功能使用显式占位和空状态。F 合入后再启用完整数据流。
5. **状态机自动 enqueue**:F 的业务状态转移成功并提交 outbox 后,集成消费者按事件类型创建步骤模板并调用 `JobQueueService.enqueue()`；路由不直接执行长任务,失败可通过 lease/retry 恢复。

## 集成建议(给未来维护者)

1. **Merge 顺序**:`integrated → F → E → G`。但 G 分支已 cherry-pick F,若直接合 G,不要再次引入 F 提交；推荐先以 commit 拓扑确认重复,再只取 G2 独有提交。
2. **数据库迁移**：该历史建议已经执行。当前生产已在一致性备份和隔离恢复验证后应用全部 19 个迁移；后续迁移仍必须遵循“隔离 MySQL 验证 → 生产备份 → `prisma migrate deploy` → 结构核验”的顺序。
3. **部署顺序**:数据库兼容性迁移 → 后端 P0/P1/F/G → worker 与网关鉴权 → 前端 E → 投影消费者；任何阶段失败均停止后续发布。
4. **监控**:关注 queued/active/expired-lease 数量、lease reclaim、步骤失败码、重试次数、outbox pending age、worker heartbeat、运行耗时和 orphaned steps。
5. **PR**:资源恢复后先执行仓库规定的静态、单元、类型/构建和 e2e 门禁；附真实运行实例 UI 截图后再推送和创建 PR。

## 未实现 / P2 待办

- Artifact routes:`/jobs/:id/artifacts`、`/artifacts/:id`。
- 加权进度估算器与 ETA。
- Worker 池监控、dead-worker sweeper 与指标端点。
- Convex 实时投影消费者。
- 状态机 outbox → workflow template → enqueue 的正式消费者/路由接线。
- `POST /jobs` 的完整 `withIdempotency` 接线及 schema 支撑。
- 自动 Offer 过期任务与能力匹配推荐。
- 真实 MySQL lease 并发、回收、重试 e2e 测试。
- 前后端完整集成测试与 UI 视觉证明。
- 文档国际化与用户/运维文档拆分。

## 历史风险（当前状态以顶部覆盖说明为准）

- Schema 迁移未跑,目标数据库兼容性未知。
- 全部新增代码未跑过 CI、lint、类型检查或生产构建。
- 单元测试只覆盖核心状态机、队列与 schema 逻辑,且今晚未执行。
- 集成测试/e2e 缺失,E/F/G 仍未形成单一最终分支。
- Worker 路由目前依赖反向代理/网关鉴权,不可直接暴露公网。
- `requireCompanyRole` 对 `ai_direct_company_members` 的依赖需要在部署前确认。
- G 分支包含 F 提交,错误 merge 顺序可能造成重复或冲突。

## 提交建议

1. 文档收尾:`docs(ai-direct-hiring): final handoff and progress tracking update`。
2. 集成代码:`chore(ai-direct-hiring): integrate frontend hiring and runtime branches`。
3. 修复迁移/鉴权发现后分别使用 `fix(ai-direct-hiring): ...`,避免将环境修复与功能整合混成一个提交。
4. 所有提交先留本地；验证通过并经维护者确认后再 push/PR/部署。
