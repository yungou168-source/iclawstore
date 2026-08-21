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
CONVEX_AUTH_ISSUER=https://zhipin.store
CONVEX_AUTH_AUDIENCE=convex
CONVEX_URL=https://zhipin.store/convex
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

邮箱登录必须发送 4 位一次性验证码，并在站内完成校验；验证码有效期为 2 分钟，不得回退为仅发送魔法链接。登录表单必须始终展示验证码输入框，邮箱输入使用标准邮箱校验且最多 38 个字符。发送前将邮箱去除首尾空白并转为小写；待验证状态必须绑定到发起请求时的归一化邮箱。用户修改邮箱时必须清空已输入验证码并作废当前对话框中的待验证状态，只有新邮箱重新请求验证码后才能提交。验证码输入仅接受 4 位数字，发送请求进行中必须拒绝同一表单的并发请求，避免后完成的请求替换用户正在输入的有效验证码。

OAuth provider 只有在对应 ID 与 Secret 都配置后才会在 Convex Auth 中启用。任一变量值、Bearer token、私钥、JWKS 私钥或 Convex admin key 都不得写入仓库、文档、日志、测试输出或聊天记录。

## OAuth 与邮件回调不变量

生产浏览器入口唯一为 `https://zhipin.store`；`https://www.zhipin.store` 必须在 Nginx 的 HTTP 与 HTTPS 层单跳重定向到该域名，不能让两个新域名同时承载登录流程。旧 `iclawstore.com` 域名不跳转到新域，也不得承载 OAuth。Convex Auth 的 verifier cookie 为 host-only cookie，混用裸域与 `www` 会使 OAuth 回调无法验证。

自托管部署中，管理 API 为 `127.0.0.1:3210`，HTTP site 服务为 `127.0.0.1:3211`。Nginx 的路由优先级必须为：

```text
/convex/api/auth/  -> 127.0.0.1:3211/api/auth/
/convex/           -> 127.0.0.1:3210/
```

`/convex/api/auth/` 必须先于通用 `/convex/` 规则匹配。否则 GitHub 回调会得到代理 `404`，而非由 Convex Auth 处理。

Convex 部署必须设置：

```text
SITE_URL=https://zhipin.store
CUSTOM_AUTH_SITE_URL=https://zhipin.store/convex
JWT_PRIVATE_KEY=<与 JWKS 成对的 PKCS#8 PEM RSA 私钥>
JWKS=<上述私钥对应的公钥 JWKS JSON>
```

`JWT_PRIVATE_KEY` 与 `JWKS` 必须由同一 RSA 密钥对生成，并只保存在 Convex Production deployment 的环境变量中。私钥不得进入仓库、构建日志、截图或应用配置文件；任何疑似泄露都必须视为密钥轮换，重新生成并同时替换这两个值。

`SITE_URL` 是 OAuth 完成后的浏览器目的地；邮箱 OTP 在站内输入并验证。`CUSTOM_AUTH_SITE_URL` 是 OAuth provider 回调进入 Convex HTTP 服务的外部地址。各 OAuth App 的 callback URL 必须精确为 `https://zhipin.store/convex/api/auth/callback/<provider>`，其中 `<provider>` 为 `github`、`google` 或 `wechat`。

原生桌面身份协议的服务端实现使用独立 issuer `${CUSTOM_AUTH_SITE_URL}/oauth/desktop` 和固定 desktop audience。第一方 public client 仅允许 Authorization Code + PKCE `S256`，注册配置必须同时包含固定 custom URI 与 IP loopback callback；动态 client registration 关闭。Access Token 必须具有 `typ=at+jwt`、`client_id/cid` 和 `jti`，Fastify 以独立 issuer、audience、JWKS、client ID 和 15 分钟最大年龄验证，再调用 `desktopOAuth:getDesktopAccessIdentity` 二次确认授权及账号状态。Web Token 仍走原有复合 subject 链，两类 Token 不混用 subject 解析规则。

OAuth 组件已提供哈希 refresh token、rotation、reuse detection、30 天绝对期限、7 天空闲期限和 authorization revocation。`users` trigger 会在账号首次停用、软删除或物理删除时撤销 authorization，并以每批 100 条的有界任务撤销该用户的 refresh token families；refresh 时会在签发前检查 family 状态，轮换后只推进 idle deadline，不延长 absolute deadline。该能力仍处于实现待发布状态：目标环境静态 client 注册锁定、真实浏览器 custom URI 与 IP loopback 两条授权闭环、生产配置烟测和统一发布门禁尚未完成。因此生产客户端仍不得复制浏览器 Cookie、自行持久化未发布的 refresh token，或在 contract 未返回 `auth` 时启动原生 OAuth。

详细接入边界见 `docs/AI_DIRECT_DESKTOP_CLIENT_API_V1.md`。

## Web 退出、切换账号与 RBAC 验收

所有 Web 导航形态都必须为已登录用户提供可发现的账户菜单和“退出登录”操作。workspace 导航不能只显示“工作台”链接而隐藏退出入口；账户菜单还必须提供 `/ai-work-admin/organizations` 的“组织与公司管理”入口，使普通已登录用户能够发现自己的 AI Direct 业务组织，但入口可见不代表拥有任何组织或公司权限。退出必须调用 Convex Auth 的 `signOut()`，待认证状态变为未登录后再展示统一登录框。不得通过手工删除单个 Local Storage 项、覆盖 Cookie 或复用旧 Bearer token 来模拟账号切换，因为这会绕过正常的会话撤销和前端状态清理。

`/settings?view=organizations` 管理 Convex 中的 ClawHub 发布组织；`/ai-work-admin/organizations` 管理 Fastify/MySQL 中的 AI Direct 业务组织。两者不自动同步，也不能仅凭名称相同推断为同一授权域。生产验收必须分别检查两个列表：发布组织 owner 在 AI Direct 中仍可能是 outsider，此时 AI Direct 页面正常返回空列表是正确结果，不得自动创建、映射或继承业务组织权限。

生产 RBAC 验收使用两个团队控制、可回收的身份，分别记为 owner 与 outsider，不在文档中记录邮箱、内部用户 ID、组织 ID、公司 ID 或 token。切换及验收顺序如下：

1. owner 完成只读基线：`/session` 返回 `200`，从公司列表取得真实公司后详情返回 `200`；不存在的公司 ID 因防枚举授权顺序可能返回 `403`，不能据此判断 owner 权限失效。
2. 在页面账户菜单退出 owner，确认登录入口重新出现，再登录 outsider。
3. outsider 调用 `/session` 验证身份已切换；访问 owner 的真实公司必须返回 `403`，且不能出现在 outsider 的公司列表中。
4. 由受控管理员授予 outsider 最小公司角色；使用 outsider 同一登录会话重试，预期按新角色允许对应操作，证明每请求重查成员关系。
5. 撤销该角色；仍使用同一 outsider 会话重试，预期立即返回 `403`，不得要求重新登录才生效。
6. 退出 outsider，删除临时成员关系、QA 组织/公司数据、Bearer 文件和脱敏临时响应。

Bearer 只允许以权限 `600` 的短期临时文件保存并直接供验收命令读取。可以记录 token 的三段格式、过期时间和测试结论，但不得把 token 明文输出到终端回放、聊天、文档、截图或 Git。当前 owner 的真实公司列表→详情链路已经通过；此前使用已不存在的旧公司标识得到的 `403` 已确认是误报。跨组织隔离和撤权即时失效仍需 outsider 身份完成，完成前不能写成生产 RBAC 已全面验收。

## 桌面 OAuth 静态客户端与 QA 验收

本节是原生桌面 OAuth 的生产启用门禁。它与现有 Web 登录 provider 独立，但复用同一受控 Convex 身份源；完成本节前，desktop contract 不得发布 `auth` metadata。

### 固定注册边界

Convex 生产环境必须保存以下非秘密配置，实际私钥、JWKS 私钥、管理员 key 与 token 只能保存在受限秘密存储中：

```dotenv
# 逗号分隔；值必须与已发布桌面二进制中的回调地址完全一致。
AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS=com.iclawstore.desktop:/oauth/callback,http://127.0.0.1:19873/oauth/callback

# 由首次管理员注册得到，后续不可静默更换。
AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID=<locked-public-client-id>
```

示例仅说明格式，不是可直接复制到生产的回调地址。`AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS` 必须同时包含一个 custom scheme 和一个 IP loopback URI；不接受任意端口、浏览器 HTTPS 回调、`file:`、`data:` 或带凭据/fragment 的 URI。客户端类型必须为 `public`，token endpoint authentication method 必须为 `none`，授权模式只能为 Authorization Code + PKCE `S256`。

注册顺序必须是：先确定已发布桌面二进制真实处理的 custom scheme 与固定 loopback 端口；设置 redirect URIs，暂不设置 client ID；管理员调用 `desktopOAuth:ensureDesktopClient`；将返回的 client ID 写入生产环境；重新部署后再次调用同一 mutation，必须返回相同 `clientId` 和 `created=false`。Client ID 由该静态注册过程产生，不是第三方 OAuth App 的 Client ID，也不能手工编造。当前没有桌面客户端或尚未完成两个回调闭环时，必须保持两个 `AI_DIRECT_DESKTOP_OAUTH_*` 变量为空，且不得发布 `auth` discovery metadata。如果已存在的客户端类型、scope 或 redirect URI 不一致，操作必须失败，不得删除或宽松修改现有客户端来绕过校验。

Fastify `/home/ubuntu/.config/iclawstore/api.env` 必须设置下列非秘密值，并与 Convex 注册保持一致：

```dotenv
CONVEX_DESKTOP_AUTH_ISSUER=https://zhipin.store/convex/oauth/desktop
CONVEX_DESKTOP_AUTH_AUDIENCE=https://zhipin.store/api/v1/ai-direct-hiring
AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID=<locked-public-client-id>
```

发布 Convex backend 后，只能重载 API；通过 `GET /api/v1/desktop/contract` 核验 `auth` 元数据。issuer、authorization/token/userinfo/revoke endpoints、JWKS URI、client ID 与 audience 必须精确匹配，不匹配则立即移除桌面 OAuth discovery 配置并停止验收。

### 可回收 QA 夹具与验收顺序

使用团队控制的专用邮箱创建 QA 身份，例如 `qa-desktop-oauth@<controlled-domain>`。该身份不得是个人账号、日常管理员账号或共享 token 账号；设置到期日并在验收完成后删除或停用。为它创建独立组织，例如 `qa-desktop-oauth-<date>`，授予完成验证所需的最小 owner 权限，并记录组织 ID 但不写入公开文档。

验收按下列顺序执行，每步只改变一个变量：

1. 获取 OIDC discovery 和 JWKS，检查 issuer、audience 与固定 client ID；
2. 使用 custom URI 和 loopback 分别完成浏览器 Authorization Code + PKCE `S256` 回调；
3. 用短期 access token 调用 `/api/v1/ai-direct-hiring/session`，验证 `200`、QA 身份和指定组织；
4. 在 QA 组织设置明确 `AI_DIRECT_FEATURE_FLAGS` 覆盖，对每个 flag 分别验证 enabled/disabled 行为及 `runtimeCapabilities`；
5. 调用 revoke endpoint，确认 refresh family 失效；删除 flag 覆盖、QA 组织与 QA 身份。

`providerExecution` 必须在整个验收中保持关闭；不能通过启动真实 Provider、保留 refresh token、保存浏览器 cookie，或制造不可回收生产业务数据来完成测试。测试记录只能保留时间、脱敏身份标签、组织夹具标签、HTTP 状态与断言结果。

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
  https://zhipin.store/api/v1/ai-direct-hiring/session
```

预期：有效登录会话返回 `200`，且响应包含当前用户与组织信息。无 token 返回正常 Bearer-required `401`；不能出现 identity bridge 未初始化或 provider 未配置错误。

生产成功路径已于 2026-08-04 使用真实 GitHub 登录会话验收：短期 token 经过刷新后返回 `200`，组织数量为 `0`、当前组织为 `null`，`aiDirectHiring`、`desktopIdentityBridge` 为启用，`wechatLogin` 为关闭。脱敏数据库核验显示身份映射仅保存稳定 `userId`，未保存包含 `|` 的复合 subject。验收过程中不得把 token、用户 ID、邮箱或完整响应写入文档和日志。

如邮箱登录可发送链接但点击后失败，应检查生产反向代理是否将 Convex Auth callback 路由正确交给 Convex site proxy。不要为了绕过回调失败而把 `dev-persona` 暴露到生产。
