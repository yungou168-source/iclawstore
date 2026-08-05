# AI 直聘 — Lint 修复交付(K, 2026-08-01)

> **目的**:记录 `feature/ai-direct-hire-all-in-one` 上合并后由 K 完成的所有 lint 修复,
> 作为完整合并链的最后一步。
>
> **关联文档**:
> - `docs/AI_DIRECT_HIRING_MERGE_EXECUTION_REPORT.md` — 合并过程
> - `specs/ai-direct-hiring-progress.md` — 全局进度跟踪

## 1. 背景

在 merge commit `4fdbe2c`(P1 frontend 整合)完成后,
`bun run lint` 在合并产出的代码上失败 23 条:

- 20 × `no-unused-vars` —— 主要来自 E(P1 frontend)新增页面里的死 import 与死变量。
- 3 × `typescript(no-misused-spread)` —— F(G2) 的 3 个 fetch 客户端在
  `headers: { "Content-Type": "application/json", ...options.headers }` 处把
  `HeadersInit` 当作纯对象展开,触发 TS 类型告警。

## 2. 修复明细

| 文件 | 修复 |
|---|---|
| `convex/devSeed.ts` | 删 `api` / `QueryCtx` / `generateEmbedding` / `buildEmbeddingText` import;`publicCorpusPreparedRowValidator` / `resetPublicCorpusRows` 加 `_` 前缀;删除未用 `metadata` 局部变量 |
| `src/lib/api.ts` | 删 `getRequiredRuntimeEnv` import;重写 spread headers 逻辑 |
| `src/lib/aiDirectApi.ts` | 重写 spread headers 逻辑 |
| `src/lib/fastifyApi.ts` | 重写 spread headers 逻辑 |
| `src/lib/aiDirectErrorMessages.ts` | 删未用 `ErrorCode` 类型 import |
| `src/routes/skills/-useSkillsBrowseModel.ts` | 删未用 `Skill` 类型 import |
| `src/routes/publishers/index.tsx` | 删未用 `label` 局部变量 |
| `src/routes/employer/projects/$id.tsx` | 删未用 `useParams` import |
| `src/routes/employer/companies/$id.tsx` | 删未用 `Users` icon + `useParams` import |
| `src/routes/employer/agents/index.tsx` | 删未用 `Archive` / `Eye` icon import |
| `src/routes/employer/agents/$id.tsx` | 删未用 `useParams` import |
| `src/routes/employer/offers/index.tsx` | 删未用 `Link` / `CardHeader` / `CardTitle` import |

合计 **12 文件 / 59 增 / 47 删**。

## 3. Spread 修复设计

把这段:

```ts
const response = await fetch(url, {
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers, // TS: HeadersInit 可以是数组 / Headers 实例
  },
  credentials: "include",
});
```

改成显式归一化:

```ts
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (options.headers) {
  if (options.headers instanceof Headers) {
    options.headers.forEach((value, key) => { headers[key] = value; });
  } else if (Array.isArray(options.headers)) {
    for (const [key, value] of options.headers) { headers[key] = value; }
  } else {
    Object.assign(headers, options.headers);
  }
}
const response = await fetch(url, { ...options, headers, credentials: "include" });
```

这样同时支持 `Headers` 实例、键值对数组、纯对象三种 `HeadersInit`,
跟原展开语义等价,且 TypeScript 不再告警。

## 4. 验证

```bash
bun run lint 2>&1 | grep -E "no-unused-vars|no-misused-spread" | wc -l
# → 0
```

## 5. Pre-existing(非合并引入)

`convex/devSeed.ts` 上的 7 条 unused-vars 在
`feature/ai-direct-hire-integrated`(合并前基线)上原本就有,
不是 K 合并引入。K 在同一个 commit 里顺手修了它们以保持 lint 干净。

## 6. Commit

- 分支:`feature/ai-direct-hire-all-in-one`
- Commit:`fed8e30 fix(merge): remove unused imports and fix array spread on object`

---

*更新时间:2026-08-01 12:30 UTC+8*
*负责人:K*