# effect-v4 branch triage

Checked 2026-11-02 against origin/main `20eba47`. Source: worktree `~/cloudflare/my-ax-effect`, branch `effect-v4` at `22e212b`. The 70 commits are the ones `git cherry origin/main effect-v4` reports as not on main by patch.

Method: for each commit, whether its files exist on main, whether its exported symbols exist on main, and what share of its added lines appear verbatim in main's version of the same file. Low-match commits were read by hand.

Result: 44 done-on-main, 25 obsolete, 1 needed (partial).

| Commit | Subject | Verdict | Evidence |
|---|---|---|---|
| `04421ba` | feat: add scoped capability review panel | done-on-main | src/capability-review.ts + route + page on main; internal hosts reworked through internal-source-hosts (#269) |
| `4d9f8e2` | fix: render capability demo proof server side | done-on-main | CapabilitiesPage renders proof server side on main via demoUrlsFor(hosts) |
| `952b6ba` | capability-review: add ax-mcp portal resource alongside cf-portal | obsolete | ax-mcp portal entry reverted by 68317fe; main forbiddenTools has no ax-mcp |
| `c4b11cf` | capability-review: test ax-mcp portal parsing alongside cf-portal | obsolete | test for the reverted ax-mcp entry |
| `68317fe` | revert: remove AX MCP private host from public source | done-on-main | same revert is on main as 3679a94 |
| `07e2605` | feat(agents): issue/PR lifecycle workflows with visual-diff gate | obsolete | agents/ tree deleted on main by b718486 (#268, factory Workers removed) |
| `435cdac` | fix(agents): split HMAC hook from Access-gated agents Worker | obsolete | agents/ hook Worker deleted by #268 |
| `aeb0684` | fix(agents): keep secret Worker off the public internet | obsolete | agents/wrangler.jsonc deleted by #268 |
| `bbba6d1` | fix(attention): Open source must open the GitLab/GitHub href | done-on-main | notify.ts isAllowedExternalHref(externalSourceHosts) + source-href.ts on main (#269 generalised the host list) |
| `1540df7` | feat: file one GitHub issue per live error (#61) | done-on-main | same feature merged as 666029b (#61); its agents/ part deleted by #268 |
| `fd3747a` | docs: name the desk-live gate, and remove a leaked employee hook host | done-on-main | proof/desk-live.sh on main, all 59 added lines present |
| `ce666e9` | fix: work_code summarizes cmux inventory instead of truncating to one workspace | needed (partial) | on main: cmux summary, dir kind, 14-day failed runs, 200-line cap. Missing: my_ax_code bare-name wrapper (wrapCoordinatorCode) and jobs_list dropping prompt bodies (promptChars) |
| `520feaf` | feat: my-ax lists and runs Pantry recipes over a Worker service bind | done-on-main | Pantry list/run is on main as pantry-program.ts (Effect) via #227 |
| `3374b7c` | fix: invoke Pantry recipe functions instead of nesting them unused | done-on-main | pantryRecipeExecutionCode invokes callable bodies on main |
| `d82e1a6` | fix: pass capability-gated bindings to Pantry recipes | done-on-main | ctx carries bindings on main (all 5 lines present) |
| `ca381e4` | fix: keep voice enabled while call is active | obsolete | main deliberately sets voiceEnabled after completion; its test asserts "enabled only after call activation completes" |
| `7713e3b` | feat: add bounded notification reads to page tools | done-on-main | listNotifications is in src/ui/page-registry.ts on main |
| `1c468f9` | fix: lease and cap backlog sweep retries | obsolete | agents/src/sweep.ts deleted by #268 |
| `d80ef30` | fix: reject factory receipts as product changes | obsolete | agents/ policy deleted by #268 |
| `2973be4` | fix: close placeholder-only factory PRs | obsolete | agents/ deleted by #268 |
| `af8a7fd` | feat: report preview source revision | done-on-main | src/index.tsx reports commit: PREVIEW_GIT_SHA on main |
| `866b705` | fix: make issue triage terminal | obsolete | agents/ deleted by #268 |
| `9787aba` | fix: close non-actionable boarded issues | obsolete | agents/ deleted by #268 |
| `4dbb0f3` | fix: lease active issue implementations | obsolete | agents/ deleted by #268 |
| `c6be63f` | fix: upgrade GLM to 5.3 | obsolete | model catalog superseded; main already lists glm-5.3 |
| `cf9bbd9` | fix: hide failing production models | obsolete | model catalog superseded by later main changes |
| `01608b0` | fix: remove unreliable GPT-5.5 | obsolete | model catalog superseded by later main changes |
| `8fc0db9` | feat: upgrade Kimi to K3 | obsolete | reverted by acd4c8a; main later added kimi-k3 on its own |
| `acd4c8a` | Revert "feat: upgrade Kimi to K3" | obsolete | revert of 8fc0db9 |
| `3d642d6` | fix: preserve issue labels in factory sweeps | obsolete | agents/ deleted by #268 |
| `614245a` | refactor: establish Effect v4 backend migration | done-on-main | landed via #227 (6f06020); added lines on main: 237/244 (97%) |
| `c82724e` | refactor: run gateway backoff through Effect | done-on-main | retryFetchEffect lives in src/gateway-retry.ts on main (moved by f57fdd5) |
| `f57fdd5` | refactor: separate Effect gateway program from fetch adapter | done-on-main | landed via #227 (6f06020); added lines on main: 31/32 (96%) |
| `6db723e` | refactor: run public web search through Effect | done-on-main | landed via #227 (6f06020); added lines on main: 61/63 (96%) |
| `ef0fbeb` | test: run web search checks with node test | done-on-main | landed via #227 (6f06020); added lines on main: 12/12 (100%) |
| `8c634af` | test: cover migrated Effect programs in backend gate | done-on-main | landed via #227 (6f06020); added lines on main: 0/0 (-1%) |
| `41093d4` | refactor: run dead session recovery through Effect | done-on-main | landed via #227 (6f06020); added lines on main: 56/58 (96%) |
| `907aa17` | refactor: add Effect database service for conversation starters | done-on-main | landed via #227 (6f06020); added lines on main: 63/63 (100%) |
| `c165ee8` | refactor: migrate smoke proof plan to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 135/136 (99%) |
| `d114d39` | chore: enforce Effect backend architecture | done-on-main | landed via #227 (6f06020); added lines on main: 24/24 (100%) |
| `59e4be2` | refactor: manage terminal probe resources with Effect | done-on-main | landed via #227 (6f06020); added lines on main: 79/83 (95%) |
| `56519bc` | refactor: manage terminal upgrade proof with Effect | done-on-main | landed via #227 (6f06020); added lines on main: 63/63 (100%) |
| `61d65a3` | refactor: migrate live terminal proof to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 110/110 (100%) |
| `045aebe` | chore: correct backend evidence classifications | done-on-main | landed via #227 (6f06020); added lines on main: 9/9 (100%) |
| `5048387` | refactor: migrate cycle cost persistence to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 60/60 (100%) |
| `5c1e18a` | chore: classify SDK workspace adapters | done-on-main | landed via #227 (6f06020); added lines on main: 2/2 (100%) |
| `d847034` | refactor: migrate workspace MCP operations to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 82/84 (97%) |
| `0f5dc28` | chore: classify bounded workspace reader adapter | done-on-main | landed via #227 (6f06020); added lines on main: 0/0 (-1%) |
| `8ac5c50` | refactor: migrate reusable tool preferences to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 48/48 (100%) |
| `f1bf8de` | refactor: migrate session pinning to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 40/40 (100%) |
| `1ce65dd` | refactor: migrate decision response compensation to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 54/54 (100%) |
| `3412d23` | refactor: migrate desk compare-and-set writes to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 17/17 (100%) |
| `ade82d1` | refactor: migrate Pantry recipe reads to Effect | done-on-main | landed via #227 (6f06020); added lines on main: 43/46 (93%) |
| `87b93e4` | refactor: run voice prompt guard through Effect | done-on-main | landed via #227 (6f06020); added lines on main: 19/19 (100%) |
| `c982661` | refactor: add Effect program for run receipt events | done-on-main | landed via #227 (6f06020); added lines on main: 22/22 (100%) |
| `c4759c6` | refactor: expose lazy Access JWT verification Effect | done-on-main | landed via #227 (6f06020); added lines on main: 15/15 (100%) |
| `588438e` | chore: classify Web Crypto as a runtime adapter | done-on-main | landed via #227 (6f06020); added lines on main: 0/0 (-1%) |
| `e4a3a68` | refactor: publish workspace snapshots through Effect | done-on-main | workspace-snapshot-program.ts publishes through Effect on main; main INSERT also writes size_bytes |
| `117424a` | chore: classify workspace lifecycle as runtime adapter | done-on-main | landed via #227 (6f06020); added lines on main: 0/0 (-1%) |
| `d7ede2d` | chore: classify agent and tool runtime boundaries | done-on-main | landed via #227 (6f06020); added lines on main: 0/0 (-1%) |
| `06625a7` | chore: classify proof and operational execution adapters | done-on-main | landed via #227 (6f06020); added lines on main: 2/2 (100%) |
| `30c59c0` | chore: classify backend integration adapters | done-on-main | landed via #227 (6f06020); added lines on main: 6/6 (100%) |
| `c2ed6c4` | refactor: finish backend Effect inventory and worker build | done-on-main | landed via #227 (6f06020); added lines on main: 4/4 (100%) |
| `def2daa` | refactor: migrate factory audit path to Effect | obsolete | agents/ audit path deleted by #268 |
| `553b13b` | test: align factory sweep drift guard | obsolete | agents/ test deleted by #268 |
| `ef53146` | refactor: migrate factory triage path to Effect | obsolete | agents/ triage path deleted by #268 |
| `deb238e` | refactor: migrate factory review path to Effect | obsolete | agents/ review path deleted by #268 |
| `e72f4db` | refactor: run factory Effects at Workflow boundaries | obsolete | agents/ workflow entry deleted by #268 |
| `8cac9d3` | chore: classify factory live ports as runtime adapters | obsolete | classifies agents/src/ports.ts, which no longer exists |
| `22e212b` | refactor: add bounded model output repair | obsolete | agents/src/model-output.ts; agents/ deleted by #268 |

## The needed piece

`ce666e9` bundled six connector fixes. Four are on main. Two are not, and this PR adds them:

- `my_ax_code` accepts bare method names (`listSessions(...)`) as well as `codemode.listSessions(...)`. Added as `wrapCoordinatorCode` in `src/coordinator-code.ts`.
- The `jobs_list` coordinator method returns `promptChars` instead of each job's full prompt body (`summarizeCoordinatorJob`).

## Worktree and remote branches

- Dirty files in the worktree: `agents/src/review.ts`, `agents/src/review.test.ts`, `agents/src/preview-check.test.ts`. These are uncommitted PR-evidence validation (`validatePrEvidence`) for the factory review Worker. Obsolete: `agents/` was deleted by #268. (The handoff listed 4 dirty files. The fourth is the untracked `.pi/fresh-session-handoff/` directory, which is session notes, not code.)
- `origin/refactor/effect-v4-canonical` (last commit 2026-09-08): 59 commits not on main by patch, all 59 inside the 70 above. Nothing extra.
- `origin/factory-owner-effect` (last commit 2026-09-05): 59 commits not on main by patch, all 59 inside the 70 above. Nothing extra.
