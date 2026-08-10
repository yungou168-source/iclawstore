# AI Direct 组织入口与 RBAC 边界

## 导航职责

已登录用户的账户菜单必须提供“组织与公司管理”入口，目标地址为 `/ai-work-admin/organizations`。入口属于普通用户的能力发现路径，不是平台管理员授权标记；页面和服务端仍必须根据当前真实身份逐请求计算组织、公司与成员权限。

账户菜单应保持以下职责分组：

- 仪表盘：ClawHub 发布内容与账户资产。
- 设置：账户资料、ClawHub 发布组织与 API 令牌。
- 组织与公司管理：AI Direct 业务组织、公司、项目、岗位和成员授权。
- 退出登录：结束 Convex Auth 会话，清理当前登录状态。

## 双组织域边界

`/settings?view=organizations` 读取 Convex 中的 ClawHub 发布组织；`/ai-work-admin/organizations` 读取 Fastify/MySQL 中的 AI Direct 业务组织。两个组织域不得按名称、slug 或 owner 身份自动合并，也不得从发布组织隐式继承业务权限。

因此，用户可以是某个发布组织的 owner，同时在 AI Direct 中没有任何成员关系。此时 AI Direct 组织页面应成功加载并返回空列表，而不是显示发布组织、自动创建业务组织或授予 owner 权限。

## 生产验收状态

已完成：

- owner 真实身份的 AI Direct 公司列表与详情只读链路通过。
- 第二个受控账号在 ClawHub 发布组织中仅能看到自己的组织。
- 同一第二账号进入 AI Direct 组织页面时得到 0 个组织、0 家公司、0 个项目和 0 个岗位，未看到 owner 的 AI Direct 资源。
- 真实会话退出、刷新后保持退出以及 4 位验证码重新登录通过。

仍需完成：

1. outsider 使用 owner 的真实组织或公司 ID 直接访问，必须返回 `403`，不能依赖列表隐藏代替对象级授权。
2. owner 为 outsider 授予最小成员角色；outsider 在同一会话中获得对应读取权限。
3. owner 撤销该成员关系；outsider 不重新登录即可立即失去权限。
4. 清理测试成员关系与临时响应，不保留 Bearer token、验证码或内部资源 ID。

入口可见、页面可打开、代码已实现、生产已发布和生产 RBAC 已验收是五个独立状态，不得互相替代。