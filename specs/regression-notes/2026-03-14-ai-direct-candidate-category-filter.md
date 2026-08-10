# AI 直聘候选分类筛选回归记录

> **状态**：已发布；已启用目标 QA 组织目录，待已认证浏览器完成分类请求证据
> **适用范围**：`/recruit-ai` 的付费雇佣流程、候选目录 API

## 运行时能力边界

- 候选目录保持默认关闭；仅 QA 组织 `qa-employeedirectory-2026-03-14-15aff8b5`（ID：`15aff8b5-4a60-4eea-aaf6-3d8c40c0c754`）启用 `candidateCatalog`。
- 开关由 `ecosystem.config.cjs` 注入 `iclawstore-api` 的 `AI_DIRECT_FEATURE_FLAGS`；前端 SSR 服务不处理候选目录 API，请勿仅重启 `iclawstore.service` 作为开关变更。
- 修改开关后必须以 `pm2 reload ecosystem.config.cjs --only iclawstore-api --update-env` 重载 API，再重启 SSR 并检查两个进程健康状态。

## 行为约束

- 候选分类必须从当前组织授权范围内的 `GET /catalog/categories` 获取，不允许使用硬编码分类或跨组织缓存。
- 用户切换分类时，候选列表必须重新请求 `GET /catalog/agents?category=<category>&limit=50`；不能只在浏览器内对已加载列表进行过滤。
- 候选展示仍以服务端目录结果为真值，并额外仅展示 `availability = available`、`priceStatus = active` 的 Agent。
- 切换公司时必须清空当前分类和已选 Agent，避免将原公司选择带入新公司的订单。

## 回归门禁

1. 组件测试应验证切换到分类 `design` 后，目录请求带有 `category: 'design'` 和 `limit: 50`。
2. 已登录且拥有 recruiter/admin/owner 公司角色的验收账号，在 `/recruit-ai` 选择一个非默认分类后：浏览器网络请求必须包含该 `category` 参数，页面只渲染该分类的候选 Agent。
3. 切换公司后，分类回到“请选择”，Agent 单选状态清空；后续请求使用新公司的 `X-Organization-Id`。

## 发布验收记录

- 2026-08-08：生产页面已确认可使用招聘公司上下文并选择 `company-A`。此前目录请求被组织功能开关拒绝，页面显示“候选目录尚未启用”。
- 2026-08-08：已为隔离 QA 组织显式启用 `candidateCatalog`；`iclawstore-api` 经 PM2 重载后为 `online`，分类接口未认证请求返回预期 `401`；SSR `iclawstore.service` 重启后为 `active`，`/plugins` 返回 `200`。尚待在同一已认证浏览器中选择实际分类，确认请求参数及候选列表过滤结果。
