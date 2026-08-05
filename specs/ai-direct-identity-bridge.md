---
summary: "AI 直聘生产 Convex identity bridge、认证 provider 与 session 验证运行约束。"
read_when:
  - 配置生产登录 provider 或 Convex 环境变量
  - 排查 AI 直聘 Bearer token 与 /session
  - 修改 Convex Auth、OIDC 或 identity bridge
---

# AI 直聘生产身份桥运行约束

## 目的与边界

Web 登录由 Convex Auth 签发短期 Bearer token；Fastify API 不自行签发或信任客户端传入的用户 ID。`convexIdentityBridge` 使用生产 OIDC discovery 和 JWKS 验证 token，并把受信任的 Convex 主体映射到 MySQL 的 `ai_direct_auth_identities` 与 AI 直聘用户/组织数据。

Convex Auth JWT 的 `sub` 是会话级复合值 `userId|sessionId`，不能直接作为业务身份键。身份桥必须严格要求且仅允许两个非空、无空白分段，取第一段 `userId`，并继续要求它与同一 token 查询得到的 `users:me._id` 一致。数据库只持久化 `issuer + userId`；完整 `sub` 和其中的 `sessionId` 不得写入身份映射，否则重新登录会错误地产生会话级身份。

```text
浏览器登录
  -> Convex Auth 签发 Bearer token
  -> Fastify aiDirectAuth
  -> Convex identity bridge（issuer + audience + JWKS）
  -> ai_direct_auth_identities
  -> 用户、组织与 RBAC
```

失效、缺失或不受信任的 token 必须返回 401。禁止通过请求体、查询参数或前端缓存传递 `userId` 来绕过该链路。

## 生产配置

身份桥运行于 Fastify 服务，必须设置以下非秘密配置：

```text
CONVEX_AUTH_ISSUER=https://www.iclawstore.com
CONVEX_AUTH_AUDIENCE=convex
CONVEX_URL=https://www.iclawstore.com/convex
```

登录 provider 运行于自托管 Convex 后端。仅设置到前端 `VITE_*` 变量或 Fastify `api.env` 不会启用 provider。当前支持的生产 provider 配置为：

```text
AUTH_RESEND_KEY
AUTH_EMAIL_FROM
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
AUTH_WECHAT_APP_ID
AUTH_WECHAT_APP_SECRET
```

邮箱登录必须发送 8 位一次性验证码，并在站内完成校验；不得回退为仅发送魔法链接。OAuth provider 只有在对应 ID 与 Secret 都配置后才会在 Convex Auth 中启用。任一变量值、Bearer token、私钥、JWKS 私钥或 Convex admin key 都不得写入仓库、文档、日志、测试输出或聊天记录。

## OAuth 与邮件回调不变量

生产浏览器入口唯一为 `https://www.iclawstore.com`；裸域必须在 Nginx 的 HTTPS 层重定向到该域名，不能让两个域名同时承载登录流程。Convex Auth 的 verifier cookie 为 host-only cookie，混用裸域与 `www` 会使 OAuth 回调无法验证。

自托管部署中，管理 API 为 `127.0.0.1:3210`，HTTP site 服务为 `127.0.0.1:3211`。Nginx 的路由优先级必须为：

```text
/convex/api/auth/  -> 127.0.0.1:3211/api/auth/
/convex/           -> 127.0.0.1:3210/
```

`/convex/api/auth/` 必须先于通用 `/convex/` 规则匹配。否则 GitHub 回调会得到代理 `404`，而非由 Convex Auth 处理。

Convex 部署必须设置：

```text
SITE_URL=https://www.iclawstore.com
CUSTOM_AUTH_SITE_URL=https://www.iclawstore.com/convex
```

`SITE_URL` 是 OAuth 完成后的浏览器目的地；邮箱 OTP 在站内输入并验证。`CUSTOM_AUTH_SITE_URL` 是 OAuth provider 回调进入 Convex HTTP 服务的外部地址。各 OAuth App 的 callback URL 必须精确为 `https://www.iclawstore.com/convex/api/auth/callback/<provider>`，其中 `<provider>` 为 `github`、`google` 或 `wechat`。

Web 登录成功后，桌面客户端可使用 Convex Auth 签发的短期 Bearer token 调用受保护接口，并必须先通过 `GET /api/v1/ai-direct-hiring/session` 确认主体与组织 scope。当前尚未发布原生桌面 OAuth/PKCE、custom URI callback、refresh token 或设备注册协议；桌面端不得复制浏览器 Cookie 或自行持久化 token。详细接入边界见 `docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md`。

## 配置与发布顺序

1. 在 Resend 验证发信域名，并以已验证域名下的地址设置 `AUTH_EMAIL_FROM`。
2. 在 GitHub OAuth App 设置生产回调 URL 后，设置 GitHub Client ID 与 secret。
3. 使用自托管 Convex 的本地管理地址写入 provider 变量；生产公网反向代理地址只用于客户端请求，不应用作该管理 CLI 的后端地址。
4. 按生产发布流程部署 Convex Auth 函数和前端；前端只能展示实际启用的 provider。
5. 使用浏览器完成一次真实登录，获取短期 Bearer token 后在服务器本机验证 `/session`。

## 验收

以下检查均不得输出 token 或密钥：

```bash
curl -sS -H "Authorization: Bearer <短期访问令牌>" \
  https://iclawstore.com/api/v1/ai-direct-hiring/session
```

预期：有效登录会话返回 `200`，且响应包含当前用户与组织信息。无 token 返回正常 Bearer-required `401`；不能出现 identity bridge 未初始化或 provider 未配置错误。

生产成功路径已于 2026-08-04 使用真实 GitHub 登录会话验收：短期 token 经过刷新后返回 `200`，组织数量为 `0`、当前组织为 `null`，`aiDirectHiring`、`desktopIdentityBridge` 为启用，`wechatLogin` 为关闭。脱敏数据库核验显示身份映射仅保存稳定 `userId`，未保存包含 `|` 的复合 subject。验收过程中不得把 token、用户 ID、邮箱或完整响应写入文档和日志。

如邮箱登录可发送链接但点击后失败，应检查生产反向代理是否将 Convex Auth callback 路由正确交给 Convex site proxy。不要为了绕过回调失败而把 `dev-persona` 暴露到生产。