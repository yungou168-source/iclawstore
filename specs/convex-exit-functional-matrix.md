---
summary: "Convex 退出前的业务功能矩阵与领域端口边界。"
read_when:
  - 为现有业务域新增 MySQL、对象存储或搜索实现
  - 设计 Convex 影子读取、切流或回滚
  - 修改直接 Convex 客户端、HTTP、Storage、认证或发布依赖
---

# Convex 退出功能矩阵

## 使用方式

- 当前读端、写端描述的是已扫描代码与既有架构，不表示任何域已迁移。
- 一个域只能从 `convex_authoritative` 经回填、影子读取、MySQL 读取，再变为 MySQL 写权威；不得产生双写权威。
- `specs/convex-dependency-baseline.json` 是静态依赖的机器可读基线。`bun run check:no-new-convex-client-usage` 仅允许减少直接浏览器/HTTP client 与生成 API 依赖。
- 领域端口定义在 `server/src/domains/<domain>/`。路由只负责协议、身份和输入输出；port 定义领域读取/写入契约；adapter 封装 Convex、Prisma、资源存储或搜索实现；compare adapter 仅返回主读结果并异步记录规范化差异。

## 领域边界

| 域                   | 当前读端 / 写端                                                           | 身份与文件依赖                                 | 必须保持的兼容契约                                           | 退出门禁                                                             |
| -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 公开用户资料         | **准备态：生产仍为 Convex 读写；MySQL read adapter/backfill 已实现，未执行** | Convex Auth 用户、头像 Storage ID              | `/profile/<slug>`、`/api/profiles/<slug>`、handle/slug、公开字段、软删除与封禁可见性 | expand migration 已部署、batch completed/errorCount=0、映射无孤儿、compare 观察期零未解释差异、匿名 SEO/HTTP 抽样和回退演练通过 |
| 发布者与组织         | Convex `publishers` / `publisherMembers`；部分 Fastify/MySQL 组织能力并存 | Convex 身份、发布者头像 Storage                | 公共发布者页、成员 owner/admin/publisher 拒绝语义            | 成员关系和角色逐行对账；权限允许/拒绝矩阵通过                        |
| Skill 目录与发布     | SSR/browser、CLI、HTTP v1 与 Convex functions                             | Convex Auth、Skill/版本文件 Storage            | slug、版本、下载、转移、隐藏/封禁和安装资格                  | 聚合级回填、并发发布/幂等、CLI 旧版本闭环、制品 SHA-256 一致         |
| 插件与包             | Convex package/release API、CLI                                           | 发布 Token、Convex Storage、trusted publishing | `/api/v1/packages`、release 解析、制品和完整性元数据         | Token 撤销即时生效；规范化 API 和制品哈希对账通过                    |
| Soul                 | Convex Soul functions 与 HTTP                                             | Auth、版本文件 Storage                         | 列表、详情、版本、下载、收藏与评论                           | 版本/文件对账，安装/隐藏过滤一致                                     |
| 社交、审核与安全     | Convex comments/stars/reports/appeals/scan 及 worker                      | 当前用户、审核角色、扫描文件                   | 举报、申诉、人工覆盖、封禁、审计和上传门禁                   | 所有角色拒绝路径；扫描重试不重复副作用；审计链连续                   |
| 文件与上传           | Convex Storage、`uploads`、下载/HTTP route                                | 上传所有权、MIME/大小约束                      | 稳定资源 ID、历史 URL、字节和 SHA-256                        | 二进制先复制后切元数据；文件数/大小/hash 对账；可回退读端            |
| 搜索、统计与任务     | Convex search/digest/stats/cron；worker 使用 Convex HTTP                  | 仅必要用户上下文，部分资源文件                 | 排序、分页、热门值、统计与任务幂等                           | 固定评测集达标；事件连续性、聚合与回放对账                           |
| Web 认证与桌面 OAuth | Convex Auth；Fastify `convexIdentityBridge` 验签                          | issuer/audience、JWT/JWKS、桌面 PKCE           | 登录、退出、切换、桌面 authorization code + PKCE             | 新旧 issuer 受控共存；撤销即时；所有 RBAC 拒绝通过                   |
| CLI、HTTP 与部署     | Convex HTTP v1、CLI、workflow Convex deploy                               | API/publish Token、部署环境变量                | resolve/download、错误语义、限流和遥测边界                   | 固定 CLI 版本闭环；Nginx/SSR/API 生产烟测；无 Convex 网络演练        |

## 首个切片：公开用户资料影子读取

边界为 `server/src/domains/profiles/`，而非 React 路由：

```text
profiles/
  publicProfilePort.ts      # getPublicProfile(slug)
  convexPublicProfile.ts    # 旧权威 adapter
  mysqlPublicProfile.ts     # 新投影 adapter
  comparePublicProfile.ts   # 主读 Convex，影子 MySQL，记录已脱敏差异
  normalizePublicProfile.ts # 只保留客户端可见字段的等价比较
```

- `src/routes/profile/$slug.tsx` 使用应用 client 调用 Fastify `GET /api/profiles/:slug`；该 API 不可用时前端继续回退 Convex。Nginx 必须明确把这个路由交给 Fastify，不能依赖未确认的通用 `/api/*` upstream。
- 当前实现已具备 `PROFILE_READ_MODE=convex|compare|mysql`，但生产尚未执行 migration、回填或读模式变更，故域状态仍是 `convex_authoritative`。`convex` 为缺失/无效配置的默认值；`compare` 只返回 Convex 并记录 MySQL 影子差异；`mysql` 仅 MySQL 命中时返回 MySQL，缺失或异常立即回退 Convex。
- 进入 `backfilling` 的前提是由 `main` 自动 Deploy 成功应用 expand-only migration。以唯一的 `PROFILE_BACKFILL_BATCH_ID` 和 `PROFILE_BACKFILL_BATCH_SIZE=100` 单进程运行 `bun run --cwd server db:profiles:backfill`，直至 batch/cursor completed；重复同一 batch 必须不重读。
- 进入 `shadow_reading` 的前提是 completed batch、`errorCount=0`、snapshot/map 计数及孤儿 SQL 检查通过。设置受限 `api.env` 中的 `PROFILE_READ_MODE=compare` 并受控 PM2 reload 后，至少覆盖一个完整正常流量周期；检查 `profile_reconciliation_records`，所有差异必须分类且未解释差异为零。
- compare 与 mysql 阶段分别抽样已激活、有/无头像、handle fallback、删除/停用、封禁和未知 slug 的 `/api/profiles/:slug`、`/profile/:slug`；确认 HTTP status/body、SEO/SSR 与 Convex 基线等价。MySQL adapter 异常、API 可用性异常或任一未解释差异都必须将 `PROFILE_READ_MODE=convex` 并 reload。
- 进入 `mysql_reading` 前还必须完成 MySQL miss 的 Convex fallback 验证；切换后观察错误率与 fallback 指标，并演练恢复 `PROFILE_READ_MODE=convex`。DDL 不回滚；出现 schema 问题只能追加兼容 migration。