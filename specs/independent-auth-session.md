---
summary: "独立 JWT/JWKS 认证、MySQL session 状态和后续登录闭环的实现意图与安全边界。"
read_when:
  - 修改 `server/src/services/jwtAuthenticator.ts` 或 `authSessionRepository.ts`
  - 设计 OIDC 登录、token 签发、session 撤销或认证切换
  - 评审 Convex Auth 到独立身份服务的迁移门禁
---

# 独立认证与 Session 边界

## 当前状态

Server 当前采用“外部身份提供方签发 JWT，Fastify 验证 JWT，MySQL 保存可即时撤销的 session 状态”的候选架构。生产认证权威和生产切换仍未迁移，生产环境不得因这些候选代码改变认证配置。

当前验证器要求：

- `AUTH_ISSUER`、`AUTH_AUDIENCE`、`AUTH_JWKS_URI` 同时存在；缺失时 protected route fail-closed；
- JWT 必须通过 issuer、audience、RS256、签名、时钟容差和最大 token age 检查；
- claims 必须包含非空 `sub` 和 `sid`；存在 `jti` 时，session 必须绑定相同 token ID；
- `auth_sessions` 必须匹配 user、issuer、session ID，未撤销且未过期；
- user 不存在、已停用或已删除时拒绝认证；
- logout 只能撤销当前 user 的当前 session，不能凭客户端提交的 user ID 撤销其他账户；
- 所有拒绝路径返回认证失败，不回退到 Convex identity 或匿名身份。

## 候选闭环实现

当前已增加但仍只允许 candidate 注入的边界：

- `oauthProvider.ts` 从显式环境变量读取 issuer、client、authorization/token endpoint、JWKS、audience、redirect URI 和 scopes，并构造 Authorization Code + PKCE S256 请求；JWKS 使用 `createRemoteJWKSet`，设置超时和冷却窗口。
- `oauthTransaction.ts` 只持久化 state、nonce、PKCE verifier 的 SHA-256 摘要；callback 输入包含授权码，消费采用原子 claim，完成后保存结果支持重复 callback 幂等重放。
- `accountBinding.ts` 按 `(issuer, subject)` 绑定；verified email 命中已有账户时默认返回 `email-match-requires-link`，禁止静默合并。
- `sessionEstablishment.ts` 将 callback 消费、provider exchange 和 MySQL session 创建组合起来，重复完成 callback 不重复 exchange 或创建 session。
- `refreshTokenFamily.ts` 只保存 refresh token hash，支持 rotation、family revoke、reuse detection 和 logout-all；仍需接入持久化 adapter 与批准的客户端 token 交付策略。
- `routes/auth.ts` 是显式依赖注入的候选 Fastify route factory，提供 `GET /auth/start`、`GET|POST /auth/callback`、`POST /auth/refresh` 和受现有认证 middleware 保护的 `POST /auth/logout-all`。它**未注册到 `server/src/index.ts`**，不是生产 endpoint。
- `/auth/start` 将 transaction ID、nonce 与 PKCE verifier 分别存进短生命周期 `HttpOnly`、`SameSite=Lax`、`Path=/auth` cookie；callback 仅从这些 cookie 恢复敏感材料，并在成功后清理。authorization request 携带标准 `state`、`nonce`、事务定位用的 `transaction_id` 与 S256 `code_challenge`，绝不携带 verifier。
- route factory 的 access-token issuer、provider exchange、transaction/session/refresh store 都必须显式注入；fake ports 只用于边界测试，不能替代持久化 adapter、真实 provider 生命周期或浏览器 cookie 证据。

这些服务已有 fake/隔离测试，但尚未选择或运行真实 provider adapter、注册真实 callback HTTP 路由、写入生产身份数据或执行浏览器回归。因此仍是 candidate-only。


当前代码**不在 Server 内签发 JWT**，也不保存明文 token。后续完整登录闭环必须由明确的 OIDC/OAuth provider adapter 提供：

1. provider 完成 Authorization Code + PKCE、callback/state/nonce 校验；
2. provider 或受控 token service 签发带 `iss`、`aud`、`sub`、`sid`、`jti`、`exp` 的 JWT；
3. callback 服务使用已验证 claims 创建 `auth_sessions` 行，写入 user、issuer、sid、可选 jti 和过期时间；
4. session 创建必须通过 `createAuthSessionRepository`，输入字段和过期时间先校验；
5. access token 只返回给符合 provider 生命周期约束的客户端，refresh rotation、reuse detection 和 family revoke 必须在单独设计完成后实现；
6. provider key rotation 通过 JWKS 完成，不能把私钥放入仓库、迁移文件或日志。

在 session 创建入口和 token 签发方案未完成前，不得声称“登录迁移完成”，不得恢复 CLI device flow、桌面 OAuth 或生产认证切换。

## 代码边界

| 职责 | 实现 |
| --- | --- |
| JWT/JWKS 验证 | `server/src/services/jwtAuthenticator.ts` |
| Session 创建、查询、touch、撤销 | `server/src/services/authSessionRepository.ts` |
| 认证错误与 request user 类型 | `server/src/middleware/aiDirectAuth.ts` |
| Fastify fail-closed 注册 | `server/src/index.ts` |
| 用户资料与 logout 路由 | `server/src/routes/users.ts` |
| session schema | `prisma/schema.prisma`、`prisma/migrations/20260903_auth_sessions/` |

## 已验证证据

以下均为 fake Prisma/Fastify 隔离测试和服务端类型检查，不是 provider、candidate 或 production 运行证据：

- session lookup 绑定 `jti`，无 `jti` 保持 legacy 兼容；
- session 创建拒绝空身份字段、空 token ID、非法或已过期时间；
- JWT claim、配置缺失、用户停用/删除和未认证 HTTP 路由拒绝路径；
- `server` 定向认证测试通过，TypeScript 检查通过。

## 下一阶段门禁

按顺序完成：

1. 明确 provider 选择和 issuer/audience/JWKS 生命周期；
2. 实现 callback/session 建立服务，覆盖 state、nonce、PKCE、账号绑定和重复 callback 幂等；
3. 实现 access/refresh 生命周期、family revoke、reuse detection 和 logout-all；
4. 增加 candidate-only provider 集成测试与浏览器回归，不读取生产凭据；
5. 验证所有受保护业务域的 user/session/RBAC 拒绝路径；
6. 仅在候选观察期、回滚证据和独立生产 approval ref 齐备后，评审认证切换。

这些步骤完成前，生产仍保持 `convex_authoritative`，不得删除 Convex Auth、identity bridge 或相关生产路由。