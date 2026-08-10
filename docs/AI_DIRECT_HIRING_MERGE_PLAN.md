# AI Direct Hiring — Merge Plan (Local, Not Executed)

> Status: **handoff document only**. No actual merges, pushes, or PRs performed.
> Generated: 2026-08-01, end of multi-agent session.
> Author role: Merge-Readiness Agent (I).
> Source branch captured: `feature/ai-direct-hire-p1-runtime` @ `8284931`.

## 0. TL;DR for the maintainer

Four long-lived working branches (`B`, `C`, `E`, `F`, `G`, plus the `integrated` baseline and the original `foundation`) sit in the local repo. There is **one canonical merge target** if you want the full system: take `integrated` and merge in `F` (P2), then `E` (P1 frontend), then `G` (P1 runtime). G already absorbed F's services/routes via a manual commit (`f58a3b4`), so any merge is effectively two real merges from integrated's perspective: **E** and **G**.

No high-criticality collisions were found outside the Fastify route-handler files that F and G both extended. Frontend (E) touches an entirely disjoint subtree (TanStack routes + `src/lib/`), so E↔integrated and E↔F/G should be trivial.

The working tree on `feature/ai-direct-hire-p1-runtime` (G) currently has uncommitted edits from another teammate (`prisma/schema.prisma`, new migration `20260801_ai_direct_hiring_obsidian_m1`, `src/routes/settings/memory.tsx`, `src/styles.css`, `src/routeTree.gen.ts`). **Do not commit the merge plan on top of an agent that is still mid-edit — coordinate or stash first.**

---

## 1. Branch inventory (as of capture time)

| Local branch                                               | Commit                | Builds on                            | Subject                                                   |
| ---------------------------------------------------------- | --------------------- | ------------------------------------ | --------------------------------------------------------- |
| `master`                                                   | `d05bb96`             | —                                    | Initial ClawHub commit (pre-AI-Direct-Hiring)             |
| `feature/ai-direct-hire-foundation`                        | `916ce2b`             | `master`                             | Baseline report only — diverged from integrated later     |
| `feature/ai-direct-hire-p1-backend` (B)                    | `8788b8a`             | `foundation`                         | P1 backend core (already merged into `integrated`)        |
| `feature/ai-direct-hire-p0-mount` (C)                      | `d39eaf9`             | `B`                                  | P0 mount — errors/audit/outbox/idempotency (merged in)    |
| `feature/ai-direct-hire-integrated` (D)                    | `daf41f0`             | `B + C`                              | Integrator's "B+C merged + tracker doc" baseline          |
| `feature/ai-direct-hire-p2-hiring` (F)                     | `ddcdead`             | `D`                                  | P2 routes + services (companies/projects/roles/...)       |
| `feature/ai-direct-hire-p1-frontend` (E)                   | `2060975`             | `D`                                  | P1 frontend (employer dashboard, agents, offers, ...)     |
| `feature/ai-direct-hire-p1-runtime` (G)                    | `8284931`             | `D` (manually pulled F in `f58a3b4`) | P1 runtime — job queue + projection + jobs/workers routes |
| `feature/mysql-migration` / `baseline-mysql-migration-fix` | `0d9f0d1` / `916ce2b` | `master`                             | Pre-existing MySQL fix branches — unrelated               |

`git merge-base --is-ancestor` confirmed: **E, F, and G are all descendants of `integrated`.** B and C are also descendants but have been fully absorbed — they are not merge-relevant any more.

### Worktrees

```
/www/wwwroot/iclawstore.com   8284931 [feature/ai-direct-hire-p1-runtime]
```

Only one worktree is attached (the main repo on G). No detached partner worktrees, so any prior agent sessions have already released theirs.

---

## 2. Diff stats vs `integrated`

| Branch             | Files changed | Lines (insertions + deletions, `git diff --stat` totals) | Net insertions vs D                                 |
| ------------------ | ------------- | -------------------------------------------------------- | --------------------------------------------------- |
| **E** (frontend)   | 16            | **+2945 / -0**                                           | +2945 lines (all additive)                          |
| **F** (P2 hiring)  | 15            | **+3608 / -0**                                           | +3608 lines (all additive)                          |
| **G** (P1 runtime) | 16            | **+4126 / -0**                                           | +4126 lines (all additive; F was already copied in) |
| B (already in D)   | 7             | reverse diff (-2243)                                     | historical only                                     |
| C (already in D)   | 12            | reverse diff (-1930)                                     | historical only                                     |

All three current branches are **additive**: zero deletions vs `integrated`. That's why the conflict surface is concentrated on the per-file content below.

---

## 3. Potential conflict surface

Cross-branch file overlap (`comm -12` of `git diff --name-only` output):

### E ∩ F — empty

E's surface (`src/routes/employer/**`, `src/routes/me/credentials.tsx`, `src/components/employer/**`, `src/lib/aiDirectApi.ts`, `src/lib/aiDirectErrorMessages.ts`, `src/lib/i18n/translations.ts`, `src/lib/nav-items.ts`, `src/components/Header.tsx`) does **not** touch `server/`. **No conflict.**

### E ∩ G — empty

Same as above. **No conflict.**

### F ∩ G — 9 files

The conflict surface is between F and G (both backend) and it is concentrated in:

```
server/src/routes/aiDirectApprovals.ts        (both extend)
server/src/routes/aiDirectCapabilities.ts     (both extend)
server/src/routes/aiDirectCompanies.ts        (both extend)
server/src/routes/aiDirectEmployments.ts      (both extend)
server/src/routes/aiDirectHiring.ts           (both extend; G adds jobs + workers registration)
server/src/routes/aiDirectOffers.ts           (both extend)
server/src/services/approvalStateMachine.ts   (both)
server/src/services/employmentStateMachine.ts (both)
server/src/services/offerStateMachine.ts      (both; G adds a few transitions)
```

**Practical risk:** low-to-moderate, because G already absorbed F at commit `f58a3b4` ("chore: integrate F's P2 routes + services into G baseline"). Inspecting the `git diff F..G` of those 9 files would tell you whether the re-merge from `integrated` is purely a reapplication (no-op) or whether G has new logic F does not (in which case maintainers need to choose "ours" vs "theirs" per file).

### E ∩ F ∩ G — same 9 files as F ∩ G

E does **not** participate in backend conflicts at all.

### Doc files

| Doc                                           | Touched by     | Conflict risk         |
| --------------------------------------------- | -------------- | --------------------- |
| `docs/AI_DIRECT_HIRING_BASELINE.md`           | foundation     | none                  |
| `docs/AI_DIRECT_HIRING_P0_MOUNT.md`           | C → integrated | none (already merged) |
| `docs/AI_DIRECT_HIRING_P1_BACKEND.md`         | B → integrated | none                  |
| `docs/AI_DIRECT_HIRING_P1_RUNTIME.md`         | G only         | none                  |
| `docs/AI_DIRECT_HIRING_P2_HIRING.md`          | F only         | none                  |
| `docs/AI_DIRECT_HIRING_P1_FRONTEND.md`        | E only         | none                  |
| `docs/AI_DIRECT_HIRING_INTEGRATION_REPORT.md` | D              | none                  |

Each doc is owned by exactly one branch. **No doc conflicts.**

### Prisma schema / migrations

| File                                                           | Owned by         |
| -------------------------------------------------------------- | ---------------- |
| `prisma/schema.prisma`                                         | B (already in D) |
| `prisma/migrations/20260801_ai_direct_hiring_p1/migration.sql` | B (already in D) |

**⚠ However**, when capturing this report the working tree on G has **uncommitted** changes to `prisma/schema.prisma` and an untracked migration folder `prisma/migrations/20260801_ai_direct_hiring_obsidian_m1/`. These appear to come from a sibling agent (likely Agent H per the original brief) and are **not part of any branch yet**. Don't merge until that work is either committed on its own branch or stashed away — otherwise `git checkout` collisions will appear.

---

## 4. Suggested merge order

Assuming the maintainer wants **all four feature branches in one final branch** (the "all-in-one" target):

1. `feature/ai-direct-hire-integrated` _(base; commit `daf41f0`)_
2. merge `feature/ai-direct-hire-p2-hiring` _(F; commit `ddcdead`)_
   - Likely zero conflicts: G has absorbed F already, but a clean re-merge from `integrated` is still a sanity check.
   - If conflicts appear on the 6 service files, take "theirs" (G's manual integration in `f58a3b4` is the canonical version).
3. merge `feature/ai-direct-hire-p1-frontend` _(E; commit `2060975`)_
   - Zero expected conflicts in `server/` or `docs/`. Frontend subtree is disjoint.
   - Possible dependency drift in `package.json` — review after the merge.
4. merge `feature/ai-direct-hire-p1-runtime` _(G; commit `8284931`)_
   - Should land cleanly because G is built atop `f58a3b4` (already includes F). Watch the 9 overlapping files for any delta applied after `f58a3b4` (e.g., the test additions and `runProjection.ts`).
5. After all four land: re-run `bun run ci:static` locally, then push the resulting branch.

### Alternative cleaner strategy

If you don't care about F's standalone commit history, **start from G directly** (it already contains F), merge in E, and you end up with two merges instead of three. Topology:

```
integrated ──┬── G (contains F) ──┐
             └── E (frontend)  ───┴──▶ feature/ai-direct-hire-all-in-one
```

This is what the final all-in-one branch should look like if you want to minimize conflict resolution work.

---

## 5. Concrete handoff commands (for the executor — **not run here**)

```bash
# Sanity: workspace clean on G before starting
cd /www/wwwroot/iclawstore.com
git status -s    # should be empty (it is not — see §6)

# Resolve the uncommitted edits on G first (stash or commit them somewhere)
git stash push -u -m "wip-on-G-pre-merge"

# Create the local integration branch from integrated
git checkout feature/ai-direct-hire-integrated
git checkout -b feature/ai-direct-hire-all-in-one-local

# Two-way merge (recommended minimal path)
git merge --no-ff feature/ai-direct-hire-p1-runtime   # brings F's stuff along
# If conflicts on the 9 overlap files: prefer G's version (their changes are
# the F-absorbed integration); see §3.

git merge --no-ff feature/ai-direct-hire-p1-frontend   # disjoint from server/
# Resolve any package.json / lockfile collisions after this merge.

# Full four-way merge (if you want each branch's full history visible)
# git merge --no-ff feature/ai-direct-hire-p2-hiring
# git merge --no-ff feature/ai-direct-hire-p1-frontend
# git merge --no-ff feature/ai-direct-hire-p1-runtime

# After all merges, run the CI gate you trust most (NOT in this session):
#   bun run ci:static              # formatting + lint + dead-code + audit
#   bun run ci:types-build         # full TS + build
#   bun run ci:packages            # schema + CLI + moderation packages
#   bun run test:pw:local-auth     # signed-in browser gate

# Push the candidate (NOT in this session):
#   git push origin feature/ai-direct-hire-all-in-one-local
# Open PR against main. After CI green, request review.
```

> **Do not** run `git push` until `bun run ci:static` is green and you have at least one other maintainer sign-off.

---

## 6. Risk register

| Risk                                                                                                         | Impact                       | Likelihood | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| All branches are unverified by CI in this environment                                                        | High                         | Certain    | Run `bun run ci:static` and at minimum `bun run lint`/`bun run format:check` before pushing                    |
| Uncommitted edits on G (schema + new migration + new route + styles + route tree)                            | High if you checkout naively | Certain    | Stash (`git stash push -u`) or commit them on a separate branch first                                          |
| Memory pressure on the dev server (3.4 / 3.6 GB)                                                             | Medium                       | High       | Defer running `dev` / `build` / `test` until off-hours; CI handles it instead                                  |
| E (frontend) may assume backend route names that F/G renamed                                                 | Medium                       | Medium     | Read `src/lib/aiDirectApi.ts` and check against the Fastify route register in `server/src/routes/aiDirect*.ts` |
| G ↔ F overlap on 9 service files                                                                             | Medium                       | Medium     | Already reconciled in commit `f58a3b4`; favor G during conflicts                                               |
| `prisma/schema.prisma` modified by two agents                                                                | High                         | High       | Coordinate ownership before merging — only one agent should hold the schema                                    |
| `prisma/migrations/20260801_ai_direct_hiring_obsidian_m1/` is **untracked**                                  | Medium                       | Certain    | Decide if it should land before or after the merge; `prisma migrate deploy` cannot run inside this session     |
| `feature/ai-direct-hire-foundation` diverged after `integrated` was cut                                      | Low                          | Low        | Ignore `foundation` — its history is preserved in `integrated`'s ancestor chain                                |
| Auto-generated `src/routeTree.gen.ts` will collide if E added routes and another agent also touched the file | Low                          | Low        | Recreate with the project's `bun run dev` / codegen script post-merge                                          |

---

## 7. What was deliberately **not** done in this session

- No real `git merge`, `rebase`, `reset`, or `cherry-pick` executed.
- No `git push`, no `git fetch`, no `git pull` (per environment constraints).
- No creation of integration branch yet — held off because the G working tree has in-flight edits from a sibling agent.
- No `bun` / `tsc` / `prisma` invocations.
- No PM2 / dev-server restarts.

---

## 8. Next actions (for tomorrow / a maintainer)

- [ ] Decide on **two-way merge (G then E)** vs **four-way merge (F, E, G)** — recommendation: two-way.
- [ ] Resolve the uncommitted edits on G first (`git status` shows modified `prisma/schema.prisma`, `src/routeTree.gen.ts`, `src/styles.css`; untracked `prisma/migrations/20260801_ai_direct_hiring_obsidian_m1/`, `src/routes/settings/memory.tsx`).
- [ ] Create `feature/ai-direct-hire-all-in-one-local` from `integrated`, merge G then E (see §5).
- [ ] Run `bun run ci:static` on the result.
- [ ] Open the PR, route it for two reviewers (one backend, one frontend).
- [ ] After CI green and review: deploy via the standard `Deploy` workflow with target `full`.

---

## 9. Provenance / how this report was produced

- Inspections performed: `git branch -v`, `git worktree list`, `git log --oneline --all --graph -20`, `git merge-base --is-ancestor` (four branches), `git diff --stat` (five branches vs `integrated`), `git diff --name-only` (three branches vs `integrated`), `comm -12` between each pair of changed-file lists, `git log` per-doc and per-migration.
- Report committed: see next section.
