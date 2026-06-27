# ClawHub Convex → MySQL 迁移计划

> **状态**: 规划中  
> **创建时间**: 2026-06-27  
> **目标**: 将后端从 Convex Cloud 迁移到本地 MySQL

---

## 1. 项目概述

### 1.1 背景

ClawHub 当前使用 Convex Cloud 作为后端服务，所有数据存储在 Convex 的数据库中。由于以下原因，需要迁移到本地 MySQL：

- 数据主权要求（国内存储）
- 降低对境外服务的依赖
- 更好的成本控制
- 自定义扩展能力

### 1.2 迁移范围

| 模块 | 数据量 | 复杂度 |
|------|--------|--------|
| 用户系统 | ~18万用户 | 🔴 高 |
| 技能(Skills) | ~5.2万 | 🟡 中 |
| 插件(Packages) | 数千 | 🟡 中 |
| 搜索索引 | 向量数据 | 🔴 高 |
| 认证系统 | GitHub OAuth | 🔴 高 |

---

## 2. Convex Schema 概览

### 2.1 核心表（共 60+ 张表）

```
核心业务表:
├── users (~180K) - 用户表
├── publishers - 发布者/组织表
├── publisherMembers - 发布者成员关系
├── skills (~52K) - 技能表
├── skillVersions - 技能版本表
├── packages - 插件表
├── packageReleases - 插件版本表
├── souls - 灵魂表
├── soulVersions - 灵魂版本表

认证相关:
├── authSessions (Convex Auth)
├── authGithubUsers
├── apiTokens - API Token
├── cliDeviceCodes - CLI 设备码

社交功能:
├── stars - 收藏
├── comments - 评论
├── skillReports - 举报
├── skillAppeals - 申诉

搜索/索引:
├── skillSearchDigest (~52K) - 搜索摘要
├── skillEmbeddings - 向量嵌入
├── packageSearchDigest - 包搜索摘要
├── packageCapabilitySearchDigest

统计/事件:
├── skillStatEvents - 技能统计事件
├── packageStatEvents - 包统计事件
├── skillDailyStats - 每日统计
├── skillLeaderboards - 排行榜

审核/安全:
├── securityScanJobs - 安全扫描任务
├── skillScanRequests - 扫描请求
├── publisherAbuseScores - 滥用评分
└── auditLogs - 审计日志
```

### 2.2 关键依赖

- **向量搜索**: Convex 内置向量索引 (1536 维)
- **文件存储**: Convex Storage (_storage 表)
- **实时订阅**: Convex 实时查询
- **认证**: @convex-dev/auth (GitHub OAuth)

---

## 3. MySQL Schema 设计

### 3.1 数据库设计原则

1. **保持关系模型**: Convex 是文档数据库，迁移时需要合理拆分
2. **索引设计**: 参考 Convex 的 compound indexes
3. **JSON 字段**: 复杂嵌套对象使用 JSON 类型
4. **分区表**: 大表（如 statEvents）按时间分区

### 3.2 核心表设计

#### 3.2.1 用户表 (users)

```sql
CREATE TABLE users (
  id VARCHAR(24) PRIMARY KEY,  -- 保留 Convex ID 格式
  name VARCHAR(255),
  image VARCHAR(500),
  email VARCHAR(255) UNIQUE,
  email_verification_time BIGINT,
  phone VARCHAR(20) UNIQUE,
  phone_verification_time BIGINT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  handle VARCHAR(50) UNIQUE,
  display_name VARCHAR(255),
  bio TEXT,
  role ENUM('admin', 'moderator', 'user') DEFAULT 'user',
  github_created_at BIGINT,
  github_fetched_at BIGINT,
  github_profile_synced_at BIGINT,
  trusted_publisher BOOLEAN DEFAULT FALSE,
  published_skills INT DEFAULT 0,
  total_stars INT DEFAULT 0,
  total_downloads INT DEFAULT 0,
  personal_publisher_id VARCHAR(24),
  requires_moderation_at BIGINT,
  requires_moderation_reason TEXT,
  deactivated_at BIGINT,
  purged_at BIGINT,
  deleted_at BIGINT,
  ban_reason VARCHAR(255),
  created_at BIGINT,
  updated_at BIGINT,

  INDEX idx_handle (handle),
  INDEX idx_email (email),
  INDEX idx_phone (phone),
  INDEX idx_deleted_at (deleted_at),
  INDEX idx_deactivated_at (deactivated_at),
  INDEX idx_active_handle (deleted_at, deactivated_at, handle)
);
```

#### 3.2.2 发布者表 (publishers)

```sql
CREATE TABLE publishers (
  id VARCHAR(24) PRIMARY KEY,
  kind ENUM('user', 'org') NOT NULL,
  handle VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  bio TEXT,
  image VARCHAR(500),
  linked_user_id VARCHAR(24),
  trusted_publisher BOOLEAN DEFAULT FALSE,
  published_skills INT DEFAULT 0,
  published_packages INT DEFAULT 0,
  total_installs BIGINT DEFAULT 0,
  total_downloads BIGINT DEFAULT 0,
  total_stars BIGINT DEFAULT 0,
  skill_total_installs BIGINT DEFAULT 0,
  skill_total_downloads BIGINT DEFAULT 0,
  skill_total_stars BIGINT DEFAULT 0,
  deactivated_at BIGINT,
  deleted_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_handle (handle),
  INDEX idx_linked_user (linked_user_id),
  INDEX idx_kind_handle (kind, handle),
  INDEX idx_active_kind_handle (deleted_at, deactivated_at, kind, handle),
  INDEX idx_active_total_downloads (deleted_at, deactivated_at, total_downloads, updated_at)
);
```

#### 3.2.3 技能表 (skills)

```sql
CREATE TABLE skills (
  id VARCHAR(24) PRIMARY KEY,
  slug VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  summary TEXT,
  icon VARCHAR(500),
  resource_id VARCHAR(255),
  owner_user_id VARCHAR(24) NOT NULL,
  owner_publisher_id VARCHAR(24),
  canonical_skill_id VARCHAR(24),
  fork_of JSON,  -- {skillId, kind, version, at}
  install_kind ENUM('github'),
  github_source_id VARCHAR(24),
  github_path VARCHAR(500),
  github_has_skill_card BOOLEAN,
  github_current_commit VARCHAR(100),
  github_current_content_hash VARCHAR(100),
  github_current_status ENUM('present', 'missing', 'unknown'),
  github_current_checked_at BIGINT,
  github_scan_status ENUM('clean', 'suspicious', 'malicious', 'pending', 'failed'),
  github_removed_at BIGINT,
  latest_version_id VARCHAR(24),
  latest_version_summary JSON,
  tags JSON,  -- record<string, versionId>
  capability_tags JSON,
  soft_deleted_at BIGINT,
  badges JSON,
  moderation_status ENUM('active', 'hidden', 'removed'),
  moderation_notes TEXT,
  moderation_reason VARCHAR(255),
  moderation_verdict ENUM('clean', 'suspicious', 'malicious'),
  moderation_reason_codes JSON,
  moderation_evidence JSON,
  moderation_summary TEXT,
  moderation_engine_version VARCHAR(50),
  moderation_evaluated_at BIGINT,
  moderation_source_version_id VARCHAR(24),
  manual_override JSON,
  quality JSON,
  is_suspicious BOOLEAN,
  moderation_flags JSON,
  last_reviewed_at BIGINT,
  scan_last_checked_at BIGINT,
  scan_check_count INT,
  hidden_at BIGINT,
  hidden_by VARCHAR(24),
  unpublished_slug_reserved_until BIGINT,
  unpublished_slug_released_at BIGINT,
  unpublished_original_slug VARCHAR(255),
  report_count INT DEFAULT 0,
  last_reported_at BIGINT,
  batch VARCHAR(100),
  stats_downloads BIGINT DEFAULT 0,
  stats_stars BIGINT DEFAULT 0,
  stats_installs_current BIGINT DEFAULT 0,
  stats_installs_all_time BIGINT DEFAULT 0,
  stats JSON,  -- 保持兼容性
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_slug (slug),
  INDEX idx_owner (owner_user_id),
  INDEX idx_owner_publisher (owner_publisher_id),
  INDEX idx_owner_slug (owner_user_id, slug),
  INDEX idx_owner_publisher_slug (owner_publisher_id, slug),
  INDEX idx_updated (updated_at),
  INDEX idx_stats_downloads (stats_downloads, updated_at),
  INDEX idx_stats_stars (stats_stars, updated_at),
  INDEX idx_soft_deleted (soft_deleted_at, updated_at),
  INDEX idx_canonical (canonical_skill_id),
  INDEX idx_fork_of (fork_of->>'$.skillId'),
  INDEX idx_github_source (github_source_id),
  INDEX idx_batch (batch),
  UNIQUE KEY uk_owner_slug (owner_user_id, slug),
  UNIQUE KEY uk_owner_publisher_slug (owner_publisher_id, slug)
);
```

#### 3.2.4 技能版本表 (skill_versions)

```sql
CREATE TABLE skill_versions (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL,
  version VARCHAR(50) NOT NULL,
  fingerprint VARCHAR(100),
  source_provenance JSON,
  changelog TEXT,
  changelog_source ENUM('auto', 'user'),
  icon VARCHAR(500),
  files JSON,  -- [{path, size, storage_id, sha256, content_type}]
  parsed JSON,
  created_by VARCHAR(24),
  created_at BIGINT NOT NULL,
  claw_scan_note TEXT,
  claw_scan_note_updated_at BIGINT,
  soft_deleted_at BIGINT,
  sha256hash VARCHAR(100),
  vt_analysis JSON,
  skill_spector_analysis JSON,
  llm_analysis JSON,
  capability_tags JSON,
  dep_registry_analysis JSON,
  dep_registry_scan_status ENUM('clean', 'suspicious', 'error'),
  static_scan JSON,
  api_key_required BOOLEAN,

  INDEX idx_skill (skill_id),
  INDEX idx_skill_version (skill_id, version),
  INDEX idx_active_created (soft_deleted_at, created_at),
  INDEX idx_sha256hash (sha256hash),
  UNIQUE KEY uk_skill_version (skill_id, version)
);
```

#### 3.2.5 插件表 (packages)

```sql
CREATE TABLE packages (
  id VARCHAR(24) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  summary TEXT,
  owner_user_id VARCHAR(24) NOT NULL,
  owner_publisher_id VARCHAR(24),
  family ENUM('skill', 'code-plugin', 'bundle-plugin') NOT NULL,
  channel ENUM('official', 'community', 'private') NOT NULL,
  is_official BOOLEAN DEFAULT FALSE,
  runtime_id VARCHAR(100),
  source_repo VARCHAR(500),
  latest_release_id VARCHAR(24),
  latest_version_summary JSON,
  tags JSON,
  capability_tags JSON,
  executes_code BOOLEAN,
  compatibility JSON,
  capabilities JSON,
  verification JSON,
  scan_status ENUM('clean', 'suspicious', 'malicious', 'pending', 'not-run') NOT NULL,
  stats JSON,
  report_count INT DEFAULT 0,
  last_reported_at BIGINT,
  soft_deleted_at BIGINT,
  soft_deleted_reason ENUM('user.banned', 'user.deactivated', 'publisher.deleted'),
  soft_deleted_by VARCHAR(24),
  soft_deleted_by_role ENUM('admin', 'moderator', 'user'),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_name (normalized_name),
  INDEX idx_owner (owner_user_id),
  INDEX idx_owner_publisher (owner_publisher_id),
  INDEX idx_family_updated (family, updated_at),
  INDEX idx_family_channel_updated (family, channel, updated_at),
  INDEX idx_runtime_id (runtime_id),
  INDEX idx_active_updated (soft_deleted_at, updated_at),
  UNIQUE KEY uk_name (normalized_name)
);
```

#### 3.2.6 插件版本表 (package_releases)

```sql
CREATE TABLE package_releases (
  id VARCHAR(24) PRIMARY KEY,
  package_id VARCHAR(24) NOT NULL,
  version VARCHAR(50) NOT NULL,
  changelog TEXT,
  summary TEXT,
  dist_tags JSON,
  files JSON,
  integrity_sha256 VARCHAR(100) NOT NULL,
  artifact_kind ENUM('legacy-zip', 'npm-pack'),
  clawpack_storage_id VARCHAR(24),
  clawpack_sha256 VARCHAR(100),
  clawpack_size BIGINT,
  clawpack_format ENUM('tgz'),
  npm_integrity VARCHAR(500),
  npm_shasum VARCHAR(100),
  npm_tarball_name VARCHAR(255),
  npm_unpacked_size BIGINT,
  npm_file_count INT,
  extracted_package_json JSON,
  extracted_plugin_manifest JSON,
  normalized_bundle_manifest JSON,
  compatibility JSON,
  capabilities JSON,
  runtime_id VARCHAR(100),
  source_repo VARCHAR(500),
  verification JSON,
  sha256hash VARCHAR(100),
  vt_analysis JSON,
  skill_spector_analysis JSON,
  llm_analysis JSON,
  static_scan JSON,
  manual_moderation JSON,
  source JSON,
  created_by VARCHAR(24),
  publish_actor JSON,
  created_at BIGINT NOT NULL,
  claw_scan_note TEXT,
  claw_scan_note_updated_at BIGINT,
  soft_deleted_at BIGINT,

  INDEX idx_package (package_id),
  INDEX idx_package_version (package_id, version),
  INDEX idx_active_created (soft_deleted_at, created_at),
  INDEX idx_sha256hash (sha256hash),
  UNIQUE KEY uk_package_version (package_id, version)
);
```

#### 3.2.7 收藏表 (stars)

```sql
CREATE TABLE stars (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL,
  user_id VARCHAR(24) NOT NULL,
  created_at BIGINT NOT NULL,

  INDEX idx_skill (skill_id),
  INDEX idx_user (user_id),
  UNIQUE KEY uk_skill_user (skill_id, user_id)
);
```

#### 3.2.8 评论表 (comments)

```sql
CREATE TABLE comments (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL,
  user_id VARCHAR(24) NOT NULL,
  body TEXT NOT NULL,
  report_count INT DEFAULT 0,
  last_reported_at BIGINT,
  scam_scan_verdict ENUM('not_scam', 'likely_scam', 'certain_scam'),
  scam_scan_confidence ENUM('low', 'medium', 'high'),
  scam_scan_explanation TEXT,
  scam_scan_evidence JSON,
  scam_scan_model VARCHAR(100),
  scam_scan_checked_at BIGINT,
  scam_ban_triggered_at BIGINT,
  created_at BIGINT NOT NULL,
  soft_deleted_at BIGINT,
  deleted_by VARCHAR(24),

  INDEX idx_skill (skill_id),
  INDEX idx_user (user_id),
  INDEX idx_scam_scan_checked (scam_scan_checked_at)
);
```

#### 3.2.9 搜索摘要表 (skill_search_digest)

```sql
CREATE TABLE skill_search_digest (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL UNIQUE,
  slug VARCHAR(255) NOT NULL,
  normalized_slug VARCHAR(255),
  normalized_slug_first_token VARCHAR(100),
  display_name VARCHAR(255) NOT NULL,
  normalized_display_name VARCHAR(255),
  normalized_display_name_first_token VARCHAR(100),
  summary TEXT,
  icon VARCHAR(500),
  owner_user_id VARCHAR(24) NOT NULL,
  owner_publisher_id VARCHAR(24),
  owner_handle VARCHAR(50),
  owner_kind ENUM('user', 'org'),
  owner_name VARCHAR(255),
  owner_display_name VARCHAR(255),
  owner_image VARCHAR(500),
  canonical_skill_id VARCHAR(24),
  fork_of JSON,
  latest_version_id VARCHAR(24),
  latest_version_skill_id VARCHAR(24),
  install_kind ENUM('github'),
  github_has_skill_card BOOLEAN,
  github_current_status ENUM('present', 'missing', 'unknown'),
  github_scan_status ENUM('clean', 'suspicious', 'malicious', 'pending', 'failed'),
  latest_version_summary JSON,
  tags JSON,
  capability_tags JSON,
  badges JSON,
  stats JSON,
  stats_downloads BIGINT DEFAULT 0,
  stats_stars BIGINT DEFAULT 0,
  stats_installs_current BIGINT DEFAULT 0,
  stats_installs_all_time BIGINT DEFAULT 0,
  soft_deleted_at BIGINT,
  moderation_status ENUM('active', 'hidden', 'removed'),
  moderation_flags JSON,
  moderation_reason VARCHAR(255),
  is_suspicious BOOLEAN,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_skill (skill_id),
  INDEX idx_active_updated (soft_deleted_at, updated_at),
  INDEX idx_active_normalized_slug (soft_deleted_at, normalized_slug),
  INDEX idx_active_normalized_display_name (soft_deleted_at, normalized_display_name),
  INDEX idx_active_stats_downloads (soft_deleted_at, stats_downloads, updated_at),
  FULLTEXT INDEX ft_name_display (display_name, normalized_display_name),
  FULLTEXT INDEX ft_slug (slug, normalized_slug),
  FULLTEXT INDEX ft_summary (summary)
);
```

#### 3.2.10 统计事件表 (skill_stat_events)

```sql
CREATE TABLE skill_stat_events (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL,
  kind ENUM('download', 'star', 'unstar', 'comment', 'uncomment',
            'install_new', 'install_reactivate', 'install_deactivate', 'install_clear') NOT NULL,
  delta JSON,  -- {allTime, current}
  occurred_at BIGINT NOT NULL,
  processed_at BIGINT,

  INDEX idx_unprocessed (processed_at),
  INDEX idx_skill (skill_id),
  INDEX idx_occurred_at (occurred_at)
) PARTITION BY RANGE (occurred_at DIV 86400000 * 86400000) (
  PARTITION p_default VALUES LESS THAN MAXVALUE
);
```

#### 3.2.11 其他表

```sql
-- 发布者成员关系
CREATE TABLE publisher_members (
  id VARCHAR(24) PRIMARY KEY,
  publisher_id VARCHAR(24) NOT NULL,
  user_id VARCHAR(24) NOT NULL,
  role ENUM('owner', 'admin', 'publisher') NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_publisher (publisher_id),
  INDEX idx_user (user_id),
  UNIQUE KEY uk_publisher_user (publisher_id, user_id)
);

-- 举报表
CREATE TABLE skill_reports (
  id VARCHAR(24) PRIMARY KEY,
  skill_id VARCHAR(24) NOT NULL,
  skill_version_id VARCHAR(24),
  version VARCHAR(50),
  user_id VARCHAR(24) NOT NULL,
  reason TEXT,
  status ENUM('open', 'confirmed', 'dismissed', 'triaged'),
  triaged_at BIGINT,
  triaged_by VARCHAR(24),
  triage_note TEXT,
  action_taken ENUM('none', 'hide'),
  created_at BIGINT NOT NULL,

  INDEX idx_skill (skill_id),
  INDEX idx_status_created (status, created_at),
  INDEX idx_user (user_id)
);

-- 灵魂表
CREATE TABLE souls (
  id VARCHAR(24) PRIMARY KEY,
  slug VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  summary TEXT,
  owner_user_id VARCHAR(24) NOT NULL,
  owner_publisher_id VARCHAR(24),
  latest_version_id VARCHAR(24),
  tags JSON,
  soft_deleted_at BIGINT,
  stats JSON,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  INDEX idx_slug (slug),
  INDEX idx_owner (owner_user_id),
  INDEX idx_owner_publisher (owner_publisher_id)
);

-- 灵魂版本表
CREATE TABLE soul_versions (
  id VARCHAR(24) PRIMARY KEY,
  soul_id VARCHAR(24) NOT NULL,
  version VARCHAR(50) NOT NULL,
  fingerprint VARCHAR(100),
  changelog TEXT,
  changelog_source ENUM('auto', 'user'),
  files JSON,
  parsed JSON,
  created_by VARCHAR(24),
  created_at BIGINT NOT NULL,
  soft_deleted_at BIGINT,

  INDEX idx_soul (soul_id),
  UNIQUE KEY uk_soul_version (soul_id, version)
);

-- API Tokens
CREATE TABLE api_tokens (
  id VARCHAR(24) PRIMARY KEY,
  user_id VARCHAR(24) NOT NULL,
  label VARCHAR(255) NOT NULL,
  prefix VARCHAR(20) NOT NULL,
  token_hash VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT,

  INDEX idx_user (user_id),
  INDEX idx_hash (token_hash)
);

-- 审计日志
CREATE TABLE audit_logs (
  id VARCHAR(24) PRIMARY KEY,
  actor_user_id VARCHAR(24),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  metadata JSON,
  created_at BIGINT NOT NULL,

  INDEX idx_actor (actor_user_id),
  INDEX idx_target (target_type, target_id)
);

-- 预订的 Slugs
CREATE TABLE reserved_slugs (
  id VARCHAR(24) PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  original_owner_user_id VARCHAR(24) NOT NULL,
  deleted_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  reason TEXT,
  released_at BIGINT,

  INDEX idx_slug (slug),
  INDEX idx_expiry (expires_at)
);
```

---

## 4. 技术栈选择

### 4.1 后端技术栈

| 组件 | 选择 | 原因 |
|------|------|------|
| **后端框架** | Node.js + Express 或 Fastify | 与前端 TypeScript 统一语言 |
| **ORM** | Prisma 或 Drizzle | 类型安全，与 TypeScript 集成好 |
| **数据库** | MySQL 8.0+ | 用户已有，使用 InnoDB 引擎 |
| **搜索** | MySQL FULLTEXT + Meilisearch | 向量搜索用 Meilisearch 替代 |
| **文件存储** | 本地 MinIO 或 OSS | 替代 Convex Storage |
| **实时推送** | Socket.io 或 SSE | 替代 Convex 实时订阅 |
| **认证** | 保留 GitHub OAuth + 考虑国内方案 | 关键决策点 |

### 4.2 迁移后架构

```
┌─────────────────────────────────────────────────────────────┐
│                      用户浏览器                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────┐
│                    Nginx (反向代理)                          │
│                    iclawstore.com                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  Node.js 后端 (Fastify)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  REST API   │  │  WebSocket  │  │  文件服务   │          │
│  │  /api/v1/* │  │  /ws        │  │  /files/*  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
┌─────────▼────┐  ┌────────▼────┐  ┌──────▼──────┐
│   MySQL 8.0  │  │ Meilisearch │  │   MinIO     │
│   (数据)     │  │  (搜索)     │  │  (文件)     │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## 5. 迁移阶段计划

### 阶段 1: 准备阶段 (1-2 周)

#### 1.1 环境搭建
- [ ] 在宝塔安装 Node.js 18+
- [ ] 配置 MySQL 数据库
- [ ] 部署 MinIO 文件存储
- [ ] 部署 Meilisearch 搜索服务

#### 1.2 数据导出准备
- [ ] 创建 Convex 数据导出脚本
- [ ] 导出所有表数据为 JSON
- [ ] 导出文件存储内容
- [ ] 验证导出完整性

### 阶段 2: 后端开发 (3-4 周)

#### 2.1 数据库迁移
- [ ] 创建 MySQL schema
- [ ] 编写数据转换脚本
- [ ] 执行数据迁移
- [ ] 验证数据完整性

#### 2.2 API 开发
- [ ] 搭建 Fastify 项目
- [ ] 实现用户认证 API
- [ ] 实现技能 CRUD API
- [ ] 实现插件 CRUD API
- [ ] 实现搜索 API
- [ ] 实现文件上传/下载 API

#### 2.3 搜索服务
- [ ] 配置 Meilisearch
- [ ] 导入技能/插件索引
- [ ] 实现向量搜索替代

### 阶段 3: 前端适配 (2-3 周)

#### 3.1 API 层重构
- [ ] 替换 Convex query/mutation 为 REST API 调用
- [ ] 实现认证状态管理
- [ ] 实现文件上传组件

#### 3.2 功能适配
- [ ] 适配搜索组件
- [ ] 适配实时更新（WebSocket）
- [ ] 测试所有页面功能

### 阶段 4: 测试与部署 (1-2 周)

#### 4.1 测试
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能测试
- [ ] 安全测试

#### 4.2 部署
- [ ] 生产环境部署
- [ ] DNS 切换
- [ ] 监控配置
- [ ] 回滚方案

---

## 6. 关键决策点

### 6.1 认证系统

| 方案 | 实现 | 工作量 |
|------|------|--------|
| **A. 保留 GitHub OAuth** | 继续使用 @convex-dev/auth 的 GitHub 方案 | 中 |
| **B. 改用手机号/微信** | 实现国内 OAuth + 短信验证 | 高 |
| **C. 两者并存** | GitHub OAuth + 手机号/微信登录 | 很高 |

**建议**: 方案 A（保留 GitHub OAuth），后续迭代添加国内登录

### 6.2 ID 格式

| 方案 | 格式 | 兼容性 |
|------|------|--------|
| **A. 保留 Convex ID** | `a1b2c3d4e5f6g7h8i9j0k1l2` | 好 |
| **B. UUID** | `550e8400-e29b-41d4-a716-446655440000` | 一般 |
| **C. 自增 ID** | `1, 2, 3, ...` | 需要映射 |

**建议**: 方案 A（保留 Convex ID 格式，避免前端代码大幅修改）

### 6.3 搜索方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. MySQL FULLTEXT** | 简单，兼容性好 | 不支持向量搜索 |
| **B. Meilisearch** | 速度快，功能全 | 需要额外服务 |
| **C. Elasticsearch** | 功能最强 | 资源占用高 |

**建议**: 方案 B（Meilisearch），性价比最高

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 数据丢失 | 🔴 高 | 完整备份，迁移验证脚本 |
| 向量搜索丢失 | 🟡 中 | 使用 Meilisearch 替代，功能近似 |
| 实时订阅失效 | 🟡 中 | WebSocket 实现，使用 Socket.io |
| 性能下降 | 🟡 中 | 数据库索引优化，缓存层 |
| 认证中断 | 🔴 高 | 并行运行认证，逐步切换 |

---

## 8. 资源估算

| 资源 | 当前 | 迁移后需求 |
|------|------|-----------|
| **CPU** | Convex 托管 | 4+ 核 |
| **内存** | Convex 托管 | 8GB+ |
| **磁盘** | Convex 存储 | 100GB+ (MinIO) |
| **MySQL** | 现有 | 50GB+ |
| **Meilisearch** | 无 | 4GB+ |

---

## 9. 下一步行动

1. **确认迁移方案**: 用户选择认证方案和 ID 格式
2. **环境准备**: 搭建开发/测试环境
3. **数据导出**: 从 Convex 导出数据
4. **Schema 创建**: 在 MySQL 创建表结构
5. **后端开发**: 开始 API 开发
6. **前端适配**: 逐步替换 Convex 调用

---

## 附录

### A. Convex → MySQL 类型映射

| Convex 类型 | MySQL 类型 |
|-------------|------------|
| `v.string()` | `VARCHAR(255)` / `TEXT` |
| `v.number()` | `BIGINT` / `DOUBLE` |
| `v.boolean()` | `BOOLEAN` |
| `v.id("table")` | `VARCHAR(24)` |
| `v.optional(...)` | nullable |
| `v.array(...)` | `JSON` |
| `v.record(...)` | `JSON` |
| `v.union(...)` | `ENUM` / `JSON` |
| `v.literal(...)` | `ENUM` |

### B. Convex Storage 迁移

Convex 的 `_storage` 表存储文件，需要：
1. 列出所有 storage IDs
2. 下载文件内容
3. 上传到 MinIO
4. 更新文件引用
