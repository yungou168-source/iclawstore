# AI 直聘功能基线报告(2026-08-01)

> 本文记录 2026-08-01 的历史工作区快照，不代表当前文件结构。
> 其中列出的 `convex/webhooks.ts` 和 `convex/lib/webhooks.ts` 后续已随
> Discord webhook 集成一并移除；当前决策见 `specs/webhook.md`。

## 1. 基线提交

- 分支: `feature/mysql-migration` / `feature/baseline-mysql-migration-fix`
- 基线提交: `0d9f0d1` (chore: update bun.lock)
- 基线标签: `baseline-mysql-migration-2026-08-01`
- 基线标签 SHA: `a9aa69e` (annotated tag)

## 2. AI 直聘功能分支

- 分支: `feature/ai-direct-hire-foundation`
- 基于提交: `0d9f0d1`

## 3. 未提交改动清单(来自主仓 `feature/mysql-migration`)

### 修改文件 (M) - 共 39 个

| 路径                                         | 说明                |
| -------------------------------------------- | ------------------- |
| `.env.local.example`                         | 本地环境变量示例    |
| `README.md`                                  | 项目说明文档        |
| `bun.lock`                                   | Bun 锁文件          |
| `convex/auth.ts`                             | Convex 认证         |
| `convex/lib/webhooks.ts`                     | Convex Webhook 库   |
| `convex/webhooks.ts`                         | Convex Webhook 路由 |
| `docs/README.md`                             | 文档首页            |
| `ecosystem.config.cjs`                       | PM2 配置文件        |
| `prisma/schema.prisma`                       | Prisma Schema       |
| `server/bun.lock`                            | Server Bun 锁       |
| `server/package-lock.json`                   | Server npm 锁       |
| `server/package.json`                        | Server 依赖         |
| `server/src/index.ts`                        | Server 入口         |
| `server/src/routes/skills.ts`                | Skills API 路由     |
| `server/src/routes/users.ts`                 | Users API 路由      |
| `specs/README.md`                            | 规格文档            |
| `src/components/AppProviders.tsx`            | 应用 providers      |
| `src/components/DevPersonaFab.tsx`           | 开发角色悬浮按钮    |
| `src/components/Header.tsx`                  | 顶部导航            |
| `src/components/SignInButton.tsx`            | 登录按钮            |
| `src/components/SignInPrompt.tsx`            | 登录提示            |
| `src/components/SkillDetailPage.tsx`         | 技能详情页          |
| `src/components/UserBootstrap.tsx`           | 用户初始化          |
| `src/lib/api.ts`                             | API 库              |
| `src/lib/fastifyApi.ts`                      | Fastify API 封装    |
| `src/lib/packageApi.ts`                      | 包 API              |
| `src/lib/useAuthStatus.ts`                   | 认证状态 Hook       |
| `src/lib/useUnifiedSearch.ts`                | 统一搜索            |
| `src/routes/__root.tsx`                      | 根路由              |
| `src/routes/docs/auth.tsx`                   | 认证文档页          |
| `src/routes/index.tsx`                       | 首页路由            |
| `src/routes/plugins/index.tsx`               | 插件页              |
| `src/routes/skills/-useSkillsBrowseModel.ts` | 技能浏览模型        |
| `src/routes/skills/index.tsx`                | 技能列表页          |
| `src/styles.css`                             | 全局样式            |
| `vite.config.ts`                             | Vite 配置           |
| `简体中文.ini`                               | 简体中文翻译配置    |

### 删除文件 (D) - 共 2 个

| 路径                                        | 说明                  |
| ------------------------------------------- | --------------------- |
| `iclawstore.com_20260625_130928.tar.gz`     | 旧备份压缩包          |
| `tailwindcss-oxide-linux-x64-gnu-4.3.0.tgz` | 旧 tailwindcss binary |

### 未跟踪文件 (??) - 共 60 个

| 路径                                                       | 说明                  |
| ---------------------------------------------------------- | --------------------- |
| `.env.convex-self-hosted`                                  | Convex 自托管环境变量 |
| `.env.example`                                             | 环境变量示例          |
| `AI直接招聘功能/`                                          | AI 直聘功能目录       |
| `XXO0hok9`                                                 | 临时文件              |
| `convex-self-hosted/`                                      | Convex 自托管代码     |
| `data/`                                                    | 数据目录              |
| `docker-compose.yml`                                       | Docker Compose 配置   |
| `prisma/migrations/20260731_ai_direct_hiring_p0/`          | AI 直聘 P0 迁移       |
| `public/sw.js`                                             | Service Worker        |
| `scripts/pm2.sh`                                           | PM2 脚本              |
| `server/data/`                                             | Server 数据目录       |
| `server/ecosystem.config.cjs`                              | Server PM2 配置       |
| `server/migrations/`                                       | Server 迁移目录       |
| `server/scripts/`                                          | Server 脚本           |
| `server/src/cache.ts`                                      | 缓存模块              |
| `server/src/db/`                                           | 数据库目录            |
| `server/src/docs/`                                         | Server 文档           |
| `server/src/routes/aiDirectHiring.ts`                      | AI 直聘路由           |
| `server/src/routes/aiDirectOrganizations.ts`               | AI 直聘组织路由       |
| `server/src/routes/devAuth.ts`                             | 开发认证              |
| `server/src/routes/files.ts`                               | 文件路由              |
| `server/src/routes/plugins.ts`                             | 插件路由              |
| `server/src/routes/publishers.ts`                          | 发布者路由            |
| `server/src/routes/skills.create.ts`                       | 创建技能              |
| `server/src/routes/skills.crud.ts`                         | 技能 CRUD             |
| `server/src/routes/skills.interactions.ts`                 | 技能交互              |
| `server/src/routes/skills.versions.ts`                     | 技能版本              |
| `server/src/routes/socialAuth.ts`                          | 社交登录              |
| `server/src/routes/translate.ts`                           | 翻译路由              |
| `server/src/routes/webhooks.ts`                            | Webhook 路由          |
| `server/src/services/`                                     | 服务层目录            |
| `server/src/utils/`                                        | 工具目录              |
| `server/test/`                                             | Server 测试           |
| `docs/superpowers/plans/2026-06-29-skill-crud-and-sync.md` | 技能同步计划          |
| `specs/ai-direct-hiring-credential-sync.md`                | 凭据同步规格          |
| `specs/ai-direct-hiring-desktop-contract.md`               | 桌面合同规格          |
| `specs/ai-direct-hiring-model-gateway.md`                  | 模型网关规格          |
| `specs/ai-direct-hiring-mysql-migration.md`                | MySQL 迁移规格        |
| `specs/ai-direct-hiring.md`                                | AI 直聘总规格         |
| `src/components/SocialLoginButtons.tsx`                    | 社交登录按钮          |
| `src/lib/useAuthStore.tsx`                                 | 认证 Store            |
| `src/lib/useServiceWorker.ts`                              | SW Hook               |
| `src/lib/useSocialLogin.ts`                                | 社交登录 Hook         |

**改动文件统计**: 39M + 2D + 60?? = 101 个文件

## 4. 改动子系统概览

### API 路由 (server/src/routes/)

- `skills.ts` - 技能 API
- `users.ts` - 用户 API
- `auth.ts` - 认证 API
- `search.ts` - 搜索 API
- `packages.ts` - 包管理 API
- `aiDirectHiring.ts` - AI 直聘 (未跟踪)
- `aiDirectOrganizations.ts` - AI 直聘组织 (未跟踪)
- `devAuth.ts` - 开发认证 (未跟踪)
- `files.ts` - 文件管理 (未跟踪)
- `plugins.ts` - 插件管理 (未跟踪)
- `publishers.ts` - 发布者管理 (未跟踪)
- `skills.create.ts` - 技能创建 (未跟踪)
- `skills.crud.ts` - 技能 CRUD (未跟踪)
- `skills.interactions.ts` - 技能交互 (未跟踪)
- `skills.versions.ts` - 技能版本 (未跟踪)
- `socialAuth.ts` - 社交登录 (未跟踪)
- `translate.ts` - 翻译 API (未跟踪)
- `webhooks.ts` - Webhook (未跟踪)

### Prisma Schema 和迁移

- `prisma/schema.prisma` - Schema 定义
- `prisma/migrations/20260731_ai_direct_hiring_p0/` - AI 直聘 P0 迁移 (未跟踪)
- `server/prisma/` - Server Prisma 配置

### 认证 / 用户

- `convex/auth.ts`
- `convex/lib/webhooks.ts`
- `convex/webhooks.ts`
- `src/components/SignInButton.tsx`
- `src/components/SignInPrompt.tsx`
- `src/lib/useAuthStatus.ts`
- `src/lib/useAuthStore.tsx` (未跟踪)
- `server/src/routes/devAuth.ts` (未跟踪)
- `server/src/routes/socialAuth.ts` (未跟踪)

### Convex

- `convex/auth.ts`
- `convex/lib/webhooks.ts`
- `convex/webhooks.ts`
- `convex-self-hosted/` (未跟踪)
- `.env.convex-self-hosted` (未跟踪)

### 前端组件

- `src/components/AppProviders.tsx`
- `src/components/DevPersonaFab.tsx`
- `src/components/Header.tsx`
- `src/components/SkillDetailPage.tsx`
- `src/components/UserBootstrap.tsx`
- `src/components/SocialLoginButtons.tsx` (未跟踪)
- `src/lib/api.ts`
- `src/lib/fastifyApi.ts`
- `src/lib/packageApi.ts`
- `src/lib/useUnifiedSearch.ts`
- `src/lib/useServiceWorker.ts` (未跟踪)
- `src/lib/useSocialLogin.ts` (未跟踪)
- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/skills/index.tsx`
- `src/routes/skills/-useSkillsBrowseModel.ts`
- `src/routes/docs/auth.tsx`
- `src/routes/plugins/index.tsx` (未跟踪)

### 服务层 (server/src/services/)

- `server/src/cache.ts` (未跟踪)
- `server/src/services/` 目录 (未跟踪,待填充)

### 资源 (Skills/Plugins/Packages)

- `server/src/routes/plugins.ts` (未跟踪)
- `server/src/routes/publishers.ts` (未跟踪)
- `server/src/routes/packages.ts`

### 配置 / 部署

- `ecosystem.config.cjs`
- `vite.config.ts`
- `docker-compose.yml` (未跟踪)
- `scripts/pm2.sh` (未跟踪)
- `简体中文.ini`

## 5. 已实现(部分)的 AI 直聘 P0 基础

> 以下功能位于未跟踪文件中,需在 `feature/ai-direct-hire-foundation` 分支上继续开发:

- **AI 直聘路由**: `server/src/routes/aiDirectHiring.ts`
- **AI 直聘组织 RBAC**: `server/src/routes/aiDirectOrganizations.ts`
- **Prisma AI 直聘 Schema**: `prisma/migrations/20260731_ai_direct_hiring_p0/`
- **金沙服务封装**: `server/src/services/` (目录已建,待实现)
- **模型策略解析**: `server/src/services/` (目录已建,待实现)
- **凭据加密服务**: `server/src/services/` (目录已建,待实现)

### Prisma Schema 中的 AI 直聘模型(待迁移)

- `aiDirectHiring*` 系列表定义(位于 `prisma/schema.prisma` 的未提交改动中)
- `aiDirectOrganization*` 系列表定义

### 规格文档

- `specs/ai-direct-hiring.md` - 总规格
- `specs/ai-direct-hiring-credential-sync.md` - 凭据同步
- `specs/ai-direct-hiring-desktop-contract.md` - 桌面合同
- `specs/ai-direct-hiring-model-gateway.md` - 模型网关
- `specs/ai-direct-hiring-mysql-migration.md` - MySQL 迁移

## 6. 回滚步骤

如需回滚到本次基线:

```bash
# 1. 切回基线标签
git checkout baseline-mysql-migration-2026-08-01

# 2. 重置工作区(会丢失未提交的改动)
git reset --hard baseline-mysql-migration-2026-08-01

# 3. 删除 AI 直聘分支(如存在)
git branch -D feature/ai-direct-hire-foundation
```

如需在 worktree 中操作:

```bash
cd /tmp/wt-baseline
git checkout baseline-mysql-migration-2026-08-01
git reset --hard baseline-mysql-migration-2026-08-01
git branch -D feature/ai-direct-hire-foundation
```

## 7. 密钥轮换清单(待用户操作,不自动执行)

以下密钥需要在后续安全审计中评估是否需要轮换:

| 密钥                  | 位置                      | 风险等级 | 建议                                                      |
| --------------------- | ------------------------- | -------- | --------------------------------------------------------- |
| `GITHUB_TOKEN`        | git remote URL            | 中       | 检查 remote 是否使用 token,建议使用 SSH 或只读 deploy key |
| `DATABASE_URL`        | `.env` / `.env.local`     | 高       | 检查密码强度,建议使用专用数据库用户                       |
| `JWT_SECRET`          | `.env.local.example`      | 高       | 确保长度 > 32 字符,使用随机生成                           |
| `NEXTAUTH_SECRET`     | `.env.local.example`      | 高       | 同上                                                      |
| `OAUTH_*` 密钥        | `.env.local.example`      | 中       | 检查 GitHub OAuth App 凭证                                |
| 金沙 Token            | `.env`                    | 高       | 评估是否需要重新申请                                      |
| 模型 API Key          | `.env`                    | 高       | 评估是否需要重新申请                                      |
| Convex deployment key | `.env.convex-self-hosted` | 高       | 仅用于自托管 Convex,勿泄露                                |

> 注意:本任务不修改任何 `.env*` 文件,以上仅为清单记录。

## 8. 关键路径

| 项目     | 路径                                                 |
| -------- | ---------------------------------------------------- |
| 主仓     | `/www/wwwroot/iclawstore.com`                        |
| Worktree | `/tmp/wt-baseline`                                   |
| 基线标签 | `baseline-mysql-migration-2026-08-01`                |
| 功能分支 | `feature/ai-direct-hire-foundation`                  |
| 基线报告 | `/tmp/wt-baseline/docs/AI_DIRECT_HIRING_BASELINE.md` |

## 9. 后续步骤(Agent B/C)

1. 将未跟踪的 AI 直聘文件从主仓迁移/复制到 `feature/ai-direct-hire-foundation` 分支
2. 实现 `server/src/services/` 中的金沙网关、凭据保险库、模型策略服务
3. 完成 Prisma 迁移 `20260731_ai_direct_hiring_p0`
4. 实现 AI 直聘前端组件
5. 运行 `bun run ci:static` 等检查

---

_报告生成时间: 2026-08-01 01:09 UTC+8_
_生成者: Agent A - 基线提交员_
