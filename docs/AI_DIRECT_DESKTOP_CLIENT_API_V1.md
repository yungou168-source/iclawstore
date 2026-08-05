# AI Direct / Desktop Client API v1

> Contract version: `1.1.0`（当前 production discovery）
> Release status: **运行态与迁移已验收；原生 OAuth、认证 Session、组织级 Feature Flag 业务验收未完成**
> OpenAPI: `server/openapi/desktop-client-v1.yaml`
> Runtime discovery: `GET /api/v1/desktop/contract`
> Scope: Agent appearance, desktop sidebar synchronization, desktop templates, Session capability negotiation, Jobs/artifacts, interviews, candidate catalog, and workforce endpoints listed by OpenAPI.

## 当前生产验收状态（2026-08-05）

以下状态以当日运行时命令为准，优先级高于本文其余历史发布记录：

- Prisma 使用受限迁移账号执行 `migrate status`，结果为 **Database schema is up to date**，包括 `20260812_ai_direct_template_review` 与 `20260813_ai_direct_audit_governance`。
- `iclawstore-api` 已由受限 PM2 配置重新加载，内存上限 `256M`；本机 `GET /health` 和公网 `GET https://www.iclawstore.com/api/v1/desktop/contract` 均返回 `200`，Discovery 为 `1.1.0`。API 启动前会校验完整契约路由表，缺路由将拒绝监听。
- `iclawstore-runtime-dispatcher` 保持独立运行，内存上限 `128M`。本次只读队列核验没有 pending、published 或 failed outbox 项；其最新运行指标保持在预算内。历史错误日志不能作为当前派发失败的结论。
- `20260814_ai_direct_workforce_employee_directory` 已应用；`GET /api/v1/ai-direct-hiring/workforce/employees` 已进入 `1.1.0` manifest 与 OpenAPI，按 `companyId` 的 recruiter 级 RBAC 从 employee digest 读取，并以 opaque `updatedAt/employmentId` cursor 分页。构建、目录路由测试和运行时契约测试已通过；认证 QA 组织的正向、空页和越权生产验收仍缺少可回收身份与隔离组织。
- 原生桌面 OAuth **未验收且未发布**：生产环境缺少 `CONVEX_DESKTOP_AUTH_ISSUER`、`AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID` 与显式 audience 配置，公网 discovery 不包含 `auth`。因此尚未执行 OIDC discovery/JWKS、Authorization Code + PKCE、refresh/revoke 或原生 access token 验收。
- Session 仅验证了未认证边界为 `401 AUTH_REQUIRED`，不能代表成功路径。当前没有专用、短期且可回收的认证测试身份，未验证 OAuth token 到 `/api/v1/ai-direct-hiring/session` 的 `200`。
- `AI_DIRECT_FEATURE_FLAGS` 未配置，代码会退回默认 flags；没有认证组织与隔离夹具，未验证各 flag 的启用、禁用及组织覆盖行为。不得将路由存在或未认证 `401` 视为 feature flag 验收。

完成条件是配置并发布锁定的 OAuth client 后，用可回收测试身份依次完成：OIDC discovery/JWKS → PKCE 交换 → 已认证 `/session` → 每个 feature flag 的 enabled/disabled 行为断言。完成前客户端必须保持本地模式，不能依赖原生 OAuth metadata。

### 生产启用与验收前置条件

原生桌面 OAuth 启用需要由平台运维在两个运行边界配置同一组固定参数：

1. Convex 生产环境设置固定的 `AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS`。它必须同时包含实际桌面应用使用的 custom URI callback 和 `127.0.0.1`/`[::1]` loopback callback；注册客户端必须是 `public` 且 `token_endpoint_auth_method=none`。
2. 管理员调用 `desktopOAuth:ensureDesktopClient` 创建或验证唯一客户端，并将其返回的 `clientId` 作为 `AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID` 固定保存到 Convex 生产环境。后续调用必须返回相同 ID 且 `created=false`。
3. Fastify 的受限 `api.env` 设置与 Convex 相同的 `AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID`，并设置 `CONVEX_DESKTOP_AUTH_ISSUER` 与可选的 `CONVEX_DESKTOP_AUTH_AUDIENCE`。issuer 必须为 `${CUSTOM_AUTH_SITE_URL}/oauth/desktop`，audience 默认是 `https://www.iclawstore.com/api/v1/ai-direct-hiring`。
4. 仅重载 API 后，`GET /api/v1/desktop/contract` 必须出现 `auth`，其 issuer、endpoint、JWKS URI、client ID 与 audience 必须同已锁定的配置一致。

验收必须使用团队控制、可停用的独立 QA 邮箱和可删除的隔离组织，不能复用个人管理员账号或记录任何 token。为 QA 组织配置明确的 `AI_DIRECT_FEATURE_FLAGS` 覆盖后，分别记录每个 flag 的 enabled 与 disabled 响应/副作用。`providerExecution` 在验收中保持关闭，不能通过启动真实 Provider 来证明 feature flag 可用。

完整的配置不变量、回收要求和验收顺序见 `specs/ai-direct-identity-bridge.md`。

## Contract boundary

This document describes the **Desktop Client API v1 machine contract**. Production returns `1.1.0` discovery and OpenAPI, and the Candidate Catalog、Workforce 与 Candidate Matching operations declared by that contract are now mounted. The production migration chain is up to date, API startup accepted the complete manifest, and the production smoke found no protected operation returning `404`. This proves route-contract availability only; it does not imply that an organization feature flag is enabled or that an authenticated caller has business access.

### Delivery and runtime status

The deployed server enforces a unified `1.1.0` release gate:

- API startup resolves every method/path in the `1.1.0` manifest after Fastify registration and refuses to listen if any route is absent;
- tests require the manifest and OpenAPI operations to match exactly;
- production smoke requests every protected operation without credentials. Authentication、authorization、validation or feature-disabled responses are acceptable, but any `404` blocks release;
- production migrations `20260808_ai_direct_desktop_jobs_cursor`、`20260809_ai_direct_interviews_policy`、`20260810_agent_publication_catalog` 与 `20260811_ai_direct_workforce` have been applied, and Prisma reports the schema up to date;
- the deployed API passed its TypeScript build, PM2 reload, startup contract validation, discovery/OpenAPI check, and full protected-operation non-`404` smoke;
- authenticated `2xx` business smoke for Candidate Catalog、Departments、Positions and Candidate Matching remains unverified: production has no dedicated smoke token, `candidateCatalog` defaults to false, and no enabled organization currently provides a complete isolated test chain;
- the Provider Executor remains disabled until an administrator has completed the OAuth-to-worker-token authorization chain; route availability is not permission to start provider execution;
- API, dispatcher, and executor retain separate low-memory process budgets and single-purpose responsibilities.

The server-side comparison, data ownership rules, implementation gaps, feature flags, and delivery priorities are maintained in `specs/ai-direct-desktop-platform-integration.md`. In particular:

- `/api/v1/desktop/contract` discovers contract metadata; it is not an identity/session or enterprise feature-flag response.
- A route that exists but returns a controlled non-`404` response may still be unavailable because authentication, migration, configuration, or a feature flag blocks execution. Clients must use `/session` capabilities rather than infer enablement from route presence.
- Client-local projects, queues, outputs, approval responsibility labels, encrypted backups, and template business data must not be silently uploaded through these APIs.

The Desktop API v1 keeps `409 REVISION_CONFLICT`, `428 PRECONDITION_REQUIRED`, and the optional-error-field shape documented below. A future platform contract may use `412 VERSION_CONFLICT` and add `requestId`; that difference must be versioned rather than silently changing v1 behavior.

## 1. Compatibility and authentication

All business endpoints use a short-lived Bearer token issued by Convex Auth:

```http
Authorization: Bearer <access-token>
```

The API origin is `https://www.iclawstore.com`. The current web login flow has
been verified for GitHub OAuth and email magic links, so desktop work may begin
against the authenticated API surface.

### 1.1 Desktop integration boundary

Production discovery remains the authority for whether native login is enabled. The current worktree contains a proposed `1.1.0` native OAuth/OIDC implementation with Authorization Code + PKCE `S256`, locked public-client redirects, an independent issuer/audience, refresh rotation/reuse detection, 30-day absolute expiry, 7-day idle expiry, account disable/delete family revocation, and RFC 7009 revocation.

This implementation is **not yet a published production client contract**. The target environment must first lock the static client registration, complete real-browser custom URI and IP loopback authorization flows, pass production configuration smoke checks, and pass the unified release gate. Until runtime discovery returns versioned `auth` metadata, a desktop client must receive access tokens through a platform-owned `TokenProvider` rather than starting the native exchange.

```ts
export type TokenProvider = {
  getAccessToken(): Promise<string | null>;
};

export const authorizedFetch = async (
  tokenProvider: TokenProvider,
  input: RequestInfo | URL,
  init: RequestInit = {},
) => {
  const token = await tokenProvider.getAccessToken();
  if (!token) throw new Error('AUTH_REQUIRED');

  return fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
};
```

The provider may keep a current token only in memory. Do not copy browser
cookies, persist an access token in Electron storage, pass it through command
arguments, or send it to a renderer that does not need it. When a request
returns `401 AUTH_REQUIRED`, clear the in-memory token and return the user to
the platform login entry; do not retry with an expired token.

Before enabling any account-scoped desktop feature, call:

```http
GET /api/v1/ai-direct-hiring/session
Authorization: Bearer <access-token>
```

Use the returned identity and organization scope as the client session source
of truth. `currentOrganization.grantVersion` changes when the server observes a
membership-role change; clients must discard organization-scoped cached data when
it changes. `featureFlags` and `runtimeCapabilities` are server decisions, not
client preferences: absent or false capability values require the desktop to stay
in its local-only mode. The desktop client must never derive an account ID, role,
company, or organization from local profile data.

`GET /api/v1/desktop/contract` and `GET /api/v1/desktop/openapi.yaml` are
read-only discovery endpoints and do not require authentication.

### 1.2 Candidate Session capability negotiation

`GET /api/v1/ai-direct-hiring/session` is the published `1.1.0` desktop startup negotiation entry, not a replacement for production discovery. The
optional `X-Organization-Id` selects an accessible organization explicitly;
otherwise the server selects its default and reports the choice in
`organizationSelection`.

- Treat `currentOrganization.grantVersion` as an organization authorization
  epoch. When it changes, discard organization-scoped cache and re-resolve the
  session before making a Jobs or artifact request.
- `interviews`、`candidateCatalog`、`providerExecution` remain default-off organization capabilities; `desktopJobs` is independently negotiated. The required production migrations and route-contract release gate have completed, but clients must still wait for the server to return each organization flag and executable runtime capability. In particular, Candidate Catalog and Candidate Matching have not yet completed an authenticated `2xx` production business smoke.
- `runtimeCapabilities` are the executable subset after server runtime checks.
  A capability must be true in both the relevant feature flag and runtime
  capability before the client calls its endpoint. Otherwise remain local-only:
  do not upload local projects, queues, chats, memories, or outputs.

## 2. Candidate Jobs and artifacts

The published `1.1.0` route contract exposes a read-only organization Job projection:

- `GET /api/v1/ai-direct-hiring/jobs` returns newest-first `JobPage` records.
  Continue only with the opaque `nextCursor`; do not derive pagination from a
  timestamp or run ID. The optional `status` filter is comma-separated.
- `GET /api/v1/ai-direct-hiring/jobs/:runId` returns the same versioned Job DTO
  plus ordered steps, failure recovery data, summarized input/output, and cost
  values. `costMicros` is a decimal string.
- `GET /api/v1/ai-direct-hiring/jobs/:runId/artifacts` returns visible metadata
  and an authorized `contentUrl`. It never returns `storagePath`.
- `GET /api/v1/ai-direct-hiring/jobs/:runId/artifacts/:artifactId/content`
  rechecks requester/organization visibility and streams the verified bytes.
  Treat `403`, `404`, and `503` as unavailable; do not retry by guessing a file
  path or direct storage URL.

The client may show Jobs only when `desktopJobs` is enabled and executable. It
may show artifact download only when `artifactDownload` is executable. Neither
endpoint starts provider execution; that remains a separately controlled worker
runtime.

## 3. Candidate catalog

The candidate catalog is part of the published `1.1.0` route contract. Its production migration and route release are complete, but the capability is callable only when the selected organization explicitly enables `candidateCatalog` and the authenticated user has an active organization membership. Production currently keeps the default flag off, so route publication must not be interpreted as catalog enablement.

- `GET /api/v1/ai-direct-hiring/catalog/agents` returns digest-backed candidates
  in stable `displayName, agentId` order. `nextCursor` is opaque; category and
  full-text search are evaluated server-side.
- `GET /api/v1/ai-direct-hiring/catalog/agents/{agentId}` returns the same
  catalog-safe DTO plus only the caller organization’s `isEmployed` disclosure.
- `GET /api/v1/ai-direct-hiring/catalog/categories` returns digest-backed
  category counts for available candidates.
- Requests select an organization only through an authorized
  `X-Organization-Id`; an inactive membership, absent flag, unavailable Agent,
  or missing digest returns no catalog data.

Catalog responses are deliberately limited to display data, category, capability
summary, approved appearance reference, availability, server-decided price status,
and viewer-scoped disclosure. They never expose `promptSpec`, `modelPolicy`,
`executionPolicy`, internal review decisions, employment records, storage paths,
or payment amounts. Clients must treat a disabled capability as local-only and
must not infer availability from Agent or Employment endpoints.

## 4. Compatibility rules

- Additive response fields may be introduced in a minor contract revision; clients must ignore unknown response fields.
- Requests reject unknown fields where the OpenAPI schema declares `additionalProperties: false`.
- Removing or changing the meaning of an existing field requires a new major API path/version.
- Integer counters, revisions, prices, and sizes that may exceed JavaScript safe integer range are returned as decimal strings.
- Errors use `{ "code": string, "error": string, "details"?: unknown }`; client behavior must branch on `code`, not localized text.

## 5. Optimistic concurrency

Agent appearance and desktop sidebar writes use strong revision ETags.

1. Read the resource and retain its `ETag` response header.
2. Send the same value in `If-Match` on the next write.
3. On `409 REVISION_CONFLICT`, fetch or merge using `details.currentRevision` and `details.etag`.
4. A missing precondition returns `428 PRECONDITION_REQUIRED`.

```ts
const read = await fetch(`${baseUrl}/api/v1/desktop/sidebar`, {
  headers: { Authorization: `Bearer ${token}` },
});
const etag = read.headers.get('etag');
if (!etag) throw new Error('Missing sidebar ETag');

const write = await fetch(`${baseUrl}/api/v1/desktop/sidebar`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'If-Match': etag,
  },
  body: JSON.stringify(nextConfig),
});
```

## 6. Agent appearance

### 6.1 Control state

The server derives control from Employment state. A client cannot submit a controller, company ID, or claimed role.

| Employment state | Appearance writer |
| --- | --- |
| no Employment, `candidate`, `evaluating`, `offer_pending`, `offered` | Agent developer or current Publisher member |
| `accepted`, `onboarding`, `active`, `paused`, `offboarding` | controlling company `owner`, `admin`, or `manager` |
| `terminated` | Agent developer or current Publisher member |

During company control, the developer and company `recruiter` receive `403 FORBIDDEN_SCOPE`. Transition into `accepted` obtains control in the same MySQL transaction. A second Employment cannot replace an existing controller and receives `409 APPEARANCE_CONTROL_CONFLICT`. Transition into `terminated` releases control only if that Employment still owns it.

### 6.2 Employment transition and control transfer

The transition endpoint is the only client operation that changes Employment state. Clients cannot call a separate appearance-control endpoint.

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"toStatus":"accepted","reason":"offer accepted"}' \
  "$BASE_URL/api/v1/ai-direct-hiring/employments/$EMPLOYMENT_ID/transition"
```

The server locks the Employment row and the Agent/profile control rows before validating and committing. A `409 APPEARANCE_CONTROL_CONFLICT` response leaves both Employment state and appearance controller unchanged. Clients must not retry this conflict automatically; show the current controlling Employment from `details.controllerEmploymentId` to an authorized operator.

### 6.3 Read and update

```bash
curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  -D /tmp/appearance.headers \
  "$BASE_URL/api/v1/ai-direct-hiring/agents/$AGENT_ID/appearance"

curl -fsS -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "appearance-3"' \
  --data '{"defaultMode":"model_3d"}' \
  "$BASE_URL/api/v1/ai-direct-hiring/agents/$AGENT_ID/appearance"
```

### 6.4 Upload rules

Upload one multipart file with a `kind` field:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'If-Match: "appearance-3"' \
  -F 'kind=image_2d' \
  -F 'file=@portrait.webp;type=image/webp' \
  "$BASE_URL/api/v1/ai-direct-hiring/agents/$AGENT_ID/appearance/assets"
```

- `avatar`, `image_2d`: PNG, JPEG, or WebP; SVG is rejected.
- `model_3d`: self-contained binary GLB only; external glTF references are not accepted.
- Extension, declared MIME, magic bytes, and format structure must agree.
- At most five active `image_2d` assets exist per Agent; the limit is checked under a transaction lock.
- Reordering sends the complete active ID list for exactly one kind.
- Deletion is soft-delete first; a currently referenced avatar returns `409 ASSET_IN_USE`.
- Content endpoints return a fixed MIME, `X-Content-Type-Options: nosniff`, hash ETag, and never reveal a server path.

## 7. Desktop sidebar synchronization

The service stores one account-level override. It does not store one authoritative copy per device.

- `GET /api/v1/desktop/sidebar`: return the override or revision `0` with `config: null`.
- `PUT /api/v1/desktop/sidebar`: atomically replace the normalized configuration.
- `DELETE /api/v1/desktop/sidebar`: remove the override and return to client defaults.
- `POST /api/v1/desktop/sidebar/icons`: upload an account-owned icon.
- `GET|DELETE /api/v1/desktop/sidebar/icons/:id[/content]`: read or delete the account-owned icon.

A sidebar item uses immutable `itemId` as identity. `label`, `icon`, `visible`, and `order` are presentation state only. A template entry may carry `templateId`, but must never carry template runtime data.

Forbidden synchronization content includes:

- `localStorage` or IndexedDB contents;
- Markdown imports/exports;
- template business snapshots;
- absolute local paths;
- arbitrary remote icon URLs.

### Offline merge

On reconnect, compare the locally cached base revision with the current server revision:

```ts
const mergeSidebarItems = (base: SidebarItem[], local: SidebarItem[], remote: SidebarItem[]) =>
  mergeByStableItemId({ base, local, remote }); // label is never an identity key
```

If both local and remote changed the same `itemId` field, present a conflict or use an explicit product-level winner rule. Never silently overwrite a newer server revision. Cache data under the authenticated account ID and clear access to that cache on logout.

## 8. Desktop template catalog

The API provides catalog metadata, validated packages, screenshots, review state, and entitlement checks. Template runtime business data remains on the client device.

### Catalog and package

```bash
curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/desktop/templates?limit=20&offset=0"

curl -fL \
  -H "Authorization: Bearer $TOKEN" \
  -o template.clawtemplate \
  "$BASE_URL/api/v1/desktop/templates/$TEMPLATE_ID/package"
```

A `.clawtemplate` package is a ZIP containing `manifest.json`, an in-package entry such as `index.html`, local assets, and 1–4 screenshot references. Validation rejects path traversal, absolute paths, excessive file count, excessive expanded size, missing entries, invalid manifests, and remote/runtime dependencies outside the approved contract.

Template publication flow:

1. A Publisher member creates a draft.
2. The draft owner uploads a version package.
3. The owner uploads 1–4 screenshots matching the manifest.
4. The owner submits the version.
5. A platform admin approves and publishes it.

Free templates can be downloaded by authenticated users. Paid templates require an active entitlement. Version 1 intentionally has no purchase endpoint:

```json
{
  "purchaseSupported": false
}
```

A paid package without entitlement returns `403 TEMPLATE_ENTITLEMENT_REQUIRED`. Admin grants are for testing/migration and do not represent a payment.

## 9. Client-side local data boundary

The server APIs do not implement the desktop template sandbox, built-in template UI, Markdown bridge, installation runtime, or payment channel. The desktop client remains responsible for:

- isolated Origin/partition per template installation;
- disabled network, Node.js, Electron, shell, and arbitrary filesystem access;
- local-only template business state;
- import preview and explicit merge/replace confirmation;
- local backups before replacement or data schema migration;
- package hash verification before installation.

Moving managed server assets from local disk to object storage must not change these client resource IDs or API paths. Only the server-side managed asset adapter is replaceable.

## 10. Stable errors

| Code | Typical HTTP | Meaning |
| --- | ---: | --- |
| `AUTH_REQUIRED` | 401 | JWT missing, invalid, or expired |
| `FORBIDDEN_SCOPE` | 403 | Authenticated, but role/ownership scope is insufficient |
| `REVISION_CONFLICT` | 409 | `If-Match` is stale |
| `PRECONDITION_REQUIRED` | 428 | Revision precondition is missing |
| `APPEARANCE_CONTROL_CONFLICT` | 409 | Another Employment controls the Agent appearance |
| `ASSET_LIMIT_EXCEEDED` | 409 | Active asset count limit reached |
| `ASSET_TOO_LARGE` | 413 | Upload exceeds the kind-specific limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Extension, MIME, magic, or format is rejected |
| `ASSET_IN_USE` | 409 | Referenced resource cannot be deleted |
| `TEMPLATE_ENTITLEMENT_REQUIRED` | 403 | Paid package requires entitlement |
| `TEMPLATE_NOT_INSTALLABLE` | 409 | No published downloadable version exists |

The complete DTO and operation definitions are authoritative in `server/openapi/desktop-client-v1.yaml`.

## 11. Candidate matching (1.1.0 candidate)

`GET /api/v1/ai-direct-hiring/workforce/positions/{positionId}/candidate-matches` is an authenticated recruiter read model for an `open` Position. It combines the Position requirement summary with its bound open Role capability requirements, then reads only published, available Candidate Catalog digests.

The response uses `capability-coverage-v1`, returning the required, matched, and missing capability names, a 0–100 coverage score, availability, and only the viewer-scoped `isEmployedByCurrentOrganization` disclosure. It never includes prompts, model policy, review data, source configuration, or Employment records. Results are score/name/id ordered and paginated with an opaque cursor.

The optional `limit` is an integer from 1 to 50 (default 20). Pass the previously returned `nextCursor` unchanged to continue the ordered result set. A caller without recruiter-level Company access receives `403`; a missing Position receives `404`; a Position outside `open` status receives `409`. The endpoint does not accept organization selection from the client: its organization scope is derived from the authorized Position's Company.

```json
{
  "scoringVersion": "capability-coverage-v1",
  "positionId": "position-id",
  "requiredCapabilities": ["sql", "typescript"],
  "items": [{
    "agentId": "agent-id",
    "displayName": "Research Agent",
    "score": 100,
    "matchedCapabilities": ["sql", "typescript"],
    "missingCapabilities": [],
    "availability": "available",
    "viewerDisclosure": { "isEmployedByCurrentOrganization": false }
  }],
  "nextCursor": "opaque-or-null"
}
```

This endpoint is present in the published production `1.1.0` route contract and passed the non-`404` operation smoke. Actual matching still requires an explicit organization `candidateCatalog` feature flag, recruiter-level Company access, and an `open` Position. Because production currently has no dedicated smoke token, no enabled catalog organization, and no complete isolated Position test chain, an authenticated `2xx` business smoke remains pending.