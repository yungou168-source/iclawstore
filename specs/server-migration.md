---
summary: "iClawStore 生产服务器迁移手册：MySQL、自建 Convex、托管资产、密钥、服务配置、验收与回滚。"
---

# iClawStore 生产服务器迁移手册

本文用于将当前 iClawStore 生产环境迁移到另一台服务器。它记录的是生产数据边界和迁移约束，不替代日常发布流程。日常发布方式参见 [`specs/deploy.md`](./deploy.md)。

> 基线日期：2026-08-07。迁移前必须重新核对服务、路径和容量，不能假设本文中的运行态快照永久不变。

## 1. 目标与原则

迁移目标：

- 保留全部业务数据、上传文件、认证密钥和运行配置。
- 保持 `https://www.iclawstore.com` 为唯一规范 Web Origin。
- 尽量缩短停止写入的时间。
- 新服务器验收失败时，可以快速将流量切回旧服务器。

迁移原则：

1. **先搭建、后停写**：新服务器的软件和配置应在停机窗口前准备完成。
2. **逻辑备份 MySQL**：不要在 MySQL 运行时直接复制数据目录。
3. **一致性备份 Convex**：备份 Convex 卷前必须先停止业务写入和 Convex 容器。
4. **密钥独立加密传输**：生产密钥不得进入 Git、普通源码压缩包、Issue 或日志。
5. **一次只切一个生产入口**：完成本机和临时域名验收后，最后才修改 DNS。
6. **保留旧服务器回滚能力**：迁移验收结束前，不清理旧服务器数据。

## 2. 当前生产架构快照

当前运行结构：

```text
Internet
  |
  v
Nginx
  |-- SSR Web -------------------- 127.0.0.1:3000
  |-- Fastify API ---------------- 0.0.0.0:3002
  |-- /convex/ ------------------- 127.0.0.1:3210
  `-- /convex/api/auth/ ---------- 127.0.0.1:3211

Persistent data
  |-- MySQL: iclawstore
  |-- Convex: db.sqlite3 + storage/
  `-- Managed assets
```

已确认运行的应用进程：

- `iclawstore.service`：TanStack Start/Nitro SSR。
- `iclawstore-api`：Fastify API。
- `iclawstore-runtime-dispatcher`：运行时 outbox dispatcher。
- `iclawstore-audit-export`：审计导出 worker。
- 自建 Convex backend。
- MySQL。
- Nginx。

当前未运行 Meilisearch，因此本次基线迁移不包含 Meilisearch 数据。如果迁移时已经启用，必须另行备份其索引或从权威数据源重建。

## 3. 数据分类

### 3.1 必须迁移的数据

| 数据                | 当前位置                                              | 迁移方式             |                    基线容量 |
| ------------------- | ----------------------------------------------------- | -------------------- | --------------------------: |
| MySQL 数据库        | 数据库 `iclawstore`                                   | `mysqldump` 逻辑备份 | MySQL 数据目录总量约 103 MB |
| Convex 数据库与文件 | Docker 卷 `convex-self-hosted_data`                   | 停止写入后整体归档   |                   约 113 MB |
| 托管资产            | `/home/ubuntu/.local/share/iclawstore/managed-assets` | `rsync -aHAX`        |                    约 20 KB |
| 生产环境变量        | 见第 4 节                                             | 加密传输             |                        很小 |
| 生产密钥            | 见第 4 节                                             | 加密传输或重新签发   |                        很小 |
| 未提交代码或配置    | `/www/wwwroot/iclawstore.com`                         | 先审计，再单独归档   |                  按实际情况 |

容量只是迁移前估算，正式执行时必须重新统计。

### 3.2 应从 Git 或发布流水线恢复的内容

以下内容应优先从 Git 仓库恢复，不应把旧服务器目录当作唯一来源：

```text
src/
server/
convex/
prisma/
packages/
public/
specs/
docs/
scripts/
ops/
package.json
bun.lock
ecosystem.config.cjs
```

当前 SSR 入口是：

```text
/www/wwwroot/iclawstore.com/.output/server/index.mjs
```

推荐通过生产发布流水线重新生成 `.output`。如迁移窗口内无法构建，应复制当前有效 release 作为首次启动和回滚版本。

### 3.3 不应作为生产数据迁移的内容

以下目录可以重新生成，通常不迁移：

```text
node_modules/
test-results/
.nitro-next/
.vercel/output/
.output.failed-*
.output.pre-*
大部分历史 .output.release-*
测试 trace 和构建缓存
```

最多保留当前 release 和最近一个已验证 release，避免把约 2.3 GB 的整个项目目录无差别复制到新服务器。

`migrations/exports/*.json` 是历史迁移产物，不是当前生产数据库的权威备份。

## 4. 环境变量与密钥

### 4.1 需要迁移的配置文件

```text
/www/wwwroot/iclawstore.com/.env.local
/www/wwwroot/iclawstore.com/convex-self-hosted/.env
/home/ubuntu/.config/iclawstore/api.env
/home/ubuntu/.config/iclawstore/dispatcher.env
/home/ubuntu/.config/iclawstore/audit-export.env
/home/ubuntu/.config/iclawstore/executor.env
/home/ubuntu/.config/iclawstore/approval-timeout.env    # 如果存在
/home/ubuntu/.config/iclawstore/backup.key
/home/ubuntu/.config/iclawstore/mysql-admin.env
/home/ubuntu/.config/iclawstore/migration.env
```

需要保留原权限，并确保只有运行用户和管理员可读。

### 4.2 关键密钥类别

- MySQL 凭据和 `DATABASE_URL`。
- Convex 管理地址与管理密钥。
- `JWT_SECRET`。
- `JWT_PRIVATE_KEY` 与 `JWKS`。
- GitHub、Google、微信等 OAuth 凭据。
- Resend、OpenAI 等第三方服务密钥。
- API 指标令牌。
- 备份加密密钥。

`JWT_PRIVATE_KEY` 和 `JWKS` 必须来自同一个密钥对并一起迁移。不得只重新生成其中一个，否则认证签发和验签会不一致。

### 4.3 密钥传输要求

推荐通过 `age`、SOPS、密码管理器或等价的加密通道传输。例如：

```bash
tar -czf - \
  /www/wwwroot/iclawstore.com/.env.local \
  /www/wwwroot/iclawstore.com/convex-self-hosted/.env \
  /home/ubuntu/.config/iclawstore \
  | age -r '<接收方公钥>' > iclawstore-secrets.tar.gz.age
```

不要将真实密钥写进本文、Shell 历史、工单或普通聊天消息。

服务器 SSH deploy key 建议在新服务器重新生成，再更新 GitHub Secrets 和 `known_hosts`，而不是复制旧服务器私钥。

## 5. MySQL 迁移

当前生产目标：

```text
协议：MySQL
地址：127.0.0.1:3306
数据库：iclawstore
```

### 5.1 预备备份

在迁移窗口前执行一次预备备份，用于验证导入流程：

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --default-character-set=utf8mb4 \
  iclawstore > iclawstore-preflight.sql
```

在新服务器创建空数据库并试导入：

```bash
mysql iclawstore < iclawstore-preflight.sql
```

预备导入只用于验证，不作为最终切换数据。

### 5.2 最终备份

最终备份前必须暂停所有可能写 MySQL 的进程：

- `iclawstore-api`
- `iclawstore-runtime-dispatcher`
- `iclawstore-audit-export`
- 可选的 provider executor
- 可选的 approval-timeout worker

然后执行最终 `mysqldump`，计算校验和并传输：

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --default-character-set=utf8mb4 \
  iclawstore > iclawstore-final.sql

sha256sum iclawstore-final.sql > iclawstore-final.sql.sha256
```

新服务器先校验再导入：

```bash
sha256sum -c iclawstore-final.sql.sha256
mysql iclawstore < iclawstore-final.sql
```

### 5.3 MySQL 验收

至少核对：

- 数据库字符集和排序规则。
- Prisma 迁移记录。
- 表数量。
- 用户、组织、职位、运行时任务、outbox、审计任务等关键表记录数。
- 外键与唯一索引。
- API 能否完成一条只读查询。
- dispatcher 启动后是否只处理待处理任务，不重复消费已完成任务。

不要无条件重新执行 `prisma/migrations/` 中全部初始化 SQL。应根据数据库内已有迁移状态决定后续动作。

## 6. 自建 Convex 迁移

### 6.1 权威数据位置

当前 Convex 容器将以下宿主机目录挂载为 `/convex/data`：

```text
/var/lib/docker/volumes/convex-self-hosted_data/_data
```

其中至少包含：

```text
db.sqlite3
storage/
tmp/                 # 临时运行数据，不是主要业务数据，但整体卷迁移时一并处理
```

`db.sqlite3` 和 `storage/` 是一个业务整体，不能只迁移数据库而遗漏文件存储。

### 6.2 一致性备份

正式备份顺序：

1. 停止 SSR、API 和所有 worker 的外部写入。
2. 确认没有仍在执行的发布、上传、认证回调或后台任务。
3. 停止 Convex 容器。
4. 归档整个数据卷。
5. 生成 SHA-256 校验和。
6. 完成后可保持旧 Convex 停止，等待切换或回滚决定。

示例：

```bash
sudo tar \
  -C /var/lib/docker/volumes/convex-self-hosted_data/_data \
  -czf convex-self-hosted-data.tar.gz .

sha256sum convex-self-hosted-data.tar.gz \
  > convex-self-hosted-data.tar.gz.sha256
```

不要在 Convex 正在写 SQLite 时直接进行普通 `rsync` 或复制 `db.sqlite3`。

### 6.3 恢复

1. 在新服务器安装与旧环境兼容的 Convex 容器版本。
2. 创建 `convex-self-hosted_data` 卷。
3. 保持 Convex 容器停止。
4. 将归档恢复到卷的 `_data` 目录。
5. 恢复正确的属主和权限。
6. 启动 Convex。
7. 检查 `3210` 和 `3211` 监听状态。
8. 使用管理端确认部署、表、文件和环境变量存在。
9. 使用严格 TypeScript 检查重新推送函数：`bunx convex dev --once`，不得禁用 typecheck。

迁移后必须核对 Convex deployment 环境变量，尤其是：

```text
SITE_URL
CUSTOM_AUTH_SITE_URL
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
AUTH_WECHAT_APP_ID
AUTH_WECHAT_APP_SECRET
AUTH_RESEND_KEY
AUTH_EMAIL_FROM
JWT_PRIVATE_KEY
JWKS
```

## 7. 托管资产迁移

当前 API 使用：

```text
/home/ubuntu/.local/share/iclawstore/managed-assets
```

预同步可以在停机前执行，最终停写后再增量同步一次：

```bash
rsync -aHAX \
  /home/ubuntu/.local/share/iclawstore/managed-assets/ \
  new-server:/home/ubuntu/.local/share/iclawstore/managed-assets/
```

恢复后核对：

- 运行 API 的用户具有读取权限。
- 需要写入时具有写入权限。
- 环境变量 `MANAGED_ASSET_ROOT` 与恢复目录一致。
- 抽样访问资产的大小和 SHA-256 与旧服务器一致。

## 8. 服务与反向代理配置

### 8.1 systemd

需要迁移或重建：

```text
/etc/systemd/system/iclawstore.service
/etc/systemd/system/mysql-iclawstore.service
/etc/systemd/system/nginx-iclawstore.service
```

当前 SSR 服务使用：

```text
WorkingDirectory=/www/wwwroot/iclawstore.com
ExecStart=/usr/bin/node /www/wwwroot/iclawstore.com/.output/server/index.mjs
EnvironmentFile=/www/wwwroot/iclawstore.com/.env.local
HOST=127.0.0.1
PORT=3000
```

恢复后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable iclawstore.service
```

不要在数据恢复和配置验证完成前启动服务。

### 8.2 PM2

PM2 应用定义在：

```text
/www/wwwroot/iclawstore.com/ecosystem.config.cjs
```

它依赖 `/home/ubuntu/.config/iclawstore/` 中的环境文件。新服务器应重新安装 Bun 和 PM2，再从 `ecosystem.config.cjs` 启动并配置开机自启，不应只复制 PM2 的临时进程状态。

### 8.3 Nginx

当前站点配置：

```text
/www/server/panel/vhost/nginx/iclawstore.com.conf
```

必须保留以下路由关系：

```text
/                 -> 127.0.0.1:3000
Fastify API       -> 127.0.0.1:3002
/convex/          -> 127.0.0.1:3210
/convex/api/auth/ -> 127.0.0.1:3211
```

`/convex/api/auth/` 必须优先于通用 `/convex/` 路由，并将内部请求路径正确保留为 `/api/auth/...`。否则 OAuth callback 会返回代理 `404`。

正式 reload 前执行：

```bash
sudo nginx -t
sudo systemctl reload nginx-iclawstore.service
```

## 9. TLS、域名与外部集成

### 9.1 TLS

当前仓库存在：

```text
/www/wwwroot/iclawstore.com/ssl/
```

优先在新服务器重新签发证书。如果迁移现有证书，必须加密传输私钥、保留权限、同时迁移完整证书链，并核对 Nginx 的真实证书路径。

ACME challenge 文件通常不需要保留，但新服务器必须正确配置 `/.well-known/acme-challenge/`。

### 9.2 规范域名

生产规范 Origin 必须保持：

```text
https://www.iclawstore.com
```

裸域名 `https://iclawstore.com` 应在登录流程开始前重定向到 `www`。OAuth state cookie 是 host-only；不能让登录流程在裸域名和 `www` 之间混用。

### 9.3 OAuth callback

如果域名不变，回调地址保持：

```text
https://www.iclawstore.com/convex/api/auth/callback/github
https://www.iclawstore.com/convex/api/auth/callback/google
https://www.iclawstore.com/convex/api/auth/callback/wechat
```

仍需在 GitHub、Google、微信等平台核对回调白名单。

### 9.4 GitHub Actions 与部署密钥

更新或重新配置：

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_PORT`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`
- `CONVEX_DEPLOY_KEY`
- 可选的 `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON`

同时安装：

```text
/usr/local/sbin/iclawstore-deploy
```

并恢复其 `root:root`、`0755` 权限及最小化 sudoers 规则。迁移后应使用新服务器主机密钥更新 `known_hosts`，不能关闭主机密钥校验。

## 10. 新服务器环境要求

新服务器需要安装并验证：

- Node.js，与当前 Nitro bundle 兼容。
- Bun。
- PM2。
- Docker。
- Nginx。
- MySQL，与备份版本兼容。
- Git。
- 应用依赖的字体、SSL 与系统动态库。

建议在迁移窗口前记录版本：

```bash
node --version
bun --version
pm2 --version
docker --version
nginx -v
mysql --version
```

新服务器目录、用户和权限应尽量保持一致，尤其是：

```text
/www/wwwroot/iclawstore.com
/home/ubuntu/.config/iclawstore
/home/ubuntu/.local/share/iclawstore
```

如果必须更改路径，应先修改 systemd、PM2、Nginx 和环境变量中的绝对路径，不能依靠符号链接长期掩盖配置差异。

## 11. 推荐迁移流程

### 阶段 A：迁移前准备，不停机

- [ ] 确认项目代码已提交并推送。
- [ ] 审计未提交和未跟踪文件，单独保存需要保留的内容。
- [ ] 记录 Node、Bun、PM2、Docker、Nginx、MySQL 和 Convex 版本。
- [ ] 准备新服务器用户、目录、软件、防火墙和安全组。
- [ ] 从 Git 克隆项目并准备 SSR release。
- [ ] 恢复 systemd、PM2 和 Nginx 配置，但暂不对公网提供服务。
- [ ] 加密迁移环境变量和密钥。
- [ ] 执行并验证一次 MySQL 预备导入。
- [ ] 预同步托管资产。
- [ ] 将 DNS TTL 提前降低。
- [ ] 验证 TLS 签发条件和 OAuth callback 配置。

### 阶段 B：进入停写窗口

建议停止顺序：

1. 阻止新写请求或启用维护模式。
2. 停止 SSR，防止继续接收应用写请求。
3. 停止 Fastify API。
4. 停止 dispatcher、审计导出和其他 worker。
5. 确认没有运行中的发布、上传和后台任务。
6. 执行最终 MySQL 备份。
7. 停止 Convex 容器并备份完整数据卷。
8. 最终增量同步托管资产。

### 阶段 C：新服务器恢复

建议启动顺序：

1. 恢复并启动 MySQL。
2. 导入最终 MySQL 备份并验收。
3. 恢复 Convex 数据卷并启动 Convex。
4. 验证 Convex 数据、文件、环境变量和认证端点。
5. 恢复托管资产。
6. 启动 Fastify API。
7. 启动 dispatcher 和所需 worker。
8. 启动 SSR。
9. 检查 Nginx 配置并 reload。
10. 通过本机 Host 映射或临时测试域名完成验收。

### 阶段 D：流量切换

- [ ] 修改 DNS 指向新服务器。
- [ ] 同时观察新旧服务器访问日志。
- [ ] 确认公网证书正确。
- [ ] 确认裸域名跳转到 `www`。
- [ ] 确认登录、API、Convex 和静态资源均正常。
- [ ] 保持旧服务器停写但可回滚。

## 12. 验收清单

### 12.1 基础服务

```bash
systemctl is-active iclawstore.service
systemctl is-active mysql-iclawstore.service
systemctl is-active nginx-iclawstore.service
pm2 status
```

监听端口应符合：

```text
127.0.0.1:3000   SSR
0.0.0.0:3002     Fastify API（建议后续收敛为仅本机监听）
0.0.0.0:3210     Convex management（应由防火墙限制公网访问）
0.0.0.0:3211     Convex HTTP site（应由防火墙限制直接公网访问）
127.0.0.1:3306   MySQL，或至少只允许受控来源
```

### 12.2 数据与功能

- [ ] 首页和公开列表可访问。
- [ ] 关键用户、组织、职位和业务记录存在。
- [ ] Convex 表记录可读取。
- [ ] Convex File Storage 文件可访问。
- [ ] 托管资产可下载，抽样校验和一致。
- [ ] GitHub、Google、微信登录按实际启用项逐一测试。
- [ ] 邮箱 OTP 登录按实际启用情况测试。
- [ ] Fastify API 只读端点正常。
- [ ] dispatcher 无重复消费和持续报错。
- [ ] 审计导出 worker 无持续失败。
- [ ] Nginx、SSR、API、Convex、MySQL 和 PM2 日志没有新错误。

### 12.3 项目自带验证

```bash
bun run verify:convex-contract -- --prod

CLAWHUB_E2E_SITE=https://www.iclawstore.com \
DESKTOP_API_BASE_URL=https://www.iclawstore.com \
bun run test:e2e:prod-http

PLAYWRIGHT_BASE_URL=https://www.iclawstore.com \
bunx playwright test --workers=1 \
  e2e/menu-smoke.pw.test.ts \
  e2e/publish-entry-workflows.pw.test.ts \
  e2e/upload-auth-smoke.pw.test.ts
```

## 13. 回滚方案

触发回滚的典型条件：

- MySQL 数据不完整或迁移版本不一致。
- Convex 数据库、文件存储或认证端点不可用。
- OAuth 登录失败且无法在窗口内修复。
- worker 出现重复消费、持续失败或数据异常。
- SSR/API 公网健康检查失败。

回滚步骤：

1. 立即阻止新服务器写入。
2. 停止新服务器 SSR、API 和 worker。
3. 将 DNS 或负载均衡切回旧服务器。
4. 启动旧服务器 Convex、MySQL、API、worker 和 SSR。
5. 执行公网 smoke test。
6. 保存新服务器日志和迁移产物，定位失败原因。

重要限制：一旦新服务器已经接受生产写入，不能直接把流量切回旧服务器而忽略新数据。此时必须先评估增量数据如何回灌，或明确丢弃范围并获得业务确认。

## 14. 迁移产物与留存

迁移包建议包含：

```text
migration-YYYYMMDD-HHMM/
  checksums.sha256
  versions.txt
  iclawstore-final.sql
  convex-self-hosted-data.tar.gz
  managed-assets.tar.gz              # 或 rsync 传输记录
  secrets.tar.gz.age                 # 加密文件
  nginx-site.conf
  systemd/
  migration-log.txt
  verification-results.txt
```

留存要求：

- 迁移包必须加密存储并限制访问。
- 数据库、Convex 卷和密钥备份使用独立校验和。
- 记录备份开始、停止写入、恢复、验收和 DNS 切换时间。
- 迁移完成并经过约定观察期后，再安全删除临时明文备份。
- 旧服务器下线前执行最终备份，并撤销其 OAuth、GitHub、SSH 和数据库访问能力。
