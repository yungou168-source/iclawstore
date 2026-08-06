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
- `ai-work-site-navigation.md`: AI直聘 Web 首页、员工目录、客户端下载页的路由职责、导航约束和静态岗位目录边界。
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
- `security-moderation.md`: detailed moderation implementation and scanner behavior notes.
- `webhook.md`: Discord webhook environment and payload notes.
- `plans/plugins.md`: long-term OpenClaw plugin hosting plan.
- `regression-notes/`: regression guard notes.
- `superpowers/`: install-surface design history.
