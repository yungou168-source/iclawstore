---
summary: "Maintainer deploy checklist: Convex backend, Vercel web app, CLI npm release, and /api rewrites."
---

# Deploy

This is a maintainer runbook for the ClawHub project. It is intentionally kept
under `specs/` so it does not publish into the user-facing ClawHub docs tab.

ClawHub is two deployables:

- Web app (TanStack Start) -> typically Vercel.
- Convex backend -> Convex deployment (serves `/api/...` routes).

## iClawStore self-hosted SSR release

`www.iclawstore.com` runs the TanStack Start SSR bundle locally through the
systemd unit `iclawstore.service`, listening on `127.0.0.1:3000`; Nginx proxies
public HTTP(S) traffic to it. The Fastify API (`iclawstore-api`) and Nginx do
not need a restart for web-only changes.

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

`SITE_URL` is the final browser destination for OAuth. Email sign-in sends an
8-digit OTP that is verified inside the login dialog; it must not fall back to
a magic-link-only flow. `CUSTOM_AUTH_SITE_URL` is the externally reachable
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

### Low-memory release guard

Builds on the self-hosted server must be serialized. Before starting, confirm
that no `vite build`, `bun run build`, `tsc`, or package-install process is
already running and that at least 2 GiB of memory is available. Do not run the
full CI matrix, Convex deployment, dependency installation, and frontend build
in parallel on this host.

Run focused tests first, let them exit, and only then start one `bun --smol`
build. If available memory falls below 512 MiB, swap begins growing quickly, or
the kernel reports an OOM kill, stop the build and investigate instead of
starting a second attempt.

A failed Vite/Nitro build may leave `.output/` present but without
`.output/server/index.mjs`. Preserve the last known-good output under a
separate, timestamped path before building. Never restart the service merely
because the build command exited: first require the new entry file to exist. If
it does not, isolate the incomplete directory, restore `.output` from the
known-good copy, and keep serving that prior release. This recovery is a
runtime artifact rollback; it must not revert source files or unrelated working
copy changes.

```bash
cd /www/wwwroot/iclawstore.com
pgrep -af 'vite build|bun run build|tsc|bun install'
awk '/MemAvailable/ { printf "MemAvailable: %.1f GiB\n", $2 / 1024 / 1024 }' /proc/meminfo
release_dir=".output.release-$(date +%Y%m%d-%H%M%S)"
NITRO_OUTPUT_DIR="$release_dir" bun --smol run build
test -f "$release_dir/server/index.mjs"
ln -s "$release_dir" .output.next
mv -Tf .output.next .output
sudo systemctl restart iclawstore.service
sudo systemctl is-active iclawstore.service
curl --fail --silent --show-error https://www.iclawstore.com/ > /dev/null
```

`NITRO_OUTPUT_DIR` applies to both the Nitro build and the required OG runtime
asset copy, so a release build never writes through the live `.output` symlink.
Record the previous `.output` target before the atomic link replacement. If the
new entry check, restart, or smoke check fails, atomically restore that target
and restart the service; retain both outputs until the new release is verified.

An empty `pgrep` result is expected. If it reports another build or install,
wait for that process to finish rather than running concurrently. If the entry
file check fails, do not restart; keep the last known-good output linked and
verify that the existing service remains healthy.

For homepage navigation or authentication UI changes, verify the public HTML
includes the expected labels before handoff. The unauthenticated homepage must
render a visible `登录` / `Sign in` trigger even while Convex Auth is resolving;
do not replace it with a blank loading placeholder.

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
  - `full`: deploy Convex, verify contract, wait for the matching Vercel production deploy, then run smoke tests
  - `backend`: deploy Convex, verify contract, then run smoke tests against current production
  - `frontend`: wait for the Vercel production deploy for the selected `main` SHA, then run smoke tests
- `frontend` does not call `vercel deploy` directly yet. It relies on the existing Vercel Git-based production deploy for that SHA.
- The real deploy job uses the GitHub `Production` environment for deploy secrets, but it does not wait for a separate approval.
- Required `Production` environment secret: `CONVEX_DEPLOY_KEY`, created from the **Production** Convex deployment settings. A development or preview key deploys to the wrong environment and cannot be converted by the CLI.
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

## 2) Deploy web app (Vercel)

Set env vars:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL` (Convex "site" URL)
- `CONVEX_SITE_URL` (same value; used by auth provider config)
- `SITE_URL` (web app URL)
- `VITE_APP_BUILD_SHA` (set to the same commit SHA stamped into Convex)

Deploy order:

1. Convex
2. contract verify
3. wait for Vercel production deploy for the same Git SHA
4. smoke

## 3) Route `/api/*` to Convex

This repo currently uses `vercel.json` rewrites:

- `source: /api/:path*`
- `destination: https://<deployment>.convex.site/api/:path*`

For self-host:

- update `vercel.json` to your deployment's Convex site URL.

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
PLAYWRIGHT_BASE_URL=https://clawhub.ai bunx playwright test e2e/menu-smoke.pw.test.ts e2e/upload-auth-smoke.pw.test.ts
```
