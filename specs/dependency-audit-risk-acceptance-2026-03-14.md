# 依赖审计风险接受记录：2026-03-14

> **状态**：已由发布决策者明确接受，适用于本轮主站发布。
> **范围**：根项目 `bun audit` 当前报告的 critical/high 依赖风险；AI直聘桌面端不属于本轮发布门禁。
> **复查条件**：下一次依赖升级、发布前安全复核，或上游发布可兼容修复版本时，以先发生者为准。

## 决策边界

本次接受不代表漏洞已修复，也不降低其他安全要求。发布门禁继续执行高危以上审计；仅以下已知 advisory ID 作为临时例外。`bun run audit:report` 保留完整（含 moderate/low）报告，用于后续处置。

## 已接受例外

| 依赖链                                          | 风险级别      | Advisory ID                                                                                | 接受理由与补救条件                                                                       |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `vite → postcss → nanoid`                       | high          | `GHSA-28wg-ghj8-5hjv`、`GHSA-2v37-7h3g-55p8`                                               | 构建期间接依赖；评估 Vite/PostCSS 可兼容升级后移除例外。                                 |
| `vite → postcss`                                | high          | `GHSA-r28c-9q8g-f849`                                                                      | 构建期 source map 处理风险；升级 Vite/PostCSS 后复查。                                   |
| `undici`                                        | high          | `GHSA-4cwx-7wf7-3272`、`GHSA-vmh5-mc38-953g`、`GHSA-vxpw-j846-p89q`、`GHSA-hm92-r4w5-c3mj` | 运行时 HTTP 客户端风险；优先升级直接依赖并复测认证/API 流量。                            |
| `@convex-dev/auth → @auth/core`                 | critical/high | `GHSA-7rqj-j65f-68wh`、`GHSA-xmf8-cvqr-rfgj`                                               | 身份链路风险；受现有 Bearer 认证边界限制，但必须在兼容版本可用时优先升级并执行认证回归。 |
| `@tanstack/devtools-vite → shell-quote`         | high          | `GHSA-395f-4hp3-45gv`                                                                      | 开发工具间接依赖；升级上游工具后移除。                                                   |
| `convex → ws`                                   | high          | `GHSA-96hv-2xvq-fx4p`                                                                      | 实时连接依赖；升级 Convex 可兼容版本并压测连接。                                         |
| `@tanstack/react-start → xmlbuilder2 → js-yaml` | high          | `GHSA-52cp-r559-cp3m`、`GHSA-5p4m-2wfm`                                                    | 间接 YAML 解析依赖；升级上游链路后移除。                                                 |

## 例外实现

`package.json` 的 `audit:release` 只检查 high/critical，并显式列出本表对应的例外 ID；`ci:static` 调用该命令。不得使用全局关闭审计或未记录的新增忽略项。
