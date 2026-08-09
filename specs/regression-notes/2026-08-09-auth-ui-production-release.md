# 2026-08-09 认证 UI 生产发布记录

## 发布范围

- 认证功能提交：`ba9ffdabb24b21789187aaec98eede1c2be85ff9`
- 可独立验证的最终提交：`799b438bd5a4f51b1e51012556144b58a8b09265`
- Convex 与 SSR 必须按同一契约发布：邮件 OTP 为 4 位，最长有效期为 2 分钟。
- workspace 已登录账户菜单提供“工作台”“设置”“退出登录”；退出动作调用 Convex Auth `signOut()`。
- 本次发布不开放付费雇佣能力，`PAID_HIRING_RELEASE_READY` 继续保持 `false`。

## 构建与发布

- 构建来源为 detached、跟踪文件干净的固定 SHA `799b438bd5a4f51b1e51012556144b58a8b09265`，未使用主工作区脏修改。
- `bun install --frozen-lockfile`、`packages/schema` 构建和生产 SSR 构建通过。
- 认证定向测试：2 个测试文件通过，20 项通过，2 项既有跳过。
- Convex 通过本机 self-hosted 管理端口单次发布，严格 typecheck 通过；未使用 `--typecheck=disable`。
- SSR 生产 release：`/www/wwwroot/iclawstore.com/.output.release-20260809-174512-799b438-auth`
- 回滚点：`/www/wwwroot/iclawstore.com/.output.release-20260809-161837-abd4e5e-authfix`
- `iclawstore.service` 已重启并指向新 release，本机与公网均返回 HTTP 200。

## 验证结果与边界

- 公网登录弹窗可打开，OTP 输入框 `maxlength=4`、占位符为 `0000`，发送与验证动作均存在。
- 客户端资源已内联生产 `VITE_CONVEX_URL`，浏览器没有缺失环境变量错误。
- workspace 已登录菜单及 `signOut()` 调用由固定 SHA 的组件测试覆盖。
- 原生产 Bearer 已过期并删除；本次未保存第二份真实登录凭据，因此“公网真实会话点击退出后会话清除”仍需用户以当前浏览器登录态做最终交互确认，不能把组件测试表述为真实会话验收。
- 公网控制台仍有既有 `/_vercel/insights/script.js` 404；该错误与认证和 Convex 发布无关，应在统一 Vercel 与自托管发布事实源时处理。