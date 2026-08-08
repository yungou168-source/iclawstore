---
summary: "Maintainer deploy checklist: self-hosted SSR, Convex backend, CLI npm release, and /api rewrites."
---

# Deploy

This is a maintainer runbook for the ClawHub project. It is intentionally kept
under `specs/` so it does not publish into the user-facing ClawHub docs tab.

ClawHub is two deployables:

- Web app (TanStack Start SSR) -> the iClawStore production server.
- Convex backend -> Convex deployment (serves `/api/...` routes).

## iClawStore self-hosted SSR release

`www.iclawstore.com` runs the TanStack Start SSR bundle locally through the
systemd unit `iclawstore.service`, listening on `127.0.0.1:3000`; Nginx proxies
public HTTP(S) traffic to it. The Fastify API (`iclawstore-api`) and Nginx do
not need a restart for web-only changes.

### GitHub Actions production-server boundary

A manual `Deploy` workflow release is live only after the self-hosted SSR
release completes and its public smoke tests pass. `full` deploys Convex and
then the SSR server; `frontend` deploys only the SSR server; `backend` never
connects to the production server.

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
The forced command accepts only `deploy <40-character-commit-sha> <artifact-sha256> <artifact-size>`. GitHub Actions builds the SSR artifact on its isolated runner, streams it over the forced-command SSH connection, and the server verifies the SHA-256 digest, declared byte size, and that the requested commit is reachable from `origin/main`. It extracts only a valid Nitro output into a staging directory, switches `.output` atomically, restarts only `iclawstore.service`, and rolls back the output pointer when restart or local smoke verification fails. The server never runs dependency installation or application builds during a release.

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

Before enabling a manual `frontend` or `full` Deploy run, verify the repository
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
`https://www.iclawstore.com`; Nginx must redirect `https://iclawstore.com` to
that origin before any login starts. OAuth state cookies are host-only, so a
mixed `www`/bare-domain login flow loses the verifier and must not be supported.

Convex's management API runs on `127.0.0.1:3210`, while its HTTP site routes
run on `127.0.0.1:3211`. Nginx must send normal Convex client traffic under
`/convex/` to `3210`, but route `/convex/api/auth/` to `3211` first. The latter
is required for OAuth callbacks and must preserve the internal
`/api/auth/…` path.

Set these values in the Convex deployment, then deploy functions with strict
TypeScript checking:

```text
SITE_URL=https://www.iclawstore.com
CUSTOM_AUTH_SITE_URL=https://www.iclawstore.com/convex
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
4-digit OTP that expires after 2 minutes and is verified inside the login dialog; it must not
fall back to a magic-link-only flow. `CUSTOM_AUTH_SITE_URL` is the externally reachable
Convex HTTP site URL. Do not substitute `RESEND_API_KEY` for
`AUTH_RESEND_KEY`; they serve different paths.

The OAuth callback URLs must be exactly:

```text
https://www.iclawstore.com/convex/api/auth/callback/github
https://www.iclawstore.com/convex/api/auth/callback/google
https://www.iclawstore.com/convex/api/auth/callback/wechat
```

After any environment change, run `bunx convex dev --once` against the local
management address. Do not disable type checking. Verify the public route
returns an authentication-handler response rather than a proxy `404` before
performing a browser login.

A source edit is **not** live until both stages below complete. The running
Node process loads `.output/server/index.mjs` at start-up and does not watch or
hot-reload that file.

### Low-memory release design

Production SSR builds run on the GitHub Actions runner, not on the self-hosted server. This keeps the live service and deployment reliability independent of transient server memory, Cursor sessions, or local background work. The server receives only a bounded, checksummed release archive and needs disk space only for the current, previous, and staged outputs.

The deployment script serializes archive reception with its lock, rejects archives larger than 1 GiB, verifies the requested commit remains reachable from `origin/main`, verifies the exact archive size and SHA-256 digest, and requires `server/index.mjs` after extraction. It does not run `bun install`, `vite`, `tsc`, or `bun run build`; a low-memory server therefore cannot make the build nondeterministically fail.

The archive is extracted into a new staging directory. Only after all integrity checks pass does the script rename it into a timestamped release and atomically replace the `.output` symlink. If service restart or the localhost `/plugins` health check fails, it restores the prior symlink and restarts that known-good release. Source files are never reset or mutated by a release.

To investigate a release failure, inspect the runner build logs, archive transfer/checksum error, or post-switch health check separately. Do not lower a memory threshold or terminate the live SSR process as a workaround; resource-intensive compilation belongs on the runner.

## 1) Deploy Convex

From your local machine:

```bash
bunx convex env set APP_BUILD_SHA "$(git rev-parse HEAD)" --prod
bunx convex env set APP_DEPLOYED_AT "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --prod
bunx convex deploy
```

Or use the GitHub Actions pipeline:

```bash
gh workflow run deploy.yml \
  --repo yungou168-source/iclawstore \
  --ref main \
  -f target=full
```

The workflow uses the npm registry directly, installs with a bounded download
concurrency and retries failed dependency downloads. It builds
`packages/schema` before Convex deployment because Convex imports its generated
dist artifact. The Convex step always uses strict type checking; do not replace
it with `--typecheck=disable`.

Production deploy notes:

- `deploy.yml` is manual-only (`workflow_dispatch`). Merging to `main` does not deploy.
- The workflow must be started from `main`.
- Deploy targets:
  - `full`: deploy Convex, verify its contract, deploy the selected `main` SHA to the self-hosted SSR server, then run smoke tests
  - `backend`: deploy Convex, verify its contract, then run smoke tests against the current SSR release without connecting to the production server
  - `frontend`: deploy the selected `main` SHA to the self-hosted SSR server, then run smoke tests
- For `full` and `frontend`, the workflow connects only through the forced-command SSH key described above; it never receives an interactive shell or unrestricted `sudo`.
- The real deploy job uses the GitHub `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required `Production` environment secret for backend deploys: `CONVEX_DEPLOY_KEY`, created from the **Production** Convex deployment settings. A development or preview key deploys to the wrong environment and cannot be converted by the CLI.
- Required `Production` environment secrets for SSR deploys: `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_PORT`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_PRIVATE_KEY`, and `PRODUCTION_SSH_KNOWN_HOSTS`.
- Optional `Production` environment secret: `PLAYWRIGHT_AUTH_STORAGE_STATE_JSON` for authenticated smoke coverage.
- Convex application variables such as `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, and `CUSTOM_AUTH_SITE_URL` are configured in the Convex Production deployment itself; they are not GitHub Actions secrets.

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
- `CUSTOM_AUTH_SITE_URL` (the externally reachable Convex HTTP URL; self-hosted production uses `https://www.iclawstore.com/convex`)
- `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` for 8-digit email OTP sign-in
- Optional webhook env (see `docs/webhook.md`)
- Recommended GitHub App env for authenticated GitHub API reads used by publish
  gates and backups:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_INSTALLATION_ID`
  - `GITHUB_APP_PRIVATE_KEY`
- Optional fallback: `GITHUB_TOKEN` (used when GitHub App auth is unavailable,
  and for arbitrary public repository lookups such as trusted-publisher setup)

## 2) Deploy web app (self-hosted SSR)

The GitHub Actions `Deploy` workflow builds the selected `main` SHA on its isolated runner, then streams the verified SSR artifact to `/usr/local/sbin/iclawstore-deploy`. The live `.output` symlink changes only after integrity checks, service restart, and local health verification succeed; the forced command restores the previous release if activation fails.

The release order is:

1. Convex deployment and contract verification for `full`.
2. Isolated SSR build on the runner, artifact transfer, atomic activation, service restart, and local health check for `full` and `frontend`.
3. Public HTTP smoke tests, then the cross-browser anonymous AI直聘 UI smoke suite. Authenticated storage state remains optional for any separate authenticated coverage; it is not required by the release gate.

The production process reads these application values from its existing server
environment; the workflow must not transfer them over SSH:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL` (Convex "site" URL)
- `CONVEX_SITE_URL` (same value; used by auth provider config)
- `SITE_URL` (web app URL)
- `VITE_APP_BUILD_SHA` (set to the same commit SHA stamped into Convex)

## 3) Route `/api/*` to Convex

The production Nginx configuration proxies `/api/*` to the configured Convex
HTTP site. Keep that upstream and the registry discovery metadata aligned with
the production Convex deployment.

## 4) Registry discovery

The CLI can discover the API base from:

1. explicit CLI/env override
2. configured registry URL
3. site URL registry metadata

Keep production rewrites and discovery metadata aligned before release.

## 5) Post-deploy checks

Run the contract verifier and smoke tests against production after deploy:

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

The browser suite verifies the anonymous AI直聘 employee-directory flow: directory rendering, search and category filtering, public navigation, desktop-client return navigation, and the desktop continuation link. It intentionally does not assert legacy ClawHub `/upload`, `/import`, `/skills`, or `data-clawhub-hydrated` behavior.
