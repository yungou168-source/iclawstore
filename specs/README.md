# Specs

`specs/` holds maintainer-only or non-navigated records that should not publish
to the public ClawHub docs tab by default.

Use this folder for:

- Product and implementation specs.
- Forward-looking plans and migration notes.
- Regression notes and design history.
- Maintainer validation or CI policy records.
- Cross-repo extraction notes that reviewers need but users do not.

Public/user/operator docs belong in `docs/`. If a spec graduates into something
users should read on `docs.openclaw.ai`, move or summarize the public material
into `docs/` and leave only the design record here.

## Index

- `spec.md`: product + implementation spec for the original registry model.
- `ai-direct-desktop-platform-integration.md`: authoritative server-side alignment with the latest desktop product contracts, including contract layers, data ownership, implementation gaps, state machines, feature flags, and backend priorities.
- `ai-direct-identity-bridge.md`: production Convex identity bridge, login provider, Bearer session verification, and fail-closed constraints.
- `ai-direct-admin-capability-gaps.md`: ordered AI直聘 administration capability gap register, distinguishing code completion, validation, migration, runtime wiring, and production acceptance.
- `ai-direct-web-server-roadmap.md`: executable P1/P2 Web and server work packages for organization/company management, Agent publication and catalog, non-payment hiring, interviews, runtime, appearance, template review, and central audit.
- `ai-direct-hiring-progress.md`: production release evidence and current AI Direct Hiring delivery status.
- `wallet-ledger.md`: AI 员工免费/付费出售事实、平台与开发者收入明细、钱包资金边界及退款补偿不变量。
- `ai-work-site-navigation.md`: AI直聘 Web 首页、员工目录、客户端下载页的路由职责、导航约束和静态岗位目录边界。
- `user-center-public-profile-and-friendly-links.md`: 用户中心入口、公开资料隐私边界、登录前后目录一致性、友情链接权限与迁移发布顺序。
- `ai-direct-provider-runtime.md`: Jinsha credential, Provider Executor, cost, retry, and production safety boundary.
- `ai-direct-agent-appearance.md`: Agent avatar, 2D/3D showcase, and employment-driven appearance control contract.
- `desktop-sidebar-local-html-templates.md`: desktop sidebar customization and account sync, local-only HTML template data, Markdown portability, and template marketplace contract.
- `orgs.md`: org, publisher membership, and scoped identity plan.
- `github-import.md`: GitHub import feature spec.
- `github-backed-skills.md`: source-backed GitHub skills catalog and install invariants.
- `diffing.md`: skill version diffing UI/API design.
- `slug-routing.md`: internal web route precedence and plugin alias contract.
- `ci.md`: PR check and production deploy audit-tag policy.
- `manual-testing.md`: maintainer CLI smoke checklist.
- `dev-worktrees.md`: disposable Worktrunk/Codex worktree lifecycle contract.
- `dev-seeding.md`: local development fixture seeding ownership rules.
- `mintlify.md`: docs publishing setup notes.
- `openclaw-docs-extraction.md`: CLAW-89 extraction classification.
- `deploy.md`: maintainer deploy checklist for the ClawHub project.
- `convex-exit-migration.md`: 渐进移除 Convex 的目标架构、单写权威、数据/文件/认证迁移阶段、切流门禁与回滚约束。
- `security-moderation.md`: detailed moderation implementation and scanner behavior notes.
- `webhook.md`: removal decision and invariants for the retired Discord webhook integration.
- `plans/plugins.md`: long-term OpenClaw plugin hosting plan.
- `regression-notes/`: regression guard notes.
- `superpowers/`: install-surface design history.
