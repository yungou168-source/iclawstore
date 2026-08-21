---
summary: "Maintainer deploy checklist: unified production release, self-hosted Convex, CLI npm release, and API routing."
---

## Current production authorization

Production Freeze解除 and the AI Direct Hiring Runtime release are approved under
`RFC-2026-001` ("解除 Production Freeze 并发布 AI Direct Hiring Runtime").
Approval: 张三 (`@zhangsan`), 2026-03-14 15:30 UTC. Target: `main`, Production,
`https://zhipin.store`. Production secrets are confirmed configured. Rollback is
to restore the previous unified release and recover the SSR/PM2 state.

# Deploy

This is a maintainer runbook for the ClawHub project. It is intentionally kept
under `specs/` so it does not publish into the user-facing ClawHub docs tab.

ClawHub application production activation is authorized under `RFC-2026-001`
for the AI Direct Hiring Runtime release. The release must still pass the unified
Convex, Fastify, PM2 worker, SSR, migration, health, and public smoke gates below.
Existing production processes must not be changed outside that release path.

The RFC supersedes the prior production freeze for this release only. It does not
authorize source destruction, destructive migrations, bypassing release gates, or
unreviewed changes to production routing. Each domain must still be delivered
with target-side reconciliation, candidate-environment network isolation, a
documented observation period, and an approved irreversible source-destruction
record.

For the current authority hierarchy, use [`convex-exit-migration.md`](convex-exit-migration.md) for exit policy, [`convex-exit-domain-ledger.md`](convex-exit-domain-ledger.md) for domain state and deletion gates, and the Profile/Publisher handoff records for candidate-only execution gates. [`server-migration.md`](server-migration.md) is a historical server-relocation and continuity reference; it cannot authorize application migration, reconciliation, read/write cutover, source deletion, or release activation. Candidate variables belong in [`.env.migration.example`](../.env.migration.example); production environment ownership and deployment freeze rules remain in this document.

## Historical unified release design

`www.iclawstore.com` runs the TanStack Start SSR bundle locally through the
systemd unit `iclawstore.service`, listening on `127.0.0.1:3000`; Nginx proxies
public HTTP(S) traffic to it. Fastify listens on `127.0.0.1:3002`, while PM2
runs the API and enabled workers. Even when a change appears web-only, the
automatic release verifies and activates all application components from the
same Git SHA so historical API/Worker releases cannot drift indefinitely.

### Automatic production release boundary

A push or merge to `main` automatically starts the `Deploy` workflow. The release
is live only after self-hosted Convex target verification, unified API/Worker/SSR
activation, and public smoke tests all pass. Every run deploys Convex first, then
ships one checksummed release containing Fastify, enabled workers, Prisma
migrations and SSR from the same Git SHA. Application releases must not use
`workflow_dispatch`, `gh workflow run`, or the Actions UI's `Run workflow`
button.

GitHub Actions is not granted a general-purpose production shell or `sudo`.
The `Production` environment contains only these server-release secrets:

- `PRODUCTION_SSH_HOST` — server address.
- `PRODUCTION_SSH_PORT` — SSH port.
- `PRODUCTION_SSH_USER` — dedicated unprivileged deploy account.
- `PRODUCTION_SSH_PRIVATE_KEY` — private half of a newly created, deployment-only Ed25519 key.
- `PRODUCTION_SSH_KNOWN_HOSTS` — pinned `known_hosts` entry generated from an
  independently verified server host key; never use `ssh-keyscan` during a deploy.

The deploy key belongs only to the dedicated account. Its entry in
`~/.ssh/authorized_keys` must use a forced command and disable forwarding and
PTY allocation:

```text
command="/usr/local/sbin/iclawstore-deploy",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 <github-actions-deploy-public-key>
```

Install the reviewed `ops/iclawstore-deploy` file as
`/usr/local/sbin/iclawstore-deploy`, owned by `root:root` with mode `0755`.
The runner builds one archive containing SSR, `server/dist`, production server dependencies, Prisma schema/migrations, PM2 config, the artifact verifier and the migration executor from the same Git SHA. The server verifies the outer SHA-256 and size, verifies every manifest file and component entrypoint, and requires the commit to be reachable from `origin/main`. It then runs the packaged Prisma status/deploy/status sequence, activates Fastify and enabled workers, requires `/health` to expose the requested build SHA, switches SSR atomically, and records `.release-current`. If process or health verification fails, it restores the saved PM2 dump and prior SSR pointer. The server never installs dependencies or compiles application code during release.

The dedicated account needs write access to the application worktree and this
narrow `sudoers` entry only:

```text
iclawstore-deploy ALL=(root) NOPASSWD: /bin/systemctl restart iclawstore.service, /bin/systemctl is-active --quiet iclawstore.service
```

Use the actual `systemctl` path from `command -v systemctl`. The server must
hold a repository deploy key at `~/.ssh/id_ed25519_iclawstore`, with its GitHub
host key pinned in `~/.ssh/known_hosts`; the release script explicitly uses
this key only for `git fetch origin main`. This repository key is separate from
the GitHub Actions-to-server key. It needs only repository read access for the
release script, although the current terminal key may also have repository
write access for maintainer pushes. Do not reuse the GitHub Actions key for
repository fetches, interactive administration, or any other host.

Before enabling automatic production releases from `main`, verify the repository
key without exposing its private contents:

```bash
ssh -T -o BatchMode=yes -o IdentitiesOnly=yes \
  -i ~/.ssh/id_ed25519_iclawstore git@github.com
```

GitHub reports successful deploy-key authentication with a non-zero exit code
because it does not provide a shell; treat the authentication message itself as
success. The GitHub Actions SSH secrets and the server-side repository key must
both be configured before a frontend release can succeed.

### Self-hosted Convex Auth

Keep one canonical HTTPS web origin. The production configuration uses
`https://zhipin.store`; Nginx must redirect `https://www.zhipin.store` to
that origin before any login starts. The retired `iclawstore.com` domains do not
redirect to the new site or serve an OAuth flow. OAuth state cookies are host-only,
so a mixed `www`/bare-domain login flow loses the verifier and must not be supported.

The HTTPS bare-domain redirect was verified on 2026-08-09: it returns `301` and
preserves the request path and query string. External probes to both HTTP hosts
on port 80 timed out, so HTTP-to-HTTPS redirect coverage is not currently
verified. If port 80 is exposed, both HTTP hosts must redirect directly to the
canonical HTTPS bare origin; they must never serve the application or begin an
OAuth flow.

Convex's management API runs on `127.0.0.1:3210`, while its HTTP site routes
run on `127.0.0.1:3211`. Nginx must send normal Convex client traffic under
`/convex/` to `3210`, but route `/convex/api/auth/` to `3211` first. The latter
is required for OAuth callbacks and must preserve the internal
`/api/auth/…` path.

Set these values in the Convex deployment, then deploy functions with strict
TypeScript checking:

```text
SITE_URL=https://zhipin.store
CUSTOM_AUTH_SITE_URL=https://zhipin.store/convex
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
AUTH_RESEND_KEY
AUTH_EMAIL_FROM
AUTH_WECHAT_APP_ID
AUTH_WECHAT_APP_SECRET
JWT_PRIVATE_KEY
JWKS
```

`JWT_PRIVATE_KEY` 必须是 PKCS#8 PEM RSA 私钥；`JWKS` 必须是同一密钥对的公钥 JWKS JSON。两项均属于生产机密，只能写入 Convex Production deployment 的环境变量，不得提交、粘贴到 issue 或写入工作区文件。密钥轮换必须同时替换两项，再以严格 typecheck 部署。

`SITE_URL` is the final browser destination for OAuth. Email sign-in sends a
4-digit OTP with a 2-minute lifetime that is verified inside the login dialog;
it must not fall back to a magic-link-only flow. `CUSTOM_AUTH_SITE_URL` is the
externally reachable Convex HTTP site URL. Do not substitute `RESEND_API_KEY`
for `AUTH_RESEND_KEY`; they serve different paths.

The OAuth callback URLs must be exactly:

```text
https://zhipin.store/convex/api/auth/callback/github
https://zhipin.store/convex/api/auth/callback/google
https://zhipin.store/convex/api/auth/callback/wechat
```

After any environment change, run `bunx convex dev --once` against the local
management address. Do not disable type checking. Verify the public route
returns an authentication-handler response rather than a proxy `404` before
performing a browser login.

#### Domain-cutover release gate

Do not restore the automatic production release while any of these checks fail:

- `GET /convex/api/auth/signin/github` must begin the configured provider flow
  without a server error.
- `GET /convex/api/auth/callback/github` must never redirect to an
  `iclawstore.com` host; the final browser destination is `https://zhipin.store`.
- A controlled OAuth or OTP login must return to the bare domain, establish an
  authenticated session, and clear it after sign-out.
- The candidate SSR and browser assets must contain no
  `https://www.iclawstore.com` value.

These are production-configuration gates. Correct them in the Convex deployment,
OAuth provider consoles, mail-provider domain settings, or release environment;
do not suppress them in application code or workflow conditions.

A source edit is **not** live until both stages below complete. The running
Node process loads `.output/server/index.mjs` at start-up and does not watch or
hot-reload that file.

Authentication UI and OTP behavior form one release contract. The 4-digit,
2-minute OTP backend and the matching compact login dialog must be committed,
tested, and released together; publishing only one side breaks email login.
Every workspace navigation variant must also expose the Convex Auth `signOut()`
action. A production recovery build from an older fixed SHA may correctly fix
a missing build variable while still restoring that SHA's older login UI. Before
switching `.output`, compare the selected SHA with the intended authentication
UI and run signed-out login-dialog plus signed-in sign-out browser smoke checks.
Never solve this by building the dirty production worktree.

### Low-memory unified release design

Production builds and production dependency installation run on the GitHub Actions runner, not on the self-hosted server. This keeps live SSR, Fastify and Worker reliability independent of transient server memory, Cursor sessions, or local background work. The server receives one bounded, checksummed release archive containing SSR, `server/dist`, production server dependencies, Prisma schema/migrations, PM2 config and verification scripts. Disk capacity must cover the current release, previous release, and one staging release under `/home/ubuntu/releases/iclawstore`.

The deployment script serializes archive reception with its lock, rejects archives larger than 1 GiB, verifies the requested commit remains reachable from `origin/main`, and verifies the exact archive size and SHA-256 digest. After extraction it rejects unlisted, missing, changed, or unsafe files and symlinks by comparing the full tree with `release-manifest.json`; required SSR, API, Worker, Prisma and PM2 component entrypoints must all be listed. It does not run `bun install`, `npm install`, Vite, TypeScript, or Nitro compilation on the production server.

The archive is extracted into a new staging directory. Before activation, the deployer reads `DATABASE_URL` from the restricted API environment and runs Prisma migration status/deploy/status with the packaged Prisma CLI. It then starts or reloads Fastify and enabled workers from the release, requires the API to be online and `/health.buildSha` to equal the requested SHA, atomically switches `.output` to the release SSR, and records `.release-current`. If process or health verification fails after activation begins, it restores the saved PM2 dump and previous SSR pointer. Already-applied database migrations are not rolled back, so routine migrations must remain expand-compatible. Source files are never reset or mutated by a release.

To investigate a release failure, separate Runner build/dependency failures, archive transfer or manifest failures, migration failures, PM2/API SHA failures, SSR health failures, and public smoke failures. Do not lower a memory threshold or terminate live processes as a workaround; resource-intensive compilation and dependency installation belong on the Runner.

## 1) Deploy Convex

Emergency local recovery for the self-hosted production deployment uses the
local management port and keeps type checking enabled:

```bash
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  bunx convex env set APP_BUILD_SHA "$(git rev-parse HEAD)"
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  bunx convex env set APP_DEPLOYED_AT "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  bunx convex dev --once
```

Production application releases are not started from a maintainer shell or the
Actions UI. Pushing or merging a reviewed commit to `main` automatically starts
`.github/workflows/deploy.yml` for `yungou168-source/iclawstore`.

Do not add `workflow_dispatch` to this workflow, run
`gh workflow run deploy.yml`, or use the Actions UI's `Run workflow` button.
The automatic workflow installs dependencies with bounded concurrency and
retries, builds `packages/schema`, deploys Convex with strict type checking,
verifies the remote contract, builds and deploys the unified Fastify/Worker/SSR
release, and then runs production smoke checks.

Production deploy notes:

- Every `main` update performs one full application release; partial `backend` and `frontend` release modes are intentionally unsupported.
- Routine deployment always disallows deleting large Convex indexes. A destructive index migration requires a separately reviewed maintenance procedure.
- For the server release, the workflow connects only through the forced-command SSH key described above; it never receives an interactive shell or unrestricted `sudo`.
- The real deploy job uses the GitHub `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required `Production` environment secret `CONVEX_SELF_HOSTED_ADMIN_KEY` is the admin key for the self-hosted deployment reached through `https://zhipin.store/convex`. Do not substitute a Convex Cloud deploy key.
- Required `Production` environment secrets for unified releases: `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_PORT`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_PRIVATE_KEY`, and `PRODUCTION_SSH_KNOWN_HOSTS`.
- Optional `Production` environment secret: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON` for authenticated smoke coverage.
- Convex application variables such as `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, and `CUSTOM_AUTH_SITE_URL` are configured in the Convex Production deployment itself; they are not GitHub Actions secrets.

### Convex production target consistency

Production Convex is the self-hosted runtime behind `https://zhipin.store/convex` (historical deployment identifier `cheerful-schnauzer-269`). `dutiful-seal-277` is a Convex Cloud deployment that was accidentally selected by the former `CONVEX_DEPLOY_KEY`; it did not contain the production users and was never the active `/convex` upstream.

The workflow now provides `CONVEX_SELF_HOSTED_URL=https://zhipin.store/convex` with `CONVEX_SELF_HOSTED_ADMIN_KEY`, pushes once with `convex dev --once`, verifies the complete function spec against that same endpoint, and then queries `appMeta:getDeploymentInfo` through the public `/convex` boundary. The release fails unless `appBuildSha` exactly equals `GITHUB_SHA`; contract verification against a different deployment can no longer satisfy the gate.

For local type generation, public/browser configuration remains `CONVEX_SELF_HOSTED_URL=https://zhipin.store/convex`; the retired `www.iclawstore.com` host must never be used. The current Nginx `/convex` proxy does not expose the CLI management path `/api/get_config_hashes`, so `bunx convex codegen` must instead run on the server with the explicit management override `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210`. Convex CLI reports an `Uploading functions to Convex` preparation step during generation, so treat this as a production-management operation: run it only under the applicable release/freeze approval, and never mistake successful binding generation for authorization of a Profile read cutover. Do not hand-edit `convex/_generated` after a failed generation.

The mismatch was repaired on 2026-08-11 by pushing the missing functions through `127.0.0.1:3210` into the active self-hosted deployment. Evidence after repair:

- `users:getPublicProfileBySlug({ slug: "ceo" })` returned the existing production `ceo` profile;
- `https://zhipin.store/profile/ceo` returned HTTP 200;
- the production function contract matched 638 identifiers.

Do not redirect `/convex` to `dutiful-seal-277` or copy production traffic to it. Remove the obsolete cloud deploy key after confirming no other workflow uses it.

## CLI npm release

The `clawhub` CLI package is released separately from the app deploy.
Only stable releases are supported here: `vX.Y.Z`.

Use the GitHub Actions workflow:

```bash
gh workflow run clawhub-cli-npm-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.11.0 \
  -f preflight_only=true
```

Then rerun the same workflow from `main` with:

- the same `tag`
- `preflight_only=false`
- `preflight_run_id=<successful preflight run id>`

CLI release notes:

- Real publishes are manual-only and require the workflow to be started from `main`.
- The publish job waits at the GitHub `npm-release` environment for approval.
- npm auth is handled through npm trusted publishing, not an `NPM_TOKEN`.
- npm trusted publisher must be configured for package `clawhub` with repository `openclaw/clawhub`, workflow `clawhub-cli-npm-release.yml`, and environment `npm-release`.
- After a successful npm publish, the workflow creates or updates the matching GitHub Release from the `CHANGELOG.md` section and appends npm tarball/integrity proof.

If npm publish succeeds but GitHub Release creation needs repair, rerun the
GitHub Release workflow without publishing to npm again:

```bash
gh workflow run clawhub-cli-github-release.yml \
  --repo openclaw/clawhub \
  --ref main \
  -f tag=v0.11.0 \
  -f preflight_run_id=<successful preflight run id> \
  -f update_existing=false
```

If the original publish workflow failed after npm publish while creating the
GitHub Release, omit `publish_run_id`; the repair workflow accepts only
successful proof run ids.

Use `update_existing=true` only when intentionally replacing the body for an
existing GitHub Release.

That workflow assumes Vercel Git integration is enabled for this repo. It does
not run `vercel deploy` directly; frontend-related steps wait for the GitHub
commit status `Vercel - clawhub` for the selected SHA, then run smoke tests
against production.

Ensure Convex env is set (auth + embeddings):

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `CONVEX_SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- `OPENAI_API_KEY`
- `RESEND_API_KEY` for account-ban notification email
- `CLAWHUB_SECURITY_EMAIL` for account-action replies, defaulting to
  `security@notifications.openclaw.ai`
- `CLAWHUB_SECURITY_EMAIL_FROM` for the outbound From header, defaulting to
  `ClawHub Security <noreply@notifications.openclaw.ai>` on the verified Resend
  domain
- `SITE_URL` (your canonical web app URL)
- `CUSTOM_AUTH_SITE_URL` (the externally reachable Convex HTTP URL; self-hosted production uses `https://zhipin.store/convex`)
- `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` for 4-digit, 2-minute email OTP sign-in.
  `AUTH_EMAIL_FROM` defaults to `AI直聘 <no-reply@iclawstore.com>` and may override
  only the sender; the subject, HTML, and plain-text body remain branded as
  `AI直聘`. After a Convex production deploy, send one code to a controlled inbox
  and verify the visible From name, subject, body, 4-digit format, and expiry.
  Do not record the code or recipient address in release logs.
- Discord webhook support has been removed. Do not add `DISCORD_WEBHOOK_*`
  variables to Convex or application environments; see `specs/webhook.md`.
- Recommended GitHub App env for authenticated GitHub API reads used by publish
  gates and backups:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_INSTALLATION_ID`
  - `GITHUB_APP_PRIVATE_KEY`
- Optional fallback: `GITHUB_TOKEN` (used when GitHub App auth is unavailable,
  and for arbitrary public repository lookups such as trusted-publisher setup)

## 2) Deploy MySQL-backed API changes

MySQL-backed API changes are part of the same unified release. The Runner packages the reviewed Prisma schema/migrations and production Prisma CLI; `/usr/local/sbin/iclawstore-deploy` reads `DATABASE_URL` from the existing restricted API environment and executes status/deploy/status before changing any process pointer. It never prints or transfers the credential.

The required release order is:

1. Verify outer archive and every manifest record.
2. Confirm the target database and apply only reviewed expand-compatible migrations.
3. Activate Fastify and enabled workers, then require `/health.buildSha` to equal the release SHA.
4. Switch SSR and verify `iclawstore.service` locally.
5. Run public anonymous, authenticated and CLI smoke checks.

Do not mark the release complete when `DATABASE_URL` is absent, migration status cannot be read, a PM2 process is offline, or any component reports a different SHA. Destructive/contract migrations require a separate maintenance procedure and cannot rely on automatic rollback.

## 3) Deploy unified application release

The GitHub Actions `Deploy` workflow builds the selected `main` SHA on its isolated Runner, then streams the verified unified artifact to `/usr/local/sbin/iclawstore-deploy`. `.release-current`, PM2 entrypoints and `.output` converge on one timestamped release directory. Activation happens only after manifest and migration checks; failed process or health verification restores the previous PM2 dump and SSR pointer.

The release order is:

1. Self-hosted Convex push, full contract verification and public `appBuildSha` verification.
2. Fastify/Worker build, SSR build, production dependency install and release manifest generation on the Runner.
3. Server-side archive/manifest verification, Prisma migration, PM2 activation, API SHA check, SSR activation and local health check.
4. Public HTTP smoke tests, then the cross-browser anonymous AI直聘 UI smoke suite. Authenticated storage state remains optional for separate authenticated coverage.

The SSR build embeds these public values on the Runner before the unified archive is created; they are not read from the server's restricted runtime environment and are not secrets:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `VITE_SITE_URL`
- `VITE_AI_WORK_SITE_URL`
- `VITE_APP_BUILD_SHA` (set to the same commit SHA stamped into Convex and Fastify)

Fastify and Workers load private runtime values from `/home/ubuntu/.config/iclawstore/*.env` through the packaged PM2 config. The workflow must not transfer `DATABASE_URL`, JWT secrets, provider credentials, or Worker secrets over SSH; only the release archive and forced-command arguments cross that boundary.

## 4) Historical Profile MySQL read-cutover procedure

> **冻结**：本节仅保留历史设计。发布冻结期间禁止应用 Profile migration、运行 backfill、改变 `PROFILE_READ_MODE` 或 PM2 reload。只有整卷归档与隔离恢复演练通过、发布冻结被明确解除，并且 Profile 作为独立整体迁移切片重新获批后，才能重写并执行本节的步骤。

## 5) Keep Convex-owned `/api/*` routes aligned

Some registry and authentication-compatible `/api/*` paths are still served by the self-hosted Convex HTTP site during the exit migration, while Fastify owns its separately routed API surface. Do not treat `/api/*` as one interchangeable upstream. Keep Nginx ownership, registry discovery metadata, and the active production implementation aligned for each route family; moving a route from Convex to Fastify requires an explicit contract-preserving cutover.

## 5) Registry discovery

The CLI can discover the API base from:

1. explicit CLI/env override
2. configured registry URL
3. site URL registry metadata

Keep production rewrites and discovery metadata aligned before release.

## 6) Post-deploy checks

Production application releases use `bun run verify:convex-contract` inside the workflow with the self-hosted URL and admin key already selected, then independently verify the public `/convex` build SHA. For an explicit post-deploy maintainer check, target the same self-hosted production deployment; do not fall back to a Convex Cloud `--prod` target.

Run the remaining smoke tests against production after deploy:

```bash
CLAWHUB_E2E_SITE=https://zhipin.store \
DESKTOP_API_BASE_URL=https://zhipin.store \
bun run test:e2e:prod-http
PLAYWRIGHT_BASE_URL=https://zhipin.store \
bunx playwright test --workers=1 \
  e2e/menu-smoke.pw.test.ts \
  e2e/publish-entry-workflows.pw.test.ts \
  e2e/upload-auth-smoke.pw.test.ts
```

The browser suite verifies the anonymous AI直聘 employee-directory flow: directory rendering, search and category filtering, public navigation, desktop-client return navigation, and the desktop continuation link. It intentionally does not assert legacy ClawHub `/upload`, `/import`, `/skills`, or `data-clawhub-hydrated` behavior.
