# 2026-08-06 AI直聘 Playwright 冒烟失败交接

## 目的

记录生产发布 `31093226382` 的 UI 冒烟失败证据，供后续在不重复发布的前提下复现、定位并修复。

## 已证实的发布状态

- 运行地址：[Deploy #31093226382](https://github.com/yungou168-source/iclawstore/actions/runs/31093226382)
- 提交：`8891573541bc5013874bb7b2931d7de3ead2086d`
- 运行最终状态：`failure`
- `Build self-hosted SSR artifact`：成功。
- `Deploy self-hosted SSR`：成功。
- `Smoke test production HTTP`：成功。
- 失败步骤：`Smoke test production UI`。
- 失败后的 `tag-production-deployment` 被跳过；这不表示 SSR 未切换，只表示发布工作流未获得完整成功结论。

因此当前问题的边界是：生产站点的 HTTP 契约可用，但 Playwright UI 断言与实际渲染结果不一致。尚未证明是页面实现回退、文本/语义结构变化、测试基准 URL 错误，还是浏览器运行时错误。

## 执行配置

失败命令：

```bash
bunx playwright test --workers=1 \
  e2e/menu-smoke.pw.test.ts \
  e2e/publish-entry-workflows.pw.test.ts \
  e2e/upload-auth-smoke.pw.test.ts
```

配置会在以下三个项目中执行同一组用例：`chromium`、`mobile-chrome`、`mobile-safari`。源测试共 7 个，三端合计应为 21 个首轮执行；失败后的重试会额外显示。

## 结果矩阵

| 源用例                                                     | chromium | mobile-chrome | mobile-safari | 结论         |
| ---------------------------------------------------------- | -------- | ------------- | ------------- | ------------ |
| `AI employee directory loads without error`                | 失败     | 失败          | 失败          | 三端一致失败 |
| `AI employee directory filters roles without error`        | 失败     | 失败          | 失败          | 三端一致失败 |
| `workspace header routes render`                           | 失败     | 失败          | 失败          | 三端一致失败 |
| `desktop client page exposes the AI employee directory`    | 失败     | 失败          | 失败          | 三端一致失败 |
| `AI employee selection exposes the desktop continuation`   | 通过     | 通过          | 通过          | 三端通过     |
| `AI employee category filtering stays healthy`             | 通过     | 通过          | 通过          | 三端通过     |
| `AI employee search handles an empty result without error` | 失败     | 失败          | 失败          | 三端一致失败 |

最终统计：15 个源用例失败，6 个通过；每个失败用例已执行 2 次重试，运行耗时约 10.8 分钟。

## 失败断言

### 员工目录页面主标题

以下三个用例都在 `/recruit-ai` 导航成功后，等待相同断言超时：

```text
getByRole('heading', { name: '招聘你的 AI 员工' })
```

涉及：

- `e2e/menu-smoke.pw.test.ts` 的目录加载用例和导航用例。
- `e2e/publish-entry-workflows.pw.test.ts` 的桌面客户端跳转用例。

共同现象：URL 已到达 `/recruit-ai`，但 10 秒内没有可访问性角色为 `heading`、名称完全为 `招聘你的 AI 员工` 的元素。

### 精确岗位数量

搜索 `地理学家` 后，岗位标题 `地理学家` 已可见，但以下精确文本不存在：

```text
1 个岗位
```

这说明目录数据及搜索路径至少部分工作，失败点局限于数量文本的内容或渲染结构。

### 空搜索结果

输入 `不存在的测试岗位` 后，以下精确文本不存在：

```text
没有匹配的 AI 员工。
```

尚未确认页面是否使用不同文案、没有结果的状态未渲染，或查询词实际仍命中数据。

## 已通过的行为

以下通过结果排除了“`/recruit-ai` 完全不可用”的结论：

1. 在员工目录中，`法务` 分类按钮可点击，岗位数量和首个 `选择员工` 按钮可见。
2. 点击首个 `选择员工` 后，`在客户端继续招聘` 文本和指向 `/releases` 的链接可见。
3. 上述行为在三种浏览器项目中都通过。

## 关联的测试文件

- `e2e/menu-smoke.pw.test.ts`
- `e2e/publish-entry-workflows.pw.test.ts`
- `e2e/upload-auth-smoke.pw.test.ts`
- `e2e/helpers/runtimeErrors.ts`

当前失败用例均使用中文精确文本或精确可访问名称作为契约；修复前应先以运行时 DOM 确认这些是否仍是产品意图，而不是直接放宽断言。

## 可用证据

每个失败尝试都产出：

- `error-context.md`
- `trace.zip`

GitHub 日志中给出的查看方式：

```bash
npx playwright show-trace test-results/<失败目录>/trace.zip
```

优先查看 Chromium 的首轮 trace，即：

```text
test-results/menu-smoke.pw-AI-employee-directory-loads-without-error-chromium/trace.zip
```

应记录 trace 中的最终 URL、页面截图、DOM 快照、控制台错误、网络失败请求和页面可访问性树。不要仅根据测试超时推断页面没有渲染。

## 下次续接的最小排查顺序

### 1. 获取并保留此次失败运行的完整日志与附件

```bash
gh run view 31093226382 --repo yungou168-source/iclawstore --log-failed
```

如果工作流将 `test-results/` 上传为 artifact，下载后查看上述 Chromium trace 和对应 `error-context.md`。

### 2. 验证生产页的实际语义结构

使用生产基准地址，仅跑一个 Chromium 用例并保留 trace：

```bash
PLAYWRIGHT_BASE_URL=https://www.iclawstore.com \
bunx playwright test --project=chromium --workers=1 --trace=on \
  e2e/menu-smoke.pw.test.ts
```

检查 `/recruit-ai` 的实际：

- 主标题的文本、HTML 标签、`role` 和可访问名称。
- 搜索 `地理学家` 后的数量文案。
- 搜索不存在词后的空状态文案。
- `console`、`pageerror`、失败请求与重定向。

一次只验证一个变量：先直接访问 `/recruit-ai`，再验证首页导航，最后验证桌面客户端下载页跳转。

### 3. 根据证据选择修复位置

- 若实际页面语义与产品意图一致，但测试使用了错误的精确文案或错误的 role，应只更新 Playwright 契约。
- 若页面文案或语义结构偏离 `AI直聘` 的公开契约，应在页面组件中恢复明确的标题、数量和空状态，再保留严格测试。
- 若 trace 显示运行时错误、资源请求失败或页面落到错误版本，应先修复部署/运行时原因；不要用更宽松的选择器掩盖问题。

## 工作区注意事项

当前工作区存在大量未跟踪的发布和构建产物，包括 `.output*`、`.nitro-next/`、`test-results/` 等。它们不属于本回归记录，也不应通过 `git add -A` 提交。后续若提交修复，只暂存明确修改的测试、源码和本记录。
